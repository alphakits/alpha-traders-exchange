import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { types } from "node:util";
import { walletDigest, walletJson } from "./commands";
import { captureInboxData, captureInboxOptions } from "./deposit-inbox-data";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { captureTrustedPaymentManifest, type PreparedTrustedPaymentEvidenceV1 } from "./trusted-payment-evidence";
import {
  appendTrustedPaymentJournal, createTrustedPaymentJournalArchive, createTrustedPaymentJournalBackup,
  findTrustedPaymentJournalReceipt, MAX_TRUSTED_PAYMENT_JOURNAL_BYTES, restoreTrustedPaymentJournalArchive,
  trustedPaymentJournalCommandDigest, TrustedPaymentJournalError, verifyTrustedPaymentJournalArchive,
  verifyTrustedPaymentJournalBackup, type TrustedPaymentJournalArchive, type TrustedPaymentJournalBackup,
  type TrustedPaymentJournalCheckpoint, type TrustedPaymentJournalPublicCommand, type TrustedPaymentJournalReceipt,
  type TrustedPaymentJournalRecord,
} from "./trusted-payment-journal-model";

export const TRUSTED_PAYMENT_JOURNAL_SCHEMA = "alpha_wallet_trusted_payment_journal_simulation";
const SCHEMA = TRUSTED_PAYMENT_JOURNAL_SCHEMA;
const BOOTSTRAP_LOCK = 61422927;
const UTC_NAMES = new Set(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"]);
type Row = Record<string, unknown>;
interface HeadRow extends Row {
  physical_store_id: string; schema_sha256: string; catalog_sha256: string;
  bootstrap: TrustedPaymentJournalArchive["bootstrap"]; archive_json: TrustedPaymentJournalArchive;
  revision: number; event_hash: string; state_hash: string; archive_sha256: string;
  installation_kind: "initialize" | "restore"; imported_revision: number;
}
type Captured<T> = { value: T; error?: never } | { value?: never; error: unknown };
interface Owner { tx: WalletSql; transactionId: string; installed: boolean; physicalStoreId: string | null }

function check(value: unknown, message: string, code: TrustedPaymentJournalError["code"] = "INTEGRITY"): asserts value {
  if (!value) throw new TrustedPaymentJournalError(code, message);
}
function runtime(mode: unknown = "simulation-only"): void {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new TrustedPaymentJournalError("RUNTIME_REFUSED", "Fiat journal storage requires an explicit local simulation runtime"); }
}
function inert<T>(value: unknown): T {
  try { return captureInboxData<T>(value, { maxBytes: MAX_TRUSTED_PAYMENT_JOURNAL_BYTES, maxNodes: 100_000, maxDepth: 64 }); }
  catch { throw new TrustedPaymentJournalError("INVALID_INPUT", "Fiat storage input must be bounded inert JSON data"); }
}
function fields(value: unknown, allowed: readonly string[]) {
  try { return captureInboxOptions(value, allowed); }
  catch { throw new TrustedPaymentJournalError("INVALID_INPUT", "Fiat storage options must have only their explicit nonexecutable fields"); }
}
function capture<T>(work: () => T): Captured<T> {
  try { return { value: work() }; } catch (error) { return { error }; }
}
function captured<T>(value: Captured<T>): T { if ("error" in value) throw value.error; return value.value; }
function identifier(value: unknown): string {
  check(typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    && !["constructor", "prototype", "__proto__"].includes(value), "Fiat storage identifier is invalid", "INVALID_INPUT");
  return value;
}
function hash(value: unknown): string {
  check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "Fiat storage hash is invalid", "INVALID_INPUT"); return value;
}
function clockCapability(value: unknown): () => number {
  check(typeof value === "function" && !types.isProxy(value), "Fiat storage requires an explicit trusted fixture clock", "INVALID_INPUT");
  return () => {
    runtime(); const at = value();
    check(Number.isSafeInteger(at) && at > 0 && at <= 8_640_000_000_000_000,
      "Fiat storage clock must be a positive exact instant", "INVALID_INPUT"); return at;
  };
}
function storeCapability(value: unknown): WalletStore {
  const options = fields(value, ["transaction", "close"]);
  check(typeof options.transaction === "function" && !types.isProxy(options.transaction)
    && typeof options.close === "function" && !types.isProxy(options.close),
  "Fiat journal requires an explicit development store capability", "INVALID_INPUT");
  return Object.freeze({ transaction: options.transaction.bind(value), close: options.close.bind(value) }) as WalletStore;
}
const json = (value: unknown) => JSON.stringify(walletJson(inert(value)));
const same = (left: unknown, right: unknown) => walletDigest(left) === walletDigest(right);
function schemaSource() {
  const sql = readFileSync(new URL("../../../docs/alpha-wallet/trusted-payment-journal-schema.sql", import.meta.url), "utf8");
  return { sql, sha256: createHash("sha256").update(sql, "utf8").digest("hex") };
}
function retryable(error: unknown) {
  if (!error || typeof error !== "object" || types.isProxy(error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return !!descriptor && "value" in descriptor && (descriptor.value === "40001" || descriptor.value === "40P01");
}
function unknownCommit(error: unknown): error is CommitOutcomeUnknownError {
  return !!error && typeof error === "object" && !types.isProxy(error)
    && Object.getPrototypeOf(error) === CommitOutcomeUnknownError.prototype;
}
function publicError(error: unknown): Error {
  if (unknownCommit(error) || retryable(error)) return error as Error;
  if (error && typeof error === "object" && !types.isProxy(error)
    && Object.getPrototypeOf(error) === TrustedPaymentJournalError.prototype) return error as TrustedPaymentJournalError;
  return new TrustedPaymentJournalError("INTEGRITY", "Fiat journal storage did not satisfy its isolated development contract");
}
async function identity(tx: WalletSql, expected?: string, retain?: (id: string) => void): Promise<string> {
  runtime();
  const rows = (await tx.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null; time_zone: string }>(
    `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode,
      current_setting('TimeZone') AS time_zone`)).rows;
  const row = rows[0];
  check(rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || expected === row.transaction_id), "Fiat storage physical transaction changed or ended");
  retain?.(row.transaction_id);
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only"
    && UTC_NAMES.has(row.time_zone), "Fiat storage requires one writable SERIALIZABLE simulation transaction in fixed UTC", "RUNTIME_REFUSED");
  runtime(); return row.transaction_id;
}
async function poison(tx: WalletSql, transactionId: string) {
  try {
    // Certify the original physical owner without reusing the failed semantic/runtime guard.
    const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
    if (rows.length === 1 && rows[0].transaction_id === transactionId)
      await tx.query("SELECT 1 / 0 /* abort failed trusted payment journal participant */");
  } catch { /* Preserve the first failure; the real owner rolls back. */ }
}
async function isolated(tx: WalletSql, allowJournal: boolean) {
  const schemas = (await tx.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname !~ '^pg_(toast|temp_[0-9]+|toast_temp_[0-9]+)$' ORDER BY nspname`)).rows;
  check(schemas.every(row => allowJournal && row.nspname === SCHEMA), "Fiat journal refuses every companion application namespace");
  const rows = (await tx.query<{ present: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_extension WHERE extname<>'plpgsql') OR EXISTS (SELECT 1 FROM pg_event_trigger) AS present`)).rows;
  check(rows.length === 1 && rows[0].present === false, "Fiat journal refuses public, temporary, extension and event-trigger objects");
}
async function catalog(tx: WalletSql) {
  const rows = (await tx.query<{ kind: string; identity: string; definition: string }>(`SELECT 'relation' AS kind,c.relname AS identity,
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
      WHERE n.nspname=$1 AND c.relkind='i' ORDER BY kind,identity,definition`, [SCHEMA])).rows;
  return walletDigest(rows);
}
async function assertSchema(tx: WalletSql, head: HeadRow) {
  const names = (await tx.query<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind NOT IN ('i','I') ORDER BY c.relname`, [SCHEMA])).rows.map(row => row.relname);
  check(same(names, ["commands", "head"]) && head.schema_sha256 === schemaSource().sha256
    && head.catalog_sha256 === await catalog(tx), "Fiat storage schema fingerprint or complete object inventory changed");
}
async function headOf(tx: WalletSql): Promise<HeadRow> {
  const rows = (await tx.query<HeadRow>(`SELECT * FROM ${SCHEMA}.head WHERE singleton`)).rows;
  check(rows.length === 1, "Fiat singleton head is missing or duplicated"); return rows[0];
}

/** Private ownership wrapper: callbacks never receive caller-controlled SQL or a reusable authorization token. */
async function owned<T>(options: { store: WalletStore; expectedStoreId?: string; fresh?: "initialize" | "restore" },
  work: (owner: Owner) => Promise<T>): Promise<T> {
  try {
    return await options.store.transaction(async raw => {
      let transactionId: string | undefined, active = true;
      try {
        transactionId = await identity(raw, undefined, id => { transactionId = id; });
        await identity(raw, transactionId);
        const physicalId = transactionId;
        const tx: WalletSql = {
          async query<T extends Row>(sql: string, params?: unknown[]) {
            check(active, "Fiat transaction owner has expired"); await identity(raw, physicalId);
            const result = await raw.query<T>(sql, params); await identity(raw, physicalId); return result;
          },
          async exec(sql: string) { check(active, "Fiat transaction owner has expired"); await identity(raw, physicalId);
            await raw.exec(sql); await identity(raw, physicalId); },
        };
        if (options.fresh) await tx.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK]);
        const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA])).rows[0]?.present;
        check(typeof present === "boolean", "Fiat journal namespace could not be inspected");
        await isolated(tx, options.fresh !== "restore");
        check(options.fresh !== "restore" || !present, "Fiat restore requires a strictly fresh target");
        check(present || options.fresh !== undefined, "Fiat journal has not been initialized");
        let physicalStoreId: string | null = null;
        if (present) {
          const rows = (await tx.query<HeadRow>(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,
            owner_transaction_id=txid_current()::text WHERE singleton RETURNING *`)).rows;
          check(rows.length === 1, "Fiat journal physical singleton fence is missing");
          physicalStoreId = rows[0].physical_store_id;
          check(options.expectedStoreId === undefined || physicalStoreId === options.expectedStoreId,
            "Fiat operation belongs to a different physical store");
          await assertSchema(tx, rows[0]);
        }
        const owner: Owner = { tx, transactionId: physicalId, installed: present, physicalStoreId };
        const result = await work(owner);
        check(owner.installed, "Fiat fresh target cannot commit an incomplete installation");
        await isolated(tx, true); await assertSchema(tx, await headOf(tx));
        await tx.exec("SET CONSTRAINTS ALL IMMEDIATE"); await identity(raw, physicalId);
        return result;
      } catch (error) {
        if (transactionId !== undefined) await poison(raw, transactionId);
        throw publicError(error);
      } finally { active = false; }
    });
  } catch (error) { throw publicError(error); }
}
async function load(owner: Owner): Promise<TrustedPaymentJournalArchive> {
  check(owner.installed, "Fiat journal installation is missing");
  const head = await headOf(owner.tx); await assertSchema(owner.tx, head);
  check(head.physical_store_id === owner.physicalStoreId, "Fiat journal physical target changed");
  const records = (await owner.tx.query<{ record_json: TrustedPaymentJournalRecord }>(`SELECT record_json FROM ${SCHEMA}.commands ORDER BY revision LIMIT 129`)).rows.map(row => row.record_json);
  check(same(records, head.archive_json.records), "Fiat immutable commands differ from the retained archive");
  const archive = verifyTrustedPaymentJournalArchive(head.archive_json);
  check(same(archive.bootstrap, head.bootstrap) && archive.archiveSha256 === head.archive_sha256
    && archive.checkpoint.revision === head.revision && archive.checkpoint.eventHash === head.event_hash
    && archive.checkpoint.stateHash === head.state_hash
    && (archive.state.restoredTargetStoreId ?? archive.bootstrap.sourceStoreId) === head.physical_store_id,
  "Fiat archive checkpoint, original admission or physical identity disagrees");
  return archive;
}
async function insertRecord(tx: WalletSql, record: TrustedPaymentJournalRecord) {
  await tx.query(`INSERT INTO ${SCHEMA}.commands(revision,operation_id,input_hash,record_json,owner_transaction_id)
    VALUES($1,$2,$3,$4::jsonb,txid_current()::text)`, [record.revision, record.operationId, record.inputHash, json(record)]);
}
async function install(owner: Owner, archive: TrustedPaymentJournalArchive, storeId: string, kind: "initialize" | "restore") {
  check(!owner.installed && owner.physicalStoreId === null, "Fiat installation requires its unused fresh target");
  const verified = verifyTrustedPaymentJournalArchive(archive);
  check((verified.state.restoredTargetStoreId ?? verified.bootstrap.sourceStoreId) === storeId,
    "Fiat installation archive does not bind the new physical target");
  check(kind === "initialize" ? verified.records.length === 0 && verified.state.status === "recording" && verified.state.restoredTargetStoreId === null
    : verified.state.status === "quarantined" && verified.state.restoredTargetStoreId === storeId
      && verified.records.at(-1)?.command.type === "quarantine-restore",
  "Fiat installation kind disagrees with the complete logical history");
  const source = schemaSource();
  await isolated(owner.tx, false); await owner.tx.exec(source.sql);
  const catalogSha256 = await catalog(owner.tx);
  await owner.tx.query(`INSERT INTO ${SCHEMA}.head(singleton,physical_store_id,schema_sha256,catalog_sha256,bootstrap,archive_json,
    revision,event_hash,state_hash,archive_sha256,lock_version,owner_transaction_id,installation_transaction_id,installation_kind,imported_revision)
    VALUES(true,$1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,1,txid_current()::text,txid_current()::text,$10,$11)`,
  [storeId, source.sha256, catalogSha256, json(verified.bootstrap), json(verified), verified.checkpoint.revision,
    verified.checkpoint.eventHash, verified.checkpoint.stateHash, verified.archiveSha256, kind,
    kind === "restore" ? verified.records.length - 1 : 0]);
  for (const record of verified.records) await insertRecord(owner.tx, record);
  owner.installed = true; owner.physicalStoreId = storeId;
  check(same(await load(owner), verified), "Fiat installation did not retain its complete exact archive");
}
async function append(owner: Owner, before: TrustedPaymentJournalArchive, after: TrustedPaymentJournalArchive) {
  check(after.records.length === before.records.length + 1 && same(after.bootstrap, before.bootstrap)
    && same(after.records.slice(0, -1), before.records), "Fiat append cannot replace original history");
  const record = after.records.at(-1)!;
  await insertRecord(owner.tx, record);
  await owner.tx.query(`UPDATE ${SCHEMA}.head SET archive_json=$1::jsonb,revision=$2,event_hash=$3,state_hash=$4,archive_sha256=$5
    WHERE singleton`, [json(after), after.checkpoint.revision, after.checkpoint.eventHash, after.checkpoint.stateHash, after.archiveSha256]);
  check(same(await load(owner), after), "Fiat appended archive differs from verified history");
}

