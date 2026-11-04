-- DEVELOPMENT ONLY: one already-reserved synthetic trade, no live migration.
-- The trusted coordinator owns authentication and one SERIALIZABLE transaction.
-- Registered transaction rows and exact wallet receipts are storage proofs, not
-- authentication. A simulation GUC alone never permits a protected mutation.
-- This deliberately freezes the whole canonical listing and unsupported wallet
-- commands. Only amount acceptance, historical inspection, and owner pause are
-- implemented. There is no resume, payout worker, or combined backup protocol.
-- Ledger-only exports are blocked after activation because they omit these rows.

DO $guard$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF current_setting('transaction_read_only') <> 'off' OR NOT EXISTS
    (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version = 2) THEN
    RAISE EXCEPTION 'Marketplace coordination requires a writable verified v2 simulation';
  END IF;
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts) THEN
    RAISE EXCEPTION 'Marketplace coordination requires a fresh, unenrolled v2 cohort';
  END IF;
END;
$guard$;

CREATE SCHEMA alpha_wallet_marketplace_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_marketplace_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_marketplace_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_marketplace_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE alpha_wallet_marketplace_simulation.transaction_contexts (
  transaction_id text PRIMARY KEY CHECK (transaction_id ~ '^[1-9][0-9]*$'),
  request_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('inspect','enroll','accept','pause')),
  actor_user_id text NOT NULL,
  planned_command jsonb,
  planned_command_key text,
  CHECK ((planned_command IS NULL) = (planned_command_key IS NULL)),
  CHECK (planned_command IS NULL OR jsonb_typeof(planned_command) = 'object')
);

CREATE TABLE alpha_wallet_marketplace_simulation.enrollments (
  request_id text PRIMARY KEY,
  -- One cohort is deliberately supported at this stage; widening is a migration.
  cohort boolean NOT NULL DEFAULT true UNIQUE CHECK (cohort),
  platform_listing_id text NOT NULL,
  platform_trade_id text,
  wallet_listing_id text NOT NULL,
  wallet_trade_id text NOT NULL UNIQUE,
  buyer_id text NOT NULL,
  seller_id text NOT NULL,
  asset_id text NOT NULL,
  actor_user_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object')
);

CREATE TABLE alpha_wallet_marketplace_simulation.acceptances (
  acceptance_key text PRIMARY KEY REFERENCES alpha_wallet_simulation.acceptance_receipts(acceptance_key),
  request_id text NOT NULL REFERENCES alpha_wallet_marketplace_simulation.enrollments(request_id),
  proposal_id text NOT NULL,
  actor_user_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  publication_id text NOT NULL UNIQUE,
  UNIQUE (request_id,proposal_id)
);

