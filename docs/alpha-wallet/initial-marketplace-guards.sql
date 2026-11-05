-- DEVELOPMENT ONLY: initial seller acceptance, one explicit canonical cohort.
-- The fixed transaction owner authenticates users. These guards independently
-- require exact financial/canonical effects and refuse unsupported writers.

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'Initial marketplace coordination records and protected identities are immutable';
END;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.require_context()
RETURNS alpha_wallet_initial_marketplace_simulation.transaction_contexts
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF current_setting('transaction_read_only') <> 'off'
    OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL THEN
    RAISE EXCEPTION 'Initial marketplace requires a writable separate v3 cohort';
  END IF;
  SELECT * INTO context FROM alpha_wallet_initial_marketplace_simulation.transaction_contexts
    WHERE transaction_id=txid_current()::text;
  IF context.transaction_id IS NULL THEN
    RAISE EXCEPTION 'A registered same-transaction initial marketplace context is required; standalone wallet tools are disabled';
  END IF;
  RETURN context;
END;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE expected_type text; command jsonb;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF NEW.transaction_id<>txid_current()::text OR current_setting('transaction_read_only')<>'off'
    OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.purchase_requests WHERE id=NEW.request_id)
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Invalid initial marketplace transaction registration';
  END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['planned_command','planned_command_key'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['planned_command','planned_command_key'])
      OR OLD.planned_command IS NOT NULL OR NEW.planned_command IS NULL) THEN
    RAISE EXCEPTION 'Initial marketplace context may bind one exact command only';
  END IF;
  IF TG_OP='INSERT' AND NEW.planned_command IS NOT NULL THEN
    RAISE EXCEPTION 'Register before binding an initial marketplace command';
  END IF;
  command:=NEW.planned_command;
  IF command IS NOT NULL THEN
    expected_type:=CASE NEW.operation WHEN 'accept' THEN 'acceptInitialSellerRequest' WHEN 'pause' THEN 'pause' ELSE NULL END;
    IF expected_type IS NULL OR command->>'type' IS DISTINCT FROM expected_type
      OR command->'version' IS DISTINCT FROM to_jsonb(3)
      OR command->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3'
      OR command#>>'{actor,id}' IS DISTINCT FROM NEW.actor_user_id
      OR command#>>'{actor,kind}' IS DISTINCT FROM (CASE WHEN NEW.operation='accept' THEN 'seller' ELSE 'operator' END)
      OR NEW.planned_command_key::jsonb IS DISTINCT FROM jsonb_build_array(
        command#>>'{actor,kind}',NEW.actor_user_id,expected_type,command->>'requestId')
      OR (NEW.operation='pause' AND command->'input' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'Initial marketplace command identity or operation mismatch';
    END IF;
    IF NEW.operation='accept' THEN
      SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=NEW.request_id;
      IF activation.request_id IS NULL OR NEW.actor_user_id IS DISTINCT FROM activation.seller_id
        OR command#>>'{input,terms,platformRequestId}' IS DISTINCT FROM activation.request_id
        OR command#>>'{input,terms,platformListingId}' IS DISTINCT FROM activation.platform_listing_id
        OR command#>>'{input,terms,platformTradeId}' IS DISTINCT FROM activation.platform_trade_id
        OR command#>>'{input,terms,sellerId}' IS DISTINCT FROM activation.seller_id
        OR command#>>'{input,terms,buyerId}' IS DISTINCT FROM activation.buyer_id
        OR command#>>'{input,terms,assetId}' IS DISTINCT FROM activation.asset_id
        OR command#>>'{input,terms,walletListingId}' IS DISTINCT FROM activation.wallet_listing_id
        OR command#>>'{input,reservation,walletTradeId}' IS DISTINCT FROM activation.wallet_trade_id THEN
        RAISE EXCEPTION 'Initial marketplace command requires its exact explicit activation mapping';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_marketplace_context_shape BEFORE INSERT OR UPDATE ON alpha_wallet_initial_marketplace_simulation.transaction_contexts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_context();
CREATE TRIGGER initial_marketplace_context_no_delete BEFORE DELETE OR TRUNCATE ON alpha_wallet_initial_marketplace_simulation.transaction_contexts
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change();

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.require_command(command_revision integer, expected_type text)
RETURNS alpha_wallet_simulation.commands
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  context:=alpha_wallet_initial_marketplace_simulation.require_context();
  PERFORM alpha_wallet_simulation.require_current_command(command_revision);
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=command_revision;
  IF command.command_json IS DISTINCT FROM context.planned_command
    OR command.command_key IS DISTINCT FROM context.planned_command_key
    OR command.command_type IS DISTINCT FROM expected_type THEN
    RAISE EXCEPTION 'Initial marketplace write requires its exact same-transaction financial command';
  END IF;
  RETURN command;
END;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.capture_canonical_basis(request_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('request',to_jsonb(r),'listing',to_jsonb(l),
    'trade',(SELECT to_jsonb(t) FROM alpha_exchange.trades t
      WHERE t.purchase_request_id=r.id OR t.payload->>'purchaseRequestId'=r.id
        OR t.id=r.trade_id OR t.payload->>'id'=r.trade_id),
    'siblings',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM alpha_exchange.purchase_requests s WHERE s.listing_id=l.id OR s.payload->>'listingId'=l.id))
  FROM alpha_exchange.purchase_requests r JOIN alpha_exchange.listings l ON l.id=r.listing_id WHERE r.id=$1;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
  head alpha_wallet_simulation.head%ROWTYPE; source alpha_wallet_simulation.commands%ROWTYPE;
  request alpha_exchange.purchase_requests%ROWTYPE; listing alpha_exchange.listings%ROWTYPE;
  field text;
BEGIN
  context:=alpha_wallet_initial_marketplace_simulation.require_context();
  SELECT * INTO head FROM alpha_wallet_simulation.head WHERE singleton FOR UPDATE;
  SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=head.revision;
  SELECT * INTO request FROM alpha_exchange.purchase_requests WHERE id=NEW.request_id;
  SELECT * INTO listing FROM alpha_exchange.listings WHERE id=NEW.platform_listing_id;
  FOREACH field IN ARRAY ARRAY['request_id','platform_listing_id','platform_trade_id','wallet_listing_id','wallet_trade_id','buyer_id','seller_id','actor_user_id'] LOOP
    IF NOT coalesce(to_jsonb(NEW)->>field ~ '^[A-Za-z0-9_-]{1,80}$',false) THEN
      RAISE EXCEPTION 'Initial marketplace activation requires bounded explicit identities';
    END IF;
  END LOOP;
  IF context.operation<>'activate' OR context.planned_command IS NOT NULL
    OR context.request_id IS DISTINCT FROM NEW.request_id OR context.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR head.format_version IS DISTINCT FROM 3 OR source.revision IS NULL
    OR NEW.wallet_checkpoint IS DISTINCT FROM jsonb_build_object('revision',head.revision,'eventHash',head.last_event_hash::text,
      'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='pause'
      AND revision>=(SELECT command_revision FROM alpha_wallet_simulation.initial_engine_continuations WHERE singleton))
    OR request.id IS NULL OR listing.id IS NULL OR request.status IS DISTINCT FROM 'pending'
    OR request.id IS DISTINCT FROM request.payload->>'id' OR request.trade_id IS DISTINCT FROM request.payload->>'tradeId'
    OR request.listing_id IS DISTINCT FROM request.payload->>'listingId' OR request.seller_id IS DISTINCT FROM request.payload->>'sellerId'
    OR request.buyer_id IS DISTINCT FROM request.payload->>'buyerId' OR request.status IS DISTINCT FROM request.payload->>'status'
    OR request.trade_id IS DISTINCT FROM NEW.platform_trade_id OR request.listing_id IS DISTINCT FROM NEW.platform_listing_id
    OR request.seller_id IS DISTINCT FROM NEW.seller_id OR request.buyer_id IS DISTINCT FROM NEW.buyer_id
    OR listing.id IS DISTINCT FROM listing.payload->>'id' OR listing.seller_id IS DISTINCT FROM NEW.seller_id
    OR listing.seller_id IS DISTINCT FROM listing.payload->>'sellerId' OR listing.status IS DISTINCT FROM 'active'
    OR listing.status IS DISTINCT FROM listing.payload->>'status' OR listing.active_trade_request_id IS NOT NULL
    OR listing.payload ? 'activeTradeRequestId' OR listing.payload->>'approvalStatus' IS DISTINCT FROM 'approved'
    OR request.payload->>'network' IS DISTINCT FROM (CASE NEW.asset_id WHEN 'tron-sim-usdt' THEN 'TRC20' ELSE 'BEP20' END)
    OR listing.payload->>'network' IS DISTINCT FROM request.payload->>'network'
    OR request.payload->>'priceMode' IS DISTINCT FROM 'listing_price'
    OR request.payload->>'currency' IS DISTINCT FROM 'ILS'
    OR NOT coalesce(request.payload->>'paymentMethod' IN ('Bank Transfer','Face-to-Face','Face-to-Face (Meet in Person)'),false)
    OR request.payload->>'feePolicyVersion' IS DISTINCT FROM 'buyer_seller_1pct_v1'
    OR request.payload->>'commissionCalculationVersion' IS DISTINCT FROM 'usdt_6dp_v2'
    OR NEW.canonical_basis IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.capture_canonical_basis(NEW.request_id)
    OR jsonb_array_length(NEW.canonical_basis->'siblings')>10000 THEN
    RAISE EXCEPTION 'Initial marketplace activation must preserve its exact pending canonical basis and verified v3 checkpoint';
  END IF;
  -- These physical tuple versions force stale SERIALIZABLE/REPEATABLE READ
  -- writers to retry even if they never observed the new activation row.
  UPDATE alpha_exchange.listings SET payload=payload WHERE id=NEW.platform_listing_id;
  UPDATE alpha_exchange.purchase_requests SET payload=payload
    WHERE listing_id=NEW.platform_listing_id OR payload->>'listingId'=NEW.platform_listing_id;
  UPDATE alpha_exchange.runtime_meta SET version=version+1,updated_at=now() WHERE singleton=true;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_marketplace_activation_shape BEFORE INSERT ON alpha_wallet_initial_marketplace_simulation.activations
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_activation();

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.request_terms_match(request jsonb, terms jsonb) RETURNS boolean
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

-- Matches the existing canonical participant's SHA-256(JSON.stringify(array))
-- byte construction. The only inputs are bounded ASCII request/trade IDs.
CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.event_suffix(request_id text, trade_id text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT encode(sha256(convert_to('["initial_seller_acceptance",'||to_jsonb($1)::text||','||to_jsonb($2)::text||']','UTF8')),'hex');
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.expected_canonical(
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
    OR NOT alpha_wallet_initial_marketplace_simulation.request_terms_match(
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
  suffix:=alpha_wallet_initial_marketplace_simulation.event_suffix(activation.request_id,activation.platform_trade_id);
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

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.expected_row(
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

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
BEGIN
  context:=alpha_wallet_initial_marketplace_simulation.require_context();
  command:=alpha_wallet_initial_marketplace_simulation.require_command(NEW.wallet_command_revision,'acceptInitialSellerRequest');
  SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=NEW.request_id;
  IF activation.request_id IS NULL OR context.operation<>'accept' OR context.request_id IS DISTINCT FROM NEW.request_id
    OR context.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR NEW.actor_user_id IS DISTINCT FROM activation.seller_id
    OR NEW.receipt IS DISTINCT FROM command.result_json OR NEW.wallet_command_key IS DISTINCT FROM command.command_key
    OR NEW.wallet_event_hash IS DISTINCT FROM command.event_hash OR NEW.receipt->>'acceptanceKey' IS DISTINCT FROM NEW.acceptance_key
    OR NEW.receipt->>'platformRequestId' IS DISTINCT FROM NEW.request_id
    OR NEW.receipt->>'platformTradeId' IS DISTINCT FROM activation.platform_trade_id
    OR NEW.receipt->>'actorUserId' IS DISTINCT FROM NEW.actor_user_id
    OR NEW.receipt->>'buyerId' IS DISTINCT FROM activation.buyer_id
    OR NEW.receipt->>'walletTradeId' IS DISTINCT FROM activation.wallet_trade_id
    OR NEW.publication_id IS DISTINCT FROM 'initial-wallet-publication-'||NEW.acceptance_key
    OR NEW.canonical_result IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_canonical(
      activation,command,(SELECT role FROM alpha_exchange.users WHERE id=NEW.actor_user_id))
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts r
      WHERE r.acceptance_key=NEW.acceptance_key AND r.platform_request_id=NEW.request_id
        AND r.wallet_trade_id=activation.wallet_trade_id AND r.command_revision=NEW.wallet_command_revision AND r.payload=NEW.receipt) THEN
    RAISE EXCEPTION 'Initial marketplace acceptance requires its exact new financial receipt and canonical poststate';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_marketplace_acceptance_shape BEFORE INSERT ON alpha_wallet_initial_marketplace_simulation.acceptances
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_acceptance();

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.publication_payload(acceptance_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('type','initial_seller_request_accepted','requestId',a.request_id,
    'listingId',v.platform_listing_id,'tradeId',v.platform_trade_id,'buyerId',v.buyer_id,'sellerId',v.seller_id,
    'walletTradeId',v.wallet_trade_id,'walletRevision',a.wallet_command_revision,'walletEventHash',a.wallet_event_hash,
    'termsDigest',a.receipt->>'termsDigest','notificationIds',jsonb_build_array(a.canonical_result#>>'{notifications,0,id}'),
    'auditId',a.canonical_result#>>'{auditLogs,0,id}','timelineEventId',a.canonical_result#>>'{request,timeline,-1,id}')
  FROM alpha_wallet_initial_marketplace_simulation.acceptances a
  JOIN alpha_wallet_initial_marketplace_simulation.activations v ON v.request_id=a.request_id WHERE a.acceptance_key=$1;
$fn$;
CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE acceptance alpha_wallet_initial_marketplace_simulation.acceptances%ROWTYPE;
BEGIN
  SELECT * INTO acceptance FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE acceptance_key=NEW.acceptance_key;
  PERFORM alpha_wallet_initial_marketplace_simulation.require_command(acceptance.wallet_command_revision,'acceptInitialSellerRequest');
  IF NEW.id IS DISTINCT FROM acceptance.publication_id
    OR NEW.payload IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.publication_payload(NEW.acceptance_key) THEN
    RAISE EXCEPTION 'Initial publication must contain only deterministic safe acceptance facts';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_marketplace_publication_shape BEFORE INSERT ON alpha_wallet_initial_marketplace_simulation.publications
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_publication();

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_wallet_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_initial_marketplace_simulation.require_context();
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_marketplace_wallet_head BEFORE UPDATE ON alpha_wallet_simulation.head
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_wallet_head();
CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_wallet_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
  context:=alpha_wallet_initial_marketplace_simulation.require_context();
  IF context.planned_command IS NULL OR NEW.command_json IS DISTINCT FROM context.planned_command
    OR NEW.command_key IS DISTINCT FROM context.planned_command_key
    OR NEW.command_type NOT IN ('acceptInitialSellerRequest','pause') THEN
    RAISE EXCEPTION 'Initial marketplace wallet commands require one exact registered coordinator intent';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_marketplace_wallet_command BEFORE INSERT ON alpha_wallet_simulation.commands
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_wallet_command();

-- Runtime fencing is BEFORE STATEMENT, before canonical row locks. It orders
-- complete seller inventory / buyer history / commission / enforcement reads
-- against legacy writers that do not take advisory locks. Unrelated records and
-- account revocation remain writable; this isolated development schema trades
-- throughput for conservative serialization rather than changing product policy.
CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.fence_dependency_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  -- Legacy READ COMMITTED writers are deliberately ordered here too. Only the
  -- coordinator's registered financial operations require SERIALIZABLE.
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'Initial marketplace dependency writes require explicit writable simulation opt-in';
  END IF;
  UPDATE alpha_exchange.runtime_meta SET version=version+1,updated_at=now() WHERE singleton=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Initial marketplace canonical runtime fence is missing'; END IF;
  RETURN NULL;
END;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_runtime_fence() RETURNS trigger
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

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.scope_listings(row_data jsonb, table_name text) RETURNS SETOF text
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

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_participant_identity() RETURNS trigger
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

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_canonical() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE old_row jsonb; new_row jsonb; listing text; scoped boolean:=false;
  context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE; expected jsonb; before_row jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND old_row=new_row THEN RETURN NEW; END IF;
  FOR listing IN SELECT id FROM (
    SELECT alpha_wallet_initial_marketplace_simulation.scope_listings(old_row,TG_TABLE_NAME) id
    UNION SELECT alpha_wallet_initial_marketplace_simulation.scope_listings(new_row,TG_TABLE_NAME) id
  ) candidates ORDER BY id LOOP
    PERFORM 1 FROM alpha_exchange.listings WHERE id=listing FOR UPDATE;
    IF EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.activations WHERE platform_listing_id=listing) THEN
      scoped:=true;
    ELSIF TG_TABLE_NAME<>'listings' THEN
      -- Auxiliary inserts/updates physically version listing tuples before
      -- activation too. The identical-row return terminates recursion.
      UPDATE alpha_exchange.listings SET payload=payload WHERE id=listing;
    END IF;
  END LOOP;
  IF NOT scoped THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  context:=alpha_wallet_initial_marketplace_simulation.require_context();
  IF context.operation<>'accept' OR context.planned_command IS NULL THEN
    RAISE EXCEPTION 'Legacy and unsupported writers are fenced for the complete initial marketplace listing';
  END IF;
  SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=context.request_id;
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
  command:=alpha_wallet_initial_marketplace_simulation.require_command(command.revision,'acceptInitialSellerRequest');
  expected:=alpha_wallet_initial_marketplace_simulation.expected_canonical(activation,command,
    (SELECT role FROM alpha_exchange.users WHERE id=activation.seller_id));
  IF TG_TABLE_NAME='purchase_requests' THEN before_row:=activation.canonical_basis->'request';
  ELSIF TG_TABLE_NAME='listings' THEN before_row:=activation.canonical_basis->'listing';
  ELSIF TG_TABLE_NAME='trades' THEN before_row:=nullif(activation.canonical_basis->'trade','null'::jsonb);
  ELSIF TG_TABLE_NAME IN ('notifications','audit_logs') THEN before_row:=NULL;
  ELSE RAISE EXCEPTION 'Unsupported initial marketplace lifecycle or auxiliary write is fenced'; END IF;
  IF old_row IS DISTINCT FROM before_row OR TG_OP IS DISTINCT FROM (CASE WHEN before_row IS NULL THEN 'INSERT' ELSE 'UPDATE' END)
    OR new_row IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_row(activation,expected,TG_TABLE_NAME) THEN
    RAISE EXCEPTION 'Initial marketplace permits only its exact canonical acceptance delta';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.assert_coherence() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
  activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
  acceptance alpha_wallet_initial_marketplace_simulation.acceptances%ROWTYPE;
  publication alpha_wallet_initial_marketplace_simulation.publications%ROWTYPE;
  actual jsonb; expected jsonb; baseline jsonb; source alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  context:=alpha_wallet_initial_marketplace_simulation.require_context();
  IF context.planned_command IS NOT NULL THEN
    SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
    IF command.revision IS NULL OR command.command_json IS DISTINCT FROM context.planned_command THEN
      RAISE EXCEPTION 'A bound initial marketplace intent must commit its exact wallet command';
    END IF;
    IF context.operation='accept' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.acceptances
      WHERE wallet_command_revision=command.revision) THEN
      RAISE EXCEPTION 'Initial wallet command and canonical marketplace receipt must commit together';
    END IF;
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
    actual:=alpha_wallet_initial_marketplace_simulation.capture_canonical_basis(activation.request_id);
    SELECT * INTO acceptance FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=activation.request_id;
    IF acceptance.acceptance_key IS NULL THEN
      IF actual IS DISTINCT FROM activation.canonical_basis
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings)
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts) THEN
        RAISE EXCEPTION 'Pending initial activation cannot change canonical rows or acquire a standalone financial reservation';
      END IF;
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
      expected:=alpha_wallet_initial_marketplace_simulation.expected_canonical(activation,command,
        acceptance.canonical_result#>>'{request,timeline,-1,actorRole}');
      IF acceptance.canonical_result IS DISTINCT FROM expected
        OR actual->'request' IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_row(activation,expected,'purchase_requests')
        OR actual->'listing' IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_row(activation,expected,'listings')
        OR actual->'trade' IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_row(activation,expected,'trades') THEN
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
      IF actual IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_row(activation,expected,'notifications') THEN
        RAISE EXCEPTION 'Initial acceptance requires its exact canonical notification';
      END IF;
      SELECT to_jsonb(a) INTO actual FROM alpha_exchange.audit_logs a WHERE id=expected#>>'{auditLogs,0,id}';
      IF actual IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.expected_row(activation,expected,'audit_logs') THEN
        RAISE EXCEPTION 'Initial acceptance requires its exact canonical audit event';
      END IF;
      SELECT * INTO publication FROM alpha_wallet_initial_marketplace_simulation.publications WHERE acceptance_key=acceptance.acceptance_key;
      IF publication.id IS DISTINCT FROM acceptance.publication_id
        OR publication.id IS DISTINCT FROM 'initial-wallet-publication-'||acceptance.acceptance_key
        OR publication.payload IS DISTINCT FROM alpha_wallet_initial_marketplace_simulation.publication_payload(acceptance.acceptance_key) THEN
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

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.check_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  -- Context changes always queue this. Late canonical/financial changes queue
  -- it again, so SET CONSTRAINTS followed by another write cannot evade checks.
  IF EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.transaction_contexts WHERE transaction_id=txid_current()::text) THEN
    PERFORM alpha_wallet_initial_marketplace_simulation.assert_coherence();
  END IF;
  RETURN NULL;
END;
$fn$;

DO $triggers$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['activations','acceptances','publications'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_initial_marketplace_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change()',name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_initial_marketplace_transaction AFTER INSERT ON alpha_wallet_initial_marketplace_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.check_deferred()',name);
  END LOOP;
  CREATE CONSTRAINT TRIGGER complete_initial_marketplace_context AFTER INSERT OR UPDATE ON alpha_wallet_initial_marketplace_simulation.transaction_contexts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.check_deferred();
  FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs'] LOOP
    EXECUTE format('CREATE TRIGGER initial_marketplace_listing_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_canonical()',name);
    EXECUTE format('CREATE TRIGGER initial_marketplace_no_truncate BEFORE TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change()',name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_initial_canonical_transaction AFTER INSERT OR UPDATE OR DELETE ON alpha_exchange.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.check_deferred()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs','users','marketplace_enforcement_records'] LOOP
    EXECUTE format('CREATE TRIGGER initial_marketplace_dependency_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.fence_dependency_statement()',name);
  END LOOP;
  CREATE TRIGGER initial_marketplace_participant_identity BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.users
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_participant_identity();
  CREATE TRIGGER initial_marketplace_runtime_identity BEFORE UPDATE ON alpha_exchange.runtime_meta
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_runtime_fence();
  CREATE TRIGGER initial_marketplace_runtime_no_replace BEFORE INSERT OR DELETE OR TRUNCATE ON alpha_exchange.runtime_meta
    FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change();
  FOREACH name IN ARRAY ARRAY['users','marketplace_enforcement_records'] LOOP
    EXECUTE format('CREATE TRIGGER initial_marketplace_no_truncate BEFORE TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['commands','head','initial_trade_bindings','initial_acceptance_receipts'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_initial_financial_transaction AFTER INSERT OR UPDATE OR DELETE ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.check_deferred()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['transaction_contexts','activations','acceptances','publications'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_initial_marketplace_simulation.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE alpha_wallet_initial_marketplace_simulation.%I FORCE ROW LEVEL SECURITY',name);
  END LOOP;
END;
$triggers$;
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM PUBLIC;
DO $client_grants$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA alpha_wallet_initial_marketplace_simulation FROM %I',client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM %I',client_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM %I',client_role);
    END IF;
  END LOOP;
END;
$client_grants$;
