-- Isolated synthetic fiat evidence retention. No wallet or marketplace authority.
DO $guard$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT','Etc/GMT','Etc/GMT0') THEN
    RAISE EXCEPTION 'Fiat journal requires explicit writable SERIALIZABLE simulation in UTC';
  END IF;
END;
$guard$;

CREATE SCHEMA alpha_wallet_trusted_payment_journal_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_trusted_payment_journal_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_trusted_payment_journal_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_trusted_payment_journal_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE DOMAIN alpha_wallet_trusted_payment_journal_simulation.identifier AS text
  CHECK (VALUE ~ '^[A-Za-z0-9_-]{1,80}$' AND VALUE NOT IN ('constructor','prototype','__proto__'));
CREATE DOMAIN alpha_wallet_trusted_payment_journal_simulation.sha256 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');

CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.utf16_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(string_agg(CASE WHEN ascii(ch)>65535 THEN
    lpad(to_hex(55296+(ascii(ch)-65536)/1024),4,'0')||lpad(to_hex(56320+(ascii(ch)-65536)%1024),4,'0')
    ELSE lpad(to_hex(ascii(ch)),4,'0') END,'' ORDER BY ordinal),'')
  FROM regexp_split_to_table(value,'') WITH ORDINALITY AS units(ch,ordinal)
$fn$;
-- Mirrors walletJson followed by JSON.stringify, including JavaScript array-index property ordering.
CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.canonical_json(value jsonb,depth integer DEFAULT 0) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
DECLARE output text; number numeric;
BEGIN
  IF depth>64 THEN RAISE EXCEPTION 'Fiat JSON nesting limit exceeded'; END IF;
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS keys(key) WHERE key IN ('__proto__','constructor','prototype')) THEN
        RAISE EXCEPTION 'Fiat JSON contains a reserved object key'; END IF;
      SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||alpha_wallet_trusted_payment_journal_simulation.canonical_json(item,depth+1),','
        ORDER BY CASE WHEN key ~ '^(0|[1-9][0-9]{0,9})$' AND length(key)<=10
          THEN CASE WHEN key::numeric<4294967295 THEN 0 ELSE 1 END ELSE 1 END,
        CASE WHEN key ~ '^(0|[1-9][0-9]{0,9})$' AND length(key)<=10
          THEN CASE WHEN key::numeric<4294967295 THEN key::numeric ELSE NULL END ELSE NULL END,
        alpha_wallet_trusted_payment_journal_simulation.utf16_key(key) COLLATE "C"),'')||'}'
        INTO output FROM jsonb_each(value) AS entries(key,item);
    WHEN 'array' THEN
      SELECT '['||coalesce(string_agg(alpha_wallet_trusted_payment_journal_simulation.canonical_json(item,depth+1),',' ORDER BY ordinal),'')||']'
        INTO output FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item,ordinal);
    WHEN 'number' THEN
      number:=value::numeric;
      IF abs(number)>9007199254740991 OR number IS DISTINCT FROM trunc(number) THEN RAISE EXCEPTION 'Fiat JSON number is not a safe integer'; END IF;
      output:=trunc(number)::text;
    WHEN 'string' THEN output:=value::text;
    WHEN 'boolean' THEN output:=value::text;
    WHEN 'null' THEN output:='null';
    ELSE RAISE EXCEPTION 'Fiat JSON type is unsupported';
  END CASE;
  RETURN output;
END;
$fn$;
CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.value_digest(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT encode(sha256(convert_to(alpha_wallet_trusted_payment_journal_simulation.canonical_json(value),'UTF8')),'hex')
$fn$;
CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.closed_object(value jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(jsonb_typeof(value)='object' AND value ?& keys
    AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(value)='object' THEN value ELSE '{}'::jsonb END))=cardinality(keys),false)
$fn$;
CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.require_runtime() RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $fn$
BEGIN
  IF current_setting('alpha_wallet.development_schema',true) IS DISTINCT FROM 'simulation-only'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT','Etc/GMT','Etc/GMT0') THEN
    RAISE EXCEPTION 'Fiat journal runtime or physical owner is invalid';
  END IF;
END;
$fn$;

