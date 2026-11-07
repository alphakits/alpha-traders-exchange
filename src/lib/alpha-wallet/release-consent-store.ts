import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { walletDigest, walletJson } from "./commands";
import { captureInboxData, captureInboxOptions } from "./deposit-inbox-data";
import type { WalletSql } from "./durable-store";
import { withPaymentMarketplaceContext, type PaymentMarketplaceContext } from "./payment-marketplace-coordination-store";
import { assertSimulationRuntime } from "./runtime";
import {
  appendReleaseConsent, MAX_RELEASE_CONSENT_BYTES, ReleaseConsentError, restoreReleaseConsentArchive,
  verifyReleaseConsentArchive, verifyReleaseConsentBackup,
  type ReleaseConsentArchive, type ReleaseConsentCurrentBasis, type ReleaseConsentPublicCommand,
  type ReleaseConsentReceipt, type ReleaseConsentRecord,
} from "./release-consent-model";

/** Same-transaction, nonauthoritative evidence and consent. The retained V5 engine is unchanged. */
export const RELEASE_CONSENT_SCHEMA = "alpha_wallet_release_consent_simulation";
const SCHEMA = RELEASE_CONSENT_SCHEMA;
const BOOTSTRAP_LOCK = 61422929;
const UTC_NAMES = new Set(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"]);
const BASE_SCHEMAS = ["alpha_exchange", "alpha_wallet_cancellation_marketplace_simulation",
  "alpha_wallet_initial_marketplace_simulation", "alpha_wallet_payment_marketplace_simulation", "alpha_wallet_simulation"];
type Row = Record<string, unknown>;
type Head = Row & {
  physical_store_id: string; request_id: string; schema_sha256: string; catalog_sha256: string;
  bootstrap: ReleaseConsentArchive["bootstrap"]; archive_json: ReleaseConsentArchive;
  revision: number; event_hash: string; state_hash: string; archive_sha256: string;
  owner_transaction_id: string; installation_transaction_id: string;
  installation_kind: "enroll" | "restore"; imported_revision: number; payment_backup_checksum: string | null;
  target_store_id: string | null; source_physical_store_id: string | null; combined_backup_checksum: string | null;
};
type Captured<T> = { value: T; error?: never } | { error: unknown; value?: never };
type Owner = { tx: WalletSql; transactionId: string; requestId: string; actorUserId: string | null };
export type StoredReleaseConsentOverlay = { archive: ReleaseConsentArchive; physicalStoreId: string };
export type ReleaseConsentStoredResult = StoredReleaseConsentOverlay & { receipt: ReleaseConsentReceipt; replayed: boolean };

function check(value: unknown, message: string, code: ReleaseConsentError["code"] = "INTEGRITY"): asserts value {
  if (!value) throw new ReleaseConsentError(code, message);
}
function runtime(mode: unknown = "simulation-only") {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new ReleaseConsentError("RUNTIME_REFUSED", "Consent storage requires explicit local simulation-only runtime"); }
}
function inert<T>(value: unknown): T {
  try { return captureInboxData<T>(value, { maxBytes: MAX_RELEASE_CONSENT_BYTES, maxNodes: 100_000, maxDepth: 64 }); }
  catch { throw new ReleaseConsentError("INVALID_INPUT", "Consent storage requires bounded inert JSON data"); }
}
function fields(value: unknown, keys: readonly string[]) {
  try { return captureInboxOptions(value, keys); }
  catch { throw new ReleaseConsentError("INVALID_INPUT", "Consent storage options must contain only their explicit fields"); }
}
function capture<T>(work: () => T): Captured<T> { try { return { value: work() }; } catch (error) { return { error }; } }
function captured<T>(value: Captured<T>): T { if ("error" in value) throw value.error; return value.value; }
function identifier(value: unknown): string {
  check(typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    && !["constructor", "prototype", "__proto__"].includes(value), "Invalid consent storage identity", "INVALID_INPUT");
  return value;
}
function hash(value: unknown): string {
  check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "Invalid consent storage digest", "INVALID_INPUT"); return value;
}
const same = (left: unknown, right: unknown) => walletDigest(left) === walletDigest(right);
const json = (value: unknown) => JSON.stringify(walletJson(inert(value)));
function schemaSource() {
  const sql = readFileSync(new URL("../../../docs/alpha-wallet/release-consent-schema.sql", import.meta.url), "utf8");
  return { sql, sha256: createHash("sha256").update(sql, "utf8").digest("hex") };
}
async function identity(tx: WalletSql, expected?: string, retained?: (id: string) => void) {
  runtime();
  const rows = (await tx.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null; time_zone: string }>(
    `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode,
      current_setting('TimeZone') AS time_zone`)).rows;
  const row = rows[0];
  check(rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || row.transaction_id === expected), "Consent storage physical transaction changed or ended");
  retained?.(row.transaction_id);
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only"
    && UTC_NAMES.has(row.time_zone), "Consent storage requires writable SERIALIZABLE simulation in fixed UTC", "RUNTIME_REFUSED");
  runtime(); return row.transaction_id;
}
async function poison(tx: WalletSql, transactionId: string) {
  try {
    const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
    if (rows.length === 1 && rows[0].transaction_id === transactionId)
      await tx.query("SELECT 1 / 0 /* abort failed release consent participant */");
  } catch { /* The owner rolls back the original physical transaction, never a substituted one. */ }
}
async function inTransaction<T>(raw: WalletSql, work: (tx: WalletSql, transactionId: string) => Promise<T>): Promise<T> {
  let transactionId: string | undefined, active = true;
  try {
    transactionId = await identity(raw, undefined, id => { transactionId = id; });
    const retained = transactionId;
    const tx: WalletSql = {
      async query<T extends Row>(sql: string, params?: unknown[]) {
        check(active, "Consent participant has expired"); await identity(raw, retained);
        const result = await raw.query<T>(sql, params); await identity(raw, retained); return result;
      },
      async exec(sql: string) {
        check(active, "Consent participant has expired"); await identity(raw, retained);
        await raw.exec(sql); await identity(raw, retained);
      },
    };
    const result = await work(tx, retained); await identity(raw, retained); return result;
  } catch (error) { if (transactionId !== undefined) await poison(raw, transactionId); throw error; }
  finally { active = false; }
}
async function inContext<T>(mode: unknown, context: PaymentMarketplaceContext, work: (owner: Owner) => Promise<T>): Promise<T> {
  return withPaymentMarketplaceContext(context, async registered => {
    runtime(mode);
    check(registered.phase === "successor" && registered.operation === "inspect" && !registered.command,
      "Consent participant requires an unchanged V5 inspection context with the actual current principal");
    return inTransaction(registered.tx, async (tx, transactionId) => {
      check(transactionId === registered.transactionId, "Consent and canonical participants have different physical owners");
      return work({ tx, transactionId, requestId: registered.requestId, actorUserId: registered.actorUserId });
    });
  });
}
async function scope(tx: WalletSql, overlay: boolean) {
  const actual = (await tx.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname !~ '^pg_(toast|temp_[0-9]+|toast_temp_[0-9]+)$' ORDER BY nspname`)).rows.map(row => row.nspname);
  check(same(actual, [...BASE_SCHEMAS, ...(overlay ? [SCHEMA] : [])].sort()),
    "Consent storage requires its exact original combined V5 namespace scope");
}
async function present(tx: WalletSql) {
  const rows = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA])).rows;
  check(rows.length === 1 && typeof rows[0].present === "boolean", "Consent namespace could not be inspected"); return rows[0].present;
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
async function assertSchema(tx: WalletSql, head: Head) {
  const names = (await tx.query<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind NOT IN ('i','I') ORDER BY c.relname`, [SCHEMA])).rows.map(row => row.relname);
  check(same(names, ["head", "records", "transaction_contexts"]) && head.schema_sha256 === schemaSource().sha256
    && head.catalog_sha256 === await catalog(tx), "Consent schema fingerprint or complete object inventory changed");
}
async function headOf(tx: WalletSql): Promise<Head> {
  const rows = (await tx.query<Head>(`SELECT * FROM ${SCHEMA}.head WHERE singleton`)).rows;
  check(rows.length === 1, "Consent singleton head is missing or duplicated"); return rows[0];
}
async function lock(owner: Owner, sourceStoreId?: string) {
  const before = await headOf(owner.tx);
  if (before.owner_transaction_id !== owner.transactionId) {
    const rows = (await owner.tx.query<Head>(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,
      owner_transaction_id=txid_current()::text WHERE singleton RETURNING *`)).rows;
    check(rows.length === 1, "Consent physical singleton fence is missing");
  }
  const head = await headOf(owner.tx);
  check(head.request_id === owner.requestId && (sourceStoreId === undefined || head.bootstrap.sourceStoreId === sourceStoreId),
    "Consent participant targets a different retained request or original store");
  await assertSchema(owner.tx, head); return head;
}
function normalizedHistory(rows: unknown[]): unknown[] {
  return rows.map(value => {
    const row = inert<Record<string, unknown>>(value);
    return { ...row, revision: Number(row.revision), occurred_at_ms: String(row.occurred_at_ms) };
  });
}
async function retainedHistories(tx: WalletSql, archive: ReleaseConsentArchive) {
  const actual = normalizedHistory((await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
    command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision LIMIT 100001`)).rows);
  const prepared = [archive.bootstrap.initialPrepared, ...archive.records.flatMap(record => record.command.type === "observe" ? [record.command.prepared] : [])];
  for (const item of prepared) check(item.walletHistory.length <= actual.length
    && same(normalizedHistory(item.walletHistory), actual.slice(0, item.walletHistory.length)),
  "Consent evidence contains a different retained V5 history or alternate fork");
}
async function load(owner: Owner, head: Head): Promise<StoredReleaseConsentOverlay> {
  const records = (await owner.tx.query<{ record_json: ReleaseConsentRecord }>(
    `SELECT record_json FROM ${SCHEMA}.records ORDER BY revision LIMIT 129`)).rows.map(row => row.record_json);
  check(same(records, head.archive_json.records), "Consent immutable records differ from its retained archive");
  const archive = verifyReleaseConsentArchive(head.archive_json);
  check(same(archive.bootstrap, head.bootstrap) && archive.archiveSha256 === head.archive_sha256
    && archive.checkpoint.revision === head.revision && archive.checkpoint.eventHash === head.event_hash
    && archive.checkpoint.stateHash === head.state_hash
    && archive.state.restoredTargetStoreId === head.target_store_id
    && (head.installation_kind === "enroll" ? head.target_store_id === null && head.source_physical_store_id === null
      : head.target_store_id !== null && head.source_physical_store_id !== head.physical_store_id),
  "Consent archive checkpoint, admission or physical identity disagrees");
  await retainedHistories(owner.tx, archive);
  return { archive, physicalStoreId: head.physical_store_id };
}
async function actor(owner: Owner, operation: "inspect" | ReleaseConsentPublicCommand["type"] | "enroll") {
  const rows = (await owner.tx.query<{ seller: boolean; owner: boolean }>(`SELECT account.id=request.seller_id AS seller,
    (account.role='owner' OR account.payload->'roles' ? 'owner') AS owner
    FROM alpha_exchange.users account JOIN alpha_exchange.purchase_requests request ON request.id=$1 WHERE account.id=$2`,
  [owner.requestId, owner.actorUserId])).rows;
  check(rows.length === 1 && ((operation === "consent" || operation === "revoke") ? rows[0].seller
    : operation === "inspect" ? rows[0].seller || rows[0].owner : rows[0].owner),
  "Consent operation does not belong to its retained seller or current owner", "ACTOR_REFUSED");
}
async function independentSources(tx: WalletSql, archive: ReleaseConsentArchive) {
  const authorities = archive.bootstrap.manifest.sources.map(source => source.authorityId);
  const rows = (await tx.query<{ id: string }>("SELECT id FROM alpha_exchange.users WHERE id=ANY($1::text[]) LIMIT 1", [authorities])).rows;
  check(rows.length === 0, "An admitted source authority cannot be any canonical platform user", "ACTOR_REFUSED");
}
async function currentBasis(tx: WalletSql, requestId: string, basis: ReleaseConsentCurrentBasis) {
  const rows = (await tx.query<{ basis: ReleaseConsentCurrentBasis }>(`SELECT ${SCHEMA}.capture_current_basis($1) AS basis`, [requestId])).rows;
  check(rows.length === 1 && same(rows[0].basis, basis), "Consent basis differs from current physical V5 and canonical state", "STALE_BASIS");
}
async function register(owner: Owner, record: ReleaseConsentRecord, expectedCheckpoint: unknown) {
  check(record.command.type !== "quarantine-restore" && record.command.actorUserId === owner.actorUserId,
    "Consent command actor differs from the actual same-transaction principal", "ACTOR_REFUSED");
  await owner.tx.query(`INSERT INTO ${SCHEMA}.transaction_contexts(transaction_id,request_id,actor_user_id,operation,
    planned_command,input_hash,current_basis,expected_checkpoint,occurred_at_ms)
    VALUES(txid_current()::text,$1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8)`,
  [owner.requestId, owner.actorUserId, record.command.type, json(record.command), record.inputHash,
    json(record.currentBasis), expectedCheckpoint === null ? null : json(expectedCheckpoint), record.occurredAtMs]);
}
async function insertRecord(tx: WalletSql, record: ReleaseConsentRecord) {
  await tx.query(`INSERT INTO ${SCHEMA}.records(revision,operation_id,input_hash,record_json,owner_transaction_id)
    VALUES($1,$2,$3,$4::jsonb,txid_current()::text)`, [record.revision, record.operationId, record.inputHash, json(record)]);
}
async function install(owner: Owner, archive: ReleaseConsentArchive, physicalStoreId: string,
  kind: "enroll" | "restore", paymentBackupChecksum: string | null,
  sourcePhysicalStoreId: string | null = null, combinedBackupChecksum: string | null = null) {
  check(!await present(owner.tx), "Consent installation requires an unused overlay namespace");
  await scope(owner.tx, false); await owner.tx.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK]);
  const source = schemaSource(); await owner.tx.exec(source.sql);
  if (kind === "enroll") {
    await currentBasis(owner.tx, owner.requestId, archive.bootstrap.initialBasis);
    await register(owner, archive.records[0], null);
  }
  const catalogSha256 = await catalog(owner.tx);
  await owner.tx.query(`INSERT INTO ${SCHEMA}.head(singleton,physical_store_id,request_id,schema_sha256,catalog_sha256,bootstrap,archive_json,
    revision,event_hash,state_hash,archive_sha256,lock_version,owner_transaction_id,installation_transaction_id,installation_kind,
    imported_revision,payment_backup_checksum,target_store_id,source_physical_store_id,combined_backup_checksum)
    VALUES(true,$1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,1,txid_current()::text,txid_current()::text,$11,$12,$13,$14,$15,$16)`,
  [physicalStoreId, owner.requestId, source.sha256, catalogSha256, json(archive.bootstrap), json(archive), archive.checkpoint.revision,
    archive.checkpoint.eventHash, archive.checkpoint.stateHash, archive.archiveSha256, kind, kind === "restore" ? archive.records.length - 1 : 0,
    paymentBackupChecksum, archive.state.restoredTargetStoreId, sourcePhysicalStoreId, combinedBackupChecksum]);
  for (const record of archive.records) await insertRecord(owner.tx, record);
  await scope(owner.tx, true); await assertSchema(owner.tx, await headOf(owner.tx));
  check(same((await load(owner, await headOf(owner.tx))).archive, archive), "Consent installation changed its complete immutable history");
  await owner.tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
}

