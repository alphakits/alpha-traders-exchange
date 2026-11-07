-- Development-only revocable consent overlay; retained V1-V5 financial and canonical rows remain unchanged.
-- The original V5 claim/dispute/pause lifecycle remains authoritative. No command here releases or transfers funds.
DO $guard$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT','Etc/GMT','Etc/GMT0') THEN
    RAISE EXCEPTION 'Release consent requires explicit writable SERIALIZABLE simulation in UTC';
  END IF;
END;
$guard$;

CREATE SCHEMA alpha_wallet_release_consent_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_release_consent_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_release_consent_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_release_consent_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE DOMAIN alpha_wallet_release_consent_simulation.identifier AS text
  CHECK (VALUE ~ '^[A-Za-z0-9_-]{1,80}$' AND VALUE NOT IN ('constructor','prototype','__proto__'));
CREATE DOMAIN alpha_wallet_release_consent_simulation.sha256 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');

CREATE FUNCTION alpha_wallet_release_consent_simulation.utf16_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(string_agg(CASE WHEN ascii(ch)>65535 THEN
    lpad(to_hex(55296+(ascii(ch)-65536)/1024),4,'0')||lpad(to_hex(56320+(ascii(ch)-65536)%1024),4,'0')
    ELSE lpad(to_hex(ascii(ch)),4,'0') END,'' ORDER BY ordinal),'')
  FROM regexp_split_to_table(value,'') WITH ORDINALITY AS units(ch,ordinal)
$fn$;

-- Mirrors walletJson followed by JSON.stringify, including JavaScript array-index property ordering.
CREATE FUNCTION alpha_wallet_release_consent_simulation.canonical_json(value jsonb,depth integer DEFAULT 0) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
DECLARE output text; number numeric;
BEGIN
  IF depth>64 THEN RAISE EXCEPTION 'Consent JSON nesting limit exceeded'; END IF;
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS keys(key) WHERE key IN ('__proto__','constructor','prototype')) THEN
        RAISE EXCEPTION 'Consent JSON contains a reserved object key'; END IF;
      SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||alpha_wallet_release_consent_simulation.canonical_json(item,depth+1),','
        ORDER BY CASE WHEN key ~ '^(0|[1-9][0-9]{0,9})$' AND length(key)<=10
          THEN CASE WHEN key::numeric<4294967295 THEN 0 ELSE 1 END ELSE 1 END,
        CASE WHEN key ~ '^(0|[1-9][0-9]{0,9})$' AND length(key)<=10
          THEN CASE WHEN key::numeric<4294967295 THEN key::numeric ELSE NULL END ELSE NULL END,
        alpha_wallet_release_consent_simulation.utf16_key(key) COLLATE "C"),'')||'}'
        INTO output FROM jsonb_each(value) AS entries(key,item);
    WHEN 'array' THEN
      SELECT '['||coalesce(string_agg(alpha_wallet_release_consent_simulation.canonical_json(item,depth+1),',' ORDER BY ordinal),'')||']'
        INTO output FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item,ordinal);
    WHEN 'number' THEN
      number:=value::numeric;
      IF abs(number)>=1000000000000000000000 OR (number<>0 AND abs(number)<0.000001) THEN RAISE EXCEPTION 'Consent JSON numeric magnitude is outside its fixed contract'; END IF;
      output:=trim_scale(number)::text;
    WHEN 'string' THEN output:=value::text;
    WHEN 'boolean' THEN output:=value::text;
    WHEN 'null' THEN output:='null';
    ELSE RAISE EXCEPTION 'Consent JSON type is unsupported';
  END CASE;
  RETURN output;
END;
$fn$;
CREATE FUNCTION alpha_wallet_release_consent_simulation.value_digest(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT encode(sha256(convert_to(alpha_wallet_release_consent_simulation.canonical_json(value),'UTF8')),'hex')
$fn$;
CREATE FUNCTION alpha_wallet_release_consent_simulation.closed_object(value jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(jsonb_typeof(value)='object' AND value ?& keys
    AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(value)='object' THEN value ELSE '{}'::jsonb END))=cardinality(keys),false)
$fn$;
CREATE FUNCTION alpha_wallet_release_consent_simulation.require_runtime() RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $fn$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT','Etc/GMT','Etc/GMT0') THEN
    RAISE EXCEPTION 'Release consent runtime or physical owner is invalid';
  END IF;
END;
$fn$;