CREATE TABLE alpha_wallet_trusted_payment_journal_simulation.head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  physical_store_id alpha_wallet_trusted_payment_journal_simulation.identifier NOT NULL,
  schema_sha256 alpha_wallet_trusted_payment_journal_simulation.sha256 NOT NULL,
  catalog_sha256 alpha_wallet_trusted_payment_journal_simulation.sha256 NOT NULL,
  bootstrap jsonb NOT NULL CHECK (jsonb_typeof(bootstrap)='object'),
  archive_json jsonb NOT NULL CHECK (jsonb_typeof(archive_json)='object'),
  revision integer NOT NULL CHECK (revision BETWEEN 0 AND 128),
  event_hash alpha_wallet_trusted_payment_journal_simulation.sha256 NOT NULL,
  state_hash alpha_wallet_trusted_payment_journal_simulation.sha256 NOT NULL,
  archive_sha256 alpha_wallet_trusted_payment_journal_simulation.sha256 NOT NULL,
  lock_version bigint NOT NULL CHECK (lock_version>=1),
  owner_transaction_id text NOT NULL CHECK (owner_transaction_id ~ '^[1-9][0-9]*$'),
  installation_transaction_id text NOT NULL CHECK (installation_transaction_id ~ '^[1-9][0-9]*$'),
  installation_kind text NOT NULL CHECK (installation_kind IN ('initialize','restore')),
  imported_revision integer NOT NULL CHECK (imported_revision BETWEEN 0 AND 127)
);
CREATE TABLE alpha_wallet_trusted_payment_journal_simulation.commands (
  revision integer PRIMARY KEY CHECK (revision BETWEEN 1 AND 128),
  operation_id alpha_wallet_trusted_payment_journal_simulation.identifier NOT NULL,
  input_hash alpha_wallet_trusted_payment_journal_simulation.sha256 NOT NULL,
  record_json jsonb NOT NULL CHECK (jsonb_typeof(record_json)='object'),
  owner_transaction_id text NOT NULL CHECK (owner_transaction_id ~ '^[1-9][0-9]*$'),
  UNIQUE (operation_id,input_hash)
);

CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.guard_head() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE identity text:=txid_current()::text;
BEGIN
  PERFORM alpha_wallet_trusted_payment_journal_simulation.require_runtime();
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Fiat journal identity and history cannot be removed'; END IF;
  IF NEW.owner_transaction_id IS DISTINCT FROM identity THEN RAISE EXCEPTION 'Fiat head owner differs from the physical transaction'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.installation_transaction_id IS DISTINCT FROM identity OR NEW.lock_version<>1 THEN
      RAISE EXCEPTION 'Fiat journal installation must bind its original transaction'; END IF;
    IF NEW.installation_kind='initialize' AND (NEW.imported_revision<>0 OR NEW.revision<>0) THEN
      RAISE EXCEPTION 'Fiat journal initialization must be empty'; END IF;
  ELSE
    IF NEW.physical_store_id IS DISTINCT FROM OLD.physical_store_id OR NEW.bootstrap IS DISTINCT FROM OLD.bootstrap
      OR NEW.schema_sha256 IS DISTINCT FROM OLD.schema_sha256 OR NEW.catalog_sha256 IS DISTINCT FROM OLD.catalog_sha256
      OR NEW.installation_transaction_id IS DISTINCT FROM OLD.installation_transaction_id
      OR NEW.installation_kind IS DISTINCT FROM OLD.installation_kind OR NEW.imported_revision IS DISTINCT FROM OLD.imported_revision THEN
      RAISE EXCEPTION 'Fiat journal original installation is immutable'; END IF;
    IF NEW.archive_json IS NOT DISTINCT FROM OLD.archive_json THEN
      IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.event_hash IS DISTINCT FROM OLD.event_hash
        OR NEW.state_hash IS DISTINCT FROM OLD.state_hash OR NEW.archive_sha256 IS DISTINCT FROM OLD.archive_sha256
        OR NEW.lock_version<>OLD.lock_version+1 THEN RAISE EXCEPTION 'Fiat head acquisition changes logical history'; END IF;
    ELSIF OLD.owner_transaction_id IS DISTINCT FROM identity OR NEW.lock_version<>OLD.lock_version
      OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Fiat append requires its acquired physical head and one next revision';
    ELSIF OLD.archive_json->'state'->>'status' IS DISTINCT FROM 'recording' THEN
      RAISE EXCEPTION 'Stopped fiat history cannot append or reset its terminal state';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER guard_head BEFORE INSERT OR UPDATE OR DELETE ON alpha_wallet_trusted_payment_journal_simulation.head
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_trusted_payment_journal_simulation.guard_head();
CREATE TRIGGER guard_head_truncate BEFORE TRUNCATE ON alpha_wallet_trusted_payment_journal_simulation.head
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_trusted_payment_journal_simulation.guard_head();

CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.guard_command() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE h alpha_wallet_trusted_payment_journal_simulation.head%ROWTYPE; prior jsonb; r jsonb; receipt jsonb; identity text:=txid_current()::text;
BEGIN
  PERFORM alpha_wallet_trusted_payment_journal_simulation.require_runtime();
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Fiat journal commands and receipts are immutable'; END IF;
  SELECT * INTO STRICT h FROM alpha_wallet_trusted_payment_journal_simulation.head WHERE singleton;
  IF h.owner_transaction_id IS DISTINCT FROM identity OR NEW.owner_transaction_id IS DISTINCT FROM identity THEN
    RAISE EXCEPTION 'Fiat journal command requires the physical singleton owner'; END IF;
  -- Only the one fresh restore installation may import an already stopped source.
  IF NOT (h.installation_transaction_id=identity AND h.installation_kind='restore')
    AND h.archive_json->'state'->>'status' IS DISTINCT FROM 'recording' THEN
    RAISE EXCEPTION 'Stopped fiat history cannot accept another command'; END IF;
  SELECT record_json INTO prior FROM alpha_wallet_trusted_payment_journal_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>coalesce((prior->>'revision')::integer,0)+1 THEN RAISE EXCEPTION 'Fiat command skipped or replaced a revision'; END IF;
  r:=NEW.record_json; receipt:=r->'receipt';
  IF NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(r,
    ARRAY['revision','operationId','inputHash','command','occurredAtMs','previousEventHash','eventHash','stateHash','receipt'])
    OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(receipt,
    ARRAY['operationId','inputHash','revision','eventHash','stateHash','disposition','status','executionAuthority','releaseAuthority'])
    OR r->>'revision' IS DISTINCT FROM NEW.revision::text OR r->>'operationId' IS DISTINCT FROM NEW.operation_id
    OR jsonb_typeof(r->'revision') IS DISTINCT FROM 'number'
    OR r->>'inputHash' IS DISTINCT FROM NEW.input_hash OR r->'command'->>'operationId' IS DISTINCT FROM NEW.operation_id
    OR alpha_wallet_trusted_payment_journal_simulation.value_digest(r->'command') IS DISTINCT FROM NEW.input_hash
    OR r->>'previousEventHash' IS DISTINCT FROM coalesce(prior->>'eventHash',repeat('0',64))
    OR jsonb_typeof(r->'occurredAtMs') IS DISTINCT FROM 'number'
    OR (r->>'occurredAtMs')::numeric<coalesce((prior->>'occurredAtMs')::numeric,(h.bootstrap->>'createdAtMs')::numeric)
    OR (r->>'occurredAtMs')::numeric NOT BETWEEN 1 AND 8640000000000000
    OR NOT coalesce(r->>'stateHash' ~ '^[0-9a-f]{64}$',false)
    OR receipt->>'operationId' IS DISTINCT FROM NEW.operation_id OR receipt->>'inputHash' IS DISTINCT FROM NEW.input_hash
    OR receipt->'revision' IS DISTINCT FROM r->'revision' OR receipt->'eventHash' IS DISTINCT FROM r->'eventHash'
    OR receipt->'stateHash' IS DISTINCT FROM r->'stateHash' OR receipt->'executionAuthority' IS DISTINCT FROM 'false'::jsonb
    OR receipt->'releaseAuthority' IS DISTINCT FROM 'false'::jsonb
    OR NOT coalesce(receipt->>'status' IN ('recording','paused','quarantined'),false)
    OR NOT coalesce(receipt->>'disposition' IN ('recorded','corroborated','stale-corroboration','paused','restored-quarantined',
      'operation-conflict-quarantined','payment-conflict-quarantined','revision-conflict-quarantined','revision-gap-quarantined',
      'source-reversal-quarantined','source-revocation-quarantined','source-rejection-quarantined','status-regression-quarantined'),false) THEN
    RAISE EXCEPTION 'Fiat command, receipt, input or history binding disagrees';
  END IF;
  IF (receipt->>'status') IS DISTINCT FROM (CASE WHEN receipt->>'disposition'='paused' THEN 'paused'
    WHEN receipt->>'disposition' LIKE '%-quarantined' THEN 'quarantined' ELSE 'recording' END) THEN
    RAISE EXCEPTION 'Fiat command disposition and terminal status disagree'; END IF;
  CASE r->'command'->>'type'
    WHEN 'record' THEN
      IF NEW.revision>126 OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(r->'command',ARRAY['type','operationId','prepared'])
        OR jsonb_typeof(r->'command'->'prepared') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Fiat observation command is invalid or consumes reserved recovery capacity'; END IF;
    WHEN 'pause' THEN
      IF NEW.revision>127 OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(r->'command',ARRAY['type','operationId','reasonCode'])
        OR NOT coalesce(r->'command'->>'reasonCode' IN ('manual-review','source-unavailable','maintenance'),false) THEN
        RAISE EXCEPTION 'Fiat pause command is invalid or consumes reserved restoration capacity'; END IF;
    WHEN 'quarantine-restore' THEN
      IF h.installation_transaction_id IS DISTINCT FROM identity OR h.installation_kind IS DISTINCT FROM 'restore'
        OR NEW.revision<>h.imported_revision+1
        OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(r->'command',
          ARRAY['type','operationId','backupSha256','sourceArchiveSha256','sourceCheckpoint','targetStoreId','exportedAtMs'])
        OR r->'command'->>'targetStoreId' IS DISTINCT FROM h.physical_store_id
        OR receipt->>'disposition' IS DISTINCT FROM 'restored-quarantined' THEN
        RAISE EXCEPTION 'Fiat restoration command requires its one fresh physical installation'; END IF;
    ELSE RAISE EXCEPTION 'Fiat command type is unsupported';
  END CASE;
  IF r->>'eventHash' IS DISTINCT FROM alpha_wallet_trusted_payment_journal_simulation.value_digest(jsonb_build_object(
    'revision',r->'revision','operationId',r->'operationId','inputHash',r->'inputHash','occurredAtMs',r->'occurredAtMs',
    'previousEventHash',r->'previousEventHash','stateHash',r->'stateHash','disposition',receipt->'disposition','status',receipt->'status')) THEN
    RAISE EXCEPTION 'Fiat command event digest disagrees'; END IF;
  IF h.installation_transaction_id<>identity AND NEW.revision<>h.revision+1 THEN
    RAISE EXCEPTION 'Fiat command requires the exact next acquired head'; END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER guard_command BEFORE INSERT OR UPDATE OR DELETE ON alpha_wallet_trusted_payment_journal_simulation.commands
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_trusted_payment_journal_simulation.guard_command();
CREATE TRIGGER guard_commands_truncate BEFORE TRUNCATE ON alpha_wallet_trusted_payment_journal_simulation.commands
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_trusted_payment_journal_simulation.guard_command();

