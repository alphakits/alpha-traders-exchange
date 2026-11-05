-- DEVELOPMENT ONLY: explicit accepted-initial cancellation successor.
-- Source-owned SQL validates stored effects; transaction contexts do not authenticate users.
-- Normal upgrade flushes every old deferred event before this atomic hook switch.
-- Fresh combined recovery installs old evidence without ever installing old V3 live guards.

ALTER TABLE alpha_wallet_cancellation_marketplace_simulation.cancellations
  ADD CONSTRAINT cancellation_financial_receipt FOREIGN KEY (cancellation_key)
  REFERENCES alpha_wallet_simulation.initial_cancellation_receipts(cancellation_key);

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'Initial marketplace coordination records and protected identities are immutable';
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.capture_initial_canonical_basis(request_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('request',to_jsonb(r),'listing',to_jsonb(l),
    'trade',(SELECT to_jsonb(t) FROM alpha_exchange.trades t
      WHERE t.purchase_request_id=r.id OR t.payload->>'purchaseRequestId'=r.id
        OR t.id=r.trade_id OR t.payload->>'id'=r.trade_id),
    'siblings',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM alpha_exchange.purchase_requests s WHERE s.listing_id=l.id OR s.payload->>'listingId'=l.id))
  FROM alpha_exchange.purchase_requests r JOIN alpha_exchange.listings l ON l.id=r.listing_id WHERE r.id=$1;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.request_terms_match(request jsonb, terms jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT request->>'id' IS NOT DISTINCT FROM terms->>'platformRequestId'
    AND request->>'tradeId' IS NOT DISTINCT FROM terms->>'platformTradeId'
    AND request->>'listingId' IS NOT DISTINCT FROM terms->>'platformListingId'
    AND request->>'sellerId' IS NOT DISTINCT FROM terms->>'sellerId'
    AND request->>'buyerId' IS NOT DISTINCT FROM terms->>'buyerId'
    AND request->>'usdtAmount' IS NOT DISTINCT FROM terms->>'usdtAmount'
    AND request->>'fiatAmount' IS NOT DISTINCT FROM terms->>'fiatAmount'
    AND request->>'pricePerUsdt' IS NOT DISTINCT FROM terms->>'pricePerUsdt'
    AND request->>'currency' IS NOT DISTINCT FROM terms->>'currency'
    AND request->>'network' IS NOT DISTINCT FROM terms->>'receivingNetwork'
    AND request->>'buyerReceivingWalletAddress' IS NOT DISTINCT FROM terms->>'destination'
    AND (CASE request->>'paymentMethod' WHEN 'Face-to-Face' THEN 'Face-to-Face (Meet in Person)'
      ELSE request->>'paymentMethod' END) IS NOT DISTINCT FROM terms->>'paymentMethod'
    AND request->>'priceMode' IS NOT DISTINCT FROM terms->>'priceMode'
    AND request->>'listingPriceAtRequest' IS NOT DISTINCT FROM terms->>'listingPriceAtRequest'
    AND request->>'feePolicyVersion' IS NOT DISTINCT FROM terms->>'feePolicyVersion'
    AND request->>'commissionCalculationVersion' IS NOT DISTINCT FROM terms->>'commissionCalculationVersion';
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.initial_event_suffix(request_id text, trade_id text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT encode(sha256(convert_to('["initial_seller_acceptance",'||to_jsonb($1)::text||','||to_jsonb($2)::text||']','UTF8')),'hex');
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.initial_expected_canonical(
  activation alpha_wallet_initial_marketplace_simulation.activations,
  command alpha_wallet_simulation.commands, actor_role text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE request jsonb; listing jsonb; trade jsonb; notification jsonb; audit jsonb;
  accepted_time text; suffix text; timeline jsonb;
BEGIN
  IF activation.request_id IS NULL OR command.command_type IS DISTINCT FROM 'acceptInitialSellerRequest'
    OR command.command_json#>>'{actor,id}' IS DISTINCT FROM activation.seller_id
    OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'seller'
    OR NOT coalesce(actor_role IN ('guest','student','buyer','pending_seller_approval','approved_seller','admin','owner'),false)
    OR NOT alpha_wallet_cancellation_marketplace_simulation.request_terms_match(
      activation.canonical_basis#>'{request,payload}',command.command_json#>'{input,terms}') THEN
    RAISE EXCEPTION 'Initial canonical poststate requires its retained seller command and exact buyer terms';
  END IF;
  request:=activation.canonical_basis#>'{request,payload}';
  listing:=activation.canonical_basis#>'{listing,payload}';
  accepted_time:=to_char(to_timestamp(command.occurred_at_ms::numeric/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF accepted_time::timestamptz<=(request->>'updatedAt')::timestamptz
    OR accepted_time::timestamptz<=(listing->>'updatedAt')::timestamptz THEN
    RAISE EXCEPTION 'Initial canonical acceptance must follow its retained request and listing clocks';
  END IF;
  suffix:=alpha_wallet_cancellation_marketplace_simulation.initial_event_suffix(activation.request_id,activation.platform_trade_id);
  timeline:=request->'timeline'||jsonb_build_array(jsonb_build_object('id','initial-acceptance-event-'||suffix,
    'type','request_accepted','actorUserId',activation.seller_id,'actorRole',actor_role,
    'message','Seller accepted request','createdAt',accepted_time));
  request:=request||jsonb_build_object('status','accepted','tradeCreatedAt',accepted_time,'updatedAt',accepted_time,
    'cardlessCodeAwaitingBuyerConfirmation',false,'timeline',timeline);
  IF command.command_json#>>'{input,terms,paymentMethod}'='Face-to-Face (Meet in Person)' THEN
    request:=request||jsonb_build_object('sellerSafetyAcknowledged',true);
  END IF;
  listing:=listing||jsonb_build_object('status','matched','activeTradeRequestId',activation.request_id,
    'lockedAt',coalesce(listing->>'lockedAt',accepted_time),'updatedAt',accepted_time);
  trade:=jsonb_build_object('id',activation.platform_trade_id,'purchaseRequestId',activation.request_id,
    'listingId',activation.platform_listing_id,'sellerId',activation.seller_id,'buyerId',activation.buyer_id,
    'status','accepted','createdAt',accepted_time,'updatedAt',accepted_time,'timeline',timeline);
  notification:=jsonb_build_object('id','initial-acceptance-notification-'||suffix,'userId',activation.buyer_id,
    'category','trade','title','Trade request accepted','message','Seller accepted this development trade request.',
    'isRead',false,'relatedRequestId',activation.request_id,'relatedTradeId',activation.platform_trade_id,
    'relatedListingId',activation.platform_listing_id,'createdAt',accepted_time);
  audit:=jsonb_build_object('id','initial-acceptance-audit-'||suffix,'action','listing_matched',
    'actorUserId',activation.seller_id,'targetUserId',activation.seller_id,'listingId',activation.platform_listing_id,
    'purchaseRequestId',activation.request_id,'details','Initial seller acceptance persisted in an isolated development transaction.',
    'createdAt',accepted_time);
  RETURN jsonb_build_object('request',request,'listing',listing,'trade',trade,
    'notifications',jsonb_build_array(notification),'auditLogs',jsonb_build_array(audit));
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(
  activation alpha_wallet_initial_marketplace_simulation.activations, canonical jsonb, table_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE payload jsonb; accepted_time timestamptz;
BEGIN
  accepted_time:=(canonical#>>'{request,updatedAt}')::timestamptz;
  IF table_name='purchase_requests' THEN
    RETURN activation.canonical_basis->'request'||jsonb_build_object('status','accepted','updated_at',accepted_time,'payload',canonical->'request');
  ELSIF table_name='listings' THEN
    RETURN activation.canonical_basis->'listing'||jsonb_build_object('status','matched','active_trade_request_id',activation.request_id,
      'updated_at',accepted_time,'payload',canonical->'listing');
  ELSIF table_name='trades' THEN
    IF activation.canonical_basis->'trade'<>'null'::jsonb THEN
      RETURN activation.canonical_basis->'trade'||jsonb_build_object('status','accepted','created_at',accepted_time,
        'updated_at',accepted_time,'payload',canonical->'trade');
    END IF;
    RETURN jsonb_build_object('id',activation.platform_trade_id,'purchase_request_id',activation.request_id,'listing_id',activation.platform_listing_id,
      'seller_id',activation.seller_id,'buyer_id',activation.buyer_id,'status','accepted','completed_at',null,
      'created_at',accepted_time,'updated_at',accepted_time,'sort_index',0,'payload',canonical->'trade');
  ELSIF table_name='notifications' THEN
    payload:=canonical#>'{notifications,0}';
    RETURN jsonb_build_object('id',payload->>'id','user_id',activation.buyer_id,'category','trade','is_read',false,
      'created_at',accepted_time,'sort_index',0,'payload',payload);
  ELSIF table_name='audit_logs' THEN
    payload:=canonical#>'{auditLogs,0}';
    RETURN jsonb_build_object('id',payload->>'id','action','listing_matched','actor_user_id',activation.seller_id,'target_user_id',activation.seller_id,
      'listing_id',activation.platform_listing_id,'purchase_request_id',activation.request_id,'created_at',accepted_time,'sort_index',0,'payload',payload);
  END IF;
  RAISE EXCEPTION 'Unsupported initial canonical projection';
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.initial_publication_payload(acceptance_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('type','initial_seller_request_accepted','requestId',a.request_id,
    'listingId',v.platform_listing_id,'tradeId',v.platform_trade_id,'buyerId',v.buyer_id,'sellerId',v.seller_id,
    'walletTradeId',v.wallet_trade_id,'walletRevision',a.wallet_command_revision,'walletEventHash',a.wallet_event_hash,
    'termsDigest',a.receipt->>'termsDigest','notificationIds',jsonb_build_array(a.canonical_result#>>'{notifications,0,id}'),
    'auditId',a.canonical_result#>>'{auditLogs,0,id}','timelineEventId',a.canonical_result#>>'{request,timeline,-1,id}')
  FROM alpha_wallet_initial_marketplace_simulation.acceptances a
  JOIN alpha_wallet_initial_marketplace_simulation.activations v ON v.request_id=a.request_id WHERE a.acceptance_key=$1;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.scope_listings(row_data jsonb, table_name text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT DISTINCT candidate FROM (
    SELECT CASE WHEN table_name='listings' THEN row_data->>'id' ELSE row_data->>'listing_id' END candidate
    UNION ALL SELECT CASE WHEN table_name='listings' THEN row_data#>>'{payload,id}' END
    UNION ALL SELECT row_data#>>'{payload,listingId}'
    UNION ALL SELECT row_data#>>'{payload,relatedListingId}'
    UNION ALL SELECT r.listing_id FROM alpha_exchange.purchase_requests r
      WHERE r.id IN (row_data->>'purchase_request_id',row_data#>>'{payload,purchaseRequestId}',
          row_data#>>'{payload,relatedRequestId}',CASE WHEN table_name='purchase_requests' THEN row_data->>'id' END,
          CASE WHEN table_name='purchase_requests' THEN row_data#>>'{payload,id}' END)
        OR r.trade_id IN (row_data->>'trade_id',row_data#>>'{payload,tradeId}',row_data#>>'{payload,relatedTradeId}',
          CASE WHEN table_name='trades' THEN row_data->>'id' END,CASE WHEN table_name='trades' THEN row_data#>>'{payload,id}' END)
  ) candidates WHERE candidate IS NOT NULL;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_participant_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE old_row jsonb; new_row jsonb; involved boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  SELECT EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.activations a
    WHERE a.seller_id IN (old_row->>'id',old_row#>>'{payload,id}',new_row->>'id',new_row#>>'{payload,id}')
      OR a.buyer_id IN (old_row->>'id',old_row#>>'{payload,id}',new_row->>'id',new_row#>>'{payload,id}')) INTO involved;
  IF NOT involved THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  -- Account revocation, seller-status changes and current verification policy
  -- remain mutable, ordered by the statement fence and authentication SHARE
  -- locks. Removing/reassigning participant identities could strand inspection
  -- and pause, so those operations are outside this bounded lifecycle.
  IF TG_OP<>'UPDATE' OR OLD.id IS DISTINCT FROM NEW.id
    OR jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' OR NEW.payload->>'id' IS DISTINCT FROM OLD.id
    OR OLD.payload->>'id' IS DISTINCT FROM OLD.id
    OR NEW.email IS DISTINCT FROM NEW.payload->>'email' OR NEW.role IS DISTINCT FROM NEW.payload->>'role'
    OR NEW.seller_status IS DISTINCT FROM NEW.payload->>'sellerStatus'
    OR NEW.availability_status IS DISTINCT FROM NEW.payload->>'availabilityStatus'
    OR NEW.online_status IS DISTINCT FROM NEW.payload->>'onlineStatus'
    OR NEW.created_at IS DISTINCT FROM (NEW.payload->>'createdAt')::timestamptz
    OR NEW.updated_at IS DISTINCT FROM (NEW.payload->>'updatedAt')::timestamptz THEN
    RAISE EXCEPTION 'Activated initial marketplace participant identities and canonical columns must remain coherent';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_runtime_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_read_only')<>'off'
    OR NEW.singleton IS DISTINCT FROM true OR NEW.singleton IS DISTINCT FROM OLD.singleton
    OR NEW.version IS NULL OR NEW.version<OLD.version THEN
    RAISE EXCEPTION 'Initial marketplace runtime fence identity and monotonic version must remain intact';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(expect_accepted boolean) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE
  command alpha_wallet_simulation.commands%ROWTYPE;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
  acceptance alpha_wallet_initial_marketplace_simulation.acceptances%ROWTYPE;
  publication alpha_wallet_initial_marketplace_simulation.publications%ROWTYPE;
  actual jsonb; expected jsonb; baseline jsonb; source alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM alpha_wallet_initial_marketplace_simulation.activations)<>1
    OR (SELECT count(*) FROM alpha_wallet_initial_marketplace_simulation.acceptances)<>1
    OR (SELECT count(*) FROM alpha_wallet_initial_marketplace_simulation.publications)<>1 THEN
    RAISE EXCEPTION 'Cancellation successor requires exactly one original accepted predecessor';
  END IF;
  FOR activation IN SELECT * FROM alpha_wallet_initial_marketplace_simulation.activations LOOP
    SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=(activation.wallet_checkpoint->>'revision')::integer;
    IF source.revision IS NULL OR activation.wallet_checkpoint IS DISTINCT FROM jsonb_build_object('revision',source.revision,
        'eventHash',source.event_hash,'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
      OR source.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3'
      OR activation.canonical_basis#>>'{request,id}' IS DISTINCT FROM activation.request_id
      OR activation.canonical_basis#>>'{request,trade_id}' IS DISTINCT FROM activation.platform_trade_id
      OR activation.canonical_basis#>>'{request,listing_id}' IS DISTINCT FROM activation.platform_listing_id
      OR activation.canonical_basis#>>'{request,seller_id}' IS DISTINCT FROM activation.seller_id
      OR activation.canonical_basis#>>'{request,buyer_id}' IS DISTINCT FROM activation.buyer_id
      OR activation.canonical_basis#>>'{request,status}' IS DISTINCT FROM 'pending'
      OR activation.canonical_basis#>>'{listing,id}' IS DISTINCT FROM activation.platform_listing_id
      OR activation.canonical_basis#>>'{listing,seller_id}' IS DISTINCT FROM activation.seller_id THEN
      RAISE EXCEPTION 'Retained initial marketplace activation differs from its original checkpoint or identities';
    END IF;
    actual:=alpha_wallet_cancellation_marketplace_simulation.capture_initial_canonical_basis(activation.request_id);
    SELECT * INTO acceptance FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=activation.request_id;
    IF acceptance.acceptance_key IS NULL THEN
      RAISE EXCEPTION 'Cancellation predecessor must already have its original acceptance';
    ELSE
      SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=acceptance.wallet_command_revision;
      IF command.revision IS NULL OR command.command_type IS DISTINCT FROM 'acceptInitialSellerRequest'
        OR command.command_key IS DISTINCT FROM acceptance.wallet_command_key
        OR command.event_hash IS DISTINCT FROM acceptance.wallet_event_hash
        OR command.result_json IS DISTINCT FROM acceptance.receipt
        OR command.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3'
        OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'seller'
        OR command.command_json#>>'{actor,id}' IS DISTINCT FROM acceptance.actor_user_id
        OR acceptance.actor_user_id IS DISTINCT FROM activation.seller_id
        OR acceptance.receipt->>'acceptanceKey' IS DISTINCT FROM acceptance.acceptance_key
        OR acceptance.receipt->>'platformRequestId' IS DISTINCT FROM activation.request_id
        OR acceptance.receipt->>'platformTradeId' IS DISTINCT FROM activation.platform_trade_id
        OR acceptance.receipt->>'buyerId' IS DISTINCT FROM activation.buyer_id
        OR acceptance.receipt->>'walletTradeId' IS DISTINCT FROM activation.wallet_trade_id
        OR command.revision<=(activation.wallet_checkpoint->>'revision')::integer
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts r
          WHERE r.acceptance_key=acceptance.acceptance_key AND r.command_revision=command.revision AND r.payload=acceptance.receipt)
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings b
          WHERE b.platform_request_id=activation.request_id AND b.platform_trade_id=activation.platform_trade_id
            AND b.wallet_trade_id=activation.wallet_trade_id AND b.command_revision=command.revision
            AND b.payload->>'walletListingId'=activation.wallet_listing_id AND b.payload->>'assetId'=activation.asset_id)
        OR (SELECT count(*) FROM alpha_wallet_simulation.initial_trade_bindings)<>1
        OR (SELECT count(*) FROM alpha_wallet_simulation.initial_acceptance_receipts)<>1 THEN
        RAISE EXCEPTION 'Retained initial marketplace receipt must match its original command, event hash and full-principal binding';
      END IF;
      expected:=alpha_wallet_cancellation_marketplace_simulation.initial_expected_canonical(activation,command,
        acceptance.canonical_result#>>'{request,timeline,-1,actorRole}');
      IF acceptance.canonical_result IS DISTINCT FROM expected
        OR (expect_accepted AND (actual->'request' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'purchase_requests')
        OR actual->'listing' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'listings')
        OR actual->'trade' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'trades'))) THEN
        RAISE EXCEPTION 'Initial acceptance requires exact retained canonical request, physical trade and listing poststate';
      END IF;
      -- Original sibling identities, ordering, quantities, statuses and payloads
      -- remain exact; only the target request receives the supported transition.
      SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]'::jsonb) INTO baseline
        FROM jsonb_array_elements(activation.canonical_basis->'siblings') WHERE value->>'id'<>activation.request_id;
      SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]'::jsonb) INTO actual
        FROM jsonb_array_elements(actual->'siblings') WHERE value->>'id'<>activation.request_id;
      IF actual IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Initial marketplace listing sibling inventory changed'; END IF;
      SELECT to_jsonb(n) INTO actual FROM alpha_exchange.notifications n WHERE id=expected#>>'{notifications,0,id}';
      IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'notifications') THEN
        RAISE EXCEPTION 'Initial acceptance requires its exact canonical notification';
      END IF;
      SELECT to_jsonb(a) INTO actual FROM alpha_exchange.audit_logs a WHERE id=expected#>>'{auditLogs,0,id}';
      IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'audit_logs') THEN
        RAISE EXCEPTION 'Initial acceptance requires its exact canonical audit event';
      END IF;
      SELECT * INTO publication FROM alpha_wallet_initial_marketplace_simulation.publications WHERE acceptance_key=acceptance.acceptance_key;
      IF publication.id IS DISTINCT FROM acceptance.publication_id
        OR publication.id IS DISTINCT FROM 'initial-wallet-publication-'||acceptance.acceptance_key
        OR publication.payload IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_publication_payload(acceptance.acceptance_key) THEN
        RAISE EXCEPTION 'Initial acceptance, canonical persistence and safe publication intent must commit together';
      END IF;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.activations)
    AND (EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts)) THEN
    RAISE EXCEPTION 'Initial financial acceptance requires explicit canonical activation';
  END IF;
END;
$fn$;

-- Deterministic JSON used only for the fixed canonical payload commitments.
-- Exponent-form magnitudes outside this bounded development profile fail closed.
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.canonical_json(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE result text; number numeric;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||alpha_wallet_cancellation_marketplace_simulation.canonical_json(item),',' ORDER BY key COLLATE "C"),'')||'}'
        INTO result FROM jsonb_each(value) AS pair(key,item);
    WHEN 'array' THEN
      SELECT '['||coalesce(string_agg(alpha_wallet_cancellation_marketplace_simulation.canonical_json(item),',' ORDER BY ordinal),'')||']'
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(item,ordinal);
    WHEN 'number' THEN
      number:=(value#>>'{}')::numeric;
      IF abs(number)>=1000000000000000000000 OR (number<>0 AND abs(number)<0.000001) THEN
        RAISE EXCEPTION 'Canonical numeric magnitude is outside the fixed cancellation profile';
      END IF;
      result:=trim_scale(number)::text;
    ELSE result:=value::text;
  END CASE;
  RETURN result;
END;
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.payload_digest(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT encode(sha256(convert_to(alpha_wallet_cancellation_marketplace_simulation.canonical_json(value),'UTF8')),'hex');
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.input_digest(operation text, actor_id text, request_id text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT alpha_wallet_cancellation_marketplace_simulation.payload_digest(jsonb_build_object(
    'kind',CASE WHEN $1='upgrade' THEN 'alpha-wallet-initial-cancellation-upgrade-v1'
      WHEN $1='cancel' THEN 'alpha-wallet-initial-cancellation-request-v1' ELSE NULL END,'actorUserId',$2,'requestId',$3));
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.capture_predecessor(request_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('activation',to_jsonb(v),'acceptance',to_jsonb(a),'publication',to_jsonb(p))
  FROM alpha_wallet_initial_marketplace_simulation.activations v
  JOIN alpha_wallet_initial_marketplace_simulation.acceptances a ON a.request_id=v.request_id
  JOIN alpha_wallet_initial_marketplace_simulation.publications p ON p.acceptance_key=a.acceptance_key WHERE v.request_id=$1;
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.capture_cancellation_basis(request_id text, actor_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('request',to_jsonb(r),'listing',to_jsonb(l),'trade',to_jsonb(t),
    'actorRole',(SELECT role FROM alpha_exchange.users WHERE id=$2),
    'reminders',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.sort_index,n.id COLLATE "C"),'[]'::jsonb)
      FROM alpha_exchange.notifications n WHERE n.user_id=r.buyer_id AND n.payload->>'userId'=r.buyer_id
        AND n.payload->>'reason'='automatic_trade_action_reminder' AND n.payload->>'relatedRequestId'=r.id
        AND n.payload->>'state' IS DISTINCT FROM 'archived'))
  FROM alpha_exchange.purchase_requests r JOIN alpha_exchange.listings l ON l.id=r.listing_id
  JOIN alpha_exchange.trades t ON t.id=r.trade_id AND t.purchase_request_id=r.id WHERE r.id=$1;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE command jsonb; expected_type text; actor_kind text;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=NEW.request_id;
  IF NEW.transaction_id IS DISTINCT FROM txid_current()::text OR current_setting('transaction_read_only')<>'off'
    OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL
    OR to_regclass('alpha_wallet_initial_marketplace_simulation.recovery_receipts') IS NOT NULL
    OR activation.request_id IS NULL OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Invalid cancellation marketplace transaction registration';
  END IF;
  IF TG_OP='INSERT' AND (NEW.planned_command IS NOT NULL OR NEW.canonical_basis IS NOT NULL) THEN
    RAISE EXCEPTION 'Register cancellation context before binding its command';
  END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['planned_command','planned_command_key','canonical_basis'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['planned_command','planned_command_key','canonical_basis'])
      OR OLD.planned_command IS NOT NULL OR NEW.planned_command IS NULL OR NEW.canonical_basis IS NOT NULL) THEN
    RAISE EXCEPTION 'Cancellation context may bind one exact command and capture its real prestate once';
  END IF;
  command:=NEW.planned_command;
  IF command IS NOT NULL THEN
    expected_type:=CASE NEW.operation WHEN 'upgrade' THEN 'continueFromV3' WHEN 'cancel' THEN 'cancelInitialTrade'
      WHEN 'pause' THEN 'pause' ELSE NULL END;
    actor_kind:=CASE WHEN NEW.operation='cancel' THEN
      CASE WHEN NEW.actor_user_id=activation.buyer_id THEN 'buyer' WHEN NEW.actor_user_id=activation.seller_id THEN 'seller' ELSE NULL END
      ELSE 'operator' END;
    IF expected_type IS NULL OR actor_kind IS NULL OR command->>'type' IS DISTINCT FROM expected_type
      OR command->'version' IS DISTINCT FROM to_jsonb(4) OR command->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
      OR command#>>'{actor,id}' IS DISTINCT FROM NEW.actor_user_id OR command#>>'{actor,kind}' IS DISTINCT FROM actor_kind
      OR NEW.planned_command_key::jsonb IS DISTINCT FROM jsonb_build_array(actor_kind,NEW.actor_user_id,expected_type,command->>'requestId')
      OR (NEW.operation='pause' AND command->'input' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'Cancellation context actor, engine, identity or operation mismatch';
    END IF;
    IF NEW.operation='cancel' THEN
      PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(true);
      IF NOT EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.transitions WHERE request_id=NEW.request_id)
        OR EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.cancellations)
        OR command#>>'{input,terms,platformRequestId}' IS DISTINCT FROM NEW.request_id
        OR command#>>'{input,terms,platformListingId}' IS DISTINCT FROM activation.platform_listing_id
        OR command#>>'{input,terms,platformTradeId}' IS DISTINCT FROM activation.platform_trade_id
        OR command#>>'{input,terms,sellerId}' IS DISTINCT FROM activation.seller_id
        OR command#>>'{input,terms,buyerId}' IS DISTINCT FROM activation.buyer_id
        OR command#>>'{input,principalReturn,walletTradeId}' IS DISTINCT FROM activation.wallet_trade_id
        OR command#>>'{input,principalReturn,walletListingId}' IS DISTINCT FROM activation.wallet_listing_id THEN
        RAISE EXCEPTION 'Cancellation binding requires the exact uncancelled accepted mapping';
      END IF;
      NEW.canonical_basis:=alpha_wallet_cancellation_marketplace_simulation.capture_cancellation_basis(NEW.request_id,NEW.actor_user_id);
      IF NEW.canonical_basis IS NULL THEN RAISE EXCEPTION 'Cancellation physical prestate is missing'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.require_command(command_revision integer, expected_type text)
RETURNS alpha_wallet_simulation.commands
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  context:=alpha_wallet_cancellation_marketplace_simulation.require_context();
  PERFORM alpha_wallet_simulation.require_current_command(command_revision);
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=command_revision;
  IF command.command_json IS DISTINCT FROM context.planned_command OR command.command_key IS DISTINCT FROM context.planned_command_key
    OR command.command_type IS DISTINCT FROM expected_type THEN
    RAISE EXCEPTION 'Cancellation write requires the exact current transaction financial command';
  END IF;
  RETURN command;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.expected_canonical(
  basis jsonb, command alpha_wallet_simulation.commands) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE request jsonb; listing jsonb; trade jsonb; request_before jsonb; listing_before jsonb;
  notification jsonb; notices jsonb:='[]'::jsonb; reminder jsonb; reminders jsonb:='[]'::jsonb; audit jsonb;
  at_time text; at_timestamp timestamptz; suffix text; timeline jsonb; actor_id text; actor_kind text; actor_role text; side text;
  receiver text; field text; disclosed boolean; initial alpha_wallet_initial_marketplace_simulation.acceptances%ROWTYPE;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE; original_command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  request_before:=basis#>'{request,payload}'; listing_before:=basis#>'{listing,payload}';
  actor_id:=command.command_json#>>'{actor,id}'; actor_kind:=command.command_json#>>'{actor,kind}'; actor_role:=basis->>'actorRole';
  SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=request_before->>'id';
  SELECT * INTO initial FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=activation.request_id;
  SELECT * INTO original_command FROM alpha_wallet_simulation.commands WHERE revision=initial.wallet_command_revision;
  IF command.command_type IS DISTINCT FROM 'cancelInitialTrade' OR activation.request_id IS NULL OR initial.acceptance_key IS NULL
    OR basis IS DISTINCT FROM jsonb_build_object('request',basis->'request','listing',basis->'listing','trade',basis->'trade',
      'reminders',basis->'reminders','actorRole',basis->'actorRole')
    OR basis->'request' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,initial.canonical_result,'purchase_requests')
    OR basis->'listing' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,initial.canonical_result,'listings')
    OR basis->'trade' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,initial.canonical_result,'trades')
    OR NOT coalesce(actor_role IN ('guest','student','buyer','pending_seller_approval','approved_seller','admin','owner'),false)
    OR actor_kind IS DISTINCT FROM (CASE actor_id WHEN activation.seller_id THEN 'seller' WHEN activation.buyer_id THEN 'buyer' ELSE NULL END)
    OR actor_kind NOT IN ('buyer','seller')
    OR command.command_json#>'{input,terms}' IS DISTINCT FROM original_command.command_json#>'{input,terms}'
    OR NOT alpha_wallet_cancellation_marketplace_simulation.request_terms_match(request_before,command.command_json#>'{input,terms}') THEN
    RAISE EXCEPTION 'Cancellation requires its exact original accepted canonical prestate, terms and stored party';
  END IF;
  at_timestamp:=to_timestamp(command.occurred_at_ms::numeric/1000);
  at_time:=to_char(at_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF command.command_json#>'{input,cancelledAtMs}' IS DISTINCT FROM to_jsonb(command.occurred_at_ms)
    OR at_timestamp<=(request_before->>'updatedAt')::timestamptz OR at_timestamp<=(listing_before->>'updatedAt')::timestamptz
    OR request_before->>'status' IS DISTINCT FROM 'accepted' OR listing_before->>'status' IS DISTINCT FROM 'matched'
    OR listing_before->>'activeTradeRequestId' IS DISTINCT FROM activation.request_id
    OR listing_before->>'lockedAt' IS NULL OR basis#>>'{listing,active_trade_request_id}' IS DISTINCT FROM activation.request_id
    OR (listing_before ? 'expiresAt' AND (listing_before->>'expiresAt')::timestamptz<=at_timestamp)
    OR basis#>>'{listing,expires_at}' IS DISTINCT FROM (CASE WHEN listing_before ? 'expiresAt'
      THEN to_jsonb((listing_before->>'expiresAt')::timestamptz)#>>'{}' ELSE NULL END)
    OR command.command_json#>>'{input,preconditions,requestUpdatedAt}' IS DISTINCT FROM request_before->>'updatedAt'
    OR command.command_json#>'{input,preconditions,listingExpiresAt}' IS DISTINCT FROM coalesce(listing_before->'expiresAt','null'::jsonb)
    OR command.command_json#>>'{input,preconditions,requestDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(request_before)
    OR command.command_json#>>'{input,preconditions,listingDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(listing_before)
    OR command.command_json#>>'{input,preconditions,tradeDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(basis#>'{trade,payload}')
    OR command.command_json#>'{input,preconditions,canonicalPrepayment}' IS DISTINCT FROM 'true'::jsonb
    OR command.command_json#>'{input,preconditions,canonicalTermsUnchanged}' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Cancellation canonical clocks, lock, expiry or digest assertions differ from real retained rows';
  END IF;
  FOREACH field IN ARRAY ARRAY['paymentSentAt','fundsReceivedAt','usdtReleaseStartedAt','usdtSentAt','completedAt',
    'buyerEvidence','sellerEvidence','usdtDemandId','usdtDemandOfferId','priceOfferAcceptedAt','timedOutAt','timeoutReason',
    'buyerConfirmationArchivedAt','lockedAt','reviewUnlockedAt','buyerReview','sellerBuyerReview','sellerResponse','closedAt',
    'closedByUserId','closeReason','closeExplanation','completionReceipt','historicalCompletion','buyerVolumeCredit','trustReconciliation',
    'usdtReleaseDeadlineAt','sellerWiseAccountId','buyerWiseAccountId','sellerWiseAccountSnapshot','buyerWiseAccountSnapshot'] LOOP
    IF request_before ? field THEN RAISE EXCEPTION 'Cancellation refuses unsupported payment, completion or evidence progress'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(request_before->'timeline') e WHERE e->>'type' IN (
      'payment_sent','seller_confirmed_funds','buyer_confirmed_funds','usdt_release_started','usdt_sent',
      'trade_completed','buyer_confirmed_receipt','buyer_evidence_uploaded','seller_evidence_uploaded'))
    OR EXISTS (SELECT 1 FROM alpha_exchange.evidence e WHERE e.purchase_request_id=activation.request_id OR e.payload->>'purchaseRequestId'=activation.request_id)
    OR EXISTS (SELECT 1 FROM alpha_exchange.disputes d WHERE (d.purchase_request_id=activation.request_id OR d.payload->>'purchaseRequestId'=activation.request_id
      OR d.trade_id=activation.platform_trade_id OR d.payload->>'tradeId'=activation.platform_trade_id) AND
      (d.status='open' OR d.payload->>'status'='open' OR d.purchase_request_id<>activation.request_id OR d.trade_id<>activation.platform_trade_id))
    OR EXISTS (SELECT 1 FROM alpha_exchange.commissions c WHERE c.purchase_request_id=activation.request_id
      OR c.payload->>'purchaseRequestId'=activation.request_id OR c.payload->>'tradeId'=activation.platform_trade_id)
    OR NOT coalesce(request_before->>'paymentMethod' IN ('Bank Transfer','Face-to-Face','Face-to-Face (Meet in Person)'),false)
    OR request_before->>'bankTransferProvider'='wise' OR listing_before->>'bankTransferProvider'='wise'
    OR request_before->>'sensitivePaymentKind'='cardless_code'
    OR request_before->'cardlessCodeAwaitingBuyerConfirmation'='true'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(request_before->'messages','[]'::jsonb)) m WHERE m->>'credentialKind'='cardless_code')
    OR listing_before ?| ARRAY['closedAt','expiredAt','cancelledAt','completedAt','wiseAccountId'] THEN
    RAISE EXCEPTION 'Cancellation is outside the unexpired ordinary prepayment Bank/F2F scope';
  END IF;
  disclosed:=coalesce(request_before->>'sensitivePaymentKind'='bank_details' AND request_before ? 'sensitivePaymentSharedAt',false)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(request_before->'timeline') e WHERE e->>'type'='bank_details_revealed'
      AND (nullif(e->>'actorUserId','') IS NULL OR e->>'actorUserId'=activation.buyer_id));
  IF command.command_json#>'{input,preconditions,buyerBankDetailsDisclosed}' IS DISTINCT FROM to_jsonb(disclosed)
    OR (actor_kind='buyer' AND disclosed) THEN RAISE EXCEPTION 'Buyer cancellation is locked after bank details disclosure'; END IF;
  IF NOT coalesce(listing_before->>'availableAmount' ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$',false)
    OR (listing_before->>'availableAmount')::numeric * (CASE activation.asset_id WHEN 'tron-sim-usdt' THEN 1000000 ELSE 1000000000000000000 END)
      <> (command.command_json#>>'{input,principalReturn,expectedListingAvailableRaw}')::numeric
        +(command.command_json#>>'{input,principalReturn,principalRaw}')::numeric THEN
    RAISE EXCEPTION 'Canonical available inventory and full wallet listing plus reservation disagree';
  END IF;
  suffix:=encode(sha256(convert_to('["prepayment_participant_cancellation",'||to_jsonb(activation.request_id)::text||','||to_jsonb(activation.platform_trade_id)::text||']','UTF8')),'hex');
  side:=CASE actor_kind WHEN 'buyer' THEN 'Buyer' ELSE 'Seller' END;
  timeline:=request_before->'timeline'||jsonb_build_array(jsonb_build_object('id','prepayment-cancellation-event-'||suffix,
    'type','request_cancelled','actorUserId',actor_id,'actorRole',actor_role,'message',side||' cancelled request','createdAt',at_time));
  request:=(request_before-ARRAY['actionReminderState','inactivityWarningSentAt'])||jsonb_build_object('status','cancelled',
    'updatedAt',at_time,'timeline',timeline,'trustReconciliation',jsonb_build_object('requestedAt',at_time,'requestedByUserId',actor_id));
  IF request_before#>>'{termsProposal,status}'='pending' THEN
    request:=jsonb_set(request,'{termsProposal}',request_before->'termsProposal'||jsonb_build_object('status','withdrawn','resolvedAt',at_time));
  END IF;
  listing:=(listing_before-ARRAY['activeTradeRequestId','lockedAt'])||jsonb_build_object('status','active','updatedAt',at_time);
  trade:=jsonb_build_object('id',activation.platform_trade_id,'purchaseRequestId',activation.request_id,'listingId',activation.platform_listing_id,
    'sellerId',activation.seller_id,'buyerId',activation.buyer_id,'status','cancelled','createdAt',request_before->>'tradeCreatedAt','updatedAt',at_time,'timeline',timeline);
  FOREACH receiver IN ARRAY ARRAY[activation.buyer_id,activation.seller_id] LOOP
    notification:=jsonb_build_object('id','prepayment-cancellation-notification-'||CASE WHEN receiver=activation.buyer_id THEN 'buyer' ELSE 'seller' END||'-'||suffix,
      'userId',receiver,'category','trade','title','Trade cancelled','message','The '||lower(side)||' cancelled this trade request.',
      'isRead',false,'state','unread','relatedRequestId',activation.request_id,'relatedTradeId',activation.platform_trade_id,
      'relatedListingId',activation.platform_listing_id,'relatedHref','/trade-room/'||activation.request_id,'createdAt',at_time);
    notices:=notices||jsonb_build_array(notification);
  END LOOP;
  FOR reminder IN SELECT value FROM jsonb_array_elements(basis->'reminders') LOOP
    IF reminder->>'user_id' IS DISTINCT FROM activation.buyer_id OR reminder#>>'{payload,userId}' IS DISTINCT FROM activation.buyer_id
      OR reminder#>>'{payload,reason}' IS DISTINCT FROM 'automatic_trade_action_reminder'
      OR reminder#>>'{payload,relatedRequestId}' IS DISTINCT FROM activation.request_id OR reminder#>>'{payload,state}'='archived' THEN
      RAISE EXCEPTION 'Cancellation reminder basis contains unrelated or archived rows';
    END IF;
    reminders:=reminders||jsonb_build_array(reminder->'payload'||jsonb_build_object('state','archived','isRead',true,'archivedAt',at_time,'updatedAt',at_time));
  END LOOP;
  audit:=jsonb_build_object('id','prepayment-cancellation-audit-'||suffix,'action','listing_reopened','actorUserId',actor_id,
    'targetUserId',activation.seller_id,'listingId',activation.platform_listing_id,'purchaseRequestId',activation.request_id,
    'details','Listing '||activation.platform_listing_id||' reopened after trade cancellation.',
    'oldValue',jsonb_build_object('status',request_before->>'status','activeTradeRequestId',listing_before->>'activeTradeRequestId'),
    'newValue',jsonb_build_object('status','active'),'reason',side||' cancelled the trade.','createdAt',at_time);
  RETURN jsonb_build_object('request',request,'listing',listing,'trade',trade,'notifications',notices,'notificationUpdates',reminders,'auditLogs',jsonb_build_array(audit));
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.expected_row(basis jsonb, canonical jsonb, table_name text, row_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE payload jsonb; before_row jsonb; cancelled_time timestamptz; ordinal bigint;
BEGIN
  cancelled_time:=(canonical#>>'{request,updatedAt}')::timestamptz;
  IF table_name='purchase_requests' THEN
    RETURN basis->'request'||jsonb_build_object('status','cancelled','updated_at',cancelled_time,'payload',canonical->'request');
  ELSIF table_name='listings' THEN
    RETURN basis->'listing'||jsonb_build_object('status','active','active_trade_request_id',null,'updated_at',cancelled_time,'payload',canonical->'listing');
  ELSIF table_name='trades' THEN
    RETURN basis->'trade'||jsonb_build_object('status','cancelled','updated_at',cancelled_time,'payload',canonical->'trade');
  ELSIF table_name='notifications' THEN
    SELECT value,number-1 INTO payload,ordinal FROM jsonb_array_elements(canonical->'notifications') WITH ORDINALITY AS e(value,number) WHERE value->>'id'=row_id;
    IF payload IS NOT NULL THEN
      RETURN jsonb_build_object('id',payload->>'id','user_id',payload->>'userId','category','trade','is_read',false,
        'created_at',cancelled_time,'sort_index',ordinal,'payload',payload);
    END IF;
    SELECT value INTO payload FROM jsonb_array_elements(canonical->'notificationUpdates') WHERE value->>'id'=row_id;
    SELECT value INTO before_row FROM jsonb_array_elements(basis->'reminders') WHERE value->>'id'=row_id;
    IF payload IS NOT NULL AND before_row IS NOT NULL THEN
      RETURN before_row||jsonb_build_object('is_read',true,'payload',payload);
    END IF;
  ELSIF table_name='audit_logs' THEN
    payload:=canonical#>'{auditLogs,0}';
    IF payload->>'id'=row_id THEN
      RETURN jsonb_build_object('id',payload->>'id','action','listing_reopened','actor_user_id',payload->>'actorUserId',
        'target_user_id',payload->>'targetUserId','listing_id',payload->>'listingId','purchase_request_id',payload->>'purchaseRequestId',
        'created_at',cancelled_time,'sort_index',0,'payload',payload);
    END IF;
  END IF;
  RAISE EXCEPTION 'Unsupported cancellation canonical projection';
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE; source alpha_wallet_simulation.commands%ROWTYPE;
  continuation alpha_wallet_simulation.cancellation_engine_continuations%ROWTYPE;
BEGIN
  context:=alpha_wallet_cancellation_marketplace_simulation.require_context();
  command:=alpha_wallet_cancellation_marketplace_simulation.require_command(NEW.wallet_command_revision,'continueFromV3');
  SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=NEW.wallet_command_revision-1;
  SELECT * INTO continuation FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
  PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(true);
  IF context.operation<>'upgrade' OR context.request_id IS DISTINCT FROM NEW.request_id OR context.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR NEW.input_digest IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.input_digest('upgrade',NEW.actor_user_id,NEW.request_id)
    OR NEW.wallet_command_key IS DISTINCT FROM command.command_key OR NEW.wallet_event_hash IS DISTINCT FROM command.event_hash
    OR NEW.continuation IS DISTINCT FROM command.result_json OR NEW.continuation->'checkpoint' IS DISTINCT FROM NEW.wallet_checkpoint
    OR NEW.wallet_checkpoint IS DISTINCT FROM jsonb_build_object('revision',source.revision,'eventHash',source.event_hash,
      'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
    OR source.command_json->'version' IS DISTINCT FROM to_jsonb(3)
    OR NEW.predecessor IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.capture_predecessor(NEW.request_id)
    OR continuation.command_revision IS DISTINCT FROM command.revision OR continuation.command_key IS DISTINCT FROM command.command_key
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=NEW.actor_user_id
      AND (role='owner' OR (jsonb_typeof(payload->'roles')='array' AND payload->'roles' ? 'owner'))) THEN
    RAISE EXCEPTION 'Cancellation transition requires the exact original V3 checkpoint, new V4 continuation and predecessor evidence';
  END IF;
  -- Physical tuple versions prevent stale pre-upgrade writers from missing the
  -- new profile. No canonical payload/normalized value or runtime time changes.
  UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE id=NEW.request_id;
  UPDATE alpha_exchange.listings SET payload=payload WHERE id=NEW.predecessor#>>'{activation,platform_listing_id}';
  UPDATE alpha_exchange.runtime_meta SET version=version+1 WHERE singleton=true;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  context:=alpha_wallet_cancellation_marketplace_simulation.require_context();
  command:=alpha_wallet_cancellation_marketplace_simulation.require_command(NEW.wallet_command_revision,'cancelInitialTrade');
  IF context.operation<>'cancel' OR context.request_id IS DISTINCT FROM NEW.request_id OR context.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR NEW.actor_kind IS DISTINCT FROM command.command_json#>>'{actor,kind}'
    OR NEW.input_digest IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.input_digest('cancel',NEW.actor_user_id,NEW.request_id)
    OR NEW.wallet_command_key IS DISTINCT FROM command.command_key OR NEW.wallet_event_hash IS DISTINCT FROM command.event_hash
    OR NEW.receipt IS DISTINCT FROM command.result_json OR NEW.cancellation_key IS DISTINCT FROM NEW.receipt->>'cancellationKey'
    OR NEW.receipt->>'platformRequestId' IS DISTINCT FROM NEW.request_id OR NEW.receipt->>'actorUserId' IS DISTINCT FROM NEW.actor_user_id
    OR NEW.receipt->>'actorKind' IS DISTINCT FROM NEW.actor_kind
    OR NEW.canonical_basis IS DISTINCT FROM context.canonical_basis
    OR NEW.canonical_result IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_canonical(NEW.canonical_basis,command)
    OR NEW.publication_id IS DISTINCT FROM 'cancellation-wallet-publication-'||NEW.cancellation_key
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts f WHERE f.cancellation_key=NEW.cancellation_key
      AND f.platform_request_id=NEW.request_id AND f.command_revision=NEW.wallet_command_revision AND f.payload=NEW.receipt) THEN
    RAISE EXCEPTION 'Cancellation coordination requires its exact new full-principal financial receipt and canonical effects';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.publication_payload(cancellation_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('type','initial_trade_cancelled','requestId',c.request_id,'listingId',v.platform_listing_id,
    'tradeId',v.platform_trade_id,'walletTradeId',v.wallet_trade_id,'sellerId',v.seller_id,'buyerId',v.buyer_id,
    'actorUserId',c.actor_user_id,'actorKind',c.actor_kind,'acceptanceKey',c.receipt->>'acceptanceKey',
    'cancellationKey',c.cancellation_key,'walletRevision',c.wallet_command_revision,'walletEventHash',c.wallet_event_hash,
    'termsDigest',c.receipt->>'termsDigest','notificationIds',jsonb_build_array(c.canonical_result#>>'{notifications,0,id}',c.canonical_result#>>'{notifications,1,id}'),
    'auditId',c.canonical_result#>>'{auditLogs,0,id}','timelineEventId',c.canonical_result#>>'{request,timeline,-1,id}')
  FROM alpha_wallet_cancellation_marketplace_simulation.cancellations c
  JOIN alpha_wallet_initial_marketplace_simulation.activations v ON v.request_id=c.request_id WHERE c.cancellation_key=$1;
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE cancellation alpha_wallet_cancellation_marketplace_simulation.cancellations%ROWTYPE;
BEGIN
  SELECT * INTO cancellation FROM alpha_wallet_cancellation_marketplace_simulation.cancellations WHERE cancellation_key=NEW.cancellation_key;
  PERFORM alpha_wallet_cancellation_marketplace_simulation.require_command(cancellation.wallet_command_revision,'cancelInitialTrade');
  IF NEW.id IS DISTINCT FROM cancellation.publication_id
    OR NEW.payload IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.publication_payload(NEW.cancellation_key) THEN
    RAISE EXCEPTION 'Cancellation publication must contain only its deterministic safe facts';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_wallet_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_cancellation_marketplace_simulation.require_context();
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_wallet_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
  context:=alpha_wallet_cancellation_marketplace_simulation.require_context();
  IF context.planned_command IS NULL OR NEW.command_json IS DISTINCT FROM context.planned_command
    OR NEW.command_key IS DISTINCT FROM context.planned_command_key
    OR NEW.command_type IS DISTINCT FROM (CASE context.operation WHEN 'upgrade' THEN 'continueFromV3'
      WHEN 'cancel' THEN 'cancelInitialTrade' WHEN 'pause' THEN 'pause' ELSE NULL END) THEN
    RAISE EXCEPTION 'Cancellation wallet commands require one exact registered coordinator intent';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.fence_dependency_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only' OR current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'Cancellation dependency writes require explicit writable simulation opt-in';
  END IF;
  IF EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.transaction_contexts c WHERE c.transaction_id=txid_current()::text
    AND c.planned_command IS NOT NULL AND ((c.operation='cancel' AND c.planned_command->>'type'='cancelInitialTrade')
      OR (c.operation='upgrade' AND c.planned_command->>'type'='continueFromV3'))) THEN
    -- The canonical participant/upgrade trigger performs exactly one explicit
    -- final runtime increment. Row guards still validate every scoped effect.
    PERFORM 1 FROM alpha_exchange.runtime_meta WHERE singleton=true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cancellation runtime fence is missing'; END IF;
    RETURN NULL;
  END IF;
  -- Legacy writers still physically version the complete decision fence.
  UPDATE alpha_exchange.runtime_meta SET version=version+1,updated_at=now() WHERE singleton=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancellation runtime fence is missing'; END IF;
  RETURN NULL;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_canonical() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE old_row jsonb; new_row jsonb; listing text; scoped boolean:=false;
  context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE; expected jsonb; before_row jsonb; row_id text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND old_row=new_row THEN RETURN NEW; END IF;
  FOR listing IN SELECT id FROM (
    SELECT alpha_wallet_cancellation_marketplace_simulation.scope_listings(old_row,TG_TABLE_NAME) id
    UNION SELECT alpha_wallet_cancellation_marketplace_simulation.scope_listings(new_row,TG_TABLE_NAME) id
  ) candidates ORDER BY id LOOP
    PERFORM 1 FROM alpha_exchange.listings WHERE id=listing FOR UPDATE;
    IF EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.activations WHERE platform_listing_id=listing) THEN scoped:=true;
    ELSIF TG_TABLE_NAME<>'listings' THEN UPDATE alpha_exchange.listings SET payload=payload WHERE id=listing;
    END IF;
  END LOOP;
  IF NOT scoped THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  context:=alpha_wallet_cancellation_marketplace_simulation.require_context();
  IF context.operation<>'cancel' OR context.planned_command IS NULL OR context.canonical_basis IS NULL THEN
    RAISE EXCEPTION 'Legacy and unsupported writers are fenced for the complete cancellation cohort listing';
  END IF;
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
  command:=alpha_wallet_cancellation_marketplace_simulation.require_command(command.revision,'cancelInitialTrade');
  expected:=alpha_wallet_cancellation_marketplace_simulation.expected_canonical(context.canonical_basis,command);
  row_id:=coalesce(new_row->>'id',old_row->>'id');
  IF TG_TABLE_NAME='purchase_requests' THEN before_row:=context.canonical_basis->'request';
  ELSIF TG_TABLE_NAME='listings' THEN before_row:=context.canonical_basis->'listing';
  ELSIF TG_TABLE_NAME='trades' THEN before_row:=context.canonical_basis->'trade';
  ELSIF TG_TABLE_NAME='notifications' THEN
    SELECT value INTO before_row FROM jsonb_array_elements(context.canonical_basis->'reminders') WHERE value->>'id'=row_id;
  ELSIF TG_TABLE_NAME='audit_logs' THEN before_row:=NULL;
  ELSE RAISE EXCEPTION 'Unsupported cancellation lifecycle or auxiliary write is fenced'; END IF;
  IF old_row IS DISTINCT FROM before_row OR TG_OP IS DISTINCT FROM (CASE WHEN before_row IS NULL THEN 'INSERT' ELSE 'UPDATE' END)
    OR new_row IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_row(context.canonical_basis,expected,TG_TABLE_NAME,row_id) THEN
    RAISE EXCEPTION 'Cancellation permits only its exact canonical prepayment cancellation delta';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.assert_coherence() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
  transition alpha_wallet_cancellation_marketplace_simulation.transitions%ROWTYPE;
  cancellation alpha_wallet_cancellation_marketplace_simulation.cancellations%ROWTYPE;
  publication alpha_wallet_cancellation_marketplace_simulation.publications%ROWTYPE;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
  initial alpha_wallet_initial_marketplace_simulation.acceptances%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE; source alpha_wallet_simulation.commands%ROWTYPE;
  financial alpha_wallet_simulation.cancellation_engine_continuations%ROWTYPE;
  expected jsonb; actual jsonb; item jsonb; identifier text;
BEGIN
  context:=alpha_wallet_cancellation_marketplace_simulation.require_context();
  PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(false);
  SELECT * INTO transition FROM alpha_wallet_cancellation_marketplace_simulation.transitions WHERE request_id=context.request_id;
  SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=context.request_id;
  SELECT * INTO initial FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=context.request_id;
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=transition.wallet_command_revision;
  SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=transition.wallet_command_revision-1;
  SELECT * INTO financial FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
  IF (SELECT count(*) FROM alpha_wallet_cancellation_marketplace_simulation.transitions)<>1 OR transition.request_id IS NULL
    OR (SELECT format_version FROM alpha_wallet_simulation.head WHERE singleton) IS DISTINCT FROM 4
    OR transition.profile IS DISTINCT FROM 'canonical-initial-cancellation-cohort-v1'
    OR transition.input_digest IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.input_digest('upgrade',transition.actor_user_id,transition.request_id)
    OR transition.predecessor IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.capture_predecessor(transition.request_id)
    OR command.command_type IS DISTINCT FROM 'continueFromV3' OR command.command_json->'version' IS DISTINCT FROM to_jsonb(4)
    OR command.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
    OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'operator' OR command.command_json#>>'{actor,id}' IS DISTINCT FROM transition.actor_user_id
    OR command.command_key IS DISTINCT FROM transition.wallet_command_key OR command.event_hash IS DISTINCT FROM transition.wallet_event_hash
    OR command.result_json IS DISTINCT FROM transition.continuation
    OR command.command_json#>'{input,checkpoint}' IS DISTINCT FROM transition.wallet_checkpoint
    OR transition.wallet_checkpoint IS DISTINCT FROM jsonb_build_object('revision',source.revision,'eventHash',source.event_hash,
      'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
    OR source.command_json->'version' IS DISTINCT FROM to_jsonb(3)
    OR source.revision<initial.wallet_command_revision
    OR financial.command_revision IS DISTINCT FROM command.revision OR financial.command_key IS DISTINCT FROM command.command_key
    OR transition.continuation IS DISTINCT FROM jsonb_build_object('checkpoint',transition.wallet_checkpoint,'commandRevision',command.revision,
      'commandKey',command.command_key,'sourceHaltReason',financial.source_halt_reason) THEN
    RAISE EXCEPTION 'Cancellation successor must retain its exact predecessor and original source-bound V4 continuation';
  END IF;
  IF context.planned_command IS NOT NULL THEN
    SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
    IF command.revision IS NULL OR command.command_json IS DISTINCT FROM context.planned_command
      OR (context.operation='upgrade' AND command.revision<>transition.wallet_command_revision)
      OR (context.operation='cancel' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.cancellations c
        WHERE c.wallet_command_revision=command.revision AND c.canonical_basis=context.canonical_basis)) THEN
      RAISE EXCEPTION 'A bound cancellation successor intent and all exact financial/canonical effects must commit together';
    END IF;
  END IF;
  SELECT * INTO cancellation FROM alpha_wallet_cancellation_marketplace_simulation.cancellations WHERE request_id=context.request_id;
  IF cancellation.cancellation_key IS NULL THEN
    IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts)
      OR EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.publications) THEN
      RAISE EXCEPTION 'A cancellation principal return cannot commit without its coordinated canonical receipt';
    END IF;
    PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(true);
  ELSE
    SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=cancellation.wallet_command_revision;
    expected:=alpha_wallet_cancellation_marketplace_simulation.expected_canonical(cancellation.canonical_basis,command);
    IF (SELECT count(*) FROM alpha_wallet_cancellation_marketplace_simulation.cancellations)<>1
      OR (SELECT count(*) FROM alpha_wallet_simulation.initial_cancellation_receipts)<>1
      OR (SELECT count(*) FROM alpha_wallet_cancellation_marketplace_simulation.publications)<>1
      OR command.command_type IS DISTINCT FROM 'cancelInitialTrade' OR command.command_json->'version' IS DISTINCT FROM to_jsonb(4)
      OR command.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
      OR command.command_json#>>'{actor,id}' IS DISTINCT FROM cancellation.actor_user_id
      OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM cancellation.actor_kind
      OR cancellation.input_digest IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.input_digest('cancel',cancellation.actor_user_id,cancellation.request_id)
      OR command.command_key IS DISTINCT FROM cancellation.wallet_command_key OR command.event_hash IS DISTINCT FROM cancellation.wallet_event_hash
      OR command.result_json IS DISTINCT FROM cancellation.receipt OR cancellation.canonical_result IS DISTINCT FROM expected
      OR command.revision<=transition.wallet_command_revision
      OR cancellation.receipt->>'cancellationKey' IS DISTINCT FROM cancellation.cancellation_key
      OR cancellation.receipt->>'acceptanceKey' IS DISTINCT FROM initial.acceptance_key
      OR cancellation.receipt->>'platformRequestId' IS DISTINCT FROM activation.request_id
      OR cancellation.receipt->>'platformTradeId' IS DISTINCT FROM activation.platform_trade_id
      OR cancellation.receipt->>'platformListingId' IS DISTINCT FROM activation.platform_listing_id
      OR cancellation.receipt->>'walletTradeId' IS DISTINCT FROM activation.wallet_trade_id
      OR cancellation.receipt->>'walletListingId' IS DISTINCT FROM activation.wallet_listing_id
      OR cancellation.receipt->>'actorUserId' IS DISTINCT FROM cancellation.actor_user_id
      OR cancellation.receipt->>'actorKind' IS DISTINCT FROM cancellation.actor_kind
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts f WHERE f.cancellation_key=cancellation.cancellation_key
        AND f.platform_request_id=activation.request_id AND f.wallet_trade_id=activation.wallet_trade_id AND f.command_revision=command.revision AND f.payload=cancellation.receipt) THEN
      RAISE EXCEPTION 'Retained cancellation must preserve the exact immutable financial result, identity and canonical effects';
    END IF;
    SELECT to_jsonb(r) INTO actual FROM alpha_exchange.purchase_requests r WHERE id=activation.request_id;
    IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_row(cancellation.canonical_basis,expected,'purchase_requests',activation.request_id) THEN
      RAISE EXCEPTION 'Cancellation request poststate changed';
    END IF;
    SELECT to_jsonb(l) INTO actual FROM alpha_exchange.listings l WHERE id=activation.platform_listing_id;
    IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_row(cancellation.canonical_basis,expected,'listings',activation.platform_listing_id) THEN
      RAISE EXCEPTION 'Cancellation listing principal inventory or reopening poststate changed';
    END IF;
    SELECT to_jsonb(t) INTO actual FROM alpha_exchange.trades t WHERE id=activation.platform_trade_id;
    IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_row(cancellation.canonical_basis,expected,'trades',activation.platform_trade_id) THEN
      RAISE EXCEPTION 'Cancellation physical trade poststate changed';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements((expected->'notifications')||(expected->'notificationUpdates')) LOOP
      identifier:=item->>'id';
      SELECT to_jsonb(n) INTO actual FROM alpha_exchange.notifications n WHERE id=identifier;
      IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_row(cancellation.canonical_basis,expected,'notifications',identifier) THEN
        RAISE EXCEPTION 'Cancellation notification or reminder archive is incomplete or changed';
      END IF;
    END LOOP;
    identifier:=expected#>>'{auditLogs,0,id}';
    SELECT to_jsonb(a) INTO actual FROM alpha_exchange.audit_logs a WHERE id=identifier;
    IF actual IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.expected_row(cancellation.canonical_basis,expected,'audit_logs',identifier) THEN
      RAISE EXCEPTION 'Cancellation requires its exact retained reopen audit';
    END IF;
    SELECT * INTO publication FROM alpha_wallet_cancellation_marketplace_simulation.publications WHERE cancellation_key=cancellation.cancellation_key;
    IF publication.id IS DISTINCT FROM cancellation.publication_id OR publication.id IS DISTINCT FROM 'cancellation-wallet-publication-'||cancellation.cancellation_key
      OR publication.payload IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.publication_payload(cancellation.cancellation_key) THEN
      RAISE EXCEPTION 'Cancellation, principal return, canonical persistence and safe publication must commit together';
    END IF;
  END IF;
END;
$fn$;
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.check_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.transaction_contexts WHERE transaction_id=txid_current()::text) THEN
    PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_coherence();
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.require_v4_protocol() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF current_setting('alpha_wallet.writer_protocol',true) IS DISTINCT FROM 'simulation-v4-cancellation' THEN
    RAISE EXCEPTION 'Coordinated V4 storage requires its scoped cancellation successor protocol';
  END IF;
  PERFORM alpha_wallet_cancellation_marketplace_simulation.require_context();
END;
$fn$;

-- Only triggers installed by the exact predecessor profile are replaced.
-- Old functions and rows remain unchanged; the old context table is now sealed.
DO $switch$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['transaction_contexts','activations','acceptances','publications'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS complete_initial_marketplace_transaction ON alpha_wallet_initial_marketplace_simulation.%I',name);
    EXECUTE format('DROP TRIGGER IF EXISTS immutable_records ON alpha_wallet_initial_marketplace_simulation.%I',name);
    EXECUTE format('CREATE TRIGGER cancellation_predecessor_sealed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_initial_marketplace_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change()',name);
    EXECUTE format('ALTER TABLE alpha_wallet_initial_marketplace_simulation.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE alpha_wallet_initial_marketplace_simulation.%I FORCE ROW LEVEL SECURITY',name);
  END LOOP;
  DROP TRIGGER IF EXISTS initial_marketplace_context_shape ON alpha_wallet_initial_marketplace_simulation.transaction_contexts;
  DROP TRIGGER IF EXISTS initial_marketplace_context_no_delete ON alpha_wallet_initial_marketplace_simulation.transaction_contexts;
  DROP TRIGGER IF EXISTS complete_initial_marketplace_context ON alpha_wallet_initial_marketplace_simulation.transaction_contexts;
  DROP TRIGGER IF EXISTS initial_marketplace_activation_shape ON alpha_wallet_initial_marketplace_simulation.activations;
  DROP TRIGGER IF EXISTS initial_marketplace_acceptance_shape ON alpha_wallet_initial_marketplace_simulation.acceptances;
  DROP TRIGGER IF EXISTS initial_marketplace_publication_shape ON alpha_wallet_initial_marketplace_simulation.publications;
  DROP TRIGGER IF EXISTS initial_marketplace_wallet_head ON alpha_wallet_simulation.head;
  DROP TRIGGER IF EXISTS initial_marketplace_wallet_command ON alpha_wallet_simulation.commands;
  CREATE TRIGGER cancellation_marketplace_wallet_head BEFORE UPDATE ON alpha_wallet_simulation.head
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_wallet_head();
  CREATE TRIGGER cancellation_marketplace_wallet_command BEFORE INSERT ON alpha_wallet_simulation.commands
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_wallet_command();
  FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS initial_marketplace_listing_fence ON alpha_exchange.%I',name);
    EXECUTE format('DROP TRIGGER IF EXISTS initial_marketplace_no_truncate ON alpha_exchange.%I',name);
    EXECUTE format('DROP TRIGGER IF EXISTS complete_initial_canonical_transaction ON alpha_exchange.%I',name);
    EXECUTE format('CREATE TRIGGER cancellation_marketplace_listing_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_canonical()',name);
    EXECUTE format('CREATE TRIGGER cancellation_marketplace_no_truncate BEFORE TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change()',name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_cancellation_canonical_transaction AFTER INSERT OR UPDATE OR DELETE ON alpha_exchange.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.check_deferred()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs','users','marketplace_enforcement_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS initial_marketplace_dependency_fence ON alpha_exchange.%I',name);
    EXECUTE format('CREATE TRIGGER cancellation_marketplace_dependency_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.fence_dependency_statement()',name);
  END LOOP;
  DROP TRIGGER IF EXISTS initial_marketplace_participant_identity ON alpha_exchange.users;
  DROP TRIGGER IF EXISTS initial_marketplace_runtime_identity ON alpha_exchange.runtime_meta;
  DROP TRIGGER IF EXISTS initial_marketplace_runtime_no_replace ON alpha_exchange.runtime_meta;
  CREATE TRIGGER cancellation_marketplace_participant_identity BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.users
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_participant_identity();
  CREATE TRIGGER cancellation_marketplace_runtime_identity BEFORE UPDATE ON alpha_exchange.runtime_meta
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_runtime_fence();
  CREATE TRIGGER cancellation_marketplace_runtime_no_replace BEFORE INSERT OR DELETE OR TRUNCATE ON alpha_exchange.runtime_meta
    FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change();
  FOREACH name IN ARRAY ARRAY['users','marketplace_enforcement_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS initial_marketplace_no_truncate ON alpha_exchange.%I',name);
    EXECUTE format('CREATE TRIGGER cancellation_marketplace_no_truncate BEFORE TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['commands','head','initial_trade_bindings','initial_acceptance_receipts','cancellation_engine_continuations','initial_cancellation_receipts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS complete_initial_financial_transaction ON alpha_wallet_simulation.%I',name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_cancellation_financial_transaction AFTER INSERT OR UPDATE OR DELETE ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.check_deferred()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['transitions','cancellations','publications'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_cancellation_marketplace_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change()',name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_cancellation_marketplace_transaction AFTER INSERT ON alpha_wallet_cancellation_marketplace_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.check_deferred()',name);
  END LOOP;
  CREATE TRIGGER cancellation_marketplace_context_shape BEFORE INSERT OR UPDATE ON alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_context();
  CREATE TRIGGER cancellation_marketplace_context_no_delete BEFORE DELETE OR TRUNCATE ON alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
    FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.reject_change();
  CREATE CONSTRAINT TRIGGER complete_cancellation_marketplace_context AFTER INSERT OR UPDATE ON alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.check_deferred();
  CREATE TRIGGER cancellation_marketplace_transition_shape BEFORE INSERT ON alpha_wallet_cancellation_marketplace_simulation.transitions
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_transition();
  CREATE TRIGGER cancellation_marketplace_cancellation_shape BEFORE INSERT ON alpha_wallet_cancellation_marketplace_simulation.cancellations
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_cancellation();
  CREATE TRIGGER cancellation_marketplace_publication_shape BEFORE INSERT ON alpha_wallet_cancellation_marketplace_simulation.publications
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.guard_publication();
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='alpha_wallet_cancellation_marketplace_simulation' AND c.relkind='r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Cancellation successor tables must retain their bootstrap RLS fences';
  END IF;
END;
$switch$;
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_cancellation_marketplace_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_cancellation_marketplace_simulation FROM PUBLIC;
DO $client_grants$
DECLARE client_role text; namespace text;
BEGIN
  FOREACH namespace IN ARRAY ARRAY['alpha_wallet_initial_marketplace_simulation','alpha_wallet_cancellation_marketplace_simulation'] LOOP
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I',namespace,client_role);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I',namespace,client_role);
        EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM %I',namespace,client_role);
      END IF;
    END LOOP;
  END LOOP;
END;
$client_grants$;