-- Exact reconstruction of the frozen canonical participant, including private
-- evidence bytes in the digest only. No credential/session table is captured.
CREATE FUNCTION alpha_wallet_release_consent_simulation.capture_canonical_basis(request_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH target AS MATERIALIZED (SELECT * FROM alpha_exchange.purchase_requests WHERE id=$1),
 requests AS MATERIALIZED (
   SELECT p.* FROM alpha_exchange.purchase_requests p,target t
   WHERE p.id=t.id OR p.payload->>'id'=t.id OR p.seller_id=t.seller_id OR p.payload->>'sellerId'=t.seller_id
     OR p.buyer_id=t.buyer_id OR p.payload->>'buyerId'=t.buyer_id OR p.listing_id=t.listing_id
     OR p.payload->>'listingId'=t.listing_id OR p.trade_id=t.trade_id OR p.payload->>'tradeId'=t.trade_id
   ORDER BY p.sort_index,p.id
 ), listings AS MATERIALIZED (
   SELECT l.* FROM alpha_exchange.listings l,target t
   WHERE l.seller_id=t.seller_id OR l.payload->>'sellerId'=t.seller_id
     OR l.id IN (SELECT listing_id FROM requests UNION SELECT payload->>'listingId' FROM requests)
     OR l.payload->>'id' IN (SELECT listing_id FROM requests UNION SELECT payload->>'listingId' FROM requests)
   ORDER BY l.sort_index,l.id
 ), users AS MATERIALIZED (
   SELECT u.* FROM alpha_exchange.users u WHERE u.id IN (SELECT seller_id FROM requests UNION SELECT buyer_id FROM requests
     UNION SELECT payload->>'sellerId' FROM requests UNION SELECT payload->>'buyerId' FROM requests)
     OR u.payload->>'id' IN (SELECT seller_id FROM requests UNION SELECT buyer_id FROM requests) ORDER BY u.sort_index,u.id
 ), commissions AS MATERIALIZED (
   SELECT c.* FROM alpha_exchange.commissions c,target t WHERE c.seller_id IN (t.seller_id,t.buyer_id)
     OR c.payload->>'sellerId' IN (t.seller_id,t.buyer_id) OR c.purchase_request_id=t.id
     OR c.payload->>'purchaseRequestId'=t.id OR c.payload->>'tradeId'=t.trade_id ORDER BY c.sort_index,c.id
 ), enforcements AS MATERIALIZED (
   SELECT e.* FROM alpha_exchange.marketplace_enforcement_records e,target t WHERE e.seller_id IN (t.seller_id,t.buyer_id)
     OR e.payload->>'sellerId' IN (t.seller_id,t.buyer_id) ORDER BY e.sort_index,e.id
 ), evidence AS MATERIALIZED (
   SELECT e.* FROM alpha_exchange.evidence e,target t WHERE e.purchase_request_id=t.id
     OR e.payload->>'purchaseRequestId'=t.id ORDER BY e.sort_index,e.id
 ), disputes AS MATERIALIZED (
   SELECT d.* FROM alpha_exchange.disputes d,target t WHERE d.purchase_request_id=t.id
     OR d.payload->>'purchaseRequestId'=t.id OR d.trade_id=t.trade_id OR d.payload->>'tradeId'=t.trade_id ORDER BY d.sort_index,d.id
 ), trades AS MATERIALIZED (
   SELECT tr.* FROM alpha_exchange.trades tr,target t WHERE tr.id=t.trade_id OR tr.payload->>'id'=t.trade_id
     OR tr.purchase_request_id=t.id OR tr.payload->>'purchaseRequestId'=t.id ORDER BY tr.sort_index,tr.id
 ), notifications AS MATERIALIZED (
   SELECT n.* FROM alpha_exchange.notifications n,target t WHERE n.user_id IN (t.buyer_id,t.seller_id)
     OR n.payload->>'userId' IN (t.buyer_id,t.seller_id) OR n.payload->>'relatedRequestId'=t.id
     OR n.payload->>'relatedTradeId'=t.trade_id OR n.payload->>'relatedListingId'=t.listing_id ORDER BY n.sort_index,n.id
 ), audits AS MATERIALIZED (
   SELECT a.* FROM alpha_exchange.audit_logs a,target t WHERE a.purchase_request_id=t.id OR a.payload->>'purchaseRequestId'=t.id
     OR a.listing_id=t.listing_id OR a.payload->>'listingId'=t.listing_id ORDER BY a.sort_index,a.id
 ) SELECT jsonb_build_object('rows',jsonb_build_object(
   'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM requests r),
   'listings',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM listings r),
   'users',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM users r),
   'commissions',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM commissions r),
   'enforcements',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM enforcements r),
   'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'content'),'[]'::jsonb) FROM evidence r),
   'disputes',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM disputes r),
   'trades',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM trades r)),
   'events',jsonb_build_object('notifications',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) FROM notifications n),
     'audits',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM audits a)),
   'runtime',(SELECT jsonb_build_object('version',version::text,'updated_at',updated_at::text) FROM alpha_exchange.runtime_meta WHERE singleton),
   'evidenceContents',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,
     'contentBase64',replace(encode(e.content,'base64'),E'\n',''),'contentDigest',encode(sha256(e.content),'hex'))),'[]'::jsonb) FROM evidence e))
 FROM target;
