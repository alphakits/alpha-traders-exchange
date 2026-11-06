-- DEVELOPMENT ONLY: exact V4 cancellation -> no-money payment/dispute successor.
-- Old source rows and old format meanings remain immutable. SQL independently
-- derives each canonical effect from retained rows and the one bound command.

ALTER TABLE alpha_wallet_payment_marketplace_simulation.claims
  ADD CONSTRAINT payment_financial_receipt FOREIGN KEY (claim_key)
  REFERENCES alpha_wallet_simulation.initial_payment_claim_receipts(claim_key);
ALTER TABLE alpha_wallet_payment_marketplace_simulation.dispute_freezes
  ADD CONSTRAINT dispute_financial_receipt FOREIGN KEY (dispute_key)
  REFERENCES alpha_wallet_simulation.initial_dispute_freeze_receipts(dispute_key);

CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.reject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'Payment predecessor and immutable lifecycle evidence are sealed'; END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.capture_predecessor(request_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('initial',alpha_wallet_cancellation_marketplace_simulation.capture_predecessor($1),
   'cancellation',jsonb_build_object('transition',to_jsonb(t),'cancellation',to_jsonb(c),'publication',to_jsonb(p)))
 FROM alpha_wallet_cancellation_marketplace_simulation.transitions t
 LEFT JOIN alpha_wallet_cancellation_marketplace_simulation.cancellations c ON c.request_id=t.request_id
 LEFT JOIN alpha_wallet_cancellation_marketplace_simulation.publications p ON p.cancellation_key=c.cancellation_key
 WHERE t.request_id=$1;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.input_digest(operation text,actor_id text,request_id text,private_input jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT alpha_wallet_cancellation_marketplace_simulation.payload_digest(
   jsonb_build_object('kind',CASE $1 WHEN 'upgrade' THEN 'alpha-wallet-initial-payment-upgrade-v1'
     WHEN 'claim' THEN 'alpha-wallet-initial-payment-claim-v1' WHEN 'dispute' THEN 'alpha-wallet-initial-payment-dispute-v1' END,
     'actorUserId',$2,'requestId',$3)
   ||CASE $1 WHEN 'claim' THEN jsonb_build_object('evidence',CASE WHEN $4 ? 'evidence' THEN
      jsonb_build_object('mimeType',$4#>>'{evidence,metadata,mimeType}','contentDigest',$4#>>'{evidence,contentDigest}') ELSE NULL END)
    WHEN 'dispute' THEN jsonb_build_object('reasonDigest',encode(sha256(convert_to($4->>'reason','UTF8')),'hex')) ELSE '{}'::jsonb END);
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.capture_basis(request_id text,actor_id text,operation text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('request',to_jsonb(r),'listing',to_jsonb(l),'trade',to_jsonb(t),
  'actorRole',(SELECT role FROM alpha_exchange.users WHERE id=$2),
  'reminders',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.sort_index,n.id COLLATE "C"),'[]'::jsonb)
    FROM alpha_exchange.notifications n WHERE n.user_id IN (r.buyer_id,CASE WHEN $3='dispute' THEN r.seller_id END)
      AND n.payload->>'userId'=n.user_id AND n.payload->>'reason'='automatic_trade_action_reminder'
      AND n.payload->>'relatedRequestId'=r.id AND n.payload->>'state' IS DISTINCT FROM 'archived'),
  'evidence',(SELECT coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(e)-'content',
      'contentDigest',encode(sha256(e.content),'hex')) ORDER BY e.id COLLATE "C"),'[]'::jsonb)
    FROM alpha_exchange.evidence e WHERE e.purchase_request_id=r.id OR e.payload->>'purchaseRequestId'=r.id))
 FROM alpha_exchange.purchase_requests r JOIN alpha_exchange.listings l ON l.id=r.listing_id
 JOIN alpha_exchange.trades t ON t.id=r.trade_id AND t.purchase_request_id=r.id WHERE r.id=$1;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.assert_source(expect_current boolean) RETURNS void
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
  PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(false);
  SELECT * INTO transition FROM alpha_wallet_cancellation_marketplace_simulation.transitions WHERE request_id=(SELECT request_id FROM alpha_wallet_initial_marketplace_simulation.activations LIMIT 1);
  SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=(SELECT request_id FROM alpha_wallet_initial_marketplace_simulation.activations LIMIT 1);
  SELECT * INTO initial FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=(SELECT request_id FROM alpha_wallet_initial_marketplace_simulation.activations LIMIT 1);
  SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=transition.wallet_command_revision;
  SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=transition.wallet_command_revision-1;
  SELECT * INTO financial FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
  IF (SELECT count(*) FROM alpha_wallet_cancellation_marketplace_simulation.transitions)<>1 OR transition.request_id IS NULL
    OR (SELECT format_version FROM alpha_wallet_simulation.head WHERE singleton) NOT IN (4,5)
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
  SELECT * INTO cancellation FROM alpha_wallet_cancellation_marketplace_simulation.cancellations WHERE request_id=(SELECT request_id FROM alpha_wallet_initial_marketplace_simulation.activations LIMIT 1);
  IF cancellation.cancellation_key IS NULL THEN
    IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts)
      OR EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.publications) THEN
      RAISE EXCEPTION 'A cancellation principal return cannot commit without its coordinated canonical receipt';
    END IF;
    IF expect_current THEN PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_predecessor(true); END IF;
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
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.expected_canonical(basis jsonb,private_input jsonb,command alpha_wallet_simulation.commands) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
 acceptance alpha_wallet_initial_marketplace_simulation.acceptances%ROWTYPE;
 claim alpha_wallet_payment_marketplace_simulation.claims%ROWTYPE;
 prior_command alpha_wallet_simulation.commands%ROWTYPE;
 before_request jsonb; before_listing jsonb; request jsonb; listing jsonb; trade jsonb; timeline jsonb;
 evidence jsonb:='[]'::jsonb; disputes jsonb:='[]'::jsonb; notices jsonb:='[]'::jsonb; reminders jsonb:='[]'::jsonb;
 metadata jsonb; proof jsonb; dispute jsonb; audit jsonb; reminder jsonb; expected jsonb; field text; receiver text;
 kind text; actor text; actor_role text; at_time text; suffix text; bank boolean; ext text; reason text;
