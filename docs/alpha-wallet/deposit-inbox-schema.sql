-- Isolated development evidence only. No ledger, custody, signer or financial command.
-- Install only in one writable SERIALIZABLE simulation transaction in fixed UTC.
-- Physical installing transaction identifiers are metadata, not logical journal input.
DO $guard$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT','Etc/GMT','Etc/GMT0') THEN
    RAISE EXCEPTION 'Deposit inbox installation requires explicit writable SERIALIZABLE simulation in UTC';
  END IF;
END;
$guard$;

CREATE SCHEMA alpha_wallet_deposit_inbox_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_deposit_inbox_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_deposit_inbox_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_deposit_inbox_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE DOMAIN alpha_wallet_deposit_inbox_simulation.identifier AS text
  CHECK (VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' AND VALUE NOT IN ('constructor','prototype','__proto__'));
CREATE DOMAIN alpha_wallet_deposit_inbox_simulation.sha256 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN alpha_wallet_deposit_inbox_simulation.uint64 AS text
  CHECK (length(VALUE)<=20 AND VALUE ~ '^(0|[1-9][0-9]*)$' AND VALUE::numeric<=18446744073709551615);
CREATE DOMAIN alpha_wallet_deposit_inbox_simulation.uint256_positive AS text
  CHECK (length(VALUE)<=78 AND VALUE ~ '^[1-9][0-9]*$'
    AND VALUE::numeric<=115792089237316195423570985008687907853269984665640564039457584007913129639935);

-- JavaScript code-unit ordering is explicit; PostgreSQL locale/JSONB key order is not the commitment contract.
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.utf16_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(string_agg(CASE WHEN ascii(ch)>65535 THEN
    lpad(to_hex(55296+(ascii(ch)-65536)/1024),4,'0')||lpad(to_hex(56320+(ascii(ch)-65536)%1024),4,'0')
    ELSE lpad(to_hex(ascii(ch)),4,'0') END,'' ORDER BY ordinal),'')
  FROM regexp_split_to_table(value,'') WITH ORDINALITY AS units(ch,ordinal)
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.canonical_json(value jsonb,depth integer DEFAULT 0) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
DECLARE output text; number numeric;
BEGIN
  IF depth>64 THEN RAISE EXCEPTION 'Deposit JSON exceeds its bounded nesting'; END IF;
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS keys(key) WHERE key IN ('__proto__','constructor','prototype')) THEN
        RAISE EXCEPTION 'Deposit JSON has a reserved object key'; END IF;
      SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||alpha_wallet_deposit_inbox_simulation.canonical_json(item,depth+1),','
        ORDER BY alpha_wallet_deposit_inbox_simulation.utf16_key(key) COLLATE "C"),'')||'}' INTO output FROM jsonb_each(value) AS entries(key,item);
    WHEN 'array' THEN SELECT '['||coalesce(string_agg(alpha_wallet_deposit_inbox_simulation.canonical_json(item,depth+1),',' ORDER BY ordinal),'')||']'
      INTO output FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item,ordinal);
    WHEN 'number' THEN
      number:=value::numeric;
      IF abs(number)>9007199254740991 OR number IS DISTINCT FROM trunc(number) THEN RAISE EXCEPTION 'Deposit JSON number is not an exact safe integer'; END IF;
      output:=trunc(number)::text;
    WHEN 'string' THEN output:=value::text;
    WHEN 'boolean' THEN output:=value::text;
    WHEN 'null' THEN output:='null';
    ELSE RAISE EXCEPTION 'Deposit JSON type is unsupported';
  END CASE;
  RETURN output;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.value_digest(domain text,value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT encode(sha256(convert_to(alpha_wallet_deposit_inbox_simulation.canonical_json(
    jsonb_build_array('alpha-wallet-deposit-inbox-v1',domain,value)),'UTF8')),'hex')
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.closed_object(value jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(jsonb_typeof(value)='object' AND value ?& keys
    AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(value)='object' THEN value ELSE '{}'::jsonb END))=cardinality(keys),false)
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.ordered_json(value jsonb,keys text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
DECLARE output text;
BEGIN
  IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(value,keys) THEN RAISE EXCEPTION 'Deposit ordered evidence object is incomplete'; END IF;
  SELECT '{'||string_agg(to_json(key)::text||':'||alpha_wallet_deposit_inbox_simulation.canonical_json(value->key),',' ORDER BY ordinal)||'}'
    INTO output FROM unnest(keys) WITH ORDINALITY AS names(key,ordinal);
  RETURN output;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.observation_body_json(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
DECLARE key text; parts text[]:=ARRAY[]::text[]; encoded text;
  keys text[]:=ARRAY['kind','mode','creditAuthority','assurance','transfer','executionSourceId','finalitySourceId','checkpointTimestampMs','startedAtMs','completedAtMs','reads'];
BEGIN
  IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(value,array_append(keys,'observationSha256')) THEN RAISE EXCEPTION 'Deposit observation body is incomplete'; END IF;
  FOREACH key IN ARRAY keys LOOP
    IF key='transfer' THEN encoded:=alpha_wallet_deposit_inbox_simulation.ordered_json(value->key,
      ARRAY['kind','creditAuthority','assurance','family','chainKey','token','recipient','transactionId','amountRaw','eventIndex',
        'sender','blockNumber','blockHash','transactionIndex','finality','checkpointNumber','checkpointHash','eventKey']);
    ELSIF key='reads' THEN
      IF jsonb_typeof(value->key) IS DISTINCT FROM 'array' OR jsonb_array_length(value->key) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Deposit observation lacks bounded transcript reads'; END IF;
      SELECT '['||string_agg(alpha_wallet_deposit_inbox_simulation.ordered_json(item,
        ARRAY['sourceId','protocol','operation','requestBody','responseBody','responseSha256','completedAtMs']),',' ORDER BY ordinal)||']'
        INTO encoded FROM jsonb_array_elements(value->key) WITH ORDINALITY AS entries(item,ordinal);
    ELSE encoded:=alpha_wallet_deposit_inbox_simulation.canonical_json(value->key); END IF;
    parts:=array_append(parts,to_json(key)::text||':'||encoded);
  END LOOP;
  RETURN '{'||array_to_string(parts,',')||'}';
END;
$fn$;

CREATE TABLE alpha_wallet_deposit_inbox_simulation.head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  format_version integer NOT NULL CHECK (format_version=1),
  mode text NOT NULL CHECK (mode='simulation-only'),
  inbox_id alpha_wallet_deposit_inbox_simulation.identifier NOT NULL,
  physical_store_instance_id alpha_wallet_deposit_inbox_simulation.identifier NOT NULL,
  manifest_sha256 alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  schema_sha256 alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  catalog_sha256 alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  bootstrap jsonb NOT NULL CHECK (jsonb_typeof(bootstrap)='object'),
  genesis_event_hash alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 0 AND 1000),
  event_hash alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  state_hash alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  state_json jsonb NOT NULL CHECK (jsonb_typeof(state_json)='object'),
  lock_version bigint NOT NULL CHECK (lock_version>=1),
  owner_transaction_id text NOT NULL CHECK (owner_transaction_id ~ '^[1-9][0-9]*$'),
  installation_transaction_id text NOT NULL CHECK (installation_transaction_id ~ '^[1-9][0-9]*$'),
  installation_kind text NOT NULL CHECK (installation_kind IN ('initialize','restore')),
  imported_revision integer NOT NULL CHECK (imported_revision BETWEEN 0 AND 999),
  restore_completed boolean NOT NULL,
  CHECK (installation_kind='restore' OR (imported_revision=0 AND restore_completed))
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.admission (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object')
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.admission_records (
  kind text NOT NULL CHECK (kind IN ('chains','assets','sources','sourceSets','assignments','workers')),
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 100),
  record_sha256 alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  PRIMARY KEY (kind,record_id)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.commands (
  revision integer PRIMARY KEY CHECK (revision BETWEEN 1 AND 1000),
  request_key text NOT NULL UNIQUE CHECK (octet_length(request_key) BETWEEN 1 AND 1024),
  input_fingerprint alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  at_ms bigint NOT NULL CHECK (at_ms BETWEEN 0 AND 9007199254740991),
  record_json jsonb NOT NULL CHECK (jsonb_typeof(record_json)='object'),
  previous_event_hash alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  event_hash alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  state_hash alpha_wallet_deposit_inbox_simulation.sha256 NOT NULL,
  owner_transaction_id text NOT NULL CHECK (owner_transaction_id ~ '^[1-9][0-9]*$')
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.command_seals (
  command_revision integer PRIMARY KEY REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  owner_transaction_id text NOT NULL CHECK (owner_transaction_id ~ '^[1-9][0-9]*$')
);

CREATE TABLE alpha_wallet_deposit_inbox_simulation.evidence_blobs (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED UNIQUE NOT NULL,
  PRIMARY KEY (command_revision,ordinal)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.observations (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED UNIQUE NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.evidence_blobs(evidence_id),
  PRIMARY KEY (command_revision,ordinal)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.block_anchors (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 4095),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  block_key text GENERATED ALWAYS AS (payload->>'blockKey') STORED UNIQUE NOT NULL,
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.observations(evidence_id),
  PRIMARY KEY (command_revision,ordinal)
);
CREATE UNIQUE INDEX block_anchor_native_identity ON alpha_wallet_deposit_inbox_simulation.block_anchors ((block_key::jsonb));
CREATE TABLE alpha_wallet_deposit_inbox_simulation.transaction_anchors (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  transaction_key text GENERATED ALWAYS AS (payload->>'transactionKey') STORED UNIQUE NOT NULL,
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.observations(evidence_id),
  PRIMARY KEY (command_revision,ordinal)
);
CREATE UNIQUE INDEX transaction_anchor_native_identity ON alpha_wallet_deposit_inbox_simulation.transaction_anchors ((transaction_key::jsonb));
CREATE TABLE alpha_wallet_deposit_inbox_simulation.events (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  native_event_locator text GENERATED ALWAYS AS (payload->>'nativeEventLocator') STORED UNIQUE NOT NULL,
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.observations(evidence_id),
  transaction_key text GENERATED ALWAYS AS (payload->>'transactionKey') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.transaction_anchors(transaction_key),
  PRIMARY KEY (command_revision,ordinal)
);
CREATE UNIQUE INDEX event_native_identity ON alpha_wallet_deposit_inbox_simulation.events ((native_event_locator::jsonb));
CREATE TABLE alpha_wallet_deposit_inbox_simulation.event_observations (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 255),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  native_event_locator text GENERATED ALWAYS AS (payload->>'nativeEventLocator') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.events(native_event_locator),
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.observations(evidence_id),
  PRIMARY KEY (command_revision,ordinal), UNIQUE (native_event_locator,evidence_id)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.source_heads (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  source_set_id text GENERATED ALWAYS AS (payload->>'sourceSetId') STORED NOT NULL,
  evidence_id text GENERATED ALWAYS AS (payload->>'evidenceId') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.observations(evidence_id),
  PRIMARY KEY (command_revision,ordinal), UNIQUE (source_set_id,command_revision)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.candidate_jobs (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  job_id text GENERATED ALWAYS AS (payload->>'jobId') STORED UNIQUE NOT NULL,
  PRIMARY KEY (command_revision,ordinal)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.candidate_cursors (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  job_id text GENERATED ALWAYS AS (payload->>'jobId') STORED NOT NULL
    REFERENCES alpha_wallet_deposit_inbox_simulation.candidate_jobs(job_id),
  PRIMARY KEY (command_revision,ordinal), UNIQUE (job_id,command_revision)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.quarantines (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  quarantine_id text GENERATED ALWAYS AS (payload->>'quarantineId') STORED UNIQUE NOT NULL,
  PRIMARY KEY (command_revision,ordinal)
);
CREATE TABLE alpha_wallet_deposit_inbox_simulation.recovery_receipts (
  command_revision integer NOT NULL REFERENCES alpha_wallet_deposit_inbox_simulation.commands(revision),
  ordinal integer NOT NULL CHECK (ordinal=0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  recovery_id text GENERATED ALWAYS AS (payload->>'recoveryId') STORED UNIQUE NOT NULL,
  target_store_instance_id text GENERATED ALWAYS AS (payload->>'targetStoreInstanceId') STORED UNIQUE NOT NULL,
  PRIMARY KEY (command_revision,ordinal)
);

CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.require_runtime() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable' OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT','Etc/GMT','Etc/GMT0') THEN
    RAISE EXCEPTION 'Deposit inbox requires explicit writable SERIALIZABLE simulation in UTC';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public','alpha_wallet_deposit_inbox_simulation')
      AND nspname !~ '^pg_(toast|temp_[0-9]+|toast_temp_[0-9]+)$')
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_extension WHERE extname IS DISTINCT FROM 'plpgsql') OR EXISTS (SELECT 1 FROM pg_event_trigger) THEN
    RAISE EXCEPTION 'Deposit inbox refuses every companion schema and public or temporary object';
  END IF;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.require_writer() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_deposit_inbox_simulation.require_runtime();
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.head WHERE singleton
    AND owner_transaction_id=txid_current()::text AND lock_version>0
    AND xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
    RAISE EXCEPTION 'Deposit inbox requires its physical singleton write fence';
  END IF;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.reject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'Deposit inbox evidence, commands, admission and seals are immutable'; END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_deposit_inbox_simulation.require_runtime();
  IF (OLD.state_json->>'status'='quarantined' AND NEW.state_json->>'status' IS DISTINCT FROM 'quarantined')
    OR (OLD.state_json->>'status'='paused' AND NEW.state_json->>'status'='recording') THEN
    RAISE EXCEPTION 'Deposit stopped state is absorbing and cannot resume recording'; END IF;
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.format_version IS DISTINCT FROM OLD.format_version
    OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.inbox_id IS DISTINCT FROM OLD.inbox_id
    OR NEW.physical_store_instance_id IS DISTINCT FROM OLD.physical_store_instance_id
    OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256 OR NEW.schema_sha256 IS DISTINCT FROM OLD.schema_sha256
    OR NEW.catalog_sha256 IS DISTINCT FROM OLD.catalog_sha256 OR NEW.bootstrap IS DISTINCT FROM OLD.bootstrap
    OR NEW.genesis_event_hash IS DISTINCT FROM OLD.genesis_event_hash
    OR NEW.installation_transaction_id IS DISTINCT FROM OLD.installation_transaction_id
    OR NEW.installation_kind IS DISTINCT FROM OLD.installation_kind OR NEW.imported_revision IS DISTINCT FROM OLD.imported_revision
    OR (OLD.restore_completed AND NOT NEW.restore_completed) THEN
    RAISE EXCEPTION 'Deposit store, manifest, schema and original bootstrap identity are immutable';
  END IF;
  IF NEW.lock_version=OLD.lock_version+1 THEN
    IF NEW.owner_transaction_id IS DISTINCT FROM txid_current()::text OR NEW.revision IS DISTINCT FROM OLD.revision
      OR NEW.event_hash IS DISTINCT FROM OLD.event_hash OR NEW.state_hash IS DISTINCT FROM OLD.state_hash OR NEW.state_json IS DISTINCT FROM OLD.state_json
      OR NEW.restore_completed IS DISTINCT FROM OLD.restore_completed THEN RAISE EXCEPTION 'Acquire deposit fence without changing logical state'; END IF;
  ELSIF NEW.lock_version=OLD.lock_version THEN
    PERFORM alpha_wallet_deposit_inbox_simulation.require_writer();
    IF NEW.owner_transaction_id IS DISTINCT FROM OLD.owner_transaction_id OR NEW.revision<OLD.revision
      OR (NEW.revision=OLD.revision AND (NEW.event_hash IS DISTINCT FROM OLD.event_hash OR NEW.state_hash IS DISTINCT FROM OLD.state_hash OR NEW.state_json IS DISTINCT FROM OLD.state_json))
      OR (NEW.restore_completed IS DISTINCT FROM OLD.restore_completed AND (OLD.installation_kind IS DISTINCT FROM 'restore'
        OR OLD.installation_transaction_id IS DISTINCT FROM txid_current()::text)) THEN RAISE EXCEPTION 'Deposit logical head cannot be replaced or moved backwards'; END IF;
  ELSE RAISE EXCEPTION 'Deposit fence must increment exactly once'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE prior alpha_wallet_deposit_inbox_simulation.commands%ROWTYPE; h alpha_wallet_deposit_inbox_simulation.head%ROWTYPE; r jsonb;
BEGIN
  PERFORM alpha_wallet_deposit_inbox_simulation.require_writer();
  SELECT * INTO h FROM alpha_wallet_deposit_inbox_simulation.head WHERE singleton;
  SELECT * INTO prior FROM alpha_wallet_deposit_inbox_simulation.commands ORDER BY revision DESC LIMIT 1;
  r:=NEW.record_json;
  IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(r,ARRAY['kind','formatVersion','mode','creditAuthority','revision','atMs',
    'workerId','actorRole','requestKey','inputFingerprint','command','effects','result','resultSha256','previousEventHash','eventHash','stateHash','receipt'])
    OR NOT alpha_wallet_deposit_inbox_simulation.closed_object(r->'effects',ARRAY['evidenceBlobs','observations','blockAnchors','transactionAnchors',
      'events','eventObservations','sourceHeads','candidateJobs','candidateCursors','quarantines','recoveryReceipts'])
    OR NOT alpha_wallet_deposit_inbox_simulation.closed_object(r->'result',ARRAY['mode','creditAuthority','disposition','requestId','requestKey','inputFingerprint',
      'workerId','recordedAtMs','revision','evidenceId','nativeEventLocator','quarantineId','cursorBefore','cursorAfter'])
    OR NOT alpha_wallet_deposit_inbox_simulation.closed_object(r->'receipt',ARRAY['mode','creditAuthority','disposition','requestId','requestKey','inputFingerprint',
      'workerId','recordedAtMs','revision','evidenceId','nativeEventLocator','quarantineId','cursorBefore','cursorAfter','checkpoint'])
    OR NOT alpha_wallet_deposit_inbox_simulation.closed_object(r#>'{receipt,checkpoint}',ARRAY['revision','eventHash','stateHash']) THEN
    RAISE EXCEPTION 'Deposit journal, effects or receipt has missing or extra fields'; END IF;
  IF r->'revision' IS DISTINCT FROM to_jsonb(NEW.revision) OR r->'atMs' IS DISTINCT FROM to_jsonb(NEW.at_ms)
    OR jsonb_typeof(r->'workerId') IS DISTINCT FROM 'string'
    OR r#>'{result,revision}' IS DISTINCT FROM to_jsonb(NEW.revision)
    OR r#>'{result,recordedAtMs}' IS DISTINCT FROM to_jsonb(NEW.at_ms)
    OR jsonb_typeof(r#>'{command,requestId}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Deposit command scalar types must be exact JSON primitives'; END IF;
  IF coalesce(r#>>'{result,disposition}','') NOT IN ('job-registered','recorded','duplicate-evidence','corroborating-observation',
    'stale-preparation-held','continuity-unproved-held','attempt-held','conflict-quarantined','request-conflict-quarantined',
    'source-conflict-unsealed','resource-quarantined','paused','restored-quarantined')
    OR coalesce(r#>>'{command,type}','') NOT IN ('register-candidate-job','record-observation','record-attempt-hold','pause','resource-quarantine','restore-quarantine')
    OR coalesce(r->>'actorRole','') NOT IN ('worker','operator','restore')
    OR r->>'eventHash' IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('inbox-command',r-'eventHash'-'receipt')
    OR r->>'resultSha256' IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('inbox-result',r->'result') THEN
    RAISE EXCEPTION 'Deposit journal has an unsupported control or an invalid content commitment'; END IF;
  IF NEW.owner_transaction_id IS DISTINCT FROM txid_current()::text OR NEW.revision IS DISTINCT FROM coalesce(prior.revision,0)+1
    OR NEW.previous_event_hash IS DISTINCT FROM coalesce(prior.event_hash,h.genesis_event_hash)
    OR NEW.at_ms<coalesce(prior.at_ms,(h.bootstrap->>'atMs')::bigint)
    OR r->>'kind' IS DISTINCT FROM 'development-deposit-inbox-command' OR r->>'formatVersion' IS DISTINCT FROM '1'
    OR r->>'mode' IS DISTINCT FROM 'simulation-only' OR r->'creditAuthority' IS DISTINCT FROM 'false'::jsonb
    OR r->>'revision' IS DISTINCT FROM NEW.revision::text OR r->>'atMs' IS DISTINCT FROM NEW.at_ms::text
    OR r->>'requestKey' IS DISTINCT FROM NEW.request_key OR r->>'inputFingerprint' IS DISTINCT FROM NEW.input_fingerprint
    OR r->>'previousEventHash' IS DISTINCT FROM NEW.previous_event_hash OR r->>'eventHash' IS DISTINCT FROM NEW.event_hash OR r->>'stateHash' IS DISTINCT FROM NEW.state_hash
    OR jsonb_typeof(r->'effects') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'result') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'receipt') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Deposit command does not extend its exact canonical journal';
  END IF;
  IF r->'result' IS DISTINCT FROM ((r->'receipt')-'checkpoint')
    OR r#>>'{receipt,checkpoint,revision}' IS DISTINCT FROM NEW.revision::text OR r#>>'{receipt,checkpoint,eventHash}' IS DISTINCT FROM NEW.event_hash
    OR r#>>'{receipt,checkpoint,stateHash}' IS DISTINCT FROM NEW.state_hash OR r#>>'{result,revision}' IS DISTINCT FROM NEW.revision::text
    OR r#>>'{result,requestKey}' IS DISTINCT FROM NEW.request_key OR r#>>'{result,inputFingerprint}' IS DISTINCT FROM NEW.input_fingerprint
    OR r#>>'{result,workerId}' IS DISTINCT FROM r->>'workerId' OR r#>>'{result,recordedAtMs}' IS DISTINCT FROM NEW.at_ms::text
    OR r#>>'{result,requestId}' IS DISTINCT FROM r#>>'{command,requestId}'
    OR r#>>'{result,mode}' IS DISTINCT FROM 'simulation-only' OR r#>'{result,creditAuthority}' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'Deposit command lacks its exact original receipt and checkpoint';
  END IF;
  IF NEW.revision>h.imported_revision THEN
    IF r->>'actorRole'='restore' THEN
      IF h.installation_kind IS DISTINCT FROM 'restore' OR h.restore_completed OR h.installation_transaction_id IS DISTINCT FROM txid_current()::text
        OR NEW.revision IS DISTINCT FROM h.imported_revision+1 OR r#>>'{command,type}' IS DISTINCT FROM 'restore-quarantine' THEN
        RAISE EXCEPTION 'Only a fresh certified restore can append a restoration quarantine'; END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.admission_records
        WHERE kind='workers' AND record_id=r->>'workerId') OR r->>'actorRole' NOT IN ('worker','operator') THEN
        RAISE EXCEPTION 'Deposit command worker is not admitted'; END IF;
      IF h.state_json->>'status' IS DISTINCT FROM 'recording' THEN
        RAISE EXCEPTION 'Deposit inbox is terminally stopped'; END IF;
      IF r#>>'{command,type}'='pause' AND r->>'actorRole' IS DISTINCT FROM 'operator' THEN RAISE EXCEPTION 'Deposit pause requires operator capability'; END IF;
    END IF;
  END IF;
  IF NEW.revision>999 AND r#>>'{command,type}' IS DISTINCT FROM 'restore-quarantine'
    OR (NEW.revision>998 AND r#>>'{result,disposition}' NOT IN ('resource-quarantined','paused','restored-quarantined',
      'conflict-quarantined','request-conflict-quarantined','source-conflict-unsealed')) THEN
    RAISE EXCEPTION 'Deposit ordinary commands cannot consume terminal and restore journal capacity'; END IF;
  PERFORM (r#>>'{command,requestId}')::alpha_wallet_deposit_inbox_simulation.identifier;
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE record jsonb; previous jsonb; job jsonb; effect_payload jsonb:=NEW.payload; keys text[]; candidate jsonb; worker jsonb; source_set jsonb;
  transfer jsonb; raw_bytes bigint; read jsonb;
BEGIN
  PERFORM alpha_wallet_deposit_inbox_simulation.require_writer();
  SELECT record_json INTO record FROM alpha_wallet_deposit_inbox_simulation.commands
    WHERE revision=NEW.command_revision AND owner_transaction_id=txid_current()::text
      AND xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296);
  IF record IS NULL OR EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.command_seals WHERE command_revision=NEW.command_revision)
    OR effect_payload->'commandRevision' IS DISTINCT FROM to_jsonb(NEW.command_revision) THEN
    RAISE EXCEPTION 'Deposit projection must accompany its exact unsealed owner command'; END IF;
  CASE TG_TABLE_NAME
    WHEN 'evidence_blobs' THEN keys:=ARRAY['evidenceId','observationSha256','rawBytes','commandRevision','observation'];
    WHEN 'observations' THEN keys:=ARRAY['evidenceId','observationSha256','rawBytes','commandRevision','sourceSetId','assignmentId',
      'nativeEventLocator','eventFactsSha256','transactionKey','transactionFactsSha256'];
    WHEN 'block_anchors' THEN keys:=ARRAY['blockKey','chainKey','number','hash','parentHash','timestampMs','blockSemanticsSha256','evidenceId','commandRevision'];
    WHEN 'transaction_anchors' THEN keys:=ARRAY['transactionKey','chainKey','transactionId','blockNumber','blockHash','transactionIndex',
      'receiptSemanticsSha256','transactionFactsSha256','evidenceId','commandRevision'];
    WHEN 'events' THEN keys:=ARRAY['nativeEventLocator','eventKey','chainKey','token','sender','recipient','amountRaw','eventIndex','assignmentId',
      'assignmentSha256','transactionKey','eventFactsSha256','evidenceId','commandRevision'];
    WHEN 'event_observations' THEN keys:=ARRAY['nativeEventLocator','evidenceId','commandRevision'];
    WHEN 'source_heads' THEN keys:=ARRAY['sourceSetId','chainKey','number','hash','timestampMs','evidenceId','previousRevision','commandRevision'];
    WHEN 'candidate_jobs' THEN keys:=ARRAY['jobId','workerId','manifestSha256','candidateManifestSha256','candidates','commandRevision'];
    WHEN 'candidate_cursors' THEN keys:=ARRAY['jobId','candidateManifestSha256','previousRevision','previousNextOrdinal','nextOrdinal','candidateCount','commandRevision'];
    WHEN 'quarantines' THEN keys:=ARRAY['quarantineId','reason','scope','firstEvidenceId','incomingEvidenceId','incomingFingerprint',
      'originalRequestKey','originalFingerprint','commandRevision'];
    WHEN 'recovery_receipts' THEN keys:=ARRAY['recoveryId','requestId','sourceStoreInstanceId','targetStoreInstanceId','sourceCheckpoint',
      'backupChecksum','targetRevision','commandRevision'];
    ELSE RAISE EXCEPTION 'Unknown deposit effect table';
  END CASE;
  IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(effect_payload,keys) THEN RAISE EXCEPTION 'Deposit effect has missing or extra fields'; END IF;
  IF TG_TABLE_NAME='evidence_blobs' THEN
    IF effect_payload->'observationSha256' IS DISTINCT FROM effect_payload#>'{observation,observationSha256}'
      OR effect_payload->>'observationSha256' IS DISTINCT FROM encode(sha256(convert_to(
        alpha_wallet_deposit_inbox_simulation.observation_body_json(effect_payload->'observation'),'UTF8')),'hex')
      OR effect_payload->'evidenceId' IS DISTINCT FROM record#>'{command,prepared,timedObservation,evidenceId}'
      OR effect_payload->>'evidenceId' IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('admitted-evidence',jsonb_build_array(
        'admitted-observation-v1',record#>>'{command,prepared,manifestSha256}',record#>>'{command,prepared,sourceSetSha256}',
        record#>>'{command,prepared,assignmentSha256}','native-node-observer-v1',effect_payload->>'observationSha256')) THEN
      RAISE EXCEPTION 'Deposit evidence blob does not match its original observation or admitted identity'; END IF;
    raw_bytes:=0;
    FOR read IN SELECT value FROM jsonb_array_elements(effect_payload#>'{observation,reads}') LOOP
      IF jsonb_typeof(read->'requestBody') IS DISTINCT FROM 'string' OR jsonb_typeof(read->'responseBody') IS DISTINCT FROM 'string'
        OR octet_length(read->>'requestBody') NOT BETWEEN 1 AND 1048576 OR octet_length(read->>'responseBody') NOT BETWEEN 1 AND 1048576
        OR read->>'responseSha256' IS DISTINCT FROM encode(sha256(convert_to(read->>'responseBody','UTF8')),'hex') THEN
        RAISE EXCEPTION 'Deposit raw transcript digest or byte bound is invalid'; END IF;
      raw_bytes:=raw_bytes+octet_length(read->>'requestBody')+octet_length(read->>'responseBody');
    END LOOP;
    IF effect_payload->'rawBytes' IS DISTINCT FROM to_jsonb(raw_bytes) THEN RAISE EXCEPTION 'Deposit raw byte accounting is not exact'; END IF;
  END IF;
  IF TG_TABLE_NAME='observations' THEN
    SELECT b.payload INTO previous FROM alpha_wallet_deposit_inbox_simulation.evidence_blobs b WHERE b.evidence_id=effect_payload->>'evidenceId';
    IF previous IS NULL OR previous->'observationSha256' IS DISTINCT FROM effect_payload->'observationSha256'
      OR previous->'rawBytes' IS DISTINCT FROM effect_payload->'rawBytes'
      OR effect_payload->'sourceSetId' IS DISTINCT FROM record#>'{command,prepared,candidate,sourceSetId}'
      OR effect_payload->'assignmentId' IS DISTINCT FROM record#>'{command,prepared,candidate,assignmentId}' THEN
      RAISE EXCEPTION 'Deposit observation does not bind its exact full evidence and admitted candidate'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('block_anchors','transaction_anchors','source_heads') THEN
    IF jsonb_typeof(effect_payload->CASE WHEN TG_TABLE_NAME='transaction_anchors' THEN 'blockNumber' ELSE 'number' END) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Deposit native heights must remain decimal strings'; END IF;
    PERFORM (effect_payload->>CASE WHEN TG_TABLE_NAME='transaction_anchors' THEN 'blockNumber' ELSE 'number' END)::alpha_wallet_deposit_inbox_simulation.uint64;
  END IF;
  IF TG_TABLE_NAME='transaction_anchors' THEN PERFORM (effect_payload->>'transactionIndex')::alpha_wallet_deposit_inbox_simulation.uint64; END IF;
  IF TG_TABLE_NAME='events' THEN
    IF jsonb_typeof(effect_payload->'amountRaw') IS DISTINCT FROM 'string' OR jsonb_typeof(effect_payload->'eventIndex') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Deposit amount and native index must remain decimal strings'; END IF;
    PERFORM (effect_payload->>'amountRaw')::alpha_wallet_deposit_inbox_simulation.uint256_positive;
    PERFORM (effect_payload->>'eventIndex')::alpha_wallet_deposit_inbox_simulation.uint64;
    SELECT a.payload INTO previous FROM alpha_wallet_deposit_inbox_simulation.admission_records a
      WHERE a.kind='assignments' AND a.record_id=effect_payload->>'assignmentId' AND a.record_sha256=effect_payload->>'assignmentSha256';
    SELECT a.payload INTO job FROM alpha_wallet_deposit_inbox_simulation.admission_records a
      WHERE a.kind='assets' AND a.record_id=previous->>'assetRef';
    IF previous IS NULL OR job IS NULL OR previous->>'recipient' IS DISTINCT FROM effect_payload->>'recipient'
      OR job->>'token' IS DISTINCT FROM effect_payload->>'token' OR job->>'chainKey' IS DISTINCT FROM effect_payload->>'chainKey' THEN
      RAISE EXCEPTION 'Deposit event attribution must match immutable assignment and native asset'; END IF;
  END IF;
  IF TG_TABLE_NAME='source_heads' THEN
    SELECT a.payload INTO source_set FROM alpha_wallet_deposit_inbox_simulation.admission_records a WHERE a.kind='sourceSets' AND a.record_id=effect_payload->>'sourceSetId';
    SELECT b.payload->'observation'->'transfer' INTO transfer FROM alpha_wallet_deposit_inbox_simulation.evidence_blobs b WHERE b.evidence_id=effect_payload->>'evidenceId';
    IF source_set IS NULL OR source_set->'chainKey' IS DISTINCT FROM effect_payload->'chainKey'
      OR effect_payload->'sourceSetId' IS DISTINCT FROM record#>'{command,prepared,candidate,sourceSetId}'
      OR effect_payload->'number' IS DISTINCT FROM transfer->'checkpointNumber' OR effect_payload->'hash' IS DISTINCT FROM transfer->'checkpointHash' THEN
      RAISE EXCEPTION 'Deposit source head is outside the admitted observation checkpoint'; END IF;
    SELECT s.payload INTO previous FROM alpha_wallet_deposit_inbox_simulation.source_heads s
      WHERE s.source_set_id=effect_payload->>'sourceSetId' ORDER BY command_revision DESC LIMIT 1;
    IF record#>>'{result,disposition}' NOT IN ('recorded','duplicate-evidence','corroborating-observation')
      OR (previous IS NULL AND effect_payload->'previousRevision' IS DISTINCT FROM 'null'::jsonb)
      OR (previous IS NOT NULL AND (effect_payload->'previousRevision' IS DISTINCT FROM previous->'commandRevision'
        OR (effect_payload->>'number')::numeric<(previous->>'number')::numeric
        OR ((effect_payload->>'number')::numeric=(previous->>'number')::numeric
          AND (effect_payload->>'hash' IS DISTINCT FROM previous->>'hash' OR effect_payload->'timestampMs' IS DISTINCT FROM previous->'timestampMs')))) THEN
      RAISE EXCEPTION 'Deposit source head must extend its exact nonregressing previous version'; END IF;
  END IF;
  IF TG_TABLE_NAME='candidate_jobs' THEN
    SELECT a.payload INTO worker FROM alpha_wallet_deposit_inbox_simulation.admission_records a WHERE a.kind='workers' AND a.record_id=effect_payload->>'workerId';
    IF worker IS NULL OR effect_payload->'workerId' IS DISTINCT FROM record->'workerId'
      OR effect_payload->'manifestSha256' IS DISTINCT FROM (SELECT to_jsonb(manifest_sha256::text) FROM alpha_wallet_deposit_inbox_simulation.head WHERE singleton)
      OR effect_payload->'jobId' IS DISTINCT FROM record#>'{command,jobId}' OR effect_payload->'candidates' IS DISTINCT FROM record#>'{command,orderedCandidates}'
      OR jsonb_typeof(effect_payload->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(effect_payload->'candidates') NOT BETWEEN 1 AND 256
      OR effect_payload->>'candidateManifestSha256' IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('candidate-job',
        jsonb_build_object('manifestSha256',effect_payload->'manifestSha256','workerId',effect_payload->'workerId','jobId',effect_payload->'jobId','candidates',effect_payload->'candidates')) THEN
      RAISE EXCEPTION 'Deposit candidate job lacks its exact worker, candidates and content commitment'; END IF;
    FOR candidate IN SELECT value FROM jsonb_array_elements(effect_payload->'candidates') LOOP
      IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(candidate,ARRAY['assignmentId','sourceSetId','transactionId','eventIndex','amountRaw'])
        OR NOT (worker->'assignmentIds' ? (candidate->>'assignmentId')) OR NOT (worker->'sourceSetIds' ? (candidate->>'sourceSetId'))
        OR jsonb_typeof(candidate->'amountRaw') IS DISTINCT FROM 'string' OR jsonb_typeof(candidate->'eventIndex') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Deposit candidate is outside its admitted worker scope'; END IF;
      PERFORM (candidate->>'amountRaw')::alpha_wallet_deposit_inbox_simulation.uint256_positive;
      PERFORM (candidate->>'eventIndex')::alpha_wallet_deposit_inbox_simulation.uint64;
      SELECT a.payload INTO previous FROM alpha_wallet_deposit_inbox_simulation.admission_records a WHERE a.kind='assignments' AND a.record_id=candidate->>'assignmentId';
      SELECT a.payload INTO job FROM alpha_wallet_deposit_inbox_simulation.admission_records a WHERE a.kind='assets' AND a.record_id=previous->>'assetRef';
      SELECT a.payload INTO source_set FROM alpha_wallet_deposit_inbox_simulation.admission_records a WHERE a.kind='sourceSets' AND a.record_id=candidate->>'sourceSetId';
      IF job IS NULL OR source_set IS NULL OR source_set->'chainKey' IS DISTINCT FROM job->'chainKey'
        OR jsonb_typeof(candidate->'transactionId') IS DISTINCT FROM 'string'
        OR (candidate->>'transactionId') !~ (CASE WHEN job->>'chainKey' LIKE 'bsc:%' THEN '^0x[0-9a-f]{64}$' ELSE '^[0-9a-f]{64}$' END) THEN
        RAISE EXCEPTION 'Deposit candidate native asset and source chain differ'; END IF;
    END LOOP;
  END IF;
  IF TG_TABLE_NAME='candidate_cursors' THEN
    SELECT c.payload INTO previous FROM alpha_wallet_deposit_inbox_simulation.candidate_cursors c
      WHERE c.job_id=effect_payload->>'jobId' ORDER BY command_revision DESC LIMIT 1;
    SELECT j.payload INTO job FROM alpha_wallet_deposit_inbox_simulation.candidate_jobs j WHERE j.job_id=effect_payload->>'jobId';
    IF job IS NULL OR effect_payload->'candidateManifestSha256' IS DISTINCT FROM job->'candidateManifestSha256'
      OR effect_payload->>'candidateCount' IS DISTINCT FROM jsonb_array_length(job->'candidates')::text
      OR effect_payload->>'nextOrdinal' !~ '^(0|[1-9][0-9]*)$'
      OR (effect_payload->>'nextOrdinal')::numeric>(effect_payload->>'candidateCount')::numeric THEN
      RAISE EXCEPTION 'Deposit candidate cursor does not bind its immutable finite job'; END IF;
    IF previous IS NULL THEN
      IF record#>>'{result,disposition}' IS DISTINCT FROM 'job-registered' OR effect_payload->'previousRevision' IS DISTINCT FROM 'null'::jsonb
        OR effect_payload->'previousNextOrdinal' IS DISTINCT FROM 'null'::jsonb OR effect_payload->>'nextOrdinal' IS DISTINCT FROM '0'
        OR job->>'commandRevision' IS DISTINCT FROM NEW.command_revision::text THEN RAISE EXCEPTION 'Deposit job must begin at ordinal zero'; END IF;
    ELSE
      IF record#>>'{result,disposition}' NOT IN ('recorded','duplicate-evidence','corroborating-observation')
        OR effect_payload->'previousRevision' IS DISTINCT FROM previous->'commandRevision'
        OR effect_payload->'previousNextOrdinal' IS DISTINCT FROM previous->'nextOrdinal'
        OR (effect_payload->>'nextOrdinal')::numeric IS DISTINCT FROM (previous->>'nextOrdinal')::numeric+1
        OR record#>'{command,candidateCursor,expectedCursorRevision}' IS DISTINCT FROM previous->'commandRevision'
        OR record#>'{command,candidateCursor,expectedNextOrdinal}' IS DISTINCT FROM previous->'nextOrdinal'
        OR record#>'{command,candidateCursor,candidateManifestSha256}' IS DISTINCT FROM job->'candidateManifestSha256'
        OR record#>'{command,candidateCursor,jobId}' IS DISTINCT FROM job->'jobId'
        OR record#>'{command,prepared,candidate}' IS DISTINCT FROM job->'candidates'->((previous->>'nextOrdinal')::integer) THEN
        RAISE EXCEPTION 'Deposit candidate advance requires exact one-ordinal compare and swap'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.assert_command(target_revision integer) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE h alpha_wallet_deposit_inbox_simulation.head%ROWTYPE; m jsonb; last_record jsonb; item record;
  table_name text; effect_name text; actual jsonb; expected jsonb; command_row record; disposition text; cursor jsonb;
  tables text[]:=ARRAY['evidence_blobs','observations','block_anchors','transaction_anchors','events','event_observations','source_heads','candidate_jobs','candidate_cursors','quarantines','recovery_receipts'];
  effects text[]:=ARRAY['evidenceBlobs','observations','blockAnchors','transactionAnchors','events','eventObservations','sourceHeads','candidateJobs','candidateCursors','quarantines','recoveryReceipts'];
  n integer; total_bytes numeric; full_command jsonb; blob jsonb; command_keys text[]; original_key text; original_fingerprint text;
  bound_candidate jsonb; actor jsonb;
BEGIN
  SELECT * INTO h FROM alpha_wallet_deposit_inbox_simulation.head WHERE singleton;
  SELECT * INTO command_row FROM alpha_wallet_deposit_inbox_simulation.commands WHERE revision=target_revision;
  IF command_row.revision IS NULL THEN RAISE EXCEPTION 'Deposit command cannot be sealed before it exists'; END IF;
  full_command:=command_row.record_json->'command'; disposition:=command_row.record_json#>>'{result,disposition}';
  CASE full_command->>'type'
    WHEN 'register-candidate-job' THEN command_keys:=ARRAY['type','requestId','jobId','orderedCandidates'];
      IF disposition NOT IN ('job-registered','request-conflict-quarantined') THEN RAISE EXCEPTION 'Deposit job command has an unrelated outcome'; END IF;
    WHEN 'record-observation' THEN command_keys:=ARRAY['type','requestId','prepared','candidateCursor'];
      IF disposition NOT IN ('recorded','duplicate-evidence','corroborating-observation','stale-preparation-held','continuity-unproved-held',
        'conflict-quarantined','request-conflict-quarantined') THEN RAISE EXCEPTION 'Deposit observation command has an unrelated outcome'; END IF;
    WHEN 'record-attempt-hold' THEN command_keys:=ARRAY['type','requestId','attempt','candidateCursor'];
      IF disposition NOT IN ('attempt-held','source-conflict-unsealed','request-conflict-quarantined') THEN RAISE EXCEPTION 'Deposit failure command has an unrelated outcome'; END IF;
    WHEN 'pause' THEN command_keys:=ARRAY['type','requestId','reason'];
      IF disposition NOT IN ('paused','request-conflict-quarantined') OR command_row.record_json->>'actorRole' IS DISTINCT FROM 'operator' THEN
        RAISE EXCEPTION 'Deposit pause requires its exact operator outcome'; END IF;
    WHEN 'resource-quarantine' THEN command_keys:=ARRAY['type','requestId','rejectedRequestKey','rejectedFingerprint','scope','originalFingerprint'];
      IF disposition IS DISTINCT FROM 'resource-quarantined' OR full_command->>'rejectedFingerprint' IS DISTINCT FROM command_row.input_fingerprint THEN
        RAISE EXCEPTION 'Deposit resource refusal must retain the incoming request commitment'; END IF;
    WHEN 'restore-quarantine' THEN command_keys:=ARRAY['type','requestId','sourceStoreInstanceId','targetStoreInstanceId','sourceCheckpoint','backupChecksum'];
      IF disposition IS DISTINCT FROM 'restored-quarantined' OR command_row.record_json->>'actorRole' IS DISTINCT FROM 'restore'
        OR command_row.input_fingerprint IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('inbox-restore-input',full_command)
        OR command_row.request_key IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.canonical_json(jsonb_build_array(
          'deposit-inbox-restore-v1',h.inbox_id,full_command->>'targetStoreInstanceId',full_command->>'requestId')) THEN
        RAISE EXCEPTION 'Deposit restore command identity or outcome is invalid'; END IF;
    ELSE RAISE EXCEPTION 'Deposit command type is unsupported';
  END CASE;
  IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(full_command,command_keys) THEN RAISE EXCEPTION 'Deposit command has missing or extra fields'; END IF;
  IF full_command->>'type'<>'restore-quarantine' THEN
    SELECT payload INTO actor FROM alpha_wallet_deposit_inbox_simulation.admission_records
      WHERE kind='workers' AND record_id=command_row.record_json->>'workerId';
    IF actor IS NULL OR command_row.record_json->>'actorRole' NOT IN ('worker','operator') THEN RAISE EXCEPTION 'Deposit command actor is not admitted'; END IF;
    original_key:=alpha_wallet_deposit_inbox_simulation.canonical_json(jsonb_build_array('deposit-inbox-request-v1',h.inbox_id,
      command_row.record_json->>'workerId',full_command->>'requestId'));
    SELECT input_fingerprint INTO original_fingerprint FROM alpha_wallet_deposit_inbox_simulation.commands
      WHERE request_key=original_key AND revision<command_row.revision;
    IF command_row.request_key IS DISTINCT FROM (CASE WHEN original_fingerprint IS NOT NULL AND original_fingerprint<>command_row.input_fingerprint
      THEN alpha_wallet_deposit_inbox_simulation.canonical_json(jsonb_build_array('deposit-inbox-fault-v1',original_key,original_fingerprint,command_row.input_fingerprint))
      ELSE original_key END) THEN RAISE EXCEPTION 'Deposit request or deterministic fault identity differs'; END IF;
    IF full_command->>'type'='record-observation' THEN
      bound_candidate:=full_command#>'{prepared,candidate}';
      SELECT payload INTO blob FROM alpha_wallet_deposit_inbox_simulation.evidence_blobs WHERE evidence_id=full_command#>>'{prepared,timedObservation,evidenceId}';
      IF blob IS NULL THEN RAISE EXCEPTION 'Deposit compact observation lacks its full immutable blob'; END IF;
      full_command:=jsonb_set(full_command,'{prepared,timedObservation}',((full_command#>'{prepared,timedObservation}')-'evidenceId')
        ||jsonb_build_object('observation',blob->'observation'));
    ELSIF full_command->>'type'='record-attempt-hold' THEN bound_candidate:=full_command#>'{attempt,candidate}'; END IF;
    IF bound_candidate IS NOT NULL AND (NOT coalesce(actor->'assignmentIds' ? (bound_candidate->>'assignmentId'),false)
      OR NOT coalesce(actor->'sourceSetIds' ? (bound_candidate->>'sourceSetId'),false)) THEN
      RAISE EXCEPTION 'Deposit observation or attempt exceeds its immutable worker scope'; END IF;
    IF full_command->>'type'<>'resource-quarantine' AND command_row.input_fingerprint IS DISTINCT FROM
      alpha_wallet_deposit_inbox_simulation.value_digest('inbox-command-input',jsonb_build_object('profile','development-deposit-inbox-v1',
        'manifestSha256',h.manifest_sha256,'workerId',command_row.record_json->>'workerId','command',full_command)) THEN
      RAISE EXCEPTION 'Deposit command input fingerprint does not match its reconstructed immutable input'; END IF;
  END IF;
    FOR n IN 1..array_length(tables,1) LOOP
      table_name:=tables[n]; effect_name:=effects[n];
      EXECUTE format('SELECT coalesce(jsonb_agg(%s ORDER BY ordinal),''[]''::jsonb) FROM alpha_wallet_deposit_inbox_simulation.%I WHERE command_revision=$1',
        CASE WHEN table_name='evidence_blobs' THEN '(payload-''observation'')' ELSE 'payload' END,table_name) INTO actual USING command_row.revision;
      expected:=command_row.record_json->'effects'->effect_name;
      IF jsonb_typeof(expected) IS DISTINCT FROM 'array' OR actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'Deposit command has incomplete exact % effects',table_name; END IF;
    END LOOP;
    disposition:=command_row.record_json#>>'{result,disposition}';
    expected:=command_row.record_json->'effects'; cursor:=command_row.record_json#>'{command,candidateCursor}';
    IF disposition='job-registered' THEN
      IF jsonb_array_length(expected->'candidateJobs') IS DISTINCT FROM 1 OR jsonb_array_length(expected->'candidateCursors') IS DISTINCT FROM 1
        OR command_row.record_json#>>'{command,type}' IS DISTINCT FROM 'register-candidate-job' THEN RAISE EXCEPTION 'Deposit job registration lacks complete effects'; END IF;
    ELSIF jsonb_array_length(expected->'candidateJobs') IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Unrelated deposit command cannot register a job'; END IF;
    IF disposition IN ('recorded','duplicate-evidence','corroborating-observation') THEN
      IF command_row.record_json#>>'{command,type}' IS DISTINCT FROM 'record-observation'
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.observations WHERE evidence_id=command_row.record_json#>>'{result,evidenceId}')
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.events WHERE native_event_locator=command_row.record_json#>>'{result,nativeEventLocator}')
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.event_observations
          WHERE native_event_locator=command_row.record_json#>>'{result,nativeEventLocator}' AND evidence_id=command_row.record_json#>>'{result,evidenceId}')
        OR jsonb_array_length(expected->'candidateCursors') IS DISTINCT FROM (CASE WHEN cursor IS NULL OR cursor='null'::jsonb THEN 0 ELSE 1 END)
        OR jsonb_array_length(expected->'quarantines') IS DISTINCT FROM 0
        OR (disposition='recorded' AND jsonb_array_length(expected->'events') IS DISTINCT FROM 1)
        OR (disposition IS DISTINCT FROM 'recorded' AND jsonb_array_length(expected->'events') IS DISTINCT FROM 0) THEN RAISE EXCEPTION 'Accepted deposit observation lacks complete immutable facts or progress'; END IF;
    ELSIF disposition IS DISTINCT FROM 'job-registered' AND jsonb_array_length(expected->'candidateCursors') IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Held, paused or quarantined deposit commands cannot advance candidates';
    END IF;
    IF disposition IN ('conflict-quarantined','request-conflict-quarantined','source-conflict-unsealed','resource-quarantined','restored-quarantined') THEN
      IF jsonb_array_length(expected->'quarantines') IS DISTINCT FROM 1 OR h.state_json->>'status' IS DISTINCT FROM 'quarantined'
        OR command_row.record_json#>'{result,quarantineId}' IS DISTINCT FROM expected#>'{quarantines,0,quarantineId}' THEN
        RAISE EXCEPTION 'Deposit contradiction must commit its exact absorbing quarantine'; END IF;
    ELSIF jsonb_array_length(expected->'quarantines') IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Unrelated deposit command cannot add quarantine'; END IF;
    IF disposition='paused' AND h.state_json->>'status' NOT IN ('paused','quarantined') THEN RAISE EXCEPTION 'Deposit pause is terminal'; END IF;
    IF disposition NOT IN ('recorded','duplicate-evidence','corroborating-observation')
      AND (jsonb_array_length(expected->'sourceHeads') IS DISTINCT FROM 0 OR jsonb_array_length(expected->'events') IS DISTINCT FROM 0
        OR jsonb_array_length(expected->'transactionAnchors') IS DISTINCT FROM 0 OR jsonb_array_length(expected->'blockAnchors') IS DISTINCT FROM 0
        OR jsonb_array_length(expected->'eventObservations') IS DISTINCT FROM 0) THEN RAISE EXCEPTION 'Unaccepted evidence cannot change accepted facts or source heads'; END IF;
    IF disposition='restored-quarantined' THEN
      IF jsonb_array_length(expected->'recoveryReceipts') IS DISTINCT FROM 1 OR command_row.record_json#>>'{command,type}' IS DISTINCT FROM 'restore-quarantine' THEN
        RAISE EXCEPTION 'Deposit restore lacks its exact complete recovery receipt'; END IF;
    ELSIF jsonb_array_length(expected->'recoveryReceipts') IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Only a restore can add a recovery receipt'; END IF;
    IF jsonb_array_length(expected->'candidateCursors')=0 THEN
      IF command_row.record_json#>'{result,cursorBefore}' IS DISTINCT FROM command_row.record_json#>'{result,cursorAfter}' THEN
        RAISE EXCEPTION 'Deposit receipt cannot claim unstored progress'; END IF;
    ELSE
      IF command_row.record_json#>'{result,cursorAfter}' IS DISTINCT FROM expected#>'{candidateCursors,0}' THEN
        RAISE EXCEPTION 'Deposit receipt cursor differs from its stored effect'; END IF;
    END IF;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_seal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_deposit_inbox_simulation.require_writer();
  IF NEW.owner_transaction_id IS DISTINCT FROM txid_current()::text OR NOT EXISTS (
    SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.commands WHERE revision=NEW.command_revision
      AND owner_transaction_id=txid_current()::text AND xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
    RAISE EXCEPTION 'Deposit command seal requires its original physical writer'; END IF;
  PERFORM alpha_wallet_deposit_inbox_simulation.assert_command(NEW.command_revision);
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.assert_coherence() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE h alpha_wallet_deposit_inbox_simulation.head%ROWTYPE; m jsonb; last_record jsonb; item record;
  table_name text; effect_name text; actual jsonb; expected jsonb; command_row record; disposition text; cursor jsonb;
  tables text[]:=ARRAY['evidence_blobs','observations','block_anchors','transaction_anchors','events','event_observations','source_heads','candidate_jobs','candidate_cursors','quarantines','recovery_receipts'];
  effects text[]:=ARRAY['evidenceBlobs','observations','blockAnchors','transactionAnchors','events','eventObservations','sourceHeads','candidateJobs','candidateCursors','quarantines','recoveryReceipts'];
  n integer; total_bytes numeric; admitted record; commitment text; binding jsonb; source_bindings jsonb; assignment_bindings jsonb;
BEGIN
  PERFORM alpha_wallet_deposit_inbox_simulation.require_runtime();
  SELECT * INTO h FROM alpha_wallet_deposit_inbox_simulation.head WHERE singleton;
  SELECT manifest INTO m FROM alpha_wallet_deposit_inbox_simulation.admission WHERE singleton;
  IF NOT alpha_wallet_deposit_inbox_simulation.closed_object(m,ARRAY['kind','formatVersion','mode','creditAuthority','inboxId',
      'chains','assets','sources','sourceSets','assignments','workers'])
    OR NOT alpha_wallet_deposit_inbox_simulation.closed_object(h.bootstrap,ARRAY['kind','formatVersion','mode','creditAuthority',
      'inboxId','storeInstanceId','manifestSha256','requestId','atMs','bootstrapSha256'])
    OR NOT alpha_wallet_deposit_inbox_simulation.closed_object(h.state_json,ARRAY['kind','formatVersion','mode','creditAuthority','profile',
      'inboxId','manifestSha256','originStoreInstanceId','storeInstanceId','status','haltReason','lastCommandAtMs','rawEvidenceBytes',
      'observations','blockAnchors','transactionAnchors','events','eventObservations','sourceHeads','candidateJobs','candidateCursors','quarantines','recoveryReceipts'])
    OR h.bootstrap->>'kind' IS DISTINCT FROM 'development-deposit-inbox-bootstrap' OR h.bootstrap->'formatVersion' IS DISTINCT FROM '1'::jsonb
    OR h.state_json->>'kind' IS DISTINCT FROM 'development-deposit-inbox-state' OR h.state_json->'formatVersion' IS DISTINCT FROM '1'::jsonb
    OR coalesce(h.state_json->>'status','') NOT IN ('recording','paused','quarantined')
    OR h.manifest_sha256 IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('manifest',m)
    OR h.bootstrap->>'bootstrapSha256' IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('inbox-bootstrap',h.bootstrap-'bootstrapSha256')
    OR h.genesis_event_hash IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('inbox-genesis',h.bootstrap)
    OR h.state_hash IS DISTINCT FROM alpha_wallet_deposit_inbox_simulation.value_digest('inbox-state',h.state_json) THEN
    RAISE EXCEPTION 'Deposit bootstrap, manifest or current state commitment is invalid'; END IF;
  IF h.singleton IS NULL OR m IS NULL OR m->>'kind' IS DISTINCT FROM 'development-deposit-inbox-manifest'
    OR m->>'formatVersion' IS DISTINCT FROM '1' OR m->>'mode' IS DISTINCT FROM 'simulation-only' OR m->'creditAuthority' IS DISTINCT FROM 'false'::jsonb
    OR m->>'inboxId' IS DISTINCT FROM h.inbox_id OR h.bootstrap->>'inboxId' IS DISTINCT FROM h.inbox_id
    OR h.bootstrap->>'manifestSha256' IS DISTINCT FROM h.manifest_sha256 OR h.bootstrap->>'mode' IS DISTINCT FROM 'simulation-only'
    OR h.bootstrap->'creditAuthority' IS DISTINCT FROM 'false'::jsonb OR h.state_json->>'inboxId' IS DISTINCT FROM h.inbox_id
    OR h.state_json->>'manifestSha256' IS DISTINCT FROM h.manifest_sha256 OR h.state_json->>'mode' IS DISTINCT FROM 'simulation-only'
    OR h.state_json->'creditAuthority' IS DISTINCT FROM 'false'::jsonb OR h.state_json->>'storeInstanceId' IS DISTINCT FROM h.physical_store_instance_id
    OR h.state_json->>'originStoreInstanceId' IS DISTINCT FROM h.bootstrap->>'storeInstanceId'
    OR h.state_json->>'profile' IS DISTINCT FROM 'development-deposit-inbox-v1' THEN RAISE EXCEPTION 'Deposit immutable admission or physical store binding is incomplete'; END IF;
  FOR item IN SELECT * FROM (VALUES ('chains','chainKey',2),('assets','assetRef',4),('sources','sourceId',8),
    ('sourceSets','sourceSetId',4),('assignments','assignmentId',64),('workers','workerId',16)) AS kinds(name,id_field,maximum) LOOP
    SELECT coalesce(jsonb_agg(payload ORDER BY record_id COLLATE "C"),'[]'::jsonb) INTO actual
      FROM alpha_wallet_deposit_inbox_simulation.admission_records WHERE kind=item.name;
    IF jsonb_typeof(m->item.name) IS DISTINCT FROM 'array' OR jsonb_array_length(m->item.name)<1
      OR jsonb_array_length(m->item.name)>item.maximum OR actual IS DISTINCT FROM m->item.name
      OR EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.admission_records
        WHERE kind=item.name AND record_id IS DISTINCT FROM payload->>item.id_field) THEN
      RAISE EXCEPTION 'Deposit normalized admission records are incomplete'; END IF;
    FOR admitted IN SELECT * FROM alpha_wallet_deposit_inbox_simulation.admission_records WHERE kind=item.name LOOP
      CASE item.name
        WHEN 'chains' THEN commitment:=alpha_wallet_deposit_inbox_simulation.value_digest('chain',admitted.payload);
        WHEN 'assets' THEN
          SELECT to_jsonb(record_sha256::text) INTO binding FROM alpha_wallet_deposit_inbox_simulation.admission_records
            WHERE kind='chains' AND record_id=admitted.payload->>'chainKey';
          commitment:=alpha_wallet_deposit_inbox_simulation.value_digest('asset',jsonb_build_object('asset',admitted.payload,'chainSha256',binding));
        WHEN 'sources' THEN commitment:=alpha_wallet_deposit_inbox_simulation.value_digest('source',admitted.payload);
        WHEN 'sourceSets' THEN
          SELECT jsonb_build_object('sourceSet',admitted.payload,'chainSha256',chain.record_sha256,
            'executionSourceSha256',execution.record_sha256,'finalitySourceSha256',finality.record_sha256) INTO binding
            FROM alpha_wallet_deposit_inbox_simulation.admission_records chain,
              alpha_wallet_deposit_inbox_simulation.admission_records execution,alpha_wallet_deposit_inbox_simulation.admission_records finality
            WHERE chain.kind='chains' AND chain.record_id=admitted.payload->>'chainKey'
              AND execution.kind='sources' AND execution.record_id=admitted.payload->>'executionSourceId'
              AND finality.kind='sources' AND finality.record_id=admitted.payload->>'finalitySourceId';
          commitment:=alpha_wallet_deposit_inbox_simulation.value_digest('source-set',binding);
        WHEN 'assignments' THEN
          SELECT to_jsonb(record_sha256::text) INTO binding FROM alpha_wallet_deposit_inbox_simulation.admission_records
            WHERE kind='assets' AND record_id=admitted.payload->>'assetRef';
          commitment:=alpha_wallet_deposit_inbox_simulation.value_digest('assignment',jsonb_build_object('assignment',admitted.payload,'assetSha256',binding));
        WHEN 'workers' THEN
          SELECT jsonb_agg(jsonb_build_object('sourceSetId',source_id,'sourceSetSha256',record_sha256) ORDER BY ordinal) INTO source_bindings
            FROM jsonb_array_elements_text(admitted.payload->'sourceSetIds') WITH ORDINALITY AS sources(source_id,ordinal)
            JOIN alpha_wallet_deposit_inbox_simulation.admission_records ON kind='sourceSets' AND record_id=source_id;
          SELECT jsonb_agg(jsonb_build_object('assignmentId',assignment_id,'assignmentSha256',record_sha256) ORDER BY ordinal) INTO assignment_bindings
            FROM jsonb_array_elements_text(admitted.payload->'assignmentIds') WITH ORDINALITY AS assignments(assignment_id,ordinal)
            JOIN alpha_wallet_deposit_inbox_simulation.admission_records ON kind='assignments' AND record_id=assignment_id;
          commitment:=alpha_wallet_deposit_inbox_simulation.value_digest('worker',jsonb_build_object('worker',admitted.payload,
            'sourceSets',source_bindings,'assignments',assignment_bindings));
      END CASE;
      IF admitted.record_sha256 IS DISTINCT FROM commitment THEN RAISE EXCEPTION 'Deposit normalized admission commitment differs from its immutable manifest'; END IF;
    END LOOP;
  END LOOP;
  SELECT record_json INTO last_record FROM alpha_wallet_deposit_inbox_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.commands) IS DISTINCT FROM h.revision
    OR (h.revision=0 AND h.event_hash IS DISTINCT FROM h.genesis_event_hash)
    OR (h.revision>0 AND (last_record->>'revision' IS DISTINCT FROM h.revision::text OR last_record->>'eventHash' IS DISTINCT FROM h.event_hash
      OR last_record->>'stateHash' IS DISTINCT FROM h.state_hash OR last_record->>'atMs' IS DISTINCT FROM h.state_json->>'lastCommandAtMs')) THEN
    RAISE EXCEPTION 'Deposit command history and head are incomplete'; END IF;
  FOR n IN 1..array_length(tables,1) LOOP
    table_name:=tables[n]; effect_name:=effects[n];
    IF table_name IS DISTINCT FROM 'evidence_blobs' THEN
      EXECUTE format('SELECT coalesce(jsonb_agg(payload ORDER BY command_revision,ordinal),''[]''::jsonb) FROM alpha_wallet_deposit_inbox_simulation.%I',table_name) INTO actual;
      IF actual IS DISTINCT FROM h.state_json->effect_name THEN RAISE EXCEPTION 'Deposit head projection % is incomplete',table_name; END IF;
    END IF;
  END LOOP;
  FOR command_row IN SELECT c.* FROM alpha_wallet_deposit_inbox_simulation.commands c
    WHERE c.owner_transaction_id=txid_current()::text AND NOT EXISTS
      (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.command_seals s WHERE s.command_revision=c.revision)
    ORDER BY c.revision LOOP
    PERFORM alpha_wallet_deposit_inbox_simulation.assert_command(command_row.revision);
    INSERT INTO alpha_wallet_deposit_inbox_simulation.command_seals(command_revision,owner_transaction_id)
      VALUES(command_row.revision,txid_current()::text) ON CONFLICT (command_revision) DO NOTHING;
  END LOOP;
  SELECT coalesce(sum((payload->>'rawBytes')::numeric),0) INTO total_bytes FROM alpha_wallet_deposit_inbox_simulation.evidence_blobs;
  IF total_bytes>16777216 OR total_bytes IS DISTINCT FROM coalesce((h.state_json->>'rawEvidenceBytes')::numeric,-1)
    OR (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.evidence_blobs)>256
    OR (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.observations)>256
    OR (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.block_anchors)>4096
    OR (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.transaction_anchors)>256
    OR (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.events)>256
    OR (SELECT count(*) FROM alpha_wallet_deposit_inbox_simulation.candidate_jobs)>16 THEN RAISE EXCEPTION 'Deposit evidence exceeded its finite recoverable bounds'; END IF;
  IF h.installation_kind='restore' AND (NOT h.restore_completed
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_deposit_inbox_simulation.recovery_receipts rr
      JOIN alpha_wallet_deposit_inbox_simulation.commands c ON c.revision=rr.command_revision
      WHERE rr.target_store_instance_id=h.physical_store_instance_id AND rr.command_revision=h.imported_revision+1
        AND rr.payload->>'targetRevision'=rr.command_revision::text AND c.record_json#>>'{result,disposition}'='restored-quarantined'
        AND rr.payload->'backupChecksum'=c.record_json#>'{command,backupChecksum}'
        AND rr.payload->'requestId'=c.record_json#>'{command,requestId}'
        AND rr.payload->'sourceStoreInstanceId'=c.record_json#>'{command,sourceStoreInstanceId}'
        AND rr.payload->'sourceCheckpoint'=c.record_json#>'{command,sourceCheckpoint}')) THEN
    RAISE EXCEPTION 'Fresh restored deposit inbox cannot commit without complete target quarantine and recovery receipt'; END IF;
END;
$fn$;
CREATE FUNCTION alpha_wallet_deposit_inbox_simulation.check_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN PERFORM alpha_wallet_deposit_inbox_simulation.assert_coherence(); RETURN NULL; END;
$fn$;

CREATE TRIGGER immutable_head_identity BEFORE UPDATE ON alpha_wallet_deposit_inbox_simulation.head
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_head();
CREATE TRIGGER no_head_removal BEFORE DELETE OR TRUNCATE ON alpha_wallet_deposit_inbox_simulation.head
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.reject_change();
CREATE TRIGGER exact_command_owner BEFORE INSERT ON alpha_wallet_deposit_inbox_simulation.commands
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_command();
CREATE TRIGGER exact_seal_owner BEFORE INSERT ON alpha_wallet_deposit_inbox_simulation.command_seals
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_seal();
DO $triggers$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['admission','admission_records','commands','command_seals','evidence_blobs','observations','block_anchors','transaction_anchors',
    'events','event_observations','source_heads','candidate_jobs','candidate_cursors','quarantines','recovery_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_deposit_inbox_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.reject_change()',name);
    IF name NOT IN ('admission','admission_records','commands','command_seals') THEN
      EXECUTE format('CREATE TRIGGER exact_projection_owner BEFORE INSERT ON alpha_wallet_deposit_inbox_simulation.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.guard_projection()',name);
    END IF;
    IF name IS DISTINCT FROM 'command_seals' THEN
      EXECUTE format('CREATE CONSTRAINT TRIGGER complete_deposit_command AFTER INSERT ON alpha_wallet_deposit_inbox_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.check_deferred()',name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['head','admission','admission_records','commands','command_seals','evidence_blobs','observations','block_anchors','transaction_anchors',
    'events','event_observations','source_heads','candidate_jobs','candidate_cursors','quarantines','recovery_receipts'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_deposit_inbox_simulation.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE alpha_wallet_deposit_inbox_simulation.%I FORCE ROW LEVEL SECURITY',name);
  END LOOP;
END;
$triggers$;
CREATE CONSTRAINT TRIGGER complete_deposit_head AFTER INSERT OR UPDATE ON alpha_wallet_deposit_inbox_simulation.head
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_deposit_inbox_simulation.check_deferred();
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_deposit_inbox_simulation FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA alpha_wallet_deposit_inbox_simulation FROM PUBLIC;