$fn$;
CREATE FUNCTION alpha_wallet_release_consent_simulation.canonical_digest(request_id text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT alpha_wallet_release_consent_simulation.value_digest(jsonb_build_object(
   'kind','alpha-wallet-release-consent-canonical-basis-v1',
   'basis',alpha_wallet_release_consent_simulation.capture_canonical_basis($1),'sellerAccount',to_jsonb(account)))
 FROM alpha_exchange.users account JOIN alpha_exchange.purchase_requests request ON request.seller_id=account.id WHERE request.id=$1;
$fn$;
CREATE FUNCTION alpha_wallet_release_consent_simulation.capture_current_basis(request_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE checkpoint jsonb; terms jsonb; wallet_trade_id text; disputed boolean; paused boolean; trade jsonb;
BEGIN
  SELECT jsonb_build_object('revision',c.revision,'eventHash',c.event_hash,'stateHash',c.state_hash,'lastCommandAtMs',c.occurred_at_ms)
    INTO checkpoint FROM alpha_wallet_simulation.head h JOIN alpha_wallet_simulation.commands c ON c.revision=h.revision
    WHERE h.singleton AND h.format_version=5 AND h.last_event_hash::text=c.event_hash;
  SELECT binding.payload->'terms',binding.wallet_trade_id INTO terms,wallet_trade_id
    FROM alpha_wallet_simulation.initial_trade_bindings binding
    JOIN alpha_wallet_simulation.initial_payment_claim_receipts claim USING(platform_request_id)
    WHERE binding.platform_request_id=$1;
  IF checkpoint IS NULL OR terms IS NULL OR wallet_trade_id IS NULL THEN RAISE EXCEPTION 'Consent requires the exact retained V5 claimed cohort'; END IF;
  SELECT EXISTS(SELECT 1 FROM alpha_wallet_simulation.initial_dispute_freeze_receipts WHERE platform_request_id=$1) INTO disputed;
  SELECT EXISTS(SELECT 1 FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton AND source_halt_reason IS NOT NULL)
    OR EXISTS(SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='pause'
      AND revision>=(SELECT command_revision FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton)) INTO paused;
  trade:=jsonb_build_object('id',wallet_trade_id,'listingId',terms->'walletListingId','sellerId',terms->'sellerId',
    'buyerId',terms->'buyerId','assetId',terms->'assetId','destination',terms->'destination',
    'amountRaw',jsonb_build_object('$walletType','bigint','value',terms->'principalRaw'),
    'buyerFeeRaw',jsonb_build_object('$walletType','bigint','value',terms->'buyerFeeRaw'),
    'sellerFeeRaw',jsonb_build_object('$walletType','bigint','value',terms->'sellerFeeRaw'),
    'totalFeeRaw',jsonb_build_object('$walletType','bigint','value',terms->'totalFeeRaw'),
    'fiatTotalMinor',jsonb_build_object('$walletType','bigint','value',terms->'fiatTotalMinor'),
    'currency','ILS','status','payment_reported','disputed',disputed);
  RETURN jsonb_build_object('walletCheckpoint',checkpoint,'walletTradeSha256',alpha_wallet_release_consent_simulation.value_digest(trade),
    'walletPaused',paused,'walletDisputed',disputed,'canonicalBasisSha256',alpha_wallet_release_consent_simulation.canonical_digest($1));
END;
$fn$;

CREATE TABLE alpha_wallet_release_consent_simulation.head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  profile text NOT NULL DEFAULT 'canonical-initial-release-consent-v1' CHECK(profile='canonical-initial-release-consent-v1'),
  physical_store_id alpha_wallet_release_consent_simulation.identifier NOT NULL,
  request_id alpha_wallet_release_consent_simulation.identifier NOT NULL,
  schema_sha256 alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  catalog_sha256 alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  bootstrap jsonb NOT NULL CHECK(jsonb_typeof(bootstrap)='object'),
  archive_json jsonb NOT NULL CHECK(jsonb_typeof(archive_json)='object'),
  revision integer NOT NULL CHECK(revision BETWEEN 1 AND 128),
  event_hash alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  state_hash alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  archive_sha256 alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  lock_version bigint NOT NULL CHECK(lock_version>=1),
  owner_transaction_id text NOT NULL CHECK(owner_transaction_id ~ '^[1-9][0-9]*$'),
  installation_transaction_id text NOT NULL CHECK(installation_transaction_id ~ '^[1-9][0-9]*$'),
  installation_kind text NOT NULL CHECK(installation_kind IN ('enroll','restore')),
  imported_revision integer NOT NULL CHECK(imported_revision BETWEEN 0 AND 127),
  payment_backup_checksum alpha_wallet_release_consent_simulation.sha256,
  target_store_id alpha_wallet_release_consent_simulation.identifier,
  source_physical_store_id alpha_wallet_release_consent_simulation.identifier,
  combined_backup_checksum alpha_wallet_release_consent_simulation.sha256
);
CREATE UNIQUE INDEX consent_native_identity ON alpha_wallet_release_consent_simulation.head
  ((bootstrap->'initialPrepared'->>'nativePaymentKey'));
CREATE TABLE alpha_wallet_release_consent_simulation.records (
  revision integer PRIMARY KEY CHECK(revision BETWEEN 1 AND 128),
  operation_id alpha_wallet_release_consent_simulation.identifier NOT NULL,
  input_hash alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  record_json jsonb NOT NULL CHECK(jsonb_typeof(record_json)='object'),
  owner_transaction_id text NOT NULL CHECK(owner_transaction_id ~ '^[1-9][0-9]*$'),
  UNIQUE(operation_id,input_hash)
);
CREATE TABLE alpha_wallet_release_consent_simulation.transaction_contexts (
  transaction_id text PRIMARY KEY CHECK(transaction_id ~ '^[1-9][0-9]*$'),
  request_id alpha_wallet_release_consent_simulation.identifier NOT NULL,
  actor_user_id alpha_wallet_release_consent_simulation.identifier NOT NULL,
  operation text NOT NULL CHECK(operation IN ('enroll','observe','consent','revoke','pause')),
  planned_command jsonb NOT NULL CHECK(jsonb_typeof(planned_command)='object'),
  input_hash alpha_wallet_release_consent_simulation.sha256 NOT NULL,
  current_basis jsonb NOT NULL CHECK(jsonb_typeof(current_basis)='object'),
  expected_checkpoint jsonb CHECK(expected_checkpoint IS NULL OR jsonb_typeof(expected_checkpoint)='object'),
  occurred_at_ms bigint NOT NULL CHECK(occurred_at_ms BETWEEN 1 AND 8640000000000000)
);

CREATE FUNCTION alpha_wallet_release_consent_simulation.guard_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE h alpha_wallet_release_consent_simulation.head%ROWTYPE; account alpha_exchange.users%ROWTYPE; seller_id text;
BEGIN
  PERFORM alpha_wallet_release_consent_simulation.require_runtime();
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Consent per-transaction intent is immutable'; END IF;
  IF NEW.transaction_id IS DISTINCT FROM txid_current()::text OR NOT EXISTS (
    SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.transaction_contexts c WHERE c.transaction_id=NEW.transaction_id
      AND c.request_id=NEW.request_id AND c.actor_user_id=NEW.actor_user_id AND c.operation='inspect'
      AND c.planned_command IS NULL AND c.planned_command_key IS NULL AND c.canonical_input IS NULL) THEN
    RAISE EXCEPTION 'Consent intent requires its original unchanged V5 context and exact actual actor'; END IF;
  IF NEW.current_basis IS DISTINCT FROM alpha_wallet_release_consent_simulation.capture_current_basis(NEW.request_id)
    OR NEW.planned_command->>'type' IS DISTINCT FROM NEW.operation OR NEW.planned_command->>'actorUserId' IS DISTINCT FROM NEW.actor_user_id
    OR NEW.input_hash IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(NEW.planned_command)
    OR NEW.occurred_at_ms<(NEW.current_basis#>>'{walletCheckpoint,lastCommandAtMs}')::bigint THEN
    RAISE EXCEPTION 'Consent intent requires its exact physical wallet, canonical, actor and command basis'; END IF;
  SELECT * INTO STRICT account FROM alpha_exchange.users WHERE id=NEW.actor_user_id;
  SELECT r.seller_id INTO STRICT seller_id FROM alpha_exchange.purchase_requests r WHERE r.id=NEW.request_id;
  IF (NEW.operation IN ('consent','revoke') AND account.id IS DISTINCT FROM seller_id)
    OR (NEW.operation IN ('enroll','observe','pause') AND account.role<>'owner'
      AND NOT coalesce(jsonb_typeof(account.payload->'roles')='array' AND account.payload->'roles' ? 'owner',false)) THEN
    RAISE EXCEPTION 'Consent operation requires the exact retained seller or current owner'; END IF;
  SELECT * INTO h FROM alpha_wallet_release_consent_simulation.head WHERE singleton;
  IF NEW.operation='enroll' THEN
    IF h.singleton IS NOT NULL OR NEW.expected_checkpoint IS NOT NULL OR NEW.current_basis->'walletPaused'<>'false'::jsonb
      OR NEW.current_basis->'walletDisputed'<>'false'::jsonb THEN RAISE EXCEPTION 'Consent enrollment requires one fresh original unpaused undisputed claim'; END IF;
  ELSIF h.singleton IS NULL OR h.owner_transaction_id IS DISTINCT FROM NEW.transaction_id OR h.request_id IS DISTINCT FROM NEW.request_id
    OR h.archive_json->'checkpoint' IS DISTINCT FROM NEW.expected_checkpoint OR h.installation_kind<>'enroll'
    OR h.archive_json->'state'->>'status' IS DISTINCT FROM 'recording' THEN
    RAISE EXCEPTION 'Consent command requires its acquired exact current recording head';
  END IF;
  IF NEW.operation IN ('observe','consent') AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(h.bootstrap->'manifest'->'sources') s JOIN alpha_exchange.users u ON u.id=s->>'authorityId') THEN
    RAISE EXCEPTION 'Source authority cannot be any canonical platform user'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER guard_context BEFORE INSERT OR UPDATE OR DELETE ON alpha_wallet_release_consent_simulation.transaction_contexts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_release_consent_simulation.guard_context();
CREATE TRIGGER guard_context_truncate BEFORE TRUNCATE ON alpha_wallet_release_consent_simulation.transaction_contexts
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_release_consent_simulation.guard_context();

-- This validates a preparation against retained immutable wallet rows. No caller
-- snapshot, self-consistent digest or historical positive receipt supplies authority.
CREATE FUNCTION alpha_wallet_release_consent_simulation.assert_prepared(prepared jsonb,bootstrap jsonb,basis jsonb,at_ms bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE p jsonb:=prepared; source jsonb; recipient jsonb; o jsonb:=prepared->'observation'; c jsonb:=prepared->'walletContext';
  wallet_row jsonb; saved jsonb; expected jsonb;
BEGIN
  SELECT s INTO source FROM jsonb_array_elements(bootstrap->'manifest'->'sources') s WHERE s->>'sourceId'=p->>'sourceId';
  SELECT r INTO recipient FROM jsonb_array_elements(source->'recipients') r
    WHERE r->>'sellerId'=c->>'sellerId' AND r->>'paymentInstructionsDigest'=c->>'paymentInstructionsDigest';
  IF p->>'kind' IS DISTINCT FROM 'development-prepared-trusted-payment-evidence'
    OR p->'formatVersion' IS DISTINCT FROM '1'::jsonb OR p->>'mode' IS DISTINCT FROM 'simulation-only'
    OR p->'executionAuthority' IS DISTINCT FROM 'false'::jsonb OR p->'releaseAuthority' IS DISTINCT FROM 'false'::jsonb
    OR p->>'manifestSha256' IS DISTINCT FROM bootstrap->>'manifestSha256' OR source IS NULL OR recipient IS NULL
    OR p->>'nativePaymentKey' IS DISTINCT FROM bootstrap#>>'{initialPrepared,nativePaymentKey}'
    OR p->>'nativePaymentKey' IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array(
      'alpha-wallet-trusted-payment-evidence-v1','native-payment',jsonb_build_array(p->'manifestSha256',p->'sourceId',p->'transactionId')))
    OR p->>'observationSha256' IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array(
      'alpha-wallet-trusted-payment-evidence-v1','observation',o))
    OR p->>'paymentFactsSha256' IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array(
      'alpha-wallet-trusted-payment-evidence-v1','payment-facts',jsonb_build_object('sourceId',p->'sourceId','authorityId',o->'authorityId',
        'transactionId',p->'transactionId','kind',o->'kind','occurredAtMs',o->'occurredAtMs','payment',o->'payment')))
    OR p->>'preparationSha256' IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array(
      'alpha-wallet-trusted-payment-evidence-v1','preparation',p-'preparationSha256'))
    OR basis IS DISTINCT FROM jsonb_build_object('walletCheckpoint',c->'checkpoint','walletTradeSha256',c->'walletTradeSha256',
      'walletPaused',c->'paused','walletDisputed',c->'disputed','canonicalBasisSha256',basis->'canonicalBasisSha256')
    OR (p->>'preparedAtMs')::numeric>at_ms OR (p->>'preparedAtMs')::numeric<(c#>>'{checkpoint,lastCommandAtMs}')::numeric
    OR o->>'authorityId' IS DISTINCT FROM source->>'authorityId' OR o->>'sourceId' IS DISTINCT FROM p->>'sourceId'
    OR o->>'transactionId' IS DISTINCT FROM p->>'transactionId'
    OR source->>'authorityId' IN (c->>'sellerId',c->>'buyerId') OR c->'recordedOperatorIds' ? (source->>'authorityId')
    OR (o->>'observedAtMs')::numeric>(p->>'preparedAtMs')::numeric OR (o->>'occurredAtMs')::numeric>(o->>'observedAtMs')::numeric
    OR (o->>'occurredAtMs')::numeric<(c->>'acceptedAtMs')::numeric
    OR (o->'settledAtMs'<>'null'::jsonb AND ((o->>'settledAtMs')::numeric<(o->>'occurredAtMs')::numeric
      OR (o->>'settledAtMs')::numeric>(o->>'observedAtMs')::numeric))
    OR (o->>'status' IN ('settled','reversed') AND o->'settledAtMs'='null'::jsonb)
    OR (o->>'status' IN ('pending','rejected') AND o->'settledAtMs'<>'null'::jsonb) THEN
    RAISE EXCEPTION 'Consent source preparation is not bound to its original admission, native identity and exact wallet basis'; END IF;
  expected:=jsonb_build_object('platformRequestId',c->'platformRequestId','platformTradeId',c->'platformTradeId','sellerId',c->'sellerId',
    'buyerId',c->'buyerId','acceptanceKey',c->'acceptanceKey','claimKey',c->'claimKey','termsDigest',c->'termsDigest',
    'paymentInstructionsDigest',c->'paymentInstructionsDigest','recipientAccountId',recipient->'recipientAccountId',
    'paymentMethod',c->'paymentMethod','amountMinor',c->'amountMinor','currency',c->'currency');
  IF o->'payment' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Consent source payment binding changed'; END IF;
  IF jsonb_array_length(p->'walletHistory')<>(c#>>'{checkpoint,revision}')::integer THEN RAISE EXCEPTION 'Consent wallet prefix is incomplete'; END IF;
  FOR wallet_row IN SELECT value FROM jsonb_array_elements(p->'walletHistory') LOOP
    SELECT to_jsonb(command) INTO saved FROM alpha_wallet_simulation.commands command WHERE revision=(wallet_row->>'revision')::integer;
    IF (saved-'revision'-'occurred_at_ms') IS DISTINCT FROM (wallet_row-'revision'-'occurred_at_ms')
      OR (saved->>'occurred_at_ms')::numeric IS DISTINCT FROM (wallet_row->>'occurred_at_ms')::numeric THEN
      RAISE EXCEPTION 'Consent preparation contains a substituted or forked retained wallet history'; END IF;
  END LOOP;
END;
$fn$;

CREATE FUNCTION alpha_wallet_release_consent_simulation.review_basis(bootstrap jsonb,prepared jsonb,basis jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE p jsonb:=bootstrap->'initialPrepared'; c jsonb:=p->'walletContext'; source jsonb;
BEGIN
  SELECT s INTO source FROM jsonb_array_elements(bootstrap->'manifest'->'sources') s WHERE s->>'sourceId'=p->>'sourceId';
  RETURN jsonb_build_object('kind','development-release-consent-reviewed-basis','formatVersion',1,'mode','simulation-only',
    'sourceStoreId',bootstrap->'sourceStoreId','manifestSha256',bootstrap->'manifestSha256',
    'platformRequestId',c->'platformRequestId','platformTradeId',c->'platformTradeId','sellerId',c->'sellerId','buyerId',c->'buyerId',
    'assetId',c->'assetId','principalRaw',c->'principalRaw','amountMinor',c->'amountMinor','currency',c->'currency',
    'paymentMethod',c->'paymentMethod','paymentInstructionsDigest',c->'paymentInstructionsDigest','destinationSha256',c->'destinationSha256',
    'termsDigest',c->'termsDigest','acceptanceKey',c->'acceptanceKey','acceptanceReceiptSha256',c->'acceptanceReceiptSha256',
    'claimKey',c->'claimKey','claimReceiptSha256',c->'claimReceiptSha256','nativePaymentKey',p->'nativePaymentKey',
    'paymentFactsSha256',p->'paymentFactsSha256','sourceId',p->'sourceId','transactionId',p->'transactionId',
    'sourceRevision',prepared#>'{observation,revision}','observationSha256',prepared->'observationSha256','currentBasis',basis,
    'sourceValidUntilMs',least((source->>'validUntilMs')::bigint,(prepared#>>'{observation,observedAtMs}')::bigint+(source->>'maxObservationAgeMs')::bigint),
    'executionAuthority',false,'releaseAuthority',false);
END;
$fn$;

-- Independent deterministic replay of the overlay and its embedded source
-- journal. SQL derives negative stops, source revision continuity, revocation,
-- current review commitments, expiry and the exact final projection itself.
CREATE FUNCTION alpha_wallet_release_consent_simulation.replay_state(bootstrap jsonb,records jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE state jsonb; source_state jsonb; source_checkpoint jsonb; source_records jsonb:='[]'::jsonb; prior_records jsonb:='[]'::jsonb;
  latest jsonb:=bootstrap->'initialPrepared'; prepared jsonb; r jsonb; command jsonb; basis jsonb; receipt jsonb; expected jsonb;
  previous_event text:=repeat('0',64); last_ms bigint:=(bootstrap->>'createdAtMs')::bigint; revision integer:=0; at_ms bigint;
  input_hash text; state_hash text; event_hash text; disposition text; source_disposition text; source_hash text; source_event text;
  source_revision integer; source_command jsonb; source_input_hash text; source_prior jsonb; payment jsonb; incoming jsonb; known jsonb;
  previous_observation jsonb; source jsonb; review jsonb; review_hash text; consents jsonb:='[]'::jsonb; consent jsonb; consent_index integer;
  operation_conflict boolean; source_conflict boolean; source_replayed boolean; prior_checkpoint jsonb; prior_archive jsonb;
BEGIN
  IF NOT alpha_wallet_release_consent_simulation.closed_object(bootstrap,
      ARRAY['sourceStoreId','manifest','manifestSha256','enrollingOwnerId','enrollmentOperationId','createdAtMs','initialPrepared','initialBasis'])
    OR bootstrap->>'manifestSha256' IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array(
      'alpha-wallet-trusted-payment-evidence-v1','admission',bootstrap->'manifest'))
    OR jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records) NOT BETWEEN 1 AND 128
    OR bootstrap#>'{initialBasis,walletPaused}' IS DISTINCT FROM 'false'::jsonb
    OR bootstrap#>'{initialBasis,walletDisputed}' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'Consent bootstrap, admission or bounded immutable history is invalid'; END IF;
  source_state:=jsonb_build_object('status','recording','haltReason',NULL,'restoredTargetStoreId',NULL,
    'executionAuthority',false,'releaseAuthority',false,'payments','[]'::jsonb);
  source_checkpoint:=jsonb_build_object('revision',0,'eventHash',repeat('0',64),
    'stateHash',alpha_wallet_release_consent_simulation.value_digest(source_state),'lastCommandAtMs',last_ms);
  state:=jsonb_build_object('status','recording','haltReason',NULL,'restoredTargetStoreId',NULL,'executionAuthority',false,'releaseAuthority',false,
    'source',source_state,'sourceCheckpoint',source_checkpoint,'latestPreparationSha256',latest->'preparationSha256',
    'consents',consents,'activeConsentOperationId',NULL);
  FOR r IN SELECT value FROM jsonb_array_elements(records) LOOP
    revision:=revision+1; command:=r->'command'; basis:=r->'currentBasis'; at_ms:=(r->>'occurredAtMs')::bigint;
    input_hash:=alpha_wallet_release_consent_simulation.value_digest(command); receipt:=r->'receipt';
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(prior_records) p WHERE p->>'operationId'=command->>'operationId') INTO operation_conflict;
    IF NOT alpha_wallet_release_consent_simulation.closed_object(r,ARRAY['revision','operationId','inputHash','command','currentBasis',
        'occurredAtMs','previousEventHash','eventHash','stateHash','receipt'])
      OR NOT alpha_wallet_release_consent_simulation.closed_object(basis,ARRAY['walletCheckpoint','walletTradeSha256','walletPaused','walletDisputed','canonicalBasisSha256'])
      OR NOT alpha_wallet_release_consent_simulation.closed_object(basis->'walletCheckpoint',ARRAY['revision','eventHash','stateHash','lastCommandAtMs'])
      OR r->'revision' IS DISTINCT FROM to_jsonb(revision) OR r->>'operationId' IS DISTINCT FROM command->>'operationId'
      OR r->>'inputHash' IS DISTINCT FROM input_hash OR r->>'previousEventHash' IS DISTINCT FROM previous_event
      OR at_ms<last_ms OR at_ms<(basis#>>'{walletCheckpoint,lastCommandAtMs}')::bigint OR at_ms NOT BETWEEN 1 AND 8640000000000000
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(prior_records) p WHERE p->>'operationId'=command->>'operationId' AND p->>'inputHash'=input_hash)
      OR (command->>'type' NOT IN ('pause','quarantine-restore') AND revision>126)
      OR (command->>'type'='pause' AND revision>127) THEN
      RAISE EXCEPTION 'Consent record shape, chronology, identity or append continuity changed'; END IF;
    IF command->>'type'='quarantine-restore' THEN
      prior_checkpoint:=jsonb_build_object('revision',revision-1,'eventHash',previous_event,
        'stateHash',alpha_wallet_release_consent_simulation.value_digest(state),'lastCommandAtMs',last_ms);
      prior_archive:=jsonb_build_object('kind','development-release-consent-overlay','formatVersion',1,'mode','simulation-only',
        'bootstrap',bootstrap,'records',prior_records,'checkpoint',prior_checkpoint,'state',state);
      prior_archive:=prior_archive||jsonb_build_object('archiveSha256',alpha_wallet_release_consent_simulation.value_digest(prior_archive));
      IF NOT alpha_wallet_release_consent_simulation.closed_object(command,ARRAY['type','operationId','backupSha256','sourceArchiveSha256',
          'sourceCheckpoint','targetStoreId','exportedAtMs']) OR state->>'status'='recording'
        OR state->'restoredTargetStoreId' IS DISTINCT FROM 'null'::jsonb OR command->>'targetStoreId'=bootstrap->>'sourceStoreId'
        OR command->'sourceCheckpoint' IS DISTINCT FROM prior_checkpoint OR command->>'sourceArchiveSha256' IS DISTINCT FROM prior_archive->>'archiveSha256'
        OR basis IS DISTINCT FROM prior_records->-1->'currentBasis' OR (command->>'exportedAtMs')::bigint<last_ms
        OR at_ms<(command->>'exportedAtMs')::bigint OR operation_conflict
        OR command->>'backupSha256' IS DISTINCT FROM alpha_wallet_release_consent_simulation.value_digest(jsonb_build_object(
          'kind','development-release-consent-overlay-backup','formatVersion',1,'mode','simulation-only','sourceStopped',true,
          'exportedAtMs',command->'exportedAtMs','archive',prior_archive)) THEN
        RAISE EXCEPTION 'Consent restoration must preserve one exact stopped original source in a distinct target'; END IF;
      state:=state||jsonb_build_object('status','quarantined','haltReason','restored-copy','restoredTargetStoreId',command->'targetStoreId');
      disposition:='restored-quarantined';
    ELSE
      IF state->>'status' IS DISTINCT FROM 'recording' OR state->'restoredTargetStoreId' IS DISTINCT FROM 'null'::jsonb
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(bootstrap->'manifest'->'sources') s WHERE s->>'authorityId'=command->>'actorUserId')
        OR (command->>'type' IN ('consent','revoke') AND command->>'actorUserId' IS DISTINCT FROM bootstrap#>>'{initialPrepared,walletContext,sellerId}') THEN
        RAISE EXCEPTION 'Stopped consent history cannot append or impersonate the retained seller'; END IF;
      IF command->>'type' IN ('enroll','observe') THEN
        prepared:=CASE WHEN command->>'type'='enroll' THEN bootstrap->'initialPrepared' ELSE command->'prepared' END;
        IF command->>'type'='enroll' THEN
          expected:=jsonb_build_object('type','enroll','operationId',bootstrap->'enrollmentOperationId','actorUserId',bootstrap->'enrollingOwnerId',
            'enrollmentSha256',alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array('alpha-wallet-release-consent-enrollment-v1',bootstrap)));
          IF revision<>1 OR command IS DISTINCT FROM expected OR basis IS DISTINCT FROM bootstrap->'initialBasis'
            OR at_ms<>(bootstrap->>'createdAtMs')::bigint THEN RAISE EXCEPTION 'Consent enrollment is not its exact first owner admission'; END IF;
        ELSIF NOT alpha_wallet_release_consent_simulation.closed_object(command,ARRAY['type','operationId','actorUserId','prepared']) THEN
          RAISE EXCEPTION 'Consent observation command is not closed';
        END IF;
        PERFORM alpha_wallet_release_consent_simulation.assert_prepared(prepared,bootstrap,basis,at_ms);
        source_command:=jsonb_build_object('type','record','operationId',command->'operationId','prepared',prepared);
        source_input_hash:=alpha_wallet_release_consent_simulation.value_digest(source_command);
        SELECT p INTO source_prior FROM jsonb_array_elements(source_records) p
          WHERE p->>'operationId'=command->>'operationId' AND p->>'inputHash'=source_input_hash;
        source_replayed:=source_prior IS NOT NULL;
        IF source_replayed THEN source_disposition:=source_prior->>'disposition';
        ELSE
          IF source_state->>'status' IS DISTINCT FROM 'recording' OR (source_checkpoint->>'revision')::integer>=126 THEN
            RAISE EXCEPTION 'Stopped source journal cannot accept another observation'; END IF;
          source_revision:=(source_checkpoint->>'revision')::integer+1;
          SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(source_records) p WHERE p->>'operationId'=command->>'operationId') INTO source_conflict;
          payment:=source_state->'payments'->0;
          incoming:=jsonb_build_object('revision',prepared#>'{observation,revision}','observationSha256',prepared->'observationSha256',
            'status',prepared#>'{observation,status}','observedAtMs',prepared#>'{observation,observedAtMs}',
            'settledAtMs',prepared#>'{observation,settledAtMs}','firstJournalRevision',source_revision);
          source_disposition:=NULL;
          IF source_conflict THEN source_disposition:='operation-conflict-quarantined';
          ELSIF payment IS NOT NULL THEN
            IF payment->>'paymentFactsSha256' IS DISTINCT FROM prepared->>'paymentFactsSha256' THEN source_disposition:='payment-conflict-quarantined';
            ELSE
              SELECT p INTO known FROM jsonb_array_elements(payment->'revisions') p WHERE p->'revision'=incoming->'revision';
              IF known IS NOT NULL THEN
                source_disposition:=CASE WHEN known->>'observationSha256' IS DISTINCT FROM incoming->>'observationSha256' THEN 'revision-conflict-quarantined'
                  WHEN incoming->'revision'=payment->'latestSourceRevision' THEN 'corroborated' ELSE 'stale-corroboration' END;
              ELSIF (incoming->>'revision')::integer<>(payment->>'latestSourceRevision')::integer+1 THEN source_disposition:='revision-gap-quarantined';
              ELSE
                previous_observation:=payment->'revisions'->-1;
                IF (incoming->>'observedAtMs')::bigint<(previous_observation->>'observedAtMs')::bigint
                  OR (previous_observation->'settledAtMs'<>'null'::jsonb AND incoming->'settledAtMs' IS DISTINCT FROM previous_observation->'settledAtMs')
                  OR (previous_observation->>'status'='settled' AND incoming->>'status'='pending') THEN source_disposition:='status-regression-quarantined';
                ELSE
                  payment:=payment||jsonb_build_object('revisions',payment->'revisions'||jsonb_build_array(incoming),'latestSourceRevision',incoming->'revision');
                  source_state:=jsonb_set(source_state,'{payments}',jsonb_build_array(payment));
                END IF;
              END IF;
            END IF;
          ELSIF (incoming->>'revision')::integer<>1 THEN source_disposition:='revision-gap-quarantined';
          ELSE
            payment:=jsonb_build_object('nativePaymentKey',prepared->'nativePaymentKey','paymentFactsSha256',prepared->'paymentFactsSha256',
              'platformRequestId',prepared#>'{walletContext,platformRequestId}','claimKey',prepared#>'{walletContext,claimKey}',
              'sourceId',prepared->'sourceId','transactionId',prepared->'transactionId','firstJournalRevision',source_revision,
              'latestSourceRevision',incoming->'revision','revisions',jsonb_build_array(incoming));
            source_state:=jsonb_set(source_state,'{payments}',jsonb_build_array(payment));
          END IF;
          IF source_disposition IS NULL THEN source_disposition:=CASE incoming->>'status' WHEN 'reversed' THEN 'source-reversal-quarantined'
            WHEN 'revoked' THEN 'source-revocation-quarantined' WHEN 'rejected' THEN 'source-rejection-quarantined' ELSE 'recorded' END; END IF;
          IF source_disposition LIKE '%-quarantined' THEN source_state:=source_state||jsonb_build_object('status','quarantined','haltReason',source_disposition); END IF;
          source_hash:=alpha_wallet_release_consent_simulation.value_digest(source_state);
          source_event:=alpha_wallet_release_consent_simulation.value_digest(jsonb_build_object('revision',source_revision,'operationId',command->'operationId',
            'inputHash',source_input_hash,'occurredAtMs',at_ms,'previousEventHash',source_checkpoint->'eventHash','stateHash',source_hash,
            'disposition',source_disposition,'status',source_state->'status'));
          source_checkpoint:=jsonb_build_object('revision',source_revision,'eventHash',source_event,'stateHash',source_hash,'lastCommandAtMs',at_ms);
          source_records:=source_records||jsonb_build_array(jsonb_build_object('operationId',command->'operationId','inputHash',source_input_hash,'disposition',source_disposition));
        END IF;
        IF command->>'type'='enroll' THEN disposition:=CASE WHEN source_state->>'status'='recording' THEN 'enrolled' ELSE source_disposition END;
        ELSE
          disposition:=CASE WHEN operation_conflict THEN 'operation-conflict-quarantined' ELSE source_disposition END;
          IF source_disposition IN ('recorded','corroborated') THEN latest:=prepared; END IF;
        END IF;
      ELSIF operation_conflict THEN disposition:='operation-conflict-quarantined';
      ELSIF command->>'type'='consent' THEN
        SELECT s INTO source FROM jsonb_array_elements(bootstrap->'manifest'->'sources') s WHERE s->>'sourceId'=latest->>'sourceId';
        review:=alpha_wallet_release_consent_simulation.review_basis(bootstrap,latest,basis);
        review_hash:=alpha_wallet_release_consent_simulation.value_digest(jsonb_build_array('alpha-wallet-release-consent-reviewed-basis-v1',review));
        IF NOT alpha_wallet_release_consent_simulation.closed_object(command,ARRAY['type','operationId','actorUserId','reviewedBasisSha256','sessionExpiresAtMs'])
          OR command->>'reviewedBasisSha256' IS DISTINCT FROM review_hash OR basis->'walletPaused' IS DISTINCT FROM 'false'::jsonb
          OR basis->'walletDisputed' IS DISTINCT FROM 'false'::jsonb OR latest#>>'{observation,status}' IS DISTINCT FROM 'settled'
          OR source->'enabled' IS DISTINCT FROM 'true'::jsonb OR at_ms<(source->>'validFromMs')::bigint OR at_ms>=(source->>'validUntilMs')::bigint
          OR at_ms<(latest#>>'{observation,observedAtMs}')::bigint
          OR at_ms-(latest#>>'{observation,observedAtMs}')::bigint>=(source->>'maxObservationAgeMs')::bigint
          OR (command->>'sessionExpiresAtMs')::bigint<=at_ms
          OR basis IS DISTINCT FROM jsonb_build_object('walletCheckpoint',latest#>'{walletContext,checkpoint}',
            'walletTradeSha256',latest#>'{walletContext,walletTradeSha256}','walletPaused',latest#>'{walletContext,paused}',
            'walletDisputed',latest#>'{walletContext,disputed}','canonicalBasisSha256',basis->'canonicalBasisSha256') THEN
          RAISE EXCEPTION 'Seller consent requires the exact current fresh settled source and reviewed wallet/canonical basis'; END IF;
        consent:=jsonb_build_object('operationId',command->'operationId','sellerId',command->'actorUserId','reviewedBasisSha256',review_hash,
          'currentBasis',basis,'nativePaymentKey',review->'nativePaymentKey','sourceRevision',review->'sourceRevision','observationSha256',review->'observationSha256',
          'consentedAtMs',at_ms,'expiresAtMs',least((command->>'sessionExpiresAtMs')::bigint,(review->>'sourceValidUntilMs')::bigint),'revokedByOperationId',NULL);
        consents:=consents||jsonb_build_array(consent); state:=jsonb_set(state,'{activeConsentOperationId}',command->'operationId'); disposition:='consented';
      ELSIF command->>'type'='revoke' THEN
        IF NOT alpha_wallet_release_consent_simulation.closed_object(command,ARRAY['type','operationId','actorUserId','consentOperationId']) THEN
          RAISE EXCEPTION 'Consent withdrawal command is not closed'; END IF;
        SELECT value,(ordinal-1)::integer INTO consent,consent_index FROM jsonb_array_elements(consents) WITH ORDINALITY AS c(value,ordinal)
          WHERE value->>'operationId'=command->>'consentOperationId';
        IF consent IS NULL THEN RAISE EXCEPTION 'Seller withdrawal must name one exact retained consent'; END IF;
        IF consent->'revokedByOperationId'='null'::jsonb THEN
          consents:=jsonb_set(consents,ARRAY[consent_index::text,'revokedByOperationId'],command->'operationId'); disposition:='consent-revoked';
        ELSE disposition:='consent-already-revoked'; END IF;
      ELSIF command->>'type'='pause' THEN
        IF NOT alpha_wallet_release_consent_simulation.closed_object(command,ARRAY['type','operationId','actorUserId','reasonCode'])
          OR NOT coalesce(command->>'reasonCode' IN ('manual-review','source-unavailable','maintenance'),false) THEN RAISE EXCEPTION 'Consent pause command is invalid'; END IF;
        state:=state||jsonb_build_object('status','paused','haltReason',command->'reasonCode'); disposition:='paused';
      ELSE RAISE EXCEPTION 'Consent command is unsupported'; END IF;
      IF disposition LIKE '%-quarantined' THEN state:=state||jsonb_build_object('status','quarantined','haltReason',disposition); END IF;
    END IF;
    state:=state||jsonb_build_object('source',source_state,'sourceCheckpoint',source_checkpoint,
      'latestPreparationSha256',latest->'preparationSha256','consents',consents);
    state_hash:=alpha_wallet_release_consent_simulation.value_digest(state);
    event_hash:=alpha_wallet_release_consent_simulation.value_digest(jsonb_build_object('revision',revision,'operationId',command->'operationId',
      'inputHash',input_hash,'currentBasis',basis,'occurredAtMs',at_ms,'previousEventHash',previous_event,'stateHash',state_hash,
      'disposition',disposition,'status',state->'status'));
    expected:=jsonb_build_object('operationId',command->'operationId','inputHash',input_hash,'revision',revision,'eventHash',event_hash,
      'stateHash',state_hash,'commandType',command->'type','actorUserId',CASE WHEN command->>'type'='quarantine-restore' THEN 'null'::jsonb ELSE command->'actorUserId' END,
      'disposition',disposition,'status',state->'status','executionAuthority',false,'releaseAuthority',false);
    IF receipt IS DISTINCT FROM expected OR r->>'stateHash' IS DISTINCT FROM state_hash OR r->>'eventHash' IS DISTINCT FROM event_hash THEN
      RAISE EXCEPTION 'Consent immutable receipt, source projection or replayed event hash changed'; END IF;
    previous_event:=event_hash; last_ms:=at_ms; prior_records:=prior_records||jsonb_build_array(r);
  END LOOP;
  RETURN state;
END;
$fn$;