/** Parent must acquire the canonical fences and coordinated V5 snapshot before this overlay participant. */
export async function loadReleaseConsentOverlay(options: {
  mode: "simulation-only"; context: PaymentMarketplaceContext; sourceStoreId: string;
}): Promise<StoredReleaseConsentOverlay | null> {
  const input = capture(() => { const data = fields(options, ["mode", "context", "sourceStoreId"]); return identifier(data.sourceStoreId); });
  return inContext(options.mode, options.context, async owner => {
    const sourceStoreId = captured(input); await actor(owner, "inspect");
    const exists = await present(owner.tx); await scope(owner.tx, exists);
    return exists ? load(owner, await lock(owner, sourceStoreId)) : null;
  });
}
export async function enrollReleaseConsentOverlay(options: {
  mode: "simulation-only"; context: PaymentMarketplaceContext; archive: ReleaseConsentArchive; currentBasis: ReleaseConsentCurrentBasis;
}): Promise<ReleaseConsentStoredResult> {
  const input = capture(() => { const data = fields(options, ["mode", "context", "archive", "currentBasis"]);
    return { archive: inert<ReleaseConsentArchive>(data.archive), basis: inert<ReleaseConsentCurrentBasis>(data.currentBasis) }; });
  return inContext(options.mode, options.context, async owner => {
    const data = captured(input), archive = verifyReleaseConsentArchive(data.archive);
    await actor(owner, "enroll");
    check(archive.records.length === 1 && archive.records[0].command.type === "enroll"
      && archive.bootstrap.enrollingOwnerId === owner.actorUserId && same(data.basis, archive.bootstrap.initialBasis)
      && archive.bootstrap.initialPrepared.walletContext.platformRequestId === owner.requestId,
    "Consent enrollment requires its exact owner, acknowledged original claim and first record");
    await independentSources(owner.tx, archive); await retainedHistories(owner.tx, archive);
    if (await present(owner.tx)) {
      await scope(owner.tx, true);
      const stored = await load(owner, await lock(owner, archive.bootstrap.sourceStoreId));
      check(same(stored.archive.bootstrap, archive.bootstrap), "Consent enrollment cannot replace original native identity or admission");
      return { ...stored, receipt: stored.archive.records[0].receipt, replayed: true };
    }
    const physicalStoreId = `release_${randomUUID().replaceAll("-", "")}`;
    await install(owner, archive, physicalStoreId, "enroll", null);
    return { archive, physicalStoreId, receipt: archive.records[0].receipt, replayed: false };
  });
}
export async function appendReleaseConsentOverlay(options: {
  mode: "simulation-only"; context: PaymentMarketplaceContext; sourceStoreId: string;
  command: ReleaseConsentPublicCommand; currentBasis: ReleaseConsentCurrentBasis; atMs: number;
}): Promise<ReleaseConsentStoredResult> {
  const input = capture(() => { const data = fields(options, ["mode", "context", "sourceStoreId", "command", "currentBasis", "atMs"]);
    return { sourceStoreId: identifier(data.sourceStoreId), command: inert<ReleaseConsentPublicCommand>(data.command),
      basis: inert<ReleaseConsentCurrentBasis>(data.currentBasis), atMs: data.atMs as number }; });
  return inContext(options.mode, options.context, async owner => {
    const data = captured(input); await scope(owner.tx, true);
    const before = await load(owner, await lock(owner, data.sourceStoreId));
    check(data.command.actorUserId === owner.actorUserId, "Consent command actor differs from authenticated context", "ACTOR_REFUSED");
    await actor(owner, data.command.type); await currentBasis(owner.tx, owner.requestId, data.basis);
    if (data.command.type === "observe" || data.command.type === "consent") await independentSources(owner.tx, before.archive);
    const result = appendReleaseConsent(before.archive, data.command, data.basis, data.atMs);
    if (!result.replayed) {
      const record = result.archive.records.at(-1)!;
      await retainedHistories(owner.tx, result.archive); await register(owner, record, before.archive.checkpoint);
      await insertRecord(owner.tx, record);
      await owner.tx.query(`UPDATE ${SCHEMA}.head SET archive_json=$1::jsonb,revision=$2,event_hash=$3,state_hash=$4,archive_sha256=$5
        WHERE singleton`, [json(result.archive), result.archive.checkpoint.revision, result.archive.checkpoint.eventHash,
        result.archive.checkpoint.stateHash, result.archive.archiveSha256]);
      check(same((await load(owner, await headOf(owner.tx))).archive, result.archive), "Consent appended history differs from verified result");
      await owner.tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    }
    return { ...result, physicalStoreId: before.physicalStoreId };
  });
}