CREATE TABLE alpha_wallet_marketplace_simulation.publications (
  id text PRIMARY KEY,
  acceptance_key text NOT NULL UNIQUE REFERENCES alpha_wallet_marketplace_simulation.acceptances(acceptance_key),
  -- A durable intent only. Nothing in this schema sends an external message.
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

CREATE FUNCTION alpha_wallet_marketplace_simulation.reject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'Development marketplace coordination records and protected identities are immutable';
END;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.require_context()
RETURNS alpha_wallet_marketplace_simulation.transaction_contexts
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'Marketplace coordination requires a writable transaction';
  END IF;
  SELECT * INTO context FROM alpha_wallet_marketplace_simulation.transaction_contexts
    WHERE transaction_id = txid_current()::text;
  IF context.transaction_id IS NULL THEN
    RAISE EXCEPTION 'A registered same-transaction marketplace context is required; standalone wallet tools are disabled';
  END IF;
  RETURN context;
END;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE expected_type text; command jsonb;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF NEW.transaction_id <> txid_current()::text OR current_setting('transaction_read_only') <> 'off'
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.purchase_requests WHERE id = NEW.request_id)
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id = NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Invalid development marketplace transaction registration';
  END IF;
  IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - ARRAY['planned_command','planned_command_key'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['planned_command','planned_command_key'])
      OR OLD.planned_command IS NOT NULL OR NEW.planned_command IS NULL) THEN
    RAISE EXCEPTION 'Marketplace context may bind one exact command only';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.planned_command IS NOT NULL THEN
    RAISE EXCEPTION 'Register before binding a marketplace command';
  END IF;
  command := NEW.planned_command;
  IF command IS NOT NULL THEN
    expected_type := CASE NEW.operation WHEN 'enroll' THEN 'enrollReservedTrade'
      WHEN 'accept' THEN 'acceptAmountCorrection' WHEN 'pause' THEN 'pause' ELSE NULL END;
    IF expected_type IS NULL OR command->>'type' IS DISTINCT FROM expected_type
      OR command->>'version' IS DISTINCT FROM '2'
      OR command->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v2'
      OR command#>>'{actor,id}' IS DISTINCT FROM NEW.actor_user_id
      OR command#>>'{actor,kind}' IS DISTINCT FROM (CASE WHEN NEW.operation='accept' THEN 'buyer' ELSE 'operator' END)
      OR NEW.planned_command_key::jsonb IS DISTINCT FROM jsonb_build_array(
        command#>>'{actor,kind}',NEW.actor_user_id,expected_type,command->>'requestId')
      OR (NEW.operation='enroll' AND command#>>'{input,terms,platformRequestId}' IS DISTINCT FROM NEW.request_id)
      OR (NEW.operation='accept' AND command#>>'{input,platformRequestId}' IS DISTINCT FROM NEW.request_id)
      OR (NEW.operation='pause' AND command->'input' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'Marketplace context command identity, operation or target mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER marketplace_context_shape BEFORE INSERT OR UPDATE ON alpha_wallet_marketplace_simulation.transaction_contexts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_context();
CREATE TRIGGER marketplace_context_no_delete BEFORE DELETE OR TRUNCATE ON alpha_wallet_marketplace_simulation.transaction_contexts
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_marketplace_simulation.reject_change();

CREATE FUNCTION alpha_wallet_marketplace_simulation.require_command(command_revision integer, expected_type text)
RETURNS alpha_wallet_simulation.commands
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  context := alpha_wallet_marketplace_simulation.require_context();
  PERFORM alpha_wallet_simulation.require_current_command(command_revision);
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision = command_revision;
  IF command.command_json IS DISTINCT FROM context.planned_command
    OR command.command_key IS DISTINCT FROM context.planned_command_key
    OR command.command_type IS DISTINCT FROM expected_type THEN
    RAISE EXCEPTION 'Marketplace write requires its exact planned same-transaction wallet command';
  END IF;
  RETURN command;
END;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.request_terms_match(request jsonb, terms jsonb) RETURNS boolean
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

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
  request alpha_exchange.purchase_requests%ROWTYPE;
BEGIN
  context := alpha_wallet_marketplace_simulation.require_context();
  command := alpha_wallet_marketplace_simulation.require_command(NEW.wallet_command_revision,'enrollReservedTrade');
  SELECT * INTO request FROM alpha_exchange.purchase_requests WHERE id=NEW.request_id;
  IF context.operation <> 'enroll' OR context.request_id <> NEW.request_id OR context.actor_user_id <> NEW.actor_user_id
    OR NEW.binding IS DISTINCT FROM command.result_json OR NEW.wallet_command_key <> command.command_key
    OR NEW.wallet_event_hash <> command.event_hash OR NEW.binding->>'revision' IS DISTINCT FROM '0'
    OR NEW.binding->>'platformRequestId' IS DISTINCT FROM NEW.request_id
    OR NEW.binding->>'platformListingId' IS DISTINCT FROM NEW.platform_listing_id
    OR NEW.binding#>>'{terms,platformTradeId}' IS DISTINCT FROM NEW.platform_trade_id
    OR NEW.binding->>'walletListingId' IS DISTINCT FROM NEW.wallet_listing_id
    OR NEW.binding->>'walletTradeId' IS DISTINCT FROM NEW.wallet_trade_id
    OR NEW.binding->>'assetId' IS DISTINCT FROM NEW.asset_id
    OR NEW.binding#>>'{terms,buyerId}' IS DISTINCT FROM NEW.buyer_id
    OR NEW.binding#>>'{terms,sellerId}' IS DISTINCT FROM NEW.seller_id
    OR request.id IS NULL OR request.status <> 'accepted'
    OR NOT alpha_wallet_marketplace_simulation.request_terms_match(request.payload, NEW.binding->'terms')
    OR request.payload#>>'{termsProposal,kind}' IS DISTINCT FROM 'amount_correction'
    OR request.payload#>>'{termsProposal,status}' IS DISTINCT FROM 'pending'
    OR request.payload->>'paymentMethod' NOT IN ('Bank Transfer','Face-to-Face','Face-to-Face (Meet in Person)')
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events e
      WHERE e.platform_request_id=NEW.request_id AND e.binding_revision=0
        AND e.command_revision=NEW.wallet_command_revision AND e.payload=NEW.binding) THEN
    RAISE EXCEPTION 'Canonical enrollment must match the exact new reserved-trade wallet binding';
  END IF;
  -- Physical versions are required even if a privileged SQL caller uses the
  -- registry directly: an old snapshot must collide with cohort activation.
  UPDATE alpha_exchange.listings SET payload=payload WHERE id=NEW.platform_listing_id;
  UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE listing_id=NEW.platform_listing_id;
  UPDATE alpha_exchange.runtime_meta SET version=version+1,updated_at=now() WHERE singleton=true;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER marketplace_enrollment_shape BEFORE INSERT ON alpha_wallet_marketplace_simulation.enrollments
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_enrollment();

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
  enrollment alpha_wallet_marketplace_simulation.enrollments%ROWTYPE;
BEGIN
  context := alpha_wallet_marketplace_simulation.require_context();
  command := alpha_wallet_marketplace_simulation.require_command(NEW.wallet_command_revision,'acceptAmountCorrection');
  SELECT * INTO enrollment FROM alpha_wallet_marketplace_simulation.enrollments WHERE request_id=NEW.request_id;
  IF context.operation <> 'accept' OR context.request_id <> NEW.request_id OR context.actor_user_id <> NEW.actor_user_id
    OR NEW.receipt IS DISTINCT FROM command.result_json OR NEW.wallet_command_key <> command.command_key
    OR NEW.wallet_event_hash <> command.event_hash OR NEW.actor_user_id <> enrollment.buyer_id
    OR NEW.receipt->>'acceptanceKey' IS DISTINCT FROM NEW.acceptance_key
    OR NEW.receipt->>'platformRequestId' IS DISTINCT FROM NEW.request_id
    OR NEW.receipt->>'proposalId' IS DISTINCT FROM NEW.proposal_id
    OR NEW.receipt->>'actorUserId' IS DISTINCT FROM NEW.actor_user_id
    OR NEW.receipt->>'walletTradeId' IS DISTINCT FROM enrollment.wallet_trade_id
    OR NEW.publication_id <> 'wallet-publication-' || NEW.acceptance_key
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts r
      WHERE r.acceptance_key=NEW.acceptance_key AND r.command_revision=NEW.wallet_command_revision AND r.payload=NEW.receipt) THEN
    RAISE EXCEPTION 'Marketplace acceptance requires its exact new wallet acceptance receipt';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER marketplace_acceptance_shape BEFORE INSERT ON alpha_wallet_marketplace_simulation.acceptances
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_acceptance();

CREATE FUNCTION alpha_wallet_marketplace_simulation.publication_payload(acceptance_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT jsonb_build_object('type','amount_correction_accepted','requestId',a.request_id,
    'listingId',e.platform_listing_id,'tradeId',e.platform_trade_id,'proposalId',a.proposal_id,
    'buyerId',e.buyer_id,'sellerId',e.seller_id,'bindingRevision',a.receipt->'bindingRevision',
    'walletRevision',a.wallet_command_revision,'walletEventHash',a.wallet_event_hash,
    'termsDigest',a.receipt->>'acceptedTermsDigest',
    'notificationIds',jsonb_build_array('wallet-notification-' || a.acceptance_key),
    'auditId','wallet-audit-' || a.acceptance_key,'messageId','wallet-message-' || a.acceptance_key)
  FROM alpha_wallet_marketplace_simulation.acceptances a
  JOIN alpha_wallet_marketplace_simulation.enrollments e ON e.request_id=a.request_id
  WHERE a.acceptance_key=$1;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE acceptance alpha_wallet_marketplace_simulation.acceptances%ROWTYPE;
BEGIN
  SELECT * INTO acceptance FROM alpha_wallet_marketplace_simulation.acceptances WHERE acceptance_key=NEW.acceptance_key;
  PERFORM alpha_wallet_marketplace_simulation.require_command(acceptance.wallet_command_revision,'acceptAmountCorrection');
  IF NEW.id IS DISTINCT FROM acceptance.publication_id
    OR NEW.payload IS DISTINCT FROM alpha_wallet_marketplace_simulation.publication_payload(NEW.acceptance_key) THEN
    RAISE EXCEPTION 'Publication must contain only its deterministic safe acceptance facts';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER marketplace_publication_shape BEFORE INSERT ON alpha_wallet_marketplace_simulation.publications
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_publication();

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_wallet_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.enrollments) THEN
    PERFORM alpha_wallet_marketplace_simulation.require_context();
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER marketplace_wallet_head BEFORE UPDATE ON alpha_wallet_simulation.head
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_wallet_head();

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_wallet_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.enrollments)
    OR NEW.command_type IN ('enrollReservedTrade','acceptAmountCorrection')
    OR EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.transaction_contexts WHERE transaction_id=txid_current()::text) THEN
    context := alpha_wallet_marketplace_simulation.require_context();
    IF context.planned_command IS NULL OR NEW.command_json IS DISTINCT FROM context.planned_command
      OR NEW.command_key IS DISTINCT FROM context.planned_command_key
      OR NEW.command_type NOT IN ('enrollReservedTrade','acceptAmountCorrection','pause') THEN
      RAISE EXCEPTION 'Enrolled marketplace wallet commands require one exact registered coordinator intent';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER marketplace_wallet_command BEFORE INSERT ON alpha_wallet_simulation.commands
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_wallet_command();