export interface TrustedPaymentJournalUnknownCommand {
  readonly operationId: string; readonly inputHash: string; readonly expectedStoreId: string;
  readonly expectedPreCommandCheckpoint: TrustedPaymentJournalCheckpoint;
}
export class TrustedPaymentJournalCommittedResponseUnavailableError extends Error {
  readonly code = "ALPHA_WALLET_FIAT_JOURNAL_COMMITTED_RESPONSE_UNAVAILABLE";
  readonly executionAuthority = false; readonly releaseAuthority = false;
  constructor(readonly trustedPaymentJournalRecovery: TrustedPaymentJournalUnknownCommand) {
    super("Fiat journal commit was acknowledged; recover the exact retained receipt on the same physical target");
    this.name = "TrustedPaymentJournalCommittedResponseUnavailableError";
  }
}
export type TrustedPaymentJournalReconciliation = Readonly<{
  status: "committed" | "not-recorded" | "not-recorded-stale" | "unresolved";
  executionAuthority: false; releaseAuthority: false;
  receipt: TrustedPaymentJournalReceipt | null; archive: TrustedPaymentJournalArchive | null;
}>;
function attachRecovery(error: unknown, value: TrustedPaymentJournalUnknownCommand | undefined) {
  if (unknownCommit(error) && value && Object.isExtensible(error))
    Object.defineProperty(error, "trustedPaymentJournalRecovery", { value: inert(value), enumerable: true });
}
function checkpoint(value: unknown): TrustedPaymentJournalCheckpoint {
  const row = fields(value, ["revision", "eventHash", "stateHash", "lastCommandAtMs"]);
  check(Number.isSafeInteger(row.revision) && Number(row.revision) >= 0 && Number(row.revision) <= 128
    && Number.isSafeInteger(row.lastCommandAtMs) && Number(row.lastCommandAtMs) > 0,
  "Fiat recovery checkpoint is invalid", "INVALID_INPUT");
  return inert({ revision: row.revision, eventHash: hash(row.eventHash), stateHash: hash(row.stateHash), lastCommandAtMs: row.lastCommandAtMs });
}