async function recoveredBase(tx: WalletSql, expectedChecksum?: string, sameInstallationTransaction?: string) {
  const exists = (await tx.query<{ present: boolean }>(
    "SELECT to_regclass('alpha_wallet_payment_marketplace_simulation.recovery_receipts') IS NOT NULL AS present")).rows[0]?.present;
  check(exists, "Consent restore requires the completed frozen combined V5 restore");
  const rows = (await tx.query<{ bootstrap_transaction_id: string; receipt: Record<string, unknown> }>(
    "SELECT bootstrap_transaction_id,receipt FROM alpha_wallet_payment_marketplace_simulation.recovery_receipts WHERE singleton")).rows;
  const row = rows[0];
  check(rows.length === 1 && row && row.receipt && typeof row.receipt.requestId === "string"
    && (expectedChecksum === undefined || row.receipt.checksum === expectedChecksum)
    && (sameInstallationTransaction === undefined || row.bootstrap_transaction_id === sameInstallationTransaction),
  "Consent restoration must follow the exact completed legacy backup restore in its original physical transaction");
  await tx.query("SELECT alpha_wallet_payment_marketplace_simulation.assert_recovery_receipt()");
  return row.receipt;
}
/** Staged import only: caller owns the complete combined restore transaction and exact legacy base receipt. */
export async function restoreReleaseConsentOverlayInTransaction(options: {
  mode: "simulation-only"; tx: WalletSql; backup: unknown; operationId: string; targetStoreId: string; atMs: number;
  expectedPaymentBackupChecksum: string; sourcePhysicalStoreId: string; combinedBackupChecksum: string;
}): Promise<ReleaseConsentStoredResult> {
  const input = capture(() => { const data = fields(options, ["mode", "tx", "backup", "operationId", "targetStoreId", "atMs", "expectedPaymentBackupChecksum",
    "sourcePhysicalStoreId", "combinedBackupChecksum"]);
    return { backup: inert(data.backup), operationId: identifier(data.operationId), targetStoreId: identifier(data.targetStoreId),
      atMs: data.atMs as number, checksum: hash(data.expectedPaymentBackupChecksum), sourcePhysicalStoreId: identifier(data.sourcePhysicalStoreId),
      combinedBackupChecksum: hash(data.combinedBackupChecksum) }; });
  return inTransaction(options.tx, async (tx, transactionId) => {
    runtime(options.mode); const data = captured(input), backup = verifyReleaseConsentBackup(data.backup);
    await scope(tx, false);
    const receipt = await recoveredBase(tx, data.checksum, transactionId);
    const requestId = backup.archive.bootstrap.initialPrepared.walletContext.platformRequestId;
    check(receipt.requestId === requestId, "Consent recovery belongs to another legacy request");
    const archive = restoreReleaseConsentArchive({ backup, operationId: data.operationId, targetStoreId: data.targetStoreId, atMs: data.atMs });
    const owner: Owner = { tx, transactionId, requestId, actorUserId: null };
    const physicalStoreId = `release_${randomUUID().replaceAll("-", "")}`;
    check(physicalStoreId !== data.sourcePhysicalStoreId, "Consent restoration cannot reuse its original physical installation identity");
    await retainedHistories(tx, archive); await install(owner, archive, physicalStoreId, "restore", data.checksum,
      data.sourcePhysicalStoreId, data.combinedBackupChecksum);
    return { archive, physicalStoreId, receipt: archive.records.at(-1)!.receipt, replayed: false };
  });
}
/** Disabled restored identities cannot authenticate. This raw participant only inspects a proven permanent combined quarantine. */
export async function readRestoredReleaseConsentOverlayInTransaction(options: {
  mode: "simulation-only"; tx: WalletSql; expectedPaymentBackupChecksum: string;
}): Promise<StoredReleaseConsentOverlay> {
  const input = capture(() => { const data = fields(options, ["mode", "tx", "expectedPaymentBackupChecksum"]); return hash(data.expectedPaymentBackupChecksum); });
  return inTransaction(options.tx, async (tx, transactionId) => {
    runtime(options.mode); const checksum = captured(input); await scope(tx, true);
    const receipt = await recoveredBase(tx, checksum), requestId = identifier(receipt.requestId);
    const owner: Owner = { tx, transactionId, requestId, actorUserId: null }, head = await lock(owner);
    check(head.installation_kind === "restore" && head.payment_backup_checksum === checksum,
      "Consent inspection requires its exact permanent combined recovery quarantine");
    const result = await load(owner, head);
    check(result.archive.state.status === "quarantined" && result.archive.state.restoredTargetStoreId === head.target_store_id,
      "Restored consent history cannot regain recording authority");
    return result;
  });
}

