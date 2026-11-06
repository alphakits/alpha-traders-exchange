-- DEVELOPMENT ONLY: the new payment profile independently checks the same
-- already-normalized reason accepted by normalizeDevelopmentPaymentDisputeReason.
-- Preserve the existing privacy-redaction.ts rules; do not change legacy code.
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.valid_dispute_reason(reason text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  -- ECMAScript trim/\s whitespace, including BOM but excluding U+0085/U+180E.
  spaces text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  whitespace text := '[' || spaces || ']';
  phone_separator text := '[' || spaces || '().-]';
  local_separator text := '[' || spaces || '.-]';
  url_tail text := '[^' || spaces || $rx$<>"']+$rx$;
  -- JavaScript's non-/u \b and \w use ASCII word characters, even beside
  -- non-ASCII letters. PostgreSQL locale-dependent word classes differ.
  boundary text := '(?:(?<=[A-Z0-9_])(?![A-Z0-9_])|(?<![A-Z0-9_])(?=[A-Z0-9_]))';
  normalized text;
  utf16_units integer;
  patterns text[];
BEGIN
  IF reason IS NULL OR reason IS DISTINCT FROM btrim(reason,spaces) OR char_length(reason) NOT BETWEEN 1 AND 500 THEN
    RETURN false;
  END IF;
  SELECT coalesce(sum(CASE WHEN ascii(character)>65535 THEN 2 ELSE 1 END),0)::integer INTO utf16_units
    FROM unnest(string_to_array(reason,NULL)) AS value(character);
  IF utf16_units>500 THEN RETURN false; END IF;
  -- The existing detector uses NFKC and non-Unicode /i. Fold ASCII only:
  -- PostgreSQL ~* or upper() can additionally fold dotless i and other letters.
  normalized:=translate(normalize(reason,NFKC),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  patterns:=ARRAY[
    '(?<![A-Z0-9_])0'||whitespace||'*(?:[234789]|5'||whitespace||'*[0-9])(?:'||phone_separator||'*[0-9]){7}(?![A-Z0-9_])',
    '(?<![A-Z0-9_])(?:\+'||whitespace||'*[0-9]{1,3}|00'||whitespace||'*[0-9]{1,3})(?:'||phone_separator||'*[0-9]){7,12}(?![A-Z0-9_])',
    '(?<![A-Z0-9_])(?:\(?[2-9][0-9]{2}\)?)'||local_separator||'+[0-9]{3}'||local_separator||'+[0-9]{4}(?![A-Z0-9_])',
    boundary||'[A-Z0-9._%+-]+'||whitespace||'*@'||whitespace||'*[A-Z0-9.-]+'||whitespace||'*\.'||whitespace||'*[A-Z]{2,}'||boundary,
    boundary||'[A-Z0-9._%+-]+'||whitespace||'*(?:\[|\()'||whitespace||'*AT'||whitespace||'*(?:\]|\))'||whitespace
      ||'*[A-Z0-9.-]+'||whitespace||'*(?:\[|\()'||whitespace||'*DOT'||whitespace||'*(?:\]|\))'||whitespace||'*[A-Z]{2,}'||boundary,
    boundary||'(?:HTTPS?://)?(?:WWW\.)?(?:WA\.ME|API\.WHATSAPP\.COM|CHAT\.WHATSAPP\.COM|WHATSAPP\.COM|T\.ME|TELEGRAM\.ME|TELEGRAM\.DOG|SIGNAL\.ME|M\.ME|MESSENGER\.COM|VIBER\.COM|LINE\.ME|DISCORD\.GG|DISCORD(?:APP)?\.COM/INVITE|SKYPE\.COM|JOIN\.SKYPE\.COM|INSTAGRAM\.COM|FACEBOOK\.COM|FB\.ME|X\.COM|TWITTER\.COM|SNAPCHAT\.COM)/'||url_tail
      ||'|'||boundary||'(?:MAILTO|TEL|SMS|SKYPE):'||url_tail,
    boundary||'(?:TELEGRAM|TELE'||whitespace||'*GRAM|TG)'||whitespace
      ||'*(?:(?:HANDLE|USERNAME|USER(?:NAME)?|CONTACT|DM|MESSAGE|AT)'||whitespace||'*)?[:@-]'||whitespace||'*@?[A-Z0-9_]{5,32}'||boundary,
    '(?<![A-Z0-9_@])@[A-Z0-9_]{5,32}'||boundary,
    boundary||'(?:CONTACT|MESSAGE|DM|REACH|WRITE)'||whitespace||'+(?:ME|US)'||whitespace||'+(?:ON|VIA|AT)'||whitespace
      ||'+(?:WHATS'||whitespace||'*APP|TELEGRAM|TELE'||whitespace||'*GRAM|SIGNAL|VIBER|LINE|DISCORD)'||boundary,
    boundary||'(?:T\.ME|TELEGRAM\.ME|TELEGRAM\.DOG)/'
  ];
  RETURN NOT EXISTS (SELECT 1 FROM unnest(patterns) AS item(pattern) WHERE normalized COLLATE "C" ~ pattern COLLATE "C");
END;
$fn$;
REVOKE EXECUTE ON FUNCTION alpha_wallet_payment_marketplace_simulation.valid_dispute_reason(text) FROM PUBLIC;