BEGIN
 kind:=CASE command.command_type WHEN 'claimInitialPayment' THEN 'claim' WHEN 'freezeInitialDispute' THEN 'dispute' END;
 before_request:=basis#>'{request,payload}'; before_listing:=basis#>'{listing,payload}';
 actor:=command.command_json#>>'{actor,id}'; actor_role:=basis->>'actorRole';
 SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=before_request->>'id';
 SELECT * INTO acceptance FROM alpha_wallet_initial_marketplace_simulation.acceptances WHERE request_id=activation.request_id;
 IF kind IS NULL OR activation.request_id IS NULL OR acceptance.acceptance_key IS NULL
   OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'buyer' OR actor IS DISTINCT FROM activation.buyer_id
   OR command.command_json->'version' IS DISTINCT FROM '5'::jsonb OR command.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v5'
   OR NOT coalesce(actor_role IN ('guest','student','buyer','pending_seller_approval','approved_seller','admin','owner'),false)
   OR command.command_json#>'{input,terms}' IS DISTINCT FROM acceptance.receipt#>'{input,terms}'
   OR command.command_json#>>'{input,termsDigest}' IS DISTINCT FROM acceptance.receipt->>'termsDigest'
   OR NOT alpha_wallet_cancellation_marketplace_simulation.request_terms_match(before_request,command.command_json#>'{input,terms}')
   OR command.command_json#>>'{input,preconditions,requestDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(before_request)
   OR command.command_json#>>'{input,preconditions,listingDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(before_listing)
   OR command.command_json#>>'{input,preconditions,tradeDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(basis#>'{trade,payload}')
   OR command.command_json#>>'{input,preconditions,requestUpdatedAt}' IS DISTINCT FROM before_request->>'updatedAt'
   OR command.command_json#>'{input,preconditions,canonicalTermsUnchanged}' IS DISTINCT FROM 'true'::jsonb
   OR command.command_json#>'{input,preconditions,canonicalOpenDispute}' IS DISTINCT FROM 'false'::jsonb
   OR command.command_json#>>'{input,principalHold,action}' IS DISTINCT FROM 'retain_reserved'
   OR command.command_json#>>'{input,principalHold,transferAmountRaw}' IS DISTINCT FROM '0'
   OR command.command_json#>>'{input,principalHold,principalRaw}' IS DISTINCT FROM acceptance.receipt->>'principalRaw'
   OR command.command_json#>>'{input,principalHold,expectedTradeReservedRaw}' IS DISTINCT FROM acceptance.receipt->>'principalRaw'
   OR command.command_json#>>'{input,principalHold,walletTradeId}' IS DISTINCT FROM activation.wallet_trade_id
   OR command.command_json#>>'{input,principalHold,walletListingId}' IS DISTINCT FROM activation.wallet_listing_id
   OR command.command_json#>>'{input,principalHold,assetId}' IS DISTINCT FROM activation.asset_id
   OR before_request->>'status' IS DISTINCT FROM (CASE kind WHEN 'claim' THEN 'accepted' ELSE 'payment_sent' END)
   OR command.command_json#>>'{input,preconditions,canonicalStatus}' IS DISTINCT FROM before_request->>'status'
   OR before_listing->>'status' IS DISTINCT FROM (CASE kind WHEN 'claim' THEN 'matched' ELSE 'in_trade' END)
   OR before_listing->>'activeTradeRequestId' IS DISTINCT FROM activation.request_id
   OR before_listing->>'lockedAt' IS NULL
   OR before_request->>'buyerId' IS DISTINCT FROM activation.buyer_id OR before_request->>'sellerId' IS DISTINCT FROM activation.seller_id
   OR before_request->>'tradeId' IS DISTINCT FROM activation.platform_trade_id OR before_request->>'listingId' IS DISTINCT FROM activation.platform_listing_id
   OR before_request->>'currency' IS DISTINCT FROM 'ILS'
   OR before_request->>'paymentMethod' NOT IN ('Bank Transfer','Face-to-Face','Face-to-Face (Meet in Person)')
   OR before_request->>'bankTransferProvider'='wise' OR before_listing->>'bankTransferProvider'='wise'
   OR before_request->>'sensitivePaymentKind'='cardless_code'
   OR jsonb_typeof(basis->'evidence') IS DISTINCT FROM 'array' OR jsonb_typeof(basis->'reminders') IS DISTINCT FROM 'array'
   OR EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.cancellations)
   OR EXISTS (SELECT 1 FROM alpha_exchange.commissions c WHERE c.purchase_request_id=activation.request_id
     OR c.payload->>'purchaseRequestId'=activation.request_id OR c.payload->>'tradeId'=activation.platform_trade_id) THEN
   RAISE EXCEPTION 'Payment action requires exact retained initial terms, actual buyer, canonical prestate and zero-money reservation';
 END IF;
 at_time:=to_char(to_timestamp(command.occurred_at_ms::numeric/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF command.occurred_at_ms IS DISTINCT FROM (command.command_json#>>(CASE kind WHEN 'claim' THEN '{input,claimedAtMs}'::text[] ELSE '{input,disputedAtMs}'::text[] END))::bigint
   OR at_time::timestamptz<=(before_request->>'updatedAt')::timestamptz
   OR (kind='claim' AND at_time::timestamptz<=(before_listing->>'updatedAt')::timestamptz) THEN
   RAISE EXCEPTION 'Payment lifecycle requires one strictly later canonical command clock';
 END IF;
 bank:=before_request->>'paymentMethod'='Bank Transfer';
 suffix:=encode(sha256(convert_to('["initial_payment_'||kind||'",'||to_jsonb(activation.request_id)::text||','||to_jsonb(activation.platform_trade_id)::text||']','UTF8')),'hex');
 timeline:=before_request->'timeline';
 IF kind='claim' THEN
   SELECT * INTO prior_command FROM alpha_wallet_simulation.commands WHERE revision=acceptance.wallet_command_revision;
   expected:=alpha_wallet_cancellation_marketplace_simulation.initial_expected_canonical(activation,prior_command,
     acceptance.canonical_result#>>'{request,timeline,-1,actorRole}');
   IF basis->'request' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'purchase_requests')
     OR basis->'listing' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'listings')
     OR basis->'trade' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.initial_expected_row(activation,expected,'trades')
     OR basis->'evidence' IS DISTINCT FROM '[]'::jsonb OR before_request ?| ARRAY['paymentSentAt','buyerEvidence'] THEN
     RAISE EXCEPTION 'Buyer claim must start from the exact original accepted V4 canonical target';
   END IF;
   proof:=command.command_json#>'{input,claim,proof}';
   IF bank THEN
     metadata:=private_input#>'{evidence,metadata}';
     ext:=CASE proof->>'mimeType' WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' WHEN 'application/pdf' THEN 'pdf' END;
     expected:=jsonb_build_object('id',proof->>'evidenceId','purchaseRequestId',activation.request_id,'side','buyer',
       'uploadedByUserId',activation.buyer_id,'uploadedAt',at_time,'fileName','buyer-payment-evidence.'||ext,
       'mimeType',proof->>'mimeType','sizeBytes',proof->'sizeBytes',
       'storagePath','db://alpha-exchange-evidence/'||activation.request_id||'/buyer-'||(proof->>'evidenceId')||'.'||ext,'status','uploaded');
     IF ext IS NULL OR metadata IS DISTINCT FROM expected
       OR private_input IS DISTINCT FROM jsonb_build_object('evidence',jsonb_build_object('metadata',expected,'contentDigest',proof->>'contentSha256'))
       OR NOT coalesce(proof->>'contentSha256' ~ '^[a-f0-9]{64}$',false)
       OR NOT coalesce(proof->>'evidenceId' ~ '^evidence-[a-f0-9]{32}$',false)
       OR (proof->>'sizeBytes')::integer NOT BETWEEN 1 AND 8388608 THEN
       RAISE EXCEPTION 'Bank payment claim requires exact neutral metadata and bounded content commitment';
     END IF;
     evidence:=jsonb_build_array(jsonb_build_object('metadata',metadata,'contentDigest',proof->>'contentSha256'));
     timeline:=timeline||jsonb_build_array(jsonb_build_object('id','payment-claim-evidence-event-'||suffix,
       'type','buyer_evidence_uploaded','actorUserId',actor,'actorRole',actor_role,'message','Buyer uploaded payment evidence','createdAt',at_time));
   ELSIF private_input IS DISTINCT FROM '{}'::jsonb OR proof IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'Face-to-Face buyer claims do not accept evidence attachments';
   END IF;
   timeline:=timeline||jsonb_build_array(jsonb_build_object('id','payment-claim-event-'||suffix,'type','payment_sent',
     'actorUserId',actor,'actorRole',actor_role,'message',CASE WHEN bank THEN 'Buyer marked payment sent' ELSE 'Buyer confirmed the cash was handed to the seller' END,'createdAt',at_time));
   request:=(before_request-ARRAY['actionReminderState','inactivityWarningSentAt'])||jsonb_build_object('status','payment_sent','paymentSentAt',at_time,'updatedAt',at_time,'timeline',timeline);
   IF bank THEN request:=request||jsonb_build_object('buyerEvidence',metadata); END IF;
   listing:=before_listing||jsonb_build_object('status','in_trade','updatedAt',at_time);
   notices:=jsonb_build_array(jsonb_build_object('id','payment-claim-notification-seller-'||suffix,'userId',activation.seller_id,
     'category','trade','title',CASE WHEN bank THEN 'Buyer marked payment sent' ELSE 'Buyer handed over cash' END,
     'message',CASE WHEN bank THEN 'Buyer marked payment as sent. Please verify the funds in your bank account.' ELSE 'Buyer confirmed the cash was handed over. Confirm receipt before sending USDT.' END,
     'isRead',false,'state','unread','relatedRequestId',activation.request_id,'relatedTradeId',activation.platform_trade_id,
     'relatedListingId',activation.platform_listing_id,'relatedHref','/trade-room/'||activation.request_id,'createdAt',at_time));
   audit:=jsonb_build_object('id','payment-claim-audit-'||suffix,'action','trade_payment_claimed','actorUserId',actor,
     'targetUserId',activation.seller_id,'listingId',activation.platform_listing_id,'purchaseRequestId',activation.request_id,
     'details','Buyer payment claim recorded; principal remains reserved.','oldValue',jsonb_build_object('status','accepted'),
     'newValue',jsonb_build_object('status','payment_sent')||CASE WHEN bank THEN jsonb_build_object('buyerEvidenceId',metadata->>'id') ELSE '{}'::jsonb END,'createdAt',at_time);
 ELSE
   SELECT * INTO claim FROM alpha_wallet_payment_marketplace_simulation.claims WHERE request_id=activation.request_id;
   SELECT * INTO prior_command FROM alpha_wallet_simulation.commands WHERE revision=claim.wallet_command_revision;
   IF claim.claim_key IS NULL THEN RAISE EXCEPTION 'Buyer dispute requires this exact prior coordinated claim'; END IF;
   expected:=alpha_wallet_payment_marketplace_simulation.expected_canonical(claim.canonical_basis,claim.canonical_input,prior_command);
   IF basis->'request' IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(claim.canonical_basis,expected,'purchase_requests',activation.request_id)
     OR basis->'listing' IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(claim.canonical_basis,expected,'listings',activation.platform_listing_id)
     OR basis->'trade' IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(claim.canonical_basis,expected,'trades',activation.platform_trade_id)
     OR command.command_json#>>'{input,priorClaim,claimKey}' IS DISTINCT FROM claim.claim_key
     OR command.command_json#>'{input,priorClaim,commandRevision}' IS DISTINCT FROM to_jsonb(claim.wallet_command_revision)
     OR command.command_json#>>'{input,priorClaim,receiptDigest}' IS DISTINCT FROM alpha_wallet_cancellation_marketplace_simulation.payload_digest(claim.receipt)
     OR (bank AND (jsonb_array_length(basis->'evidence')<>1
       OR basis#>>'{evidence,0,contentDigest}' IS DISTINCT FROM claim.canonical_input#>>'{evidence,contentDigest}'
       OR basis#>'{evidence,0,row,payload}' IS DISTINCT FROM claim.canonical_input#>'{evidence,metadata}'))
     OR (NOT bank AND basis->'evidence' IS DISTINCT FROM '[]'::jsonb) THEN
     RAISE EXCEPTION 'Dispute basis, held principal and exact prior claim/evidence binding disagree';
   END IF;
   reason:=private_input->>'reason';
   IF NOT alpha_wallet_payment_marketplace_simulation.valid_dispute_reason(reason)
     OR private_input IS DISTINCT FROM jsonb_build_object('reason',reason)
     OR command.command_json#>>'{input,reasonDigest}' IS DISTINCT FROM encode(sha256(convert_to(reason,'UTF8')),'hex') THEN
     RAISE EXCEPTION 'Dispute requires its exact normalized private reason commitment';
   END IF;
   dispute:=jsonb_build_object('id','payment-dispute-'||suffix,'purchaseRequestId',activation.request_id,'tradeId',activation.platform_trade_id,
     'openedByUserId',actor,'buyerId',activation.buyer_id,'sellerId',activation.seller_id,'reason',reason,'status','open','createdAt',at_time,'updatedAt',at_time);
   IF bank THEN dispute:=dispute||jsonb_build_object('buyerEvidenceId',before_request#>>'{buyerEvidence,id}'); END IF;
   disputes:=jsonb_build_array(dispute);
   timeline:=timeline||jsonb_build_array(jsonb_build_object('id','payment-dispute-event-'||suffix,'type','dispute_opened',
     'actorUserId',actor,'actorRole',actor_role,'message','Dispute opened for this trade.','createdAt',at_time));
   request:=(before_request-ARRAY['actionReminderState','inactivityWarningSentAt'])||jsonb_build_object('updatedAt',at_time,'timeline',timeline);
   listing:=before_listing;
   FOREACH receiver IN ARRAY ARRAY[activation.buyer_id,activation.seller_id] LOOP
     notices:=notices||jsonb_build_array(jsonb_build_object('id','payment-dispute-notification-'||CASE WHEN receiver=activation.buyer_id THEN 'buyer' ELSE 'seller' END||'-'||suffix,
       'userId',receiver,'category','dispute','title','Dispute opened','message','A dispute was opened for trade '||activation.platform_trade_id||'.',
       'isRead',false,'state','unread','relatedRequestId',activation.request_id,'relatedTradeId',activation.platform_trade_id,
       'relatedListingId',activation.platform_listing_id,'relatedHref','/trade-room/'||activation.request_id,'createdAt',at_time));
   END LOOP;
   audit:=jsonb_build_object('id','payment-dispute-audit-'||suffix,'action','trade_dispute_opened','actorUserId',actor,
     'targetUserId',activation.seller_id,'listingId',activation.platform_listing_id,'purchaseRequestId',activation.request_id,
     'details','Buyer dispute opened; principal remains reserved and lifecycle is frozen.','oldValue',jsonb_build_object('status','payment_sent'),
     'newValue',jsonb_build_object('status','payment_sent','disputeId',dispute->>'id'),'createdAt',at_time);
 END IF;
 FOR reminder IN SELECT value FROM jsonb_array_elements(basis->'reminders') LOOP
   IF reminder->>'user_id' IS DISTINCT FROM reminder#>>'{payload,userId}'
     OR reminder->>'user_id' NOT IN (activation.buyer_id,CASE WHEN kind='dispute' THEN activation.seller_id ELSE activation.buyer_id END)
     OR reminder#>>'{payload,reason}' IS DISTINCT FROM 'automatic_trade_action_reminder'
     OR reminder#>>'{payload,relatedRequestId}' IS DISTINCT FROM activation.request_id OR reminder#>>'{payload,state}'='archived' THEN
     RAISE EXCEPTION 'Payment action reminder basis contains unsupported rows';
   END IF;
   reminders:=reminders||jsonb_build_array(reminder->'payload'||jsonb_build_object('state','archived','isRead',true,'archivedAt',at_time,'updatedAt',at_time));
 END LOOP;
 trade:=jsonb_build_object('id',activation.platform_trade_id,'purchaseRequestId',activation.request_id,'listingId',activation.platform_listing_id,
   'sellerId',activation.seller_id,'buyerId',activation.buyer_id,'status','payment_sent','createdAt',before_request->>'tradeCreatedAt','updatedAt',at_time,'timeline',timeline);
 RETURN jsonb_build_object('kind',kind,'request',request,'listing',listing,'trade',trade,'evidence',evidence,'disputes',disputes,
   'notifications',notices,'notificationUpdates',reminders,'auditLogs',jsonb_build_array(audit));
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.expected_row(basis jsonb,canonical jsonb,table_name text,row_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE payload jsonb; before_row jsonb; at_time timestamptz; ordinal bigint;
BEGIN
 at_time:=(canonical#>>'{request,updatedAt}')::timestamptz;
 IF table_name='purchase_requests' THEN
   RETURN basis->'request'||jsonb_build_object('status','payment_sent','updated_at',at_time,'payload',canonical->'request');
 ELSIF table_name='listings' THEN
   RETURN basis->'listing'||jsonb_build_object('status','in_trade','updated_at',(canonical#>>'{listing,updatedAt}')::timestamptz,'payload',canonical->'listing');
 ELSIF table_name='trades' THEN
   RETURN basis->'trade'||jsonb_build_object('status','payment_sent','updated_at',at_time,'payload',canonical->'trade');
 ELSIF table_name='notifications' THEN
   SELECT value,number-1 INTO payload,ordinal FROM jsonb_array_elements(canonical->'notifications') WITH ORDINALITY e(value,number) WHERE value->>'id'=row_id;
   IF payload IS NOT NULL THEN
     RETURN jsonb_build_object('id',payload->>'id','user_id',payload->>'userId','category',payload->>'category','is_read',false,'created_at',at_time,'sort_index',ordinal,'payload',payload);
   END IF;
   SELECT value INTO payload FROM jsonb_array_elements(canonical->'notificationUpdates') WHERE value->>'id'=row_id;
   SELECT value INTO before_row FROM jsonb_array_elements(basis->'reminders') WHERE value->>'id'=row_id;
   IF payload IS NOT NULL AND before_row IS NOT NULL THEN RETURN before_row||jsonb_build_object('is_read',true,'payload',payload); END IF;
 ELSIF table_name='audit_logs' THEN
   payload:=canonical#>'{auditLogs,0}';
   IF payload->>'id'=row_id THEN RETURN jsonb_build_object('id',payload->>'id','action',payload->>'action','actor_user_id',payload->>'actorUserId',
     'target_user_id',payload->>'targetUserId','listing_id',payload->>'listingId','purchase_request_id',payload->>'purchaseRequestId','created_at',at_time,'sort_index',0,'payload',payload); END IF;
 ELSIF table_name='evidence' THEN
   SELECT value->'metadata' INTO payload FROM jsonb_array_elements(canonical->'evidence') WHERE value#>>'{metadata,id}'=row_id;
   IF payload IS NOT NULL THEN RETURN jsonb_build_object('id',payload->>'id','purchase_request_id',payload->>'purchaseRequestId','side','buyer',
     'uploaded_by_user_id',payload->>'uploadedByUserId','mime_type',payload->>'mimeType','file_name',payload->>'fileName','size_bytes',payload->'sizeBytes',
     'uploaded_at',(payload->>'uploadedAt')::timestamptz,'sort_index',0,'payload',payload); END IF;
 ELSIF table_name='disputes' THEN
   SELECT value INTO payload FROM jsonb_array_elements(canonical->'disputes') WHERE value->>'id'=row_id;
   IF payload IS NOT NULL THEN RETURN jsonb_build_object('id',payload->>'id','trade_id',payload->>'tradeId','purchase_request_id',payload->>'purchaseRequestId',
     'seller_id',payload->>'sellerId','buyer_id',payload->>'buyerId','status','open','created_at',at_time,'updated_at',at_time,'sort_index',0,'payload',payload); END IF;
 END IF;
 RAISE EXCEPTION 'Unsupported payment lifecycle canonical projection';
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.require_command(command_revision integer,expected_type text) RETURNS alpha_wallet_simulation.commands
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE context alpha_wallet_payment_marketplace_simulation.transaction_contexts%ROWTYPE; command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
 context:=alpha_wallet_payment_marketplace_simulation.require_context();
 PERFORM alpha_wallet_simulation.require_current_command(command_revision);
 SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=command_revision;
 IF command.command_json IS DISTINCT FROM context.planned_command OR command.command_key IS DISTINCT FROM context.planned_command_key
   OR command.command_type IS DISTINCT FROM expected_type THEN RAISE EXCEPTION 'Payment write requires its exact current-transaction financial command'; END IF;
 RETURN command;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE; expected_type text; actor_kind text; command jsonb;
BEGIN
 PERFORM alpha_wallet_simulation.require_runtime();
 SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=NEW.request_id;
 IF NEW.transaction_id IS DISTINCT FROM txid_current()::text OR current_setting('transaction_read_only')<>'off'
   OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL
   OR to_regclass('alpha_wallet_initial_marketplace_simulation.recovery_receipts') IS NOT NULL
   OR to_regclass('alpha_wallet_cancellation_marketplace_simulation.recovery_receipts') IS NOT NULL
   OR activation.request_id IS NULL OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=NEW.actor_user_id) THEN
   RAISE EXCEPTION 'Invalid original-source payment marketplace registration';
 END IF;
 IF TG_OP='INSERT' AND (NEW.planned_command IS NOT NULL OR NEW.canonical_basis IS NOT NULL OR NEW.canonical_input IS NOT NULL) THEN
   RAISE EXCEPTION 'Register payment context before binding its command';
 END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['planned_command','planned_command_key','canonical_basis','canonical_input'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['planned_command','planned_command_key','canonical_basis','canonical_input'])
     OR OLD.planned_command IS NOT NULL OR OLD.canonical_input IS NOT NULL OR NEW.planned_command IS NULL OR NEW.canonical_basis IS NOT NULL) THEN
   RAISE EXCEPTION 'Payment context binds one exact command and captures physical prestate once';
 END IF;
 command:=NEW.planned_command;
 IF command IS NOT NULL THEN
   expected_type:=CASE NEW.operation WHEN 'upgrade' THEN 'continueFromV4' WHEN 'claim' THEN 'claimInitialPayment'
     WHEN 'dispute' THEN 'freezeInitialDispute' WHEN 'pause' THEN 'pause' END;
   actor_kind:=CASE WHEN NEW.operation IN ('claim','dispute') THEN 'buyer' ELSE 'operator' END;
   IF expected_type IS NULL OR command->>'type' IS DISTINCT FROM expected_type OR command->'version' IS DISTINCT FROM '5'::jsonb
     OR command->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v5' OR command#>>'{actor,id}' IS DISTINCT FROM NEW.actor_user_id
     OR command#>>'{actor,kind}' IS DISTINCT FROM actor_kind
     OR NEW.planned_command_key::jsonb IS DISTINCT FROM jsonb_build_array(actor_kind,NEW.actor_user_id,expected_type,command->>'requestId')
     OR (NEW.operation='pause' AND command->'input' IS DISTINCT FROM 'null'::jsonb) THEN
     RAISE EXCEPTION 'Payment context command actor, engine, identity or operation mismatch';
   END IF;
   IF NEW.operation IN ('claim','dispute') THEN
     PERFORM alpha_wallet_payment_marketplace_simulation.assert_coherence();
     IF NEW.actor_user_id IS DISTINCT FROM activation.buyer_id OR NEW.canonical_input IS NULL
       OR command#>>'{input,terms,platformRequestId}' IS DISTINCT FROM activation.request_id
       OR EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.cancellations)
       OR EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.dispute_freezes)
       OR (NEW.operation='claim' AND EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.claims))
       OR (NEW.operation='dispute' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.claims)) THEN
       RAISE EXCEPTION 'Payment binding requires the original buyer and exact claim/dispute order';
     END IF;
     NEW.canonical_basis:=alpha_wallet_payment_marketplace_simulation.capture_basis(NEW.request_id,NEW.actor_user_id,NEW.operation);
     IF NEW.canonical_basis IS NULL THEN RAISE EXCEPTION 'Payment physical prestate is missing'; END IF;
   ELSIF NEW.canonical_input IS NOT NULL THEN RAISE EXCEPTION 'Non-lifecycle operations have no private action input'; END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE context alpha_wallet_payment_marketplace_simulation.transaction_contexts%ROWTYPE;
 command alpha_wallet_simulation.commands%ROWTYPE; source alpha_wallet_simulation.commands%ROWTYPE;
 continuation alpha_wallet_simulation.payment_engine_continuations%ROWTYPE;
BEGIN
 context:=alpha_wallet_payment_marketplace_simulation.require_context();
 command:=alpha_wallet_payment_marketplace_simulation.require_command(NEW.wallet_command_revision,'continueFromV4');
 SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=NEW.wallet_command_revision-1;
 SELECT * INTO continuation FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton;
 PERFORM alpha_wallet_payment_marketplace_simulation.assert_source(true);
 IF context.operation<>'upgrade' OR context.request_id IS DISTINCT FROM NEW.request_id OR context.actor_user_id IS DISTINCT FROM NEW.actor_user_id
   OR NEW.input_digest IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.input_digest('upgrade',NEW.actor_user_id,NEW.request_id,NULL)
   OR NEW.source_status IS DISTINCT FROM (SELECT status FROM alpha_exchange.purchase_requests WHERE id=NEW.request_id)
   OR NEW.wallet_command_key IS DISTINCT FROM command.command_key OR NEW.wallet_event_hash IS DISTINCT FROM command.event_hash
   OR NEW.continuation IS DISTINCT FROM command.result_json OR NEW.continuation->'checkpoint' IS DISTINCT FROM NEW.wallet_checkpoint
   OR NEW.wallet_checkpoint IS DISTINCT FROM jsonb_build_object('revision',source.revision,'eventHash',source.event_hash,'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
   OR source.command_json->'version' IS DISTINCT FROM '4'::jsonb
   OR NEW.predecessor IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.capture_predecessor(NEW.request_id)
   OR continuation.command_revision IS DISTINCT FROM command.revision OR continuation.command_key IS DISTINCT FROM command.command_key
   OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=NEW.actor_user_id
     AND (role='owner' OR (jsonb_typeof(payload->'roles')='array' AND payload->'roles' ? 'owner'))) THEN
   RAISE EXCEPTION 'Payment transition requires the current owner, original V4 checkpoint and exact unchanged source evidence';
 END IF;
 UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE id=NEW.request_id;
 UPDATE alpha_exchange.listings SET payload=payload WHERE id=NEW.predecessor#>>'{initial,activation,platform_listing_id}';
 UPDATE alpha_exchange.runtime_meta SET version=version+1 WHERE singleton=true;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_action() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE context alpha_wallet_payment_marketplace_simulation.transaction_contexts%ROWTYPE;
 command alpha_wallet_simulation.commands%ROWTYPE; kind text; key text; projection jsonb; projection_revision integer;
BEGIN
 kind:=CASE TG_TABLE_NAME WHEN 'claims' THEN 'claim' WHEN 'dispute_freezes' THEN 'dispute' END;
 key:=CASE kind WHEN 'claim' THEN to_jsonb(NEW)->>'claim_key' ELSE to_jsonb(NEW)->>'dispute_key' END;
 context:=alpha_wallet_payment_marketplace_simulation.require_context();
 command:=alpha_wallet_payment_marketplace_simulation.require_command(NEW.wallet_command_revision,CASE kind WHEN 'claim' THEN 'claimInitialPayment' ELSE 'freezeInitialDispute' END);
 IF kind='claim' THEN SELECT payload,command_revision INTO projection,projection_revision FROM alpha_wallet_simulation.initial_payment_claim_receipts WHERE claim_key=key;
 ELSE SELECT payload,command_revision INTO projection,projection_revision FROM alpha_wallet_simulation.initial_dispute_freeze_receipts WHERE dispute_key=key; END IF;
 IF context.operation IS DISTINCT FROM kind OR context.request_id IS DISTINCT FROM NEW.request_id OR context.actor_user_id IS DISTINCT FROM NEW.actor_user_id
   OR NEW.actor_kind IS DISTINCT FROM 'buyer' OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'buyer'
   OR command.command_json#>>'{actor,id}' IS DISTINCT FROM NEW.actor_user_id
   OR NEW.input_digest IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.input_digest(kind,NEW.actor_user_id,NEW.request_id,context.canonical_input)
   OR NEW.wallet_command_key IS DISTINCT FROM command.command_key OR NEW.wallet_event_hash IS DISTINCT FROM command.event_hash
   OR NEW.receipt IS DISTINCT FROM command.result_json OR projection IS DISTINCT FROM NEW.receipt OR projection_revision IS DISTINCT FROM command.revision
   OR key IS DISTINCT FROM NEW.receipt->>(CASE kind WHEN 'claim' THEN 'claimKey' ELSE 'disputeKey' END)
   OR NEW.receipt->>'platformRequestId' IS DISTINCT FROM NEW.request_id OR NEW.receipt->>'actorUserId' IS DISTINCT FROM NEW.actor_user_id
   OR NEW.receipt->>'transferAmountRaw' IS DISTINCT FROM '0'
   OR NEW.canonical_basis IS DISTINCT FROM context.canonical_basis OR NEW.canonical_input IS DISTINCT FROM context.canonical_input
   OR NEW.canonical_result IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_canonical(NEW.canonical_basis,NEW.canonical_input,command)
   OR NEW.publication_id IS DISTINCT FROM 'payment-'||kind||'-publication-'||key THEN
   RAISE EXCEPTION 'Payment action requires its exact zero-money financial receipt and complete independent canonical effects';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.publication_payload(operation text,action_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('type',CASE $1 WHEN 'claim' THEN 'initial_payment_claimed' ELSE 'initial_dispute_frozen' END,
   'requestId',c.request_id,'listingId',v.platform_listing_id,'tradeId',v.platform_trade_id,'walletTradeId',v.wallet_trade_id,
   'sellerId',v.seller_id,'buyerId',v.buyer_id,'actorUserId',c.actor_user_id,'actorKind','buyer','acceptanceKey',c.receipt->>'acceptanceKey',
   'actionKey',$2,'walletRevision',c.wallet_command_revision,'walletEventHash',c.wallet_event_hash,'termsDigest',c.receipt->>'termsDigest',
   'principalRaw',c.receipt->>'principalRaw','transferAmountRaw','0','paymentVerified',false,
   'notificationIds',(SELECT coalesce(jsonb_agg(n->>'id'),'[]'::jsonb) FROM jsonb_array_elements(c.canonical_result->'notifications') n),
   'auditId',c.canonical_result#>>'{auditLogs,0,id}','timelineEventId',c.canonical_result#>>'{request,timeline,-1,id}')
 FROM (SELECT request_id,actor_user_id,receipt,wallet_command_revision,wallet_event_hash,canonical_result FROM alpha_wallet_payment_marketplace_simulation.claims WHERE $1='claim' AND claim_key=$2
   UNION ALL SELECT request_id,actor_user_id,receipt,wallet_command_revision,wallet_event_hash,canonical_result FROM alpha_wallet_payment_marketplace_simulation.dispute_freezes WHERE $1='dispute' AND dispute_key=$2) c
 JOIN alpha_wallet_initial_marketplace_simulation.activations v ON v.request_id=c.request_id;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE revision integer; publication text;
BEGIN
 IF NEW.operation='claim' THEN SELECT wallet_command_revision,publication_id INTO revision,publication FROM alpha_wallet_payment_marketplace_simulation.claims WHERE claim_key=NEW.action_key;
 ELSE SELECT wallet_command_revision,publication_id INTO revision,publication FROM alpha_wallet_payment_marketplace_simulation.dispute_freezes WHERE dispute_key=NEW.action_key; END IF;
 PERFORM alpha_wallet_payment_marketplace_simulation.require_command(revision,CASE NEW.operation WHEN 'claim' THEN 'claimInitialPayment' ELSE 'freezeInitialDispute' END);
 IF NEW.id IS DISTINCT FROM publication OR NEW.payload IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.publication_payload(NEW.operation,NEW.action_key) THEN
   RAISE EXCEPTION 'Payment publication must contain only its exact safe unverified lifecycle facts'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.check_evidence(row_data jsonb,content bytea,canonical jsonb,basis jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE item jsonb; metadata jsonb; identifier text; prefix bytea; valid_signature boolean;
BEGIN
 identifier:=row_data->>'id';
 SELECT value INTO item FROM jsonb_array_elements(canonical->'evidence') WHERE value#>>'{metadata,id}'=identifier;
 metadata:=item->'metadata';
 IF item IS NULL OR content IS NULL OR octet_length(content)<>(metadata->>'sizeBytes')::integer
   OR octet_length(content) NOT BETWEEN 1 AND 8388608 OR encode(sha256(content),'hex') IS DISTINCT FROM item->>'contentDigest'
   OR row_data IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(basis,canonical,'evidence',identifier) THEN
   RAISE EXCEPTION 'Claim evidence requires exact metadata, length and original bytes commitment';
 END IF;
 prefix:=convert_to(metadata->>'purchaseRequestId','UTF8')||decode('00','hex')||convert_to(metadata->>'uploadedByUserId','UTF8')
   ||decode('00','hex')||convert_to('buyer','UTF8')||decode('00','hex')||convert_to(metadata->>'mimeType','UTF8')||decode('00','hex');
 IF identifier IS DISTINCT FROM 'evidence-'||substr(encode(sha256(prefix||content),'hex'),1,32) THEN
   RAISE EXCEPTION 'Evidence identity must derive from actual buyer, request, MIME and exact binary content';
 END IF;
 valid_signature:=CASE metadata->>'mimeType'
   WHEN 'image/png' THEN substring(content FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex')
   WHEN 'image/jpeg' THEN substring(content FROM 1 FOR 3)=decode('ffd8ff','hex')
   WHEN 'application/pdf' THEN substring(content FROM 1 FOR 5)=convert_to('%PDF-','UTF8') ELSE false END;
 IF NOT coalesce(valid_signature,false) THEN RAISE EXCEPTION 'Evidence signature differs from the permitted upload MIME'; END IF;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_canonical() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE old_row jsonb; new_row jsonb; listing text; scoped boolean:=false;
 context alpha_wallet_payment_marketplace_simulation.transaction_contexts%ROWTYPE;
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
   ELSIF TG_TABLE_NAME<>'listings' THEN UPDATE alpha_exchange.listings SET payload=payload WHERE id=listing; END IF;
 END LOOP;
 IF NOT scoped THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 context:=alpha_wallet_payment_marketplace_simulation.require_context();
 IF context.operation NOT IN ('claim','dispute') OR context.planned_command IS NULL OR context.canonical_basis IS NULL OR context.canonical_input IS NULL THEN
   RAISE EXCEPTION 'Legacy and unsupported writers remain fenced for the complete payment cohort listing';
 END IF;
 SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
 command:=alpha_wallet_payment_marketplace_simulation.require_command(command.revision,CASE context.operation WHEN 'claim' THEN 'claimInitialPayment' ELSE 'freezeInitialDispute' END);
 expected:=alpha_wallet_payment_marketplace_simulation.expected_canonical(context.canonical_basis,context.canonical_input,command);
 row_id:=coalesce(new_row->>'id',old_row->>'id');
 IF TG_TABLE_NAME='purchase_requests' THEN before_row:=context.canonical_basis->'request';
 ELSIF TG_TABLE_NAME='listings' THEN before_row:=context.canonical_basis->'listing';
 ELSIF TG_TABLE_NAME='trades' THEN before_row:=context.canonical_basis->'trade';
 ELSIF TG_TABLE_NAME='notifications' THEN SELECT value INTO before_row FROM jsonb_array_elements(context.canonical_basis->'reminders') WHERE value->>'id'=row_id;
 ELSIF TG_TABLE_NAME IN ('audit_logs','evidence','disputes') THEN before_row:=NULL;
 ELSE RAISE EXCEPTION 'Unsupported payment lifecycle auxiliary mutation is fenced'; END IF;
 IF old_row IS DISTINCT FROM before_row OR TG_OP IS DISTINCT FROM (CASE WHEN before_row IS NULL THEN 'INSERT' ELSE 'UPDATE' END) THEN
   RAISE EXCEPTION 'Payment action requires the exact single physical-row delta';
 END IF;
 IF TG_TABLE_NAME='evidence' THEN
   PERFORM alpha_wallet_payment_marketplace_simulation.check_evidence(new_row-'content',NEW.content,expected,context.canonical_basis);
 ELSIF new_row IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(context.canonical_basis,expected,TG_TABLE_NAME,row_id) THEN
   RAISE EXCEPTION 'Payment canonical write differs from the independently reconstructed exact effect';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.verify_effects(basis jsonb,canonical jsonb,verify_target boolean) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE actual jsonb; expected jsonb; item jsonb; identifier text; name text; content bytea;
BEGIN
 IF verify_target THEN
   FOREACH name IN ARRAY ARRAY['purchase_requests','listings','trades'] LOOP
     identifier:=CASE name WHEN 'purchase_requests' THEN basis#>>'{request,id}' WHEN 'listings' THEN basis#>>'{listing,id}' ELSE basis#>>'{trade,id}' END;
     EXECUTE format('SELECT to_jsonb(t) FROM alpha_exchange.%I t WHERE id=$1',name) INTO actual USING identifier;
     IF actual IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(basis,canonical,name,identifier) THEN
       RAISE EXCEPTION 'Payment canonical target is missing or differs from the complete result';
     END IF;
   END LOOP;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements((canonical->'notifications')||(canonical->'notificationUpdates')) LOOP
   identifier:=item->>'id'; SELECT to_jsonb(n) INTO actual FROM alpha_exchange.notifications n WHERE id=identifier;
   IF actual IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(basis,canonical,'notifications',identifier) THEN
     RAISE EXCEPTION 'Payment notification or exact reminder archive is missing or changed';
   END IF;
 END LOOP;
 identifier:=canonical#>>'{auditLogs,0,id}'; SELECT to_jsonb(a) INTO actual FROM alpha_exchange.audit_logs a WHERE id=identifier;
 IF actual IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(basis,canonical,'audit_logs',identifier) THEN
   RAISE EXCEPTION 'Payment canonical audit is missing or changed'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(canonical->'evidence') LOOP
   identifier:=item#>>'{metadata,id}'; SELECT to_jsonb(e)-'content',e.content INTO actual,content FROM alpha_exchange.evidence e WHERE id=identifier;
   PERFORM alpha_wallet_payment_marketplace_simulation.check_evidence(actual,content,canonical,basis);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(canonical->'disputes') LOOP
   identifier:=item->>'id'; SELECT to_jsonb(d) INTO actual FROM alpha_exchange.disputes d WHERE id=identifier;
   IF actual IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.expected_row(basis,canonical,'disputes',identifier) THEN
     RAISE EXCEPTION 'Payment dispute freeze is missing or changed'; END IF;
 END LOOP;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.assert_coherence() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE context alpha_wallet_payment_marketplace_simulation.transaction_contexts%ROWTYPE;
 transition alpha_wallet_payment_marketplace_simulation.transitions%ROWTYPE;
 activation alpha_wallet_initial_marketplace_simulation.activations%ROWTYPE;
 continuation alpha_wallet_simulation.payment_engine_continuations%ROWTYPE;
 command alpha_wallet_simulation.commands%ROWTYPE; source alpha_wallet_simulation.commands%ROWTYPE;
 row_data record; publication alpha_wallet_payment_marketplace_simulation.publications%ROWTYPE;
 expected jsonb; projection jsonb; projection_revision integer; key text; command_type text; count_claim integer; count_dispute integer;
BEGIN
 context:=alpha_wallet_payment_marketplace_simulation.require_context();
 PERFORM alpha_wallet_payment_marketplace_simulation.assert_source(false);
 SELECT * INTO activation FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=context.request_id;
 SELECT * INTO transition FROM alpha_wallet_payment_marketplace_simulation.transitions WHERE request_id=context.request_id;
 SELECT * INTO continuation FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton;
 SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=transition.wallet_command_revision;
 SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=transition.wallet_command_revision-1;
 IF transition.request_id IS NULL OR (SELECT count(*) FROM alpha_wallet_payment_marketplace_simulation.transitions)<>1
   OR (SELECT format_version FROM alpha_wallet_simulation.head WHERE singleton) IS DISTINCT FROM 5
   OR transition.profile IS DISTINCT FROM 'canonical-initial-payment-cohort-v1'
   OR transition.input_digest IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.input_digest('upgrade',transition.actor_user_id,transition.request_id,NULL)
   OR transition.predecessor IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.capture_predecessor(transition.request_id)
   OR transition.source_status IS DISTINCT FROM (CASE WHEN EXISTS (SELECT 1 FROM alpha_wallet_cancellation_marketplace_simulation.cancellations) THEN 'cancelled' ELSE 'accepted' END)
   OR command.command_type IS DISTINCT FROM 'continueFromV4' OR command.command_json->'version' IS DISTINCT FROM '5'::jsonb
   OR command.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v5'
   OR command.command_json#>>'{actor,kind}' IS DISTINCT FROM 'operator' OR command.command_json#>>'{actor,id}' IS DISTINCT FROM transition.actor_user_id
   OR command.command_key IS DISTINCT FROM transition.wallet_command_key OR command.event_hash IS DISTINCT FROM transition.wallet_event_hash
   OR command.result_json IS DISTINCT FROM transition.continuation OR command.command_json#>'{input,checkpoint}' IS DISTINCT FROM transition.wallet_checkpoint
   OR transition.wallet_checkpoint IS DISTINCT FROM jsonb_build_object('revision',source.revision,'eventHash',source.event_hash,'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
   OR source.command_json->'version' IS DISTINCT FROM '4'::jsonb
   OR continuation.command_revision IS DISTINCT FROM command.revision OR continuation.command_key IS DISTINCT FROM command.command_key
   OR transition.continuation IS DISTINCT FROM jsonb_build_object('checkpoint',transition.wallet_checkpoint,'commandRevision',command.revision,'commandKey',command.command_key,'sourceHaltReason',continuation.source_halt_reason) THEN
   RAISE EXCEPTION 'Payment profile must retain its exact original V4 source and explicit V5 continuation';
 END IF;
 SELECT count(*) INTO count_claim FROM alpha_wallet_payment_marketplace_simulation.claims;
 SELECT count(*) INTO count_dispute FROM alpha_wallet_payment_marketplace_simulation.dispute_freezes;
 IF count_claim<>(SELECT count(*) FROM alpha_wallet_simulation.initial_payment_claim_receipts)
   OR count_dispute<>(SELECT count(*) FROM alpha_wallet_simulation.initial_dispute_freeze_receipts)
   OR count_dispute>count_claim OR (transition.source_status='cancelled' AND count_claim<>0)
   OR (SELECT count(*) FROM alpha_wallet_payment_marketplace_simulation.publications)<>count_claim+count_dispute THEN
   RAISE EXCEPTION 'Payment financial, canonical action and publication inventories must agree';
 END IF;
 IF context.planned_command IS NOT NULL THEN
   SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE command_key=context.planned_command_key;
   IF command.revision IS NULL OR command.command_json IS DISTINCT FROM context.planned_command
     OR (context.operation='upgrade' AND command.revision<>transition.wallet_command_revision)
     OR (context.operation='claim' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.claims c WHERE c.wallet_command_revision=command.revision AND c.canonical_basis=context.canonical_basis AND c.canonical_input=context.canonical_input))
     OR (context.operation='dispute' AND NOT EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.dispute_freezes d WHERE d.wallet_command_revision=command.revision AND d.canonical_basis=context.canonical_basis AND d.canonical_input=context.canonical_input)) THEN
     RAISE EXCEPTION 'A bound payment intent cannot commit a partial command, evidence or lifecycle effect'; END IF;
 END IF;
 IF count_claim=0 THEN PERFORM alpha_wallet_payment_marketplace_simulation.assert_source(true); END IF;
 FOR row_data IN SELECT 'claim'::text AS kind,claim_key AS key,c.* FROM alpha_wallet_payment_marketplace_simulation.claims c
   UNION ALL SELECT 'dispute'::text AS kind,dispute_key AS key,d.* FROM alpha_wallet_payment_marketplace_simulation.dispute_freezes d
   ORDER BY wallet_command_revision LOOP
   key:=row_data.key; command_type:=CASE row_data.kind WHEN 'claim' THEN 'claimInitialPayment' ELSE 'freezeInitialDispute' END;
   SELECT * INTO command FROM alpha_wallet_simulation.commands WHERE revision=row_data.wallet_command_revision;
   expected:=alpha_wallet_payment_marketplace_simulation.expected_canonical(row_data.canonical_basis,row_data.canonical_input,command);
   IF row_data.kind='claim' THEN SELECT payload,command_revision INTO projection,projection_revision FROM alpha_wallet_simulation.initial_payment_claim_receipts WHERE claim_key=key;
   ELSE SELECT payload,command_revision INTO projection,projection_revision FROM alpha_wallet_simulation.initial_dispute_freeze_receipts WHERE dispute_key=key; END IF;
   IF row_data.request_id IS DISTINCT FROM activation.request_id OR row_data.actor_user_id IS DISTINCT FROM activation.buyer_id
     OR row_data.actor_kind IS DISTINCT FROM 'buyer' OR command.command_type IS DISTINCT FROM command_type
     OR command.command_key IS DISTINCT FROM row_data.wallet_command_key OR command.event_hash IS DISTINCT FROM row_data.wallet_event_hash
     OR command.result_json IS DISTINCT FROM row_data.receipt OR projection IS DISTINCT FROM row_data.receipt OR projection_revision IS DISTINCT FROM command.revision
     OR command.revision<=transition.wallet_command_revision
     OR row_data.input_digest IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.input_digest(row_data.kind,row_data.actor_user_id,row_data.request_id,row_data.canonical_input)
     OR row_data.receipt->>'transferAmountRaw' IS DISTINCT FROM '0' OR row_data.canonical_result IS DISTINCT FROM expected THEN
     RAISE EXCEPTION 'Immutable payment action, financial receipt, canonical proof or identity changed'; END IF;
   PERFORM alpha_wallet_payment_marketplace_simulation.verify_effects(row_data.canonical_basis,expected,row_data.kind='dispute' OR count_dispute=0);
   SELECT * INTO publication FROM alpha_wallet_payment_marketplace_simulation.publications WHERE operation=row_data.kind AND action_key=key;
   IF publication.id IS DISTINCT FROM row_data.publication_id OR publication.id IS DISTINCT FROM 'payment-'||row_data.kind||'-publication-'||key
     OR publication.payload IS DISTINCT FROM alpha_wallet_payment_marketplace_simulation.publication_payload(row_data.kind,key) THEN
     RAISE EXCEPTION 'Payment safe publication is incomplete or changed'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM alpha_exchange.evidence e WHERE e.purchase_request_id=activation.request_id OR e.payload->>'purchaseRequestId'=activation.request_id)
     <> coalesce((SELECT jsonb_array_length(canonical_result->'evidence') FROM alpha_wallet_payment_marketplace_simulation.claims),0)
   OR (SELECT count(*) FROM alpha_exchange.disputes d WHERE d.purchase_request_id=activation.request_id OR d.payload->>'purchaseRequestId'=activation.request_id
     OR d.trade_id=activation.platform_trade_id OR d.payload->>'tradeId'=activation.platform_trade_id)<>count_dispute THEN
   RAISE EXCEPTION 'Payment target evidence or dispute closure contains missing or extra records';
 END IF;
END;
$fn$;
CREATE OR REPLACE FUNCTION alpha_wallet_simulation.require_v5_protocol() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF current_setting('alpha_wallet.writer_protocol',true) IS DISTINCT FROM 'simulation-v5-payment' THEN
   RAISE EXCEPTION 'V5 payment cohort requires its scoped successor protocol'; END IF;
 PERFORM alpha_wallet_payment_marketplace_simulation.require_context();
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_wallet_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN PERFORM alpha_wallet_payment_marketplace_simulation.require_context(); RETURN NEW; END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_wallet_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE context alpha_wallet_payment_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
 context:=alpha_wallet_payment_marketplace_simulation.require_context();
 IF context.planned_command IS NULL OR NEW.command_json IS DISTINCT FROM context.planned_command OR NEW.command_key IS DISTINCT FROM context.planned_command_key
   OR NEW.command_type IS DISTINCT FROM (CASE context.operation WHEN 'upgrade' THEN 'continueFromV4' WHEN 'claim' THEN 'claimInitialPayment'
     WHEN 'dispute' THEN 'freezeInitialDispute' WHEN 'pause' THEN 'pause' END) THEN
   RAISE EXCEPTION 'Payment financial command requires one exact registered coordinator intent'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.fence_dependency_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only' OR current_setting('transaction_read_only')<>'off' THEN
   RAISE EXCEPTION 'Payment dependency writes require explicit writable simulation opt-in'; END IF;
 IF EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.transaction_contexts c WHERE c.transaction_id=txid_current()::text
   AND c.planned_command IS NOT NULL AND ((c.operation='upgrade' AND c.planned_command->>'type'='continueFromV4')
     OR (c.operation='claim' AND c.planned_command->>'type'='claimInitialPayment') OR (c.operation='dispute' AND c.planned_command->>'type'='freezeInitialDispute'))) THEN
   PERFORM 1 FROM alpha_exchange.runtime_meta WHERE singleton=true FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Payment runtime fence is missing'; END IF; RETURN NULL;
 END IF;
 UPDATE alpha_exchange.runtime_meta SET version=version+1,updated_at=now() WHERE singleton=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment runtime fence is missing'; END IF; RETURN NULL;
END;
$fn$;
CREATE FUNCTION alpha_wallet_payment_marketplace_simulation.check_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF EXISTS (SELECT 1 FROM alpha_wallet_payment_marketplace_simulation.transaction_contexts WHERE transaction_id=txid_current()::text) THEN
   PERFORM alpha_wallet_payment_marketplace_simulation.assert_coherence(); END IF;
 RETURN NULL;
END;
$fn$;
DO $switch$
DECLARE name text; namespace text;
BEGIN
 -- Every predecessor evidence row and context stays verbatim and sealed, even
 -- against a no-row/no-op statement. The original SQL functions remain retained.
 FOREACH namespace IN ARRAY ARRAY['alpha_wallet_initial_marketplace_simulation','alpha_wallet_cancellation_marketplace_simulation'] LOOP
   FOR name IN SELECT tablename FROM pg_tables WHERE schemaname=namespace LOOP
     EXECUTE format('CREATE TRIGGER payment_predecessor_sealed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.reject_change()',namespace,name);
   END LOOP;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['transaction_contexts','transitions','cancellations','publications'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS complete_cancellation_marketplace_transaction ON alpha_wallet_cancellation_marketplace_simulation.%I',name);
 END LOOP;
 DROP TRIGGER IF EXISTS complete_cancellation_marketplace_context ON alpha_wallet_cancellation_marketplace_simulation.transaction_contexts;
 DROP TRIGGER IF EXISTS cancellation_marketplace_wallet_head ON alpha_wallet_simulation.head;
 DROP TRIGGER IF EXISTS cancellation_marketplace_wallet_command ON alpha_wallet_simulation.commands;
 CREATE TRIGGER payment_marketplace_wallet_head BEFORE UPDATE ON alpha_wallet_simulation.head FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_wallet_head();
 CREATE TRIGGER payment_marketplace_wallet_command BEFORE INSERT ON alpha_wallet_simulation.commands FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_wallet_command();
 FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS cancellation_marketplace_listing_fence ON alpha_exchange.%I',name);
   EXECUTE format('DROP TRIGGER IF EXISTS cancellation_marketplace_no_truncate ON alpha_exchange.%I',name);
   EXECUTE format('DROP TRIGGER IF EXISTS complete_cancellation_canonical_transaction ON alpha_exchange.%I',name);
   EXECUTE format('CREATE TRIGGER payment_marketplace_listing_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_canonical()',name);
   EXECUTE format('CREATE TRIGGER payment_marketplace_no_truncate BEFORE TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.reject_change()',name);
   EXECUTE format('CREATE CONSTRAINT TRIGGER complete_payment_canonical_transaction AFTER INSERT OR UPDATE OR DELETE ON alpha_exchange.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.check_deferred()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['purchase_requests','listings','evidence','disputes','trades','commissions','notifications','audit_logs','users','marketplace_enforcement_records'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS cancellation_marketplace_dependency_fence ON alpha_exchange.%I',name);
   EXECUTE format('CREATE TRIGGER payment_marketplace_dependency_fence BEFORE INSERT OR UPDATE OR DELETE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.fence_dependency_statement()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['commands','head','initial_trade_bindings','initial_acceptance_receipts','cancellation_engine_continuations','initial_cancellation_receipts'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS complete_cancellation_financial_transaction ON alpha_wallet_simulation.%I',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['commands','head','initial_trade_bindings','initial_acceptance_receipts','cancellation_engine_continuations','initial_cancellation_receipts','payment_engine_continuations','initial_payment_claim_receipts','initial_dispute_freeze_receipts'] LOOP
   EXECUTE format('CREATE CONSTRAINT TRIGGER complete_payment_financial_transaction AFTER INSERT OR UPDATE OR DELETE ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.check_deferred()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['transitions','claims','dispute_freezes','publications'] LOOP
   EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_payment_marketplace_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.reject_change()',name);
   EXECUTE format('CREATE CONSTRAINT TRIGGER complete_payment_marketplace_transaction AFTER INSERT ON alpha_wallet_payment_marketplace_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.check_deferred()',name);
 END LOOP;
 CREATE TRIGGER payment_marketplace_context_shape BEFORE INSERT OR UPDATE ON alpha_wallet_payment_marketplace_simulation.transaction_contexts FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_context();
 CREATE TRIGGER payment_marketplace_context_no_delete BEFORE DELETE OR TRUNCATE ON alpha_wallet_payment_marketplace_simulation.transaction_contexts FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.reject_change();
 CREATE CONSTRAINT TRIGGER complete_payment_marketplace_context AFTER INSERT OR UPDATE ON alpha_wallet_payment_marketplace_simulation.transaction_contexts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.check_deferred();
 CREATE TRIGGER payment_marketplace_transition_shape BEFORE INSERT ON alpha_wallet_payment_marketplace_simulation.transitions FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_transition();
 CREATE TRIGGER payment_marketplace_claim_shape BEFORE INSERT ON alpha_wallet_payment_marketplace_simulation.claims FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_action();
 CREATE TRIGGER payment_marketplace_dispute_shape BEFORE INSERT ON alpha_wallet_payment_marketplace_simulation.dispute_freezes FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_action();
 CREATE TRIGGER payment_marketplace_publication_shape BEFORE INSERT ON alpha_wallet_payment_marketplace_simulation.publications FOR EACH ROW EXECUTE FUNCTION alpha_wallet_payment_marketplace_simulation.guard_publication();
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alpha_wallet_payment_marketplace_simulation'
   AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Payment profile retains exact bootstrap RLS fences'; END IF;
END;
$switch$;
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_payment_marketplace_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_payment_marketplace_simulation FROM PUBLIC;
DO $client_grants$
DECLARE client_role text;
BEGIN
 FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
   EXECUTE format('REVOKE ALL ON SCHEMA alpha_wallet_payment_marketplace_simulation FROM %I',client_role);
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_payment_marketplace_simulation FROM %I',client_role);
   EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_payment_marketplace_simulation FROM %I',client_role);
  END IF;
 END LOOP;
END;
$client_grants$;