CREATE FUNCTION alpha_wallet_trusted_payment_journal_simulation.check_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE h alpha_wallet_trusted_payment_journal_simulation.head%ROWTYPE; archive jsonb; rows jsonb; last_record jsonb; state jsonb;
BEGIN
  PERFORM alpha_wallet_trusted_payment_journal_simulation.require_runtime();
  SELECT * INTO STRICT h FROM alpha_wallet_trusted_payment_journal_simulation.head WHERE singleton;
  archive:=h.archive_json; state:=archive->'state';
  SELECT coalesce(jsonb_agg(record_json ORDER BY revision),'[]'::jsonb) INTO rows FROM alpha_wallet_trusted_payment_journal_simulation.commands;
  last_record:=rows->-1;
  IF NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(archive,
    ARRAY['kind','formatVersion','mode','bootstrap','records','checkpoint','state','archiveSha256'])
    OR archive->>'kind' IS DISTINCT FROM 'development-trusted-payment-journal' OR archive->'formatVersion' IS DISTINCT FROM '1'::jsonb
    OR archive->>'mode' IS DISTINCT FROM 'simulation-only' OR archive->'bootstrap' IS DISTINCT FROM h.bootstrap
    OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(h.bootstrap,
      ARRAY['sourceStoreId','manifest','manifestSha256','createdAtMs'])
    OR NOT coalesce(h.bootstrap->>'sourceStoreId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR h.bootstrap->>'sourceStoreId' IN ('constructor','prototype','__proto__')
    OR jsonb_typeof(h.bootstrap->'manifest') IS DISTINCT FROM 'object'
    OR h.bootstrap->>'manifestSha256' IS DISTINCT FROM alpha_wallet_trusted_payment_journal_simulation.value_digest(
      jsonb_build_array('alpha-wallet-trusted-payment-evidence-v1','admission',h.bootstrap->'manifest'))
    OR jsonb_typeof(h.bootstrap->'createdAtMs') IS DISTINCT FROM 'number'
    OR (h.bootstrap->>'createdAtMs')::numeric NOT BETWEEN 1 AND 8640000000000000
    OR archive->'records' IS DISTINCT FROM rows OR jsonb_array_length(rows)<>h.revision
    OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(archive->'checkpoint',ARRAY['revision','eventHash','stateHash','lastCommandAtMs'])
    OR jsonb_typeof(archive->'checkpoint'->'revision') IS DISTINCT FROM 'number'
    OR archive->'checkpoint'->>'revision' IS DISTINCT FROM h.revision::text
    OR archive->'checkpoint'->>'eventHash' IS DISTINCT FROM h.event_hash
    OR archive->'checkpoint'->>'stateHash' IS DISTINCT FROM h.state_hash
    OR archive->'checkpoint'->'lastCommandAtMs' IS DISTINCT FROM coalesce(last_record->'occurredAtMs',h.bootstrap->'createdAtMs')
    OR h.event_hash IS DISTINCT FROM coalesce(last_record->>'eventHash',repeat('0',64))
    OR h.state_hash IS DISTINCT FROM alpha_wallet_trusted_payment_journal_simulation.value_digest(state)
    OR h.archive_sha256 IS DISTINCT FROM alpha_wallet_trusted_payment_journal_simulation.value_digest(archive-'archiveSha256')
    OR archive->>'archiveSha256' IS DISTINCT FROM h.archive_sha256
    OR NOT alpha_wallet_trusted_payment_journal_simulation.closed_object(state,
      ARRAY['status','haltReason','restoredTargetStoreId','executionAuthority','releaseAuthority','payments'])
    OR state->'executionAuthority' IS DISTINCT FROM 'false'::jsonb OR state->'releaseAuthority' IS DISTINCT FROM 'false'::jsonb
    OR NOT coalesce(state->>'status' IN ('recording','paused','quarantined'),false)
    OR NOT coalesce(jsonb_typeof(state->'haltReason') IN ('null','string'),false)
    OR jsonb_typeof(state->'payments') IS DISTINCT FROM 'array'
    OR octet_length(alpha_wallet_trusted_payment_journal_simulation.canonical_json(archive))>33554432 THEN
    RAISE EXCEPTION 'Fiat journal head and complete immutable command history disagree'; END IF;
  IF h.revision=0 AND (state->>'status' IS DISTINCT FROM 'recording' OR state->'haltReason' IS DISTINCT FROM 'null'::jsonb
    OR state->'payments' IS DISTINCT FROM '[]'::jsonb) THEN RAISE EXCEPTION 'Fiat genesis must be empty and recording'; END IF;
  IF h.revision>0 AND (last_record->>'stateHash' IS DISTINCT FROM h.state_hash
    OR last_record->'receipt'->'status' IS DISTINCT FROM state->'status') THEN
    RAISE EXCEPTION 'Fiat journal last command differs from its final projection'; END IF;
  IF h.installation_kind='initialize' THEN
    IF h.bootstrap->>'sourceStoreId' IS DISTINCT FROM h.physical_store_id OR state->'restoredTargetStoreId' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'Fiat original source cannot become a restored target'; END IF;
  ELSE
    IF h.revision<>h.imported_revision+1 OR state->>'status' IS DISTINCT FROM 'quarantined'
      OR state->>'haltReason' IS DISTINCT FROM 'restored-copy' OR state->>'restoredTargetStoreId' IS DISTINCT FROM h.physical_store_id
      OR h.bootstrap->>'sourceStoreId' IS NOT DISTINCT FROM h.physical_store_id OR last_record->'command'->>'type' IS DISTINCT FROM 'quarantine-restore'
      OR last_record->'command'->>'targetStoreId' IS DISTINCT FROM h.physical_store_id
      OR last_record->'receipt'->>'disposition' IS DISTINCT FROM 'restored-quarantined' THEN
      RAISE EXCEPTION 'Fiat restore requires exactly one terminal quarantine bound to its new physical target'; END IF;
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER complete_head AFTER INSERT OR UPDATE ON alpha_wallet_trusted_payment_journal_simulation.head
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_trusted_payment_journal_simulation.check_complete();
CREATE CONSTRAINT TRIGGER complete_command AFTER INSERT ON alpha_wallet_trusted_payment_journal_simulation.commands
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_trusted_payment_journal_simulation.check_complete();
