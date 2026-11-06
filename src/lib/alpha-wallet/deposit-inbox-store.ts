import "server-only";

import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { captureInboxData, captureInboxOptions, canonicalInboxJson, depositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { captureDepositInboxManifest } from "./deposit-inbox-admission";
import type { DepositInboxActor, DepositInboxAppendPlan, DepositInboxArchive, DepositInboxCheckpoint,
  DepositInboxEffects, DepositInboxEvidenceBlob, DepositInboxJournalRecord, DepositInboxRecoveryRecord,
  DepositInboxSnapshot, DepositInboxUserCommand, DepositInboxReceipt } from "./deposit-inbox-protocol";
import { createDepositInboxArchive, verifyDepositInboxArchive, captureDepositInboxCommand, transitionDepositInbox,
  createDepositInboxPreparationContext, findDepositInboxReceipt, recheckAdmittedDepositInboxCommandFreshness } from "./deposit-inbox-model";
import type { DepositPreparationContextRequest } from "./deposit-observation-preparation";

export const DEPOSIT_INBOX_SCHEMA = "alpha_wallet_deposit_inbox_simulation";
const BOOTSTRAP_LOCK = 61422926;
const UTC_NAMES = new Set(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"]);
type Row = Record<string, unknown>;
const TABLES = {
  evidenceBlobs: "evidence_blobs", observations: "observations", blockAnchors: "block_anchors",
  transactionAnchors: "transaction_anchors", events: "events", eventObservations: "event_observations",
  sourceHeads: "source_heads", candidateJobs: "candidate_jobs", candidateCursors: "candidate_cursors",
  quarantines: "quarantines", recoveryReceipts: "recovery_receipts",
} as const;
interface HeadRow extends Row {
  physical_store_instance_id: string;
  manifest_sha256: string;
  schema_sha256: string;
  catalog_sha256: string;
  bootstrap: DepositInboxArchive["bootstrap"];
  revision: number;
  event_hash: string;
  state_hash: string;
  state_json: DepositInboxArchive["projections"];
  installation_kind: "initialize" | "restore";
  imported_revision: number;
  restore_completed: boolean;
}

/** An opaque proof owned by exactly one physical SERIALIZABLE transaction. */
export interface DepositInboxStoreOwner { readonly kind: "development-deposit-inbox-owner" }
interface RegisteredOwner {
  readonly tx: WalletSql;
  readonly transactionId: string;
  readonly freshTarget: "initialize" | "restore" | null;
  readonly expectedStoreInstanceId: string | null;
  active: boolean;
  busy: boolean;
  installed: boolean;
  beforeReturn?: () => void;
}
const owners = new WeakMap<object, RegisteredOwner>();

function identifier(value: unknown): string {
  inboxCheck(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
    && !["constructor", "prototype", "__proto__"].includes(value), "INVALID_INPUT", "Deposit store identity must be a closed identifier");
  return value;
}
export function captureDepositInboxStore(value: unknown): WalletStore {
  inboxRuntime("simulation-only");
  const methods = captureInboxOptions(value, ["transaction", "close"]);
  inboxCheck(typeof methods.transaction === "function" && !types.isProxy(methods.transaction)
    && typeof methods.close === "function" && !types.isProxy(methods.close),
  "INVALID_INPUT", "Deposit storage requires an explicit local development store capability");
  return Object.freeze({ transaction: methods.transaction.bind(value), close: methods.close.bind(value) }) as WalletStore;
}
async function transactionIdentity(tx: WalletSql, expected?: string, retain?: (transactionId: string) => void): Promise<string> {
  inboxRuntime("simulation-only");
  const result = await tx.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null; time_zone: string }>(
    `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode,
      current_setting('TimeZone') AS time_zone`);
  const row = result.rows[0];
  inboxCheck(result.rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || row.transaction_id === expected), "INVALID_EVIDENCE", "Deposit storage physical transaction changed or ended");
  retain?.(row.transaction_id);
  inboxCheck(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only"
    && UTC_NAMES.has(row.time_zone), "RUNTIME_REFUSED", "Deposit storage requires one writable SERIALIZABLE simulation transaction in fixed UTC");
  inboxRuntime("simulation-only");
  return row.transaction_id;
}
async function poisonSameTransaction(tx: WalletSql, expected: string): Promise<void> {
  try {
    // Cleanup cannot use the failed runtime/schema guard or target a different physical transaction.
    const result = await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
    if (result.rows.length === 1 && result.rows[0].transaction_id === expected)
      await tx.query("SELECT 1 / 0 /* abort failed deposit inbox owner */");
  } catch { /* The real owner will roll back; preserve the classified original refusal. */ }
}
async function assertNamespaces(tx: WalletSql, allowInbox: boolean): Promise<void> {
  const namespaces = await tx.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname !~ '^pg_(toast|temp_[0-9]+|toast_temp_[0-9]+)$' ORDER BY nspname`);
  inboxCheck(namespaces.rows.every(row => allowInbox && row.nspname === DEPOSIT_INBOX_SCHEMA),
    "ADMISSION_REFUSED", "Deposit inbox storage refuses every companion application namespace");
  const objects = await tx.query<{ present: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_extension WHERE extname<>'plpgsql') OR EXISTS (SELECT 1 FROM pg_event_trigger) AS present`);
  inboxCheck(objects.rows.length === 1 && objects.rows[0].present === false,
    "ADMISSION_REFUSED", "Deposit inbox storage refuses public, temporary, extension and event-trigger objects");
}
function isUnknownCommit(error: unknown): error is CommitOutcomeUnknownError {
  return error !== null && typeof error === "object" && !types.isProxy(error)
    && Object.getPrototypeOf(error) === CommitOutcomeUnknownError.prototype;
}
function isSerializationFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object" || types.isProxy(error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return !!descriptor && "value" in descriptor && (descriptor.value === "40001" || descriptor.value === "40P01");
}
async function owned<T>(owner: DepositInboxStoreOwner, work: (registered: RegisteredOwner) => Promise<T>): Promise<T> {
  const registered = owner !== null && typeof owner === "object" ? owners.get(owner) : undefined;
  inboxCheck(registered && registered.active, "INVALID_INPUT", "Deposit storage requires its original active transaction owner");
  try {
    inboxCheck(!registered.busy, "SESSION_CLOSED", "Deposit storage owner does not permit concurrent or reentrant participants");
    registered.busy = true;
    await transactionIdentity(registered.tx, registered.transactionId);
    const result = await work(registered);
    await transactionIdentity(registered.tx, registered.transactionId);
    return result;
  } catch (error) {
    registered.active = false;
    await poisonSameTransaction(registered.tx, registered.transactionId);
    if (isSerializationFailure(error)) throw error;
    throw depositInboxError(error, "INVALID_EVIDENCE");
  } finally { registered.busy = false; }
}