-- Protect both normalized and payload identities, including the entire listing's
-- sibling requests. Lock the listing before consulting enrollment: enrollment
-- physically touches that row, so an older RR/SERIALIZABLE snapshot cannot miss
-- activation and then insert an evidence row or a sibling reservation silently.
-- Unenrolled related writes also physically version the listing. This makes an
-- enrollment snapshot taken before a legacy READ COMMITTED auxiliary insert
-- fail and retry, even if that legacy writer ignored the shared advisory lock.
CREATE FUNCTION alpha_wallet_marketplace_simulation.scope_listings(row_data jsonb, table_name text) RETURNS SETOF text
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

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_canonical() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE old_row jsonb; new_row jsonb; listing text; scoped boolean := false;
  context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
  acceptance alpha_wallet_marketplace_simulation.acceptances%ROWTYPE;
  prior_terms jsonb; accepted_time text; message jsonb; expected_message text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND old_row=new_row THEN RETURN NEW; END IF;
  FOR listing IN SELECT id FROM (
    SELECT alpha_wallet_marketplace_simulation.scope_listings(old_row,TG_TABLE_NAME) id
    UNION SELECT alpha_wallet_marketplace_simulation.scope_listings(new_row,TG_TABLE_NAME) id
  ) candidates ORDER BY id LOOP
    PERFORM 1 FROM alpha_exchange.listings WHERE id=listing FOR UPDATE;
    IF EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.enrollments WHERE platform_listing_id=listing) THEN
      scoped:=true;
    ELSIF TG_TABLE_NAME <> 'listings' THEN
      -- A listing's own INSERT/UPDATE/DELETE already changes its tuple. Other
      -- table writes need this physical version as well as the lock. Recursion
      -- terminates at the identical-row return at the beginning of this guard.
      UPDATE alpha_exchange.listings SET payload=payload WHERE id=listing;
    END IF;
  END LOOP;
  IF NOT scoped THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  context := alpha_wallet_marketplace_simulation.require_context();
  IF TG_TABLE_NAME='purchase_requests' AND TG_OP='UPDATE' AND context.operation='accept'
    AND context.request_id=OLD.id AND NEW.id=OLD.id THEN
    SELECT * INTO acceptance FROM alpha_wallet_marketplace_simulation.acceptances
      WHERE request_id=OLD.id AND proposal_id=OLD.payload#>>'{termsProposal,id}';
    IF acceptance.acceptance_key IS NULL THEN RAISE EXCEPTION 'Canonical amount update needs its appended marketplace receipt'; END IF;
    PERFORM alpha_wallet_marketplace_simulation.require_command(acceptance.wallet_command_revision,'acceptAmountCorrection');
    SELECT payload->'terms' INTO prior_terms FROM alpha_wallet_simulation.trade_terms_events
      WHERE platform_request_id=OLD.id AND binding_revision=(acceptance.receipt->>'bindingRevision')::integer-1;
    accepted_time := to_char(to_timestamp((acceptance.receipt->>'acceptedAtMs')::numeric / 1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    message := NEW.payload#>'{messages,0}';
    expected_message := 'Trade terms accepted: ' || (acceptance.receipt#>>'{terms,usdtAmount}') || ' USDT for ILS ' || (acceptance.receipt#>>'{terms,fiatAmount}') || '.';
    IF (old_row-ARRAY['payload','updated_at']) IS DISTINCT FROM (new_row-ARRAY['payload','updated_at'])
      OR (OLD.payload-ARRAY['usdtAmount','fiatAmount','pricePerUsdt','termsProposal','messages','updatedAt'])
        IS DISTINCT FROM (NEW.payload-ARRAY['usdtAmount','fiatAmount','pricePerUsdt','termsProposal','messages','updatedAt'])
      OR NOT alpha_wallet_marketplace_simulation.request_terms_match(OLD.payload,prior_terms)
      OR NOT alpha_wallet_marketplace_simulation.request_terms_match(NEW.payload,acceptance.receipt->'terms')
      OR OLD.payload#>>'{termsProposal,kind}' IS DISTINCT FROM 'amount_correction'
      OR OLD.payload#>>'{termsProposal,status}' IS DISTINCT FROM 'pending'
      OR NEW.payload#>>'{termsProposal,status}' IS DISTINCT FROM 'accepted'
      OR NEW.payload#>>'{termsProposal,resolvedAt}' IS DISTINCT FROM accepted_time
      OR ((OLD.payload->'termsProposal')-ARRAY['status','resolvedAt']) IS DISTINCT FROM ((NEW.payload->'termsProposal')-ARRAY['status','resolvedAt'])
      OR NEW.payload->>'updatedAt' IS DISTINCT FROM accepted_time OR NEW.updated_at IS DISTINCT FROM accepted_time::timestamptz
      OR NEW.updated_at <= OLD.updated_at
      OR jsonb_typeof(NEW.payload->'messages') IS DISTINCT FROM 'array'
      OR ((NEW.payload->'messages')-0) IS DISTINCT FROM coalesce(OLD.payload->'messages','[]'::jsonb)
      OR message IS DISTINCT FROM jsonb_build_object('id','wallet-message-'||acceptance.acceptance_key,
        'purchaseRequestId',OLD.id,'kind','system','senderUserId',acceptance.actor_user_id,
        'senderRole',message->>'senderRole','message',expected_message,'createdAt',accepted_time,'readByUserIds','[]'::jsonb)
      OR message->>'senderRole' IS DISTINCT FROM (SELECT role FROM alpha_exchange.users WHERE id=acceptance.actor_user_id) THEN
      RAISE EXCEPTION 'Canonical acceptance may change only the exact receipt terms and deterministic appended system message';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME IN ('notifications','audit_logs') AND TG_OP='INSERT' AND context.operation='accept' THEN
    SELECT a.* INTO acceptance FROM alpha_wallet_marketplace_simulation.acceptances a
      JOIN alpha_wallet_marketplace_simulation.publications p ON p.acceptance_key=a.acceptance_key
      WHERE a.request_id=context.request_id AND ((TG_TABLE_NAME='notifications' AND p.payload->'notificationIds' ? NEW.id)
        OR (TG_TABLE_NAME='audit_logs' AND p.payload->>'auditId'=NEW.id));
    IF acceptance.acceptance_key IS NOT NULL THEN
      PERFORM alpha_wallet_marketplace_simulation.require_command(acceptance.wallet_command_revision,'acceptAmountCorrection');
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Legacy and unsupported writers are fenced for the complete enrolled marketplace listing';
END;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.assert_coherence() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
  command alpha_wallet_simulation.commands%ROWTYPE;
  enrollment alpha_wallet_marketplace_simulation.enrollments%ROWTYPE;
  request alpha_exchange.purchase_requests%ROWTYPE; listing alpha_exchange.listings%ROWTYPE;
  binding jsonb; acceptance alpha_wallet_marketplace_simulation.acceptances%ROWTYPE;
  publication alpha_wallet_marketplace_simulation.publications%ROWTYPE;
  accepted_time text; expected_message text;
BEGIN
  context := alpha_wallet_marketplace_simulation.require_context();
  IF context.planned_command IS NOT NULL THEN
    SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
    IF command.revision IS NULL OR command.command_json IS DISTINCT FROM context.planned_command THEN
      RAISE EXCEPTION 'A bound marketplace intent must commit its exact wallet command';
    END IF;
    IF context.operation='enroll' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.enrollments WHERE wallet_command_revision=command.revision)
      OR context.operation='accept' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.acceptances WHERE wallet_command_revision=command.revision) THEN
      RAISE EXCEPTION 'The wallet command and its canonical marketplace record must commit together';
    END IF;
  END IF;
  FOR enrollment IN SELECT * FROM alpha_wallet_marketplace_simulation.enrollments LOOP
    SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=enrollment.wallet_command_revision;
    IF command.revision IS NULL OR command.command_type <> 'enrollReservedTrade'
      OR command.command_key IS DISTINCT FROM enrollment.wallet_command_key
      OR command.event_hash IS DISTINCT FROM enrollment.wallet_event_hash OR command.result_json IS DISTINCT FROM enrollment.binding
      OR command.command_json->>'type' IS DISTINCT FROM 'enrollReservedTrade'
      OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'operator'
      OR command.command_json#>>'{actor,id}' IS DISTINCT FROM enrollment.actor_user_id
      OR command.command_json#>>'{input,terms,platformRequestId}' IS DISTINCT FROM enrollment.request_id
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events e
        WHERE e.platform_request_id=enrollment.request_id AND e.binding_revision=0
          AND e.command_revision=enrollment.wallet_command_revision AND e.payload=enrollment.binding) THEN
      RAISE EXCEPTION 'Retained marketplace enrollment must match its original wallet command, event hash and binding';
    END IF;
    SELECT * INTO request FROM alpha_exchange.purchase_requests WHERE id=enrollment.request_id;
    SELECT * INTO listing FROM alpha_exchange.listings WHERE id=enrollment.platform_listing_id;
    SELECT payload INTO binding FROM alpha_wallet_simulation.trade_terms_events
      WHERE platform_request_id=enrollment.request_id ORDER BY binding_revision DESC LIMIT 1;
    IF request.id IS NULL OR listing.id IS NULL OR binding IS NULL
      OR request.id IS DISTINCT FROM request.payload->>'id' OR request.trade_id IS DISTINCT FROM request.payload->>'tradeId'
      OR request.listing_id IS DISTINCT FROM request.payload->>'listingId' OR request.seller_id IS DISTINCT FROM request.payload->>'sellerId'
      OR request.buyer_id IS DISTINCT FROM request.payload->>'buyerId' OR request.status IS DISTINCT FROM request.payload->>'status'
      OR request.updated_at IS DISTINCT FROM (request.payload->>'updatedAt')::timestamptz
      OR request.listing_id <> enrollment.platform_listing_id OR request.trade_id IS DISTINCT FROM enrollment.platform_trade_id
      OR request.buyer_id <> enrollment.buyer_id OR request.seller_id <> enrollment.seller_id OR request.status <> 'accepted'
      OR listing.id IS DISTINCT FROM listing.payload->>'id' OR listing.seller_id IS DISTINCT FROM listing.payload->>'sellerId'
      OR listing.seller_id <> enrollment.seller_id
      OR (to_jsonb(listing) ? 'status' AND to_jsonb(listing)->>'status' IS DISTINCT FROM listing.payload->>'status')
      OR (to_jsonb(listing) ? 'active_trade_request_id'
        AND to_jsonb(listing)->>'active_trade_request_id' IS DISTINCT FROM listing.payload->>'activeTradeRequestId')
      OR NOT alpha_wallet_marketplace_simulation.request_terms_match(request.payload,binding->'terms')
      OR binding->>'walletTradeId' IS DISTINCT FROM enrollment.wallet_trade_id
      OR binding->>'walletListingId' IS DISTINCT FROM enrollment.wallet_listing_id
      OR EXISTS (SELECT 1 FROM alpha_exchange.purchase_requests sibling WHERE sibling.listing_id=listing.id
        AND (sibling.id IS DISTINCT FROM sibling.payload->>'id' OR sibling.listing_id IS DISTINCT FROM sibling.payload->>'listingId'
          OR sibling.trade_id IS DISTINCT FROM sibling.payload->>'tradeId' OR sibling.seller_id IS DISTINCT FROM sibling.payload->>'sellerId'
          OR sibling.buyer_id IS DISTINCT FROM sibling.payload->>'buyerId' OR sibling.status IS DISTINCT FROM sibling.payload->>'status'
          OR sibling.seller_id <> enrollment.seller_id)) THEN
      RAISE EXCEPTION 'Canonical marketplace identities and current wallet terms must remain coherent';
    END IF;
    IF (binding->>'revision')::integer <> (SELECT count(*) FROM alpha_wallet_marketplace_simulation.acceptances WHERE request_id=enrollment.request_id)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts r WHERE r.platform_request_id=enrollment.request_id
        AND NOT EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.acceptances a WHERE a.acceptance_key=r.acceptance_key)) THEN
      RAISE EXCEPTION 'Every enrolled wallet terms revision requires its marketplace receipt';
    END IF;
  END LOOP;
  FOR acceptance IN SELECT * FROM alpha_wallet_marketplace_simulation.acceptances LOOP
    SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=acceptance.wallet_command_revision;
    IF command.revision IS NULL OR command.command_type <> 'acceptAmountCorrection'
      OR command.command_key IS DISTINCT FROM acceptance.wallet_command_key
      OR command.event_hash IS DISTINCT FROM acceptance.wallet_event_hash OR command.result_json IS DISTINCT FROM acceptance.receipt
      OR command.command_json->>'type' IS DISTINCT FROM 'acceptAmountCorrection'
      OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'buyer'
      OR command.command_json#>>'{actor,id}' IS DISTINCT FROM acceptance.actor_user_id
      OR command.command_json#>>'{input,platformRequestId}' IS DISTINCT FROM acceptance.request_id
      OR command.command_json#>>'{input,proposalId}' IS DISTINCT FROM acceptance.proposal_id
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts r
        WHERE r.acceptance_key=acceptance.acceptance_key AND r.command_revision=acceptance.wallet_command_revision
          AND r.platform_request_id=acceptance.request_id AND r.proposal_id=acceptance.proposal_id AND r.payload=acceptance.receipt) THEN
      RAISE EXCEPTION 'Retained marketplace acceptance must match its original wallet command, event hash and receipt';
    END IF;
    SELECT * INTO publication FROM alpha_wallet_marketplace_simulation.publications WHERE id=acceptance.publication_id;
    SELECT * INTO enrollment FROM alpha_wallet_marketplace_simulation.enrollments WHERE request_id=acceptance.request_id;
    SELECT * INTO request FROM alpha_exchange.purchase_requests WHERE id=acceptance.request_id;
    accepted_time := to_char(to_timestamp((acceptance.receipt->>'acceptedAtMs')::numeric / 1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    expected_message := 'Trade terms accepted: ' || (acceptance.receipt#>>'{terms,usdtAmount}') || ' USDT for ILS ' || (acceptance.receipt#>>'{terms,fiatAmount}') || '.';
    IF publication.id IS NULL OR publication.acceptance_key <> acceptance.acceptance_key
      OR publication.payload IS DISTINCT FROM alpha_wallet_marketplace_simulation.publication_payload(acceptance.acceptance_key)
      OR request.payload#>>'{termsProposal,id}' IS DISTINCT FROM acceptance.proposal_id
      OR request.payload#>>'{termsProposal,status}' IS DISTINCT FROM 'accepted'
      OR request.payload#>>'{termsProposal,resolvedAt}' IS DISTINCT FROM accepted_time
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(request.payload->'messages','[]'::jsonb)) message
        WHERE message->>'id'='wallet-message-'||acceptance.acceptance_key AND message->>'purchaseRequestId'=acceptance.request_id
          AND message->>'kind'='system' AND message->>'senderUserId'=acceptance.actor_user_id
          AND message->>'createdAt'=accepted_time AND message->>'message'=expected_message)
      OR NOT EXISTS (SELECT 1 FROM alpha_exchange.notifications n WHERE n.id='wallet-notification-'||acceptance.acceptance_key
        AND n.user_id=enrollment.seller_id AND n.category='trade' AND n.is_read=false AND n.created_at=accepted_time::timestamptz
        AND n.payload->>'id'=n.id AND n.payload->>'userId'=n.user_id AND n.payload->>'category'='trade'
        AND n.payload->>'title'='Trade proposal updated' AND n.payload->>'message'=expected_message AND n.payload->>'isRead'='false'
        AND n.payload->>'relatedRequestId'=acceptance.request_id AND n.payload->>'relatedListingId'=enrollment.platform_listing_id
        AND n.payload->>'relatedTradeId' IS NOT DISTINCT FROM enrollment.platform_trade_id AND n.payload->>'createdAt'=accepted_time)
      OR NOT EXISTS (SELECT 1 FROM alpha_exchange.audit_logs a WHERE a.id='wallet-audit-'||acceptance.acceptance_key
        AND a.actor_user_id=acceptance.actor_user_id AND a.purchase_request_id=acceptance.request_id
        AND a.listing_id=enrollment.platform_listing_id AND a.action='trade_amount_correction_accepted' AND a.created_at=accepted_time::timestamptz
        AND a.payload->>'id'=a.id AND a.payload->>'actorUserId'=a.actor_user_id AND a.payload->>'action'='trade_amount_correction_accepted'
        AND a.payload->>'purchaseRequestId'=acceptance.request_id AND a.payload->>'listingId'=enrollment.platform_listing_id
        AND a.payload->>'details'=expected_message AND a.payload->>'reason'='development_wallet_amount_acceptance'
        AND a.payload->>'createdAt'=accepted_time) THEN
      RAISE EXCEPTION 'Acceptance, canonical terms, system message and safe publication intent must commit together';
    END IF;
  END LOOP;
END;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.check_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  -- Ordinary unscoped legacy transactions need no registration. All scoped
  -- writes are already rejected by BEFORE guards; a context queues this check.
  PERFORM alpha_wallet_marketplace_simulation.assert_coherence();
  RETURN NULL;
END;
$fn$;

DO $triggers$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['enrollments','acceptances','publications'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_marketplace_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_marketplace_simulation.reject_change()',name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER complete_marketplace_transaction AFTER INSERT ON alpha_wallet_marketplace_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.check_deferred()',name);
  END LOOP;
  CREATE CONSTRAINT TRIGGER complete_marketplace_context AFTER INSERT OR UPDATE ON alpha_wallet_marketplace_simulation.transaction_contexts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.check_deferred();
  FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs'] LOOP
    EXECUTE format('CREATE TRIGGER marketplace_listing_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_canonical()',name);
    EXECUTE format('CREATE TRIGGER marketplace_no_truncate BEFORE TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_marketplace_simulation.reject_change()',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['transaction_contexts','enrollments','acceptances','publications'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_marketplace_simulation.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE alpha_wallet_marketplace_simulation.%I FORCE ROW LEVEL SECURITY',name);
  END LOOP;
END;
$triggers$;
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_marketplace_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_marketplace_simulation FROM PUBLIC;