export async function initializeDevelopmentTrustedPaymentJournal(supplied: {
  mode: "simulation-only"; store: WalletStore; manifest: unknown; sourceStoreId?: string; clock: () => number;
}): Promise<TrustedPaymentJournalArchive> {
  runtime();
  const options = fields(supplied, ["mode", "store", "manifest", "sourceStoreId", "clock"]); runtime(options.mode);
  const store = storeCapability(options.store), clock = clockCapability(options.clock);
  const input = capture(() => ({ admission: captureTrustedPaymentManifest(options.manifest),
    explicitId: options.sourceStoreId === undefined ? undefined : identifier(options.sourceStoreId), atMs: clock() }));
  const allocatedId = `fiat_${randomUUID()}`;
  let expected: TrustedPaymentJournalArchive | undefined;
  const returned = await owned({ store, fresh: "initialize" }, async owner => {
    const value = captured(input), sourceStoreId = value.explicitId ?? allocatedId;
    if (!owner.installed) await install(owner, createTrustedPaymentJournalArchive({ mode: "simulation-only",
      manifest: value.admission.manifest, sourceStoreId, atMs: value.atMs }), sourceStoreId, "initialize");
    const archive = await load(owner);
    check(archive.bootstrap.manifestSha256 === value.admission.manifestSha256 && archive.state.restoredTargetStoreId === null
      && (value.explicitId === undefined || archive.bootstrap.sourceStoreId === value.explicitId),
    "Fiat initialization differs from its immutable original admission or physical identity");
    expected = archive; return archive;
  });
  check(expected && same(inert(returned), expected), "Fiat initialization response is unavailable; inspect the same initialized target");
  return expected;
}