export interface DepositInboxStoreTransactionOptions {
  readonly mode: "simulation-only";
  readonly store: WalletStore;
  readonly expectedStoreInstanceId?: string;
  readonly freshTarget?: "initialize" | "restore";
}

/** Internal low-level owner shared with restoration; supplied work never receives a raw SQL handle. */
export async function withDepositInboxStoreTransaction<T>(supplied: DepositInboxStoreTransactionOptions,
  work: (owner: DepositInboxStoreOwner) => Promise<T>): Promise<T> {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "store", "expectedStoreInstanceId", "freshTarget"]);
  inboxRuntime(options.mode);
  const store = captureDepositInboxStore(options.store);
  const expectedStoreInstanceId = options.expectedStoreInstanceId === undefined ? null : identifier(options.expectedStoreInstanceId);
  inboxCheck(options.freshTarget === undefined || options.freshTarget === "initialize" || options.freshTarget === "restore",
    "INVALID_INPUT", "Deposit fresh-target intent must be explicit initialization or recovery");
  const requestedFreshTarget = options.freshTarget as "initialize" | "restore" | undefined;
  inboxCheck(typeof work === "function" && !types.isProxy(work), "INVALID_INPUT", "Deposit transaction participant must be an explicit trusted function");
  try {
    return await store.transaction(async tx => {
      let transactionId: string | undefined, owner: DepositInboxStoreOwner | undefined;
      try {
        transactionId = await transactionIdentity(tx, undefined, value => { transactionId = value; });
        await transactionIdentity(tx, transactionId);
        if (requestedFreshTarget !== undefined) await tx.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK]);
        const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [DEPOSIT_INBOX_SCHEMA])).rows[0]?.present;
        inboxCheck(typeof present === "boolean", "INVALID_EVIDENCE", "Deposit target namespace could not be identified");
        await assertNamespaces(tx, requestedFreshTarget !== "restore");
        inboxCheck(requestedFreshTarget !== "restore" || !present, "ADMISSION_REFUSED", "Deposit restore requires a strictly fresh target");
        inboxCheck(present || requestedFreshTarget !== undefined, "ADMISSION_REFUSED", "Deposit inbox target has not been initialized");
        const freshTarget = present ? null : requestedFreshTarget!;
        if (present) {
          const heads = await tx.query<HeadRow>(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head
            SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton RETURNING *`);
          inboxCheck(heads.rows.length === 1, "INVALID_EVIDENCE", "Deposit singleton head is missing or duplicated");
          if (expectedStoreInstanceId !== null) inboxCheck(heads.rows[0].physical_store_instance_id === expectedStoreInstanceId,
            "ADMISSION_REFUSED", "Deposit operation belongs to another physical store instance");
          await assertSchema(tx, heads.rows[0]);
        }
        owner = Object.freeze({ kind: "development-deposit-inbox-owner" });
        owners.set(owner, { tx, transactionId, freshTarget, expectedStoreInstanceId,
          active: true, busy: false, installed: present });
        const result = await work(owner);
        const registered = owners.get(owner)!;
        inboxCheck(registered.active && !registered.busy, "SESSION_CLOSED", "Deposit transaction participant failed before completion");
        await transactionIdentity(tx, transactionId);
        await assertNamespaces(tx, true);
        inboxCheck(registered.installed, "INVALID_EVIDENCE", "Deposit fresh target cannot commit an incomplete installation");
        await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
        await transactionIdentity(tx, transactionId);
        registered.beforeReturn?.();
        registered.active = false;
        return result;
      } catch (error) {
        if (owner) owners.get(owner)!.active = false;
        if (transactionId !== undefined) await poisonSameTransaction(tx, transactionId);
        if (isSerializationFailure(error)) throw error;
        throw depositInboxError(error, "INVALID_EVIDENCE");
      } finally { if (owner) owners.delete(owner); }
    });
  } catch (error) {
    if (isUnknownCommit(error)) throw error;
    throw depositInboxError(error, "INVALID_EVIDENCE");
  }
}

function schemaSource(): { sql: string; sha256: string } {
  const sql = readFileSync(new URL("../../../docs/alpha-wallet/deposit-inbox-schema.sql", import.meta.url), "utf8");
  return { sql, sha256: createHash("sha256").update(sql).digest("hex") };
}

async function catalogSha256(tx: WalletSql): Promise<string> {
  const rows = await tx.query<{ kind: string; identity: string; definition: string }>(`SELECT 'relation' AS kind,c.relname AS identity,
    concat_ws('|',c.relkind::text,c.relrowsecurity::text,c.relforcerowsecurity::text,coalesce(c.relacl::text,'')) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
    UNION ALL SELECT 'column',c.relname||'.'||a.attname,
      concat_ws('|',a.attnum::text,format_type(a.atttypid,a.atttypmod),a.attnotnull::text,a.attgenerated::text,coalesce(pg_get_expr(d.adbin,d.adrelid),''))
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT 'constraint',coalesce(c.relname,'domain')||'.'||q.conname,pg_get_constraintdef(q.oid,true)
      FROM pg_constraint q JOIN pg_namespace n ON n.oid=q.connamespace LEFT JOIN pg_class c ON c.oid=q.conrelid WHERE n.nspname=$1
    UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      concat_ws('|',p.prosrc,p.prosecdef::text,p.provolatile::text,coalesce(p.proconfig::text,''),coalesce(p.proacl::text,''),pg_get_function_result(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1
    UNION ALL SELECT 'trigger',c.relname||'.'||t.tgname,concat_ws('|',pg_get_triggerdef(t.oid,true),t.tgenabled::text)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
    UNION ALL SELECT 'index',c.relname,pg_get_indexdef(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind='i'
    ORDER BY kind,identity,definition`, [DEPOSIT_INBOX_SCHEMA]);
  return digestInboxValue("deposit-inbox-catalog", rows.rows);
}
async function assertSchema(tx: WalletSql, head: HeadRow): Promise<void> {
  const names = (await tx.query<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind NOT IN ('i','I') ORDER BY c.relname`, [DEPOSIT_INBOX_SCHEMA])).rows.map(row => row.relname);
  const expected = ["head", "admission", "admission_records", "commands", "command_seals", ...Object.values(TABLES)].sort();
  inboxCheck(canonicalInboxJson(names) === canonicalInboxJson(expected) && head.schema_sha256 === schemaSource().sha256
    && head.catalog_sha256 === await catalogSha256(tx), "INVALID_EVIDENCE", "Deposit inbox schema fingerprint or exact object inventory changed");
}
async function headOf(tx: WalletSql): Promise<HeadRow> {
  const rows = (await tx.query<HeadRow>(`SELECT * FROM ${DEPOSIT_INBOX_SCHEMA}.head WHERE singleton`)).rows;
  inboxCheck(rows.length === 1, "INVALID_EVIDENCE", "Deposit inbox singleton is missing or duplicated");
  return rows[0];
}
function checkpointOf(head: HeadRow): DepositInboxCheckpoint {
  return { revision: head.revision, eventHash: head.event_hash, stateHash: head.state_hash };
}
function same(left: unknown, right: unknown): boolean { return canonicalInboxJson(left) === canonicalInboxJson(right); }

async function captureOwned<T, C>(owner: DepositInboxStoreOwner, value: unknown,
  operation: (registered: RegisteredOwner, captured: C) => Promise<T>, capture: (value: unknown) => C = captureInboxData<C>): Promise<T> {
  let captured: C | undefined, captureError: unknown, failed = false;
  try { inboxRuntime("simulation-only"); captured = capture(value); }
  catch (error) { failed = true; captureError = error; }
  return owned(owner, async registered => {
    if (failed) throw captureError;
    return operation(registered, captured as C);
  });
}
async function readArchive(registered: RegisteredOwner): Promise<DepositInboxArchive> {
  const { tx } = registered, head = await headOf(tx);
  await assertSchema(tx, head);
  inboxCheck(registered.expectedStoreInstanceId === null || registered.expectedStoreInstanceId === head.physical_store_instance_id,
    "ADMISSION_REFUSED", "Deposit inbox target identity differs");
  const admissionRows = (await tx.query<{ manifest: DepositInboxArchive["manifest"] }>(`SELECT manifest FROM ${DEPOSIT_INBOX_SCHEMA}.admission WHERE singleton`)).rows;
  inboxCheck(admissionRows.length === 1, "INVALID_EVIDENCE", "Deposit immutable manifest is missing");
  const counts = (await tx.query<{ commands: string; observations: string; raw_bytes: string }>(`SELECT
    (SELECT count(*) FROM ${DEPOSIT_INBOX_SCHEMA}.commands)::text AS commands,
    (SELECT count(*) FROM ${DEPOSIT_INBOX_SCHEMA}.evidence_blobs)::text AS observations,
    (SELECT coalesce(sum((payload->>'rawBytes')::numeric),0) FROM ${DEPOSIT_INBOX_SCHEMA}.evidence_blobs)::text AS raw_bytes`)).rows[0];
  inboxCheck(counts && BigInt(counts.commands) <= BigInt(1000) && BigInt(counts.observations) <= BigInt(256)
    && BigInt(counts.raw_bytes) >= BigInt(0) && BigInt(counts.raw_bytes) <= BigInt(16 * 1_048_576),
  "RESOURCE_LIMIT", "Deposit retained history exceeds its closed replay bounds");
  const commands = (await tx.query<{ record_json: DepositInboxJournalRecord }>(`SELECT record_json FROM ${DEPOSIT_INBOX_SCHEMA}.commands ORDER BY revision`)).rows.map(row => row.record_json);
  const blobs = (await tx.query<{ payload: DepositInboxEvidenceBlob }>(`SELECT payload FROM ${DEPOSIT_INBOX_SCHEMA}.evidence_blobs ORDER BY command_revision,ordinal`)).rows.map(row => row.payload);
  for (const [key, table] of Object.entries(TABLES)) {
    if (key === "evidenceBlobs") continue;
    const actual = (await tx.query<{ payload: unknown }>(`SELECT payload FROM ${DEPOSIT_INBOX_SCHEMA}.${table} ORDER BY command_revision,ordinal`)).rows.map(row => row.payload);
    inboxCheck(same(actual, head.state_json[key as keyof DepositInboxArchive["projections"]]),
      "INVALID_EVIDENCE", "Deposit durable projections differ from the retained state");
  }
  const archive = await verifyDepositInboxArchive({ manifest: admissionRows[0].manifest, bootstrap: head.bootstrap,
    commands, evidenceBlobs: blobs, projections: head.state_json, checkpoint: checkpointOf(head) });
  inboxCheck(archive.projections.storeInstanceId === head.physical_store_instance_id,
    "INVALID_EVIDENCE", "Deposit logical state does not bind this physical target");
  return archive;
}

/** Full historical replay and exact durable projection checks; never contacts a node. */
export async function loadDepositInboxStore(owner: DepositInboxStoreOwner): Promise<DepositInboxArchive> {
  return owned(owner, readArchive);
}
async function insertRecord(tx: WalletSql, record: DepositInboxJournalRecord, blobs: readonly DepositInboxEvidenceBlob[]): Promise<void> {
  await tx.query(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.commands
    (revision,request_key,input_fingerprint,at_ms,record_json,previous_event_hash,event_hash,state_hash,owner_transaction_id)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,txid_current()::text)`, [record.revision, record.requestKey, record.inputFingerprint,
    record.atMs, canonicalInboxJson(record), record.previousEventHash, record.eventHash, record.stateHash]);
  for (const [key, table] of Object.entries(TABLES) as Array<[keyof DepositInboxEffects, typeof TABLES[keyof typeof TABLES]]>) {
    const values: readonly unknown[] = key === "evidenceBlobs"
      ? record.effects.evidenceBlobs.map(reference => {
        const blob = blobs.find(item => item.evidenceId === reference.evidenceId);
        inboxCheck(blob && same({ evidenceId: blob.evidenceId, observationSha256: blob.observationSha256,
          rawBytes: blob.rawBytes, commandRevision: blob.commandRevision }, reference), "INVALID_EVIDENCE", "Deposit full evidence blob is missing or substituted");
        return blob;
      }) : record.effects[key];
    for (let ordinal = 0; ordinal < values.length; ordinal++) await tx.query(
      `INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.${table}(command_revision,ordinal,payload) VALUES($1,$2,$3::jsonb)`,
      [record.revision, ordinal, canonicalInboxJson(values[ordinal])]);
  }
}

/** Install original logical history without rewriting its bootstrap, command hashes or evidence. */
export async function installDepositInboxStore(owner: DepositInboxStoreOwner, supplied: DepositInboxArchive,
  suppliedPhysicalStoreInstanceId?: string): Promise<void> {
  return captureOwned<void, { archive: DepositInboxArchive; physicalStoreInstanceId: string | null }>(owner,
    { archive: supplied, physicalStoreInstanceId: suppliedPhysicalStoreInstanceId ?? null }, async (registered, input) => {
      inboxCheck(registered.freshTarget !== null && !registered.installed, "ADMISSION_REFUSED", "Deposit installation requires its unused fresh-target owner");
      const archive = await verifyDepositInboxArchive(input.archive);
      const physicalStoreInstanceId = identifier(input.physicalStoreInstanceId ?? archive.projections.storeInstanceId);
      inboxCheck(registered.expectedStoreInstanceId === null || registered.expectedStoreInstanceId === physicalStoreInstanceId,
        "ADMISSION_REFUSED", "Deposit installation target differs from its expected physical identity");
      if (registered.freshTarget === "initialize") inboxCheck(archive.commands.length === 0
        && archive.projections.storeInstanceId === physicalStoreInstanceId && archive.projections.status === "recording",
      "ADMISSION_REFUSED", "Deposit initialization accepts only the original empty recording genesis");
      else inboxCheck(physicalStoreInstanceId !== archive.projections.storeInstanceId
        && physicalStoreInstanceId !== archive.bootstrap.storeInstanceId
        && !archive.projections.recoveryReceipts.some(item => item.targetStoreInstanceId === physicalStoreInstanceId),
      "ADMISSION_REFUSED", "Deposit restore requires a new physical identity outside the retained lineage");
      const source = schemaSource(), { tx } = registered;
      await assertNamespaces(tx, false);
      await tx.exec(source.sql);
      const catalog = await catalogSha256(tx), admission = captureDepositInboxManifest(archive.manifest);
      await tx.query(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.head
        (singleton,format_version,mode,inbox_id,physical_store_instance_id,manifest_sha256,schema_sha256,catalog_sha256,
         bootstrap,genesis_event_hash,revision,event_hash,state_hash,state_json,lock_version,owner_transaction_id,
         installation_transaction_id,installation_kind,imported_revision,restore_completed)
        VALUES(true,1,'simulation-only',$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,1,txid_current()::text,
          txid_current()::text,$12,$13,$14)`, [archive.bootstrap.inboxId, physicalStoreInstanceId, admission.manifestSha256,
        source.sha256, catalog, canonicalInboxJson(archive.bootstrap), digestInboxValue("inbox-genesis", archive.bootstrap),
        archive.checkpoint.revision, archive.checkpoint.eventHash, archive.checkpoint.stateHash, canonicalInboxJson(archive.projections),
        registered.freshTarget, archive.checkpoint.revision, registered.freshTarget === "initialize"]);
      await tx.query(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.admission(singleton,manifest) VALUES(true,$1::jsonb)`, [canonicalInboxJson(admission.manifest)]);
      const groups = [
        ["chains", admission.manifest.chains, "chainKey", admission.chainHashes], ["assets", admission.manifest.assets, "assetRef", admission.assetHashes],
        ["sources", admission.manifest.sources, "sourceId", admission.sourceHashes], ["sourceSets", admission.manifest.sourceSets, "sourceSetId", admission.sourceSetHashes],
        ["assignments", admission.manifest.assignments, "assignmentId", admission.assignmentHashes], ["workers", admission.manifest.workers, "workerId", admission.workerHashes],
      ] as const;
      for (const [kind, rows, key, hashes] of groups) for (const value of rows) {
        const recordId = (value as unknown as Row)[key] as string;
        await tx.query(`INSERT INTO ${DEPOSIT_INBOX_SCHEMA}.admission_records(kind,record_id,record_sha256,payload) VALUES($1,$2,$3,$4::jsonb)`,
          [kind, recordId, hashes[recordId], canonicalInboxJson(value)]);
      }
      for (const record of archive.commands) await insertRecord(tx, record, archive.evidenceBlobs);
      registered.installed = true;
    }, value => {
      const input = captureInboxOptions(value, ["archive", "physicalStoreInstanceId"]);
      return Object.freeze({ archive: captureInboxData<DepositInboxArchive>(input.archive),
        physicalStoreInstanceId: input.physicalStoreInstanceId === null ? null : identifier(input.physicalStoreInstanceId) });
    });
}

/** Append exactly one validated plan; the database independently checks its complete effect set at COMMIT. */
export async function appendDepositInboxStore(owner: DepositInboxStoreOwner, value: DepositInboxAppendPlan): Promise<void> {
  return captureOwned<void, DepositInboxAppendPlan>(owner, value, async (registered, plan) => {
    inboxCheck(registered.installed, "ADMISSION_REFUSED", "Deposit append requires an installed target");
    const archive = await verifyDepositInboxArchive(plan.archive), head = await headOf(registered.tx);
    inboxCheck(same(checkpointOf(head), plan.previousCheckpoint) && plan.record.revision === head.revision + 1
      && same(archive.commands.at(-1), plan.record) && same(archive.checkpoint, plan.nextCheckpoint)
      && same(archive.projections, plan.nextState) && archive.projections.storeInstanceId === head.physical_store_instance_id,
    "REPLAY_MISMATCH", "Deposit append plan does not extend this exact fenced target checkpoint");
    const existing = (await registered.tx.query<{ record_json: DepositInboxJournalRecord }>(`SELECT record_json FROM ${DEPOSIT_INBOX_SCHEMA}.commands ORDER BY revision`)).rows.map(row => row.record_json);
    inboxCheck(same(existing, archive.commands.slice(0, -1)), "REPLAY_MISMATCH", "Deposit append cannot replace an earlier immutable command");
    await insertRecord(registered.tx, plan.record, plan.evidenceBlobs);
    const advanced = await registered.tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET revision=$1,event_hash=$2,state_hash=$3,state_json=$4::jsonb
      WHERE singleton AND revision=$5 AND event_hash=$6 AND state_hash=$7 RETURNING revision`, [plan.nextCheckpoint.revision,
      plan.nextCheckpoint.eventHash, plan.nextCheckpoint.stateHash, canonicalInboxJson(plan.nextState), plan.previousCheckpoint.revision,
      plan.previousCheckpoint.eventHash, plan.previousCheckpoint.stateHash]);
    inboxCheck(advanced.rows.length === 1, "REPLAY_MISMATCH", "Deposit append lost its exact singleton checkpoint");
  }, value => {
    const input = captureInboxOptions(value, ["previousCheckpoint", "record", "evidenceBlobs", "nextState", "nextCheckpoint", "archive"]);
    return Object.freeze({ previousCheckpoint: captureInboxData<DepositInboxAppendPlan["previousCheckpoint"]>(input.previousCheckpoint),
      record: captureInboxData<DepositInboxAppendPlan["record"]>(input.record),
      evidenceBlobs: captureInboxData<DepositInboxAppendPlan["evidenceBlobs"]>(input.evidenceBlobs),
      nextState: captureInboxData<DepositInboxAppendPlan["nextState"]>(input.nextState),
      nextCheckpoint: captureInboxData<DepositInboxAppendPlan["nextCheckpoint"]>(input.nextCheckpoint),
      archive: captureInboxData<DepositInboxArchive>(input.archive) });
  });
}