/** Strict inventory used by the complete recovery reader; no rows or extra objects are silently omitted. */
export async function assertReleaseConsentOverlaySchema(tx: WalletSql): Promise<void> {
  return inTransaction(tx, async scoped => {
    await scope(scoped, true); await assertSchema(scoped, await headOf(scoped));
  });
}

export async function readReleaseConsentRestoredOverlay(options: {
  mode: "simulation-only"; tx: WalletSql; targetStoreId: string;
}): Promise<StoredReleaseConsentOverlay & { sourcePhysicalStoreId: string; combinedBackupChecksum: string; paymentBackupChecksum: string }> {
  const input = capture(() => { const data = fields(options, ["mode", "tx", "targetStoreId"]); return identifier(data.targetStoreId); });
  return inTransaction(options.tx, async (tx, transactionId) => {
    runtime(options.mode); const targetStoreId = captured(input); await scope(tx, true);
    const head = await headOf(tx);
    check(head.installation_kind === "restore" && head.target_store_id === targetStoreId && head.payment_backup_checksum !== null
      && head.combined_backup_checksum !== null && head.source_physical_store_id !== null
      && head.physical_store_id !== head.source_physical_store_id, "Consent target is not a complete distinct restored installation");
    const receipt = await recoveredBase(tx, head.payment_backup_checksum);
    const owner: Owner = { tx, transactionId, requestId: identifier(receipt.requestId), actorUserId: null };
    const result = await load(owner, await lock(owner));
    check(result.archive.state.status === "quarantined" && result.archive.state.restoredTargetStoreId === targetStoreId,
      "Restored consent history cannot regain recording authority");
    return { ...result, sourcePhysicalStoreId: head.source_physical_store_id,
      combinedBackupChecksum: head.combined_backup_checksum, paymentBackupChecksum: head.payment_backup_checksum };
  });
}