/** Private adapter capability; supplied identifiers are fixture attribution, never user authentication. */
export function createDevelopmentTrustedPaymentJournal(supplied: {
  mode: "simulation-only"; store: WalletStore; manifest: unknown; storeId: string; clock: () => number;
}) {
  runtime();
  const options = fields(supplied, ["mode", "store", "manifest", "storeId", "clock"]); runtime(options.mode);
  const store = storeCapability(options.store), admission = captureTrustedPaymentManifest(options.manifest);
  const storeId = identifier(options.storeId), clock = clockCapability(options.clock);
  async function inStore<T>(work: (archive: TrustedPaymentJournalArchive, owner: Owner) => Promise<T>): Promise<T> {
    return owned({ store, expectedStoreId: storeId }, async owner => {
      const archive = await load(owner);
      check(archive.bootstrap.manifestSha256 === admission.manifestSha256, "Fiat adapter admission differs from the retained source");
      return work(archive, owner);
    });
  }
  async function verifiedRead<T>(work: (archive: TrustedPaymentJournalArchive) => Promise<T>): Promise<T> {
    let executed = false, expected!: T;
    const returned = await inStore(async archive => { expected = await work(archive); executed = true; return expected; });
    let matches = false; try { matches = executed && same(inert(returned), expected); } catch { /* Never invoke a substituted response. */ }
    check(matches, "Fiat read response differs from the result of its certified physical participant");
    return expected;
  }
  async function execute(build: () => unknown): Promise<TrustedPaymentJournalReceipt> {
    const input = capture(() => {
      const command = inert<TrustedPaymentJournalPublicCommand>(build());
      return { command, inputHash: trustedPaymentJournalCommandDigest(command), atMs: clock() };
    });
    let recovery: TrustedPaymentJournalUnknownCommand | undefined, expected: TrustedPaymentJournalReceipt | undefined;
    try {
      const result = await inStore(async (archive, owner) => {
        const value = captured(input);
        recovery = inert({ operationId: value.command.operationId, inputHash: value.inputHash,
          expectedStoreId: storeId, expectedPreCommandCheckpoint: archive.checkpoint });
        const next = appendTrustedPaymentJournal(archive, value.command, value.atMs);
        if (!next.replayed) await append(owner, archive, next.archive);
        expected = next.receipt; return next.receipt;
      });
      check(expected && recovery, "Fiat store capability did not execute its certified participant");
      let matches = false; try { matches = same(inert(result), expected); } catch { /* Retain acknowledged outcome without invoking returned getters. */ }
      if (!matches) throw new TrustedPaymentJournalCommittedResponseUnavailableError(recovery);
      return expected;
    } catch (error) { attachRecovery(error, recovery); throw error; }
  }
  async function inspect() {
    return verifiedRead(async archive => archive);
  }
  async function lookupReceipt(value: { operationId: string; inputHash: string }) {
    const input = capture(() => {
      const row = fields(value, ["operationId", "inputHash"]);
      return { operationId: identifier(row.operationId), inputHash: hash(row.inputHash) };
    });
    return verifiedRead(async archive => findTrustedPaymentJournalReceipt(archive, captured(input)));
  }
  async function reconcileUnknown(value: TrustedPaymentJournalUnknownCommand): Promise<TrustedPaymentJournalReconciliation> {
    const input = capture(() => {
      const row = fields(value, ["operationId", "inputHash", "expectedStoreId", "expectedPreCommandCheckpoint"]);
      return { operationId: identifier(row.operationId), inputHash: hash(row.inputHash), expectedStoreId: identifier(row.expectedStoreId),
        expectedPreCommandCheckpoint: checkpoint(row.expectedPreCommandCheckpoint) };
    });
    const unresolved = (): TrustedPaymentJournalReconciliation => Object.freeze({ status: "unresolved", executionAuthority: false,
      releaseAuthority: false, receipt: null, archive: null });
    try {
      return await verifiedRead(async archive => {
        const query = captured(input);
        if (query.expectedStoreId !== storeId) return unresolved();
        const receipt = findTrustedPaymentJournalReceipt(archive, { operationId: query.operationId, inputHash: query.inputHash });
        if (archive.state.restoredTargetStoreId !== null) {
          const restoration = archive.records.at(-1);
          // A restored target proves its own restoration receipt, never an absent or post-backup source operation.
          return receipt && restoration?.command.type === "quarantine-restore" && restoration.command.targetStoreId === storeId
            && same(restoration.receipt, receipt)
            ? inert({ status: "committed", executionAuthority: false, releaseAuthority: false, receipt, archive }) : unresolved();
        }
        if (receipt) return inert({ status: "committed", executionAuthority: false, releaseAuthority: false, receipt, archive });
        const before = query.expectedPreCommandCheckpoint;
        const prior = before.revision === 0 ? createTrustedPaymentJournalArchive({ mode: "simulation-only", manifest: archive.bootstrap.manifest,
          sourceStoreId: archive.bootstrap.sourceStoreId, atMs: archive.bootstrap.createdAtMs }).checkpoint
          : archive.records.find(record => record.revision === before.revision);
        const known = prior && "receipt" in prior ? { revision: prior.revision, eventHash: prior.eventHash,
          stateHash: prior.stateHash, lastCommandAtMs: prior.occurredAtMs } : prior;
        if (!known || !same(known, before)) return unresolved();
        return inert({ status: same(before, archive.checkpoint) ? "not-recorded" : "not-recorded-stale", executionAuthority: false,
          releaseAuthority: false, receipt: null, archive });
      });
    } catch (error) {
      runtime(); if (unknownCommit(error) || (error instanceof TrustedPaymentJournalError && error.code === "INTEGRITY")) return unresolved();
      throw error;
    }
  }
  async function exportBackup(): Promise<TrustedPaymentJournalBackup> {
    const at = capture(clock);
    return verifiedRead(async archive => createTrustedPaymentJournalBackup(archive, captured(at)));
  }
  return Object.freeze({ mode: "simulation-only" as const, executionAuthority: false as const, releaseAuthority: false as const,
    storeId, inspect, snapshot: inspect, lookupReceipt, reconcileUnknown, exportBackup,
    record(value: { operationId: string; prepared: PreparedTrustedPaymentEvidenceV1 }) {
      return execute(() => ({ ...fields(value, ["operationId", "prepared"]), type: "record" }));
    },
    pause(value: { operationId: string; reasonCode: "manual-review" | "source-unavailable" | "maintenance" }) {
      return execute(() => ({ ...fields(value, ["operationId", "reasonCode"]), type: "pause" }));
    },
  });
}