/** The restore's complete receipt must already be an effect of its sole new quarantine command. */
export async function completeDepositInboxRestore(owner: DepositInboxStoreOwner, value: DepositInboxRecoveryRecord): Promise<void> {
  return captureOwned<void, DepositInboxRecoveryRecord>(owner, value, async (registered, receipt) => {
    inboxCheck(registered.freshTarget === "restore" && registered.installed, "ADMISSION_REFUSED", "Deposit recovery seal requires its original fresh restore owner");
    const head = await headOf(registered.tx);
    const rows = (await registered.tx.query<{ payload: DepositInboxRecoveryRecord }>(`SELECT payload FROM ${DEPOSIT_INBOX_SCHEMA}.recovery_receipts
      WHERE target_store_instance_id=$1`, [head.physical_store_instance_id])).rows;
    inboxCheck(!head.restore_completed && rows.length === 1 && same(rows[0].payload, receipt)
      && receipt.commandRevision === head.imported_revision + 1 && receipt.targetRevision === head.revision
      && head.state_json.status === "quarantined" && head.state_json.storeInstanceId === head.physical_store_instance_id,
    "INVALID_EVIDENCE", "Deposit restoration receipt or terminal target state is incomplete");
    await registered.tx.query(`UPDATE ${DEPOSIT_INBOX_SCHEMA}.head SET restore_completed=true WHERE singleton AND NOT restore_completed`);
  });
}

function captureClock(value: unknown): () => number {
  inboxCheck(value === undefined || (typeof value === "function" && !types.isProxy(value)),
    "INVALID_INPUT", "Deposit storage clock must be an explicit synchronous function");
  const clock = (value ?? Date.now) as () => number;
  return () => {
    inboxRuntime("simulation-only");
    const now = clock();
    inboxCheck(typeof now === "number" && Number.isSafeInteger(now) && now >= 0 && !Object.is(now, -0),
      "INVALID_INPUT", "Deposit storage clock must return a safe nonnegative millisecond instant");
    inboxRuntime("simulation-only");
    return now;
  };
}
function snapshotOf(archive: DepositInboxArchive): DepositInboxSnapshot {
  return captureInboxData<DepositInboxSnapshot>({ mode: "simulation-only", creditAuthority: false,
    manifest: archive.manifest, bootstrap: archive.bootstrap, state: archive.projections, checkpoint: archive.checkpoint });
}

/** Bootstrap is idempotent only for the exact retained request, admission and original physical identity. */
export async function initializeDevelopmentDepositInbox(supplied: {
  mode: "simulation-only"; store: WalletStore; manifest: unknown; storeInstanceId?: string; requestId: string; clock?: () => number;
}): Promise<DepositInboxSnapshot> {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "store", "manifest", "storeInstanceId", "requestId", "clock"]);
  inboxRuntime(options.mode);
  const store = captureDepositInboxStore(options.store), admission = captureDepositInboxManifest(options.manifest);
  const requestId = identifier(options.requestId), explicitIdentity = options.storeInstanceId === undefined ? undefined : identifier(options.storeInstanceId);
  const storeInstanceId = explicitIdentity ?? randomUUID(), clock = captureClock(options.clock);
  const created = createDepositInboxArchive({ mode: "simulation-only", manifest: admission.manifest, storeInstanceId, requestId, atMs: clock() });
  return withDepositInboxStoreTransaction({ mode: "simulation-only", store, freshTarget: "initialize",
    ...(explicitIdentity === undefined ? {} : { expectedStoreInstanceId: explicitIdentity }) }, async owner => {
    if (!owners.get(owner)!.installed) await installDepositInboxStore(owner, created);
    const archive = await loadDepositInboxStore(owner);
    inboxCheck(archive.bootstrap.requestId === requestId && archive.bootstrap.manifestSha256 === admission.manifestSha256
      && archive.bootstrap.storeInstanceId === archive.projections.storeInstanceId
      && (explicitIdentity === undefined || archive.projections.storeInstanceId === explicitIdentity),
    "ADMISSION_REFUSED", "Deposit initialization differs from the immutable original bootstrap");
    return snapshotOf(archive);
  });
}