/** Atomic fresh-target installation retains original receipts and appends one permanent quarantine. */
export async function restoreDevelopmentTrustedPaymentJournal(supplied: {
  mode: "simulation-only"; store: WalletStore; backup: unknown; expectedChecksum: string;
  operationId: string; targetStoreId?: string; acknowledgeFreshTarget: true; clock: () => number;
}): Promise<{ archive: TrustedPaymentJournalArchive; receipt: TrustedPaymentJournalReceipt }> {
  runtime();
  const options = fields(supplied, ["mode", "store", "backup", "expectedChecksum", "operationId", "targetStoreId", "acknowledgeFreshTarget", "clock"]);
  runtime(options.mode); const store = storeCapability(options.store), clock = clockCapability(options.clock);
  const allocatedId = `fiat_${randomUUID()}`;
  const input = capture(() => {
    check(options.acknowledgeFreshTarget === true, "Fiat recovery requires acknowledgement of a physically fresh target", "INVALID_INPUT");
    const backup = verifyTrustedPaymentJournalBackup(options.backup);
    check(backup.backupSha256 === hash(options.expectedChecksum), "Fiat backup differs from its independently retained expected checksum");
    const targetStoreId = options.targetStoreId === undefined ? allocatedId : identifier(options.targetStoreId);
    const archive = restoreTrustedPaymentJournalArchive({ backup, operationId: identifier(options.operationId), targetStoreId, atMs: clock() });
    return { backup, archive, targetStoreId };
  });
  let expected: { archive: TrustedPaymentJournalArchive; receipt: TrustedPaymentJournalReceipt } | undefined;
  let recovery: TrustedPaymentJournalUnknownCommand | undefined;
  try {
    const returned = await owned({ store, fresh: "restore" }, async owner => {
      const { backup, archive, targetStoreId } = captured(input), receipt = archive.records.at(-1)!.receipt;
      recovery = inert({ operationId: receipt.operationId, inputHash: receipt.inputHash, expectedStoreId: targetStoreId,
        expectedPreCommandCheckpoint: backup.archive.checkpoint });
      await install(owner, archive, targetStoreId, "restore");
      expected = { archive: await load(owner), receipt }; return expected;
    });
    check(expected && recovery, "Fiat restore capability did not execute its certified participant");
    let matches = false; try { matches = same(inert(returned), expected); } catch { /* Recovery uses the exact original physical target. */ }
    if (!matches) throw new TrustedPaymentJournalCommittedResponseUnavailableError(recovery);
    return expected;
  } catch (error) { attachRecovery(error, recovery); throw error; }
}