export interface DepositInboxUnknownCommand {
  readonly requestId: string;
  readonly inputFingerprint: string;
  readonly expectedStoreInstanceId: string;
  readonly expectedPreCommandCheckpoint: DepositInboxCheckpoint;
}
/** COMMIT was acknowledged, but a surrounding capability did not return the recorded response. */
export class DepositInboxCommittedResponseUnavailableError extends Error {
  readonly code = "ALPHA_WALLET_DEPOSIT_INBOX_COMMITTED_RESPONSE_UNAVAILABLE";
  readonly disposition = "committed-response-unavailable";
  readonly mode = "simulation-only";
  readonly creditAuthority = false;
  constructor(readonly depositInboxRecovery: DepositInboxUnknownCommand) {
    super("Deposit inbox commit was acknowledged; recover the exact response through its retained receipt identity");
    this.name = "DepositInboxCommittedResponseUnavailableError";
  }
}
export type DepositInboxReconciliation = Readonly<{
  mode: "simulation-only"; creditAuthority: false;
  status: "committed" | "not-recorded" | "not-recorded-stale" | "unresolved";
  receipt: DepositInboxReceipt | null; snapshot: DepositInboxSnapshot | null;
}>;
function sha256(value: unknown): string {
  inboxCheck(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "INVALID_INPUT", "Deposit command fingerprint must be a lowercase SHA-256 commitment");
  return value;
}
function capturedCheckpoint(value: unknown): DepositInboxCheckpoint {
  const row = captureInboxOptions(value, ["revision", "eventHash", "stateHash"]);
  inboxCheck(typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 0
    && row.revision <= 1000 && !Object.is(row.revision, -0), "INVALID_INPUT", "Deposit checkpoint revision is outside the finite journal");
  return Object.freeze({ revision: row.revision, eventHash: sha256(row.eventHash), stateHash: sha256(row.stateHash) });
}

/** One local admission and physical store capability; no method performs node IO, custody or credit. */
export function createDevelopmentDepositInboxRecorder(supplied: {
  mode: "simulation-only"; store: WalletStore; manifest: unknown; storeInstanceId: string; worker: DepositInboxActor; clock?: () => number;
}) {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "store", "manifest", "storeInstanceId", "worker", "clock"]);
  inboxRuntime(options.mode);
  const store = captureDepositInboxStore(options.store), admission = captureDepositInboxManifest(options.manifest);
  const actor = captureInboxOptions(options.worker, ["workerId", "role"]), workerId = identifier(actor.workerId);
  inboxCheck((actor.role === "worker" || actor.role === "operator")
    && admission.manifest.workers.some(row => row.workerId === workerId), "ADMISSION_REFUSED", "Deposit recorder actor is outside its immutable admission");
  const worker: DepositInboxActor = Object.freeze({ workerId, role: actor.role });
  const storeInstanceId = identifier(options.storeInstanceId), clock = captureClock(options.clock);
  async function inStore<T>(work: (archive: DepositInboxArchive, owner: DepositInboxStoreOwner) => Promise<T>): Promise<T> {
    return withDepositInboxStoreTransaction({ mode: "simulation-only", store, expectedStoreInstanceId: storeInstanceId }, async owner => {
      const archive = await loadDepositInboxStore(owner);
      inboxCheck(archive.bootstrap.manifestSha256 === admission.manifestSha256, "ADMISSION_REFUSED", "Deposit recorder admission differs from its immutable target");
      return work(archive, owner);
    });
  }
  async function execute(command: DepositInboxUserCommand): Promise<DepositInboxReceipt> {
    // Both the input and recorded time are fixed before the driver's SERIALIZABLE retry loop.
    const atMs = clock();
    const captured = await captureDepositInboxCommand({ mode: "simulation-only", manifest: admission.manifest, worker, storeInstanceId, command });
    let preCommandCheckpoint: DepositInboxCheckpoint | undefined;
    let expectedReceipt: DepositInboxReceipt | undefined;
    try {
      const returned = await inStore(async (archive, owner) => {
        preCommandCheckpoint = archive.checkpoint;
        const transition = await transitionDepositInbox(archive, captured, { atMs, admissionNowMs: clock() });
        if (transition.kind === "append") {
          await appendDepositInboxStore(owner, transition.plan);
          if (["recorded", "duplicate-evidence", "corroborating-observation"].includes(transition.receipt.disposition)) {
            const recheck = () => recheckAdmittedDepositInboxCommandFreshness(captured, clock());
            recheck(); owners.get(owner)!.beforeReturn = recheck;
          }
        }
        expectedReceipt = transition.receipt;
        return transition.receipt;
      });
      inboxCheck(expectedReceipt && preCommandCheckpoint, "INVALID_EVIDENCE", "Deposit transaction capability did not execute its certified participant");
      let matching = false;
      try { matching = same(captureInboxData(returned), expectedReceipt); } catch { /* Preserve acknowledged outcome, never manufacture a fresh command. */ }
      if (!matching) throw new DepositInboxCommittedResponseUnavailableError(captureInboxData({
        requestId: captured.command.requestId, inputFingerprint: captured.inputFingerprint,
        expectedStoreInstanceId: storeInstanceId, expectedPreCommandCheckpoint: preCommandCheckpoint }));
      return expectedReceipt;
    } catch (error) {
      if (isUnknownCommit(error) && preCommandCheckpoint && Object.isExtensible(error)) {
        Object.defineProperty(error, "depositInboxRecovery", { value: captureInboxData<DepositInboxUnknownCommand>({
          requestId: captured.command.requestId, inputFingerprint: captured.inputFingerprint,
          expectedStoreInstanceId: storeInstanceId, expectedPreCommandCheckpoint: preCommandCheckpoint }), enumerable: true });
      }
      throw error;
    }
  }
  async function inspect(): Promise<DepositInboxSnapshot> { return inStore(async archive => snapshotOf(archive)); }
  async function preparationContext(suppliedRequest: DepositPreparationContextRequest) {
    inboxRuntime("simulation-only");
    const request = captureInboxData<DepositPreparationContextRequest>(suppliedRequest);
    const fields = captureInboxOptions(request, ["inboxId", "storeInstanceId", "manifestSha256", "workerId", "candidate", "jobId"]);
    inboxCheck(fields.inboxId === admission.manifest.inboxId && fields.storeInstanceId === storeInstanceId
      && fields.manifestSha256 === admission.manifestSha256 && fields.workerId === workerId
      && (fields.jobId === null || typeof fields.jobId === "string"), "ADMISSION_REFUSED", "Deposit preparation requests must bind the configured worker and physical target");
    return inStore(async archive => createDepositInboxPreparationContext({ archive, workerId, candidate: request.candidate,
      ...(request.jobId === null ? {} : { jobId: identifier(request.jobId) }), capturedAtMs: clock() }));
  }
  async function lookupReceipt(suppliedRequest: { requestId: string; inputFingerprint: string; expectedStoreInstanceId?: string }) {
    inboxRuntime("simulation-only");
    const request = captureInboxOptions(suppliedRequest, ["requestId", "inputFingerprint", "expectedStoreInstanceId"]);
    const requestId = identifier(request.requestId), inputFingerprint = sha256(request.inputFingerprint);
    inboxCheck(request.expectedStoreInstanceId === undefined || request.expectedStoreInstanceId === storeInstanceId,
      "ADMISSION_REFUSED", "Deposit receipt lookup belongs to another physical target");
    return inStore(async archive => findDepositInboxReceipt(archive, { workerId, requestId, inputFingerprint }));
  }
  async function reconcileUnknown(suppliedRequest: DepositInboxUnknownCommand): Promise<DepositInboxReconciliation> {
    inboxRuntime("simulation-only");
    const request = captureInboxOptions(suppliedRequest, ["requestId", "inputFingerprint", "expectedStoreInstanceId", "expectedPreCommandCheckpoint"]);
    const requestId = identifier(request.requestId), inputFingerprint = sha256(request.inputFingerprint);
    const expectedStoreInstanceId = identifier(request.expectedStoreInstanceId), before = capturedCheckpoint(request.expectedPreCommandCheckpoint);
    const unresolved = (): DepositInboxReconciliation => Object.freeze({ mode: "simulation-only", creditAuthority: false,
      status: "unresolved", receipt: null, snapshot: null });
    if (expectedStoreInstanceId !== storeInstanceId) return unresolved();
    try {
      return await inStore(async archive => {
        const snapshot = snapshotOf(archive), receipt = findDepositInboxReceipt(archive, { workerId, requestId, inputFingerprint });
        if (receipt) return Object.freeze({ mode: "simulation-only", creditAuthority: false, status: "committed", receipt, snapshot });
        const known = before.revision === 0 ? { revision: 0, eventHash: digestInboxValue("inbox-genesis", archive.bootstrap),
          stateHash: createDepositInboxArchive({ mode: "simulation-only", manifest: archive.manifest, storeInstanceId: archive.bootstrap.storeInstanceId,
            requestId: archive.bootstrap.requestId, atMs: archive.bootstrap.atMs }).checkpoint.stateHash }
          : archive.commands.find(row => row.revision === before.revision)?.receipt.checkpoint;
        if (!known || !same(known, before)) return unresolved();
        return Object.freeze({ mode: "simulation-only", creditAuthority: false,
          status: same(before, archive.checkpoint) ? "not-recorded" : "not-recorded-stale", receipt: null, snapshot });
      });
    } catch (error) {
      inboxRuntime("simulation-only");
      if (isUnknownCommit(error) || ["INVALID_EVIDENCE", "REPLAY_MISMATCH", "ADMISSION_REFUSED"].includes(depositInboxError(error).code)) return unresolved();
      throw error;
    }
  }
  return Object.freeze({ mode: "simulation-only" as const, creditAuthority: false as const, storeInstanceId,
    inspect, snapshot: inspect, preparationContext, lookupReceipt, reconcileUnknown,
    registerCandidateJob(input: Omit<Extract<DepositInboxUserCommand, { type: "register-candidate-job" }>, "type">) {
      const value = captureInboxOptions(input, ["requestId", "jobId", "orderedCandidates"]);
      return execute({ ...value, type: "register-candidate-job" } as Extract<DepositInboxUserCommand, { type: "register-candidate-job" }>);
    },
    record(input: Omit<Extract<DepositInboxUserCommand, { type: "record-observation" }>, "type" | "candidateCursor"> & {
      candidateCursor?: Extract<DepositInboxUserCommand, { type: "record-observation" }>["candidateCursor"];
    }) {
      const value = captureInboxOptions(input, ["requestId", "prepared", "candidateCursor"]);
      return execute({ ...value, type: "record-observation", candidateCursor: value.candidateCursor ?? null } as Extract<DepositInboxUserCommand, { type: "record-observation" }>);
    },
    recordAttemptHold(input: Omit<Extract<DepositInboxUserCommand, { type: "record-attempt-hold" }>, "type" | "candidateCursor"> & {
      candidateCursor?: Extract<DepositInboxUserCommand, { type: "record-attempt-hold" }>["candidateCursor"];
    }) {
      const value = captureInboxOptions(input, ["requestId", "attempt", "candidateCursor"]);
      return execute({ ...value, type: "record-attempt-hold", candidateCursor: value.candidateCursor ?? null } as Extract<DepositInboxUserCommand, { type: "record-attempt-hold" }>);
    },
    pause(input: Omit<Extract<DepositInboxUserCommand, { type: "pause" }>, "type">) {
      const value = captureInboxOptions(input, ["requestId", "reason"]);
      return execute({ ...value, type: "pause" } as Extract<DepositInboxUserCommand, { type: "pause" }>);
    },
  });
}
