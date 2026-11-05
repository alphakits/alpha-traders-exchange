import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WalletBackupError, type WalletBackupCheckpoint } from "./backup";
import { walletDigest } from "./commands";
import type { WalletSql, WalletStore } from "./durable-store";
import {
  initialMarketplaceCanonicalRowsSchema, initialMarketplaceCoordinationRowsSchema,
  type InitialMarketplaceRecoveryRows,
} from "./initial-marketplace-backup-manifest";
import { assertSimulationRuntime } from "./runtime";
import { createV3DurableWallet } from "./v3-durable";
import { isV3State } from "./v3-engine";

type Row = Record<string, unknown>;
type Column = { type: "text" | "jsonb" | "bool" | "int4" | "int8" | "timestamptz" | "bytea"; required: boolean };
type Table = { columns: Record<string, Column>; key: string };
type CanonicalRows = InitialMarketplaceRecoveryRows["canonical"];
const required = (type: Column["type"] = "text"): Column => ({ type, required: true });
const optional = (type: Column["type"] = "text"): Column => ({ type, required: false });
const INITIAL_SCHEMA = "alpha_wallet_initial_marketplace_simulation";

/** The exact initial-acceptance fixture schema, not the older correction fixture. */
const canonicalTables: Record<string, Table> = {
  runtime_meta: { key: "singleton", columns: { singleton: required("bool"), version: required("int8"), updated_at: required("timestamptz") } },
  users: { key: "id", columns: { id: required(), email: required(), role: required(), seller_status: required(),
    availability_status: required(), online_status: required(), created_at: required("timestamptz"), updated_at: required("timestamptz"),
    sort_index: required("int4"), payload: required("jsonb") } },
  listings: { key: "id", columns: { id: required(), seller_id: required(), status: required(), active_trade_request_id: optional(),
    expires_at: optional("timestamptz"), created_at: required("timestamptz"), updated_at: required("timestamptz"),
    sort_index: required("int4"), payload: required("jsonb") } },
  trades: { key: "id", columns: { id: required(), purchase_request_id: required(), listing_id: required(), seller_id: required(),
    buyer_id: required(), status: required(), completed_at: optional("timestamptz"), created_at: required("timestamptz"),
    updated_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  purchase_requests: { key: "id", columns: { id: required(), trade_id: optional(), listing_id: required(), seller_id: required(),
    buyer_id: required(), status: required(), timed_out_at: optional("timestamptz"), completed_at: optional("timestamptz"),
    created_at: required("timestamptz"), updated_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  commissions: { key: "id", columns: { id: required(), purchase_request_id: optional(), listing_id: optional(), seller_id: required(),
    buyer_id: optional(), payment_status: required(), due_at: optional("timestamptz"), created_at: required("timestamptz"),
    updated_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  marketplace_enforcement_records: { key: "id", columns: { id: required(), seller_id: required(), status: required(),
    violation_number: required("int4"), issued_at: required("timestamptz"), due_at: optional("timestamptz"),
    created_at: required("timestamptz"), updated_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  evidence: { key: "id", columns: { id: required(), purchase_request_id: required(), side: required(), uploaded_by_user_id: required(),
    mime_type: required(), file_name: required(), size_bytes: required("int4"), uploaded_at: required("timestamptz"),
    sort_index: required("int4"), payload: required("jsonb"), content: optional("bytea") } },
  disputes: { key: "id", columns: { id: required(), trade_id: required(), purchase_request_id: required(), seller_id: required(),
    buyer_id: required(), status: required(), created_at: required("timestamptz"), updated_at: required("timestamptz"),
    sort_index: required("int4"), payload: required("jsonb") } },
  notifications: { key: "id", columns: { id: required(), user_id: required(), category: required(), is_read: required("bool"),
    created_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  audit_logs: { key: "id", columns: { id: required(), action: required(), actor_user_id: required(), target_user_id: optional(),
    listing_id: optional(), purchase_request_id: optional(), created_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  sessions: { key: "token_hash", columns: { token_hash: required(), user_id: required(), expires_at: required("timestamptz"),
    created_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
};

// Only schema compatibility is checked. No rows/credentials from these tables
// are selected, serialized, or installed in a recovered target.
const excludedMobileAuthenticationTables: Record<string, Table> = {
  mobile_device_sessions: { key: "id", columns: {
    id: required(), user_id: required(), device_id_hash: required(), access_token_hash: required(), refresh_token_hash: required(),
    token_family_id: required(), refresh_generation: required("int4"), platform: required(), app_version: required(), locale: required(),
    access_expires_at: required("timestamptz"), refresh_expires_at: required("timestamptz"), last_seen_at: required("timestamptz"),
    revoked_at: optional("timestamptz"), revoke_reason: optional(), created_at: required("timestamptz"), updated_at: required("timestamptz"),
  } },
  mobile_refresh_token_history: { key: "token_hash", columns: {
    token_hash: required(), session_id: required(), generation: required("int4"), used_at: required("timestamptz"), expires_at: required("timestamptz"),
  } },
};
const coordinationTables: Record<string, Table> = {
  transaction_contexts: { key: "transaction_id", columns: { transaction_id: required(), request_id: required(), operation: required(),
    actor_user_id: required(), planned_command: optional("jsonb"), planned_command_key: optional() } },
  activations: { key: "request_id", columns: { request_id: required(), cohort: required("bool"), platform_listing_id: required(),
    platform_trade_id: required(), wallet_listing_id: required(), wallet_trade_id: required(), buyer_id: required(), seller_id: required(),
    asset_id: required(), actor_user_id: required(), input_digest: required(), wallet_checkpoint: required("jsonb"), canonical_basis: required("jsonb") } },
  acceptances: { key: "acceptance_key", columns: { acceptance_key: required(), request_id: required(), actor_user_id: required(),
    input_digest: required(), wallet_command_revision: required("int4"), wallet_command_key: required(), wallet_event_hash: required(),
    receipt: required("jsonb"), publication_id: required(), canonical_result: required("jsonb") } },
  publications: { key: "id", columns: { id: required(), acceptance_key: required(), payload: required("jsonb") } },
};
const recoveryReceiptTable: Table = { key: "singleton", columns: {
  singleton: required("bool"), bootstrap_transaction_id: required(), receipt: optional("jsonb"),
} };

export type { InitialMarketplaceRecoveryRows } from "./initial-marketplace-backup-manifest";
export type InitialMarketplaceRecoveryReceipt = {
  checksum: string; source: WalletBackupCheckpoint; restored: WalletBackupCheckpoint;
  requestId: string; ownerId: string; restoredAtMs: number;
  canonicalDigest: string; coordinationDigest: string; quarantineCommandKey: string;
};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => Number.isFinite(new Date(value).getTime()));
const checkpoint = z.strictObject({ revision: z.number().int().min(1).max(MAX_WALLET_BACKUP_COMMANDS),
  eventHash: hash, stateHash: hash, lastCommandAtMs: timestamp });
const receiptSchema = z.strictObject({ checksum: hash, source: checkpoint, restored: checkpoint, requestId: identity,
  ownerId: identity, restoredAtMs: timestamp, canonicalDigest: hash, coordinationDigest: hash,
  quarantineCommandKey: z.string().min(1).max(512) });
type Fresh = { transactionId: string; installed?: InitialMarketplaceRecoveryRows; completed?: boolean };
const freshTargets = new WeakMap<WalletSql, Fresh>();
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });

function check(value: unknown, message: string): asserts value {
  if (!value) throw new WalletBackupError(message);
}
function parsed<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  check(result.success, message);
  return result.data;
}
async function transactionIdentity(tx: WalletSql, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null; time_zone: string }>(
    `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode,
      current_setting('TimeZone') AS time_zone`);
  const row = result.rows[0];
  check(result.rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || row.transaction_id === expected), "Initial recovery storage transaction identity changed or ended");
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "Initial recovery storage requires one writable SERIALIZABLE simulation transaction");
  // The original activation contains to_jsonb(timestamptz) strings. Its
  // representation is evidence too: never rewrite a non-UTC basis to make a
  // restore fit the fixed format, or let target session timezone alter it.
  // PGlite reports Etc/GMT0 for TZ=UTC; these exact fixed-zero aliases emit the
  // same +00:00 representation and have no daylight-saving transitions.
  check(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes(row.time_zone),
    "Initial recovery requires an explicit UTC transaction timezone to preserve original canonical evidence");
  assertSimulationRuntime("simulation-only");
  return row.transaction_id;
}
async function abortSameTransaction(tx: WalletSql, certified: string) {
  try {
    // Do not run runtime/schema/role guards during cleanup: a runtime refusal
    // must still poison the already certified physical transaction. A changed
    // transaction is never a target of cleanup.
    const result = await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
    if (result.rows.length === 1 && result.rows[0]?.transaction_id === certified) {
      await tx.query("SELECT 1 / 0 /* abort failed initial marketplace recovery storage */");
    }
  } catch { /* Preserve the original failure; the real transaction owner rolls back. */ }
}
async function owned<T, Captured = undefined>(tx: WalletSql,
  work: (transactionId: string, captured: Captured) => Promise<T>, capture?: () => Captured): Promise<T> {
  // Snapshot caller input before the first await, then throw any clone/parser
  // refusal only inside a certified failure boundary. It cannot be caught to
  // commit earlier bootstrap writes, or race a caller mutating the input.
  let captured: Captured | undefined, captureFailed = false, captureError: unknown;
  try { captured = capture?.(); } catch (error) { captureFailed = true; captureError = error; }
  let certified: string | undefined = freshTargets.get(tx)?.transactionId;
  try {
    const identity = await transactionIdentity(tx);
    await transactionIdentity(tx, identity);
    certified = identity;
    if (captureFailed) throw captureError;
    const result = await work(identity, captured as Captured);
    await transactionIdentity(tx, identity);
    return result;
  } catch (error) {
    if (certified !== undefined) await abortSameTransaction(tx, certified);
    throw error;
  }
}

/** Refuse unrelated state rather than silently omit, overwrite, or truncate it. */
async function assertNamespaces(tx: WalletSql, allowed: string[]) {
  const namespaces = await tx.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname !~ '^pg_(toast|temp_[0-9]+|toast_temp_[0-9]+)$' ORDER BY nspname`);
  check(namespaces.rows.every(row => allowed.includes(row.nspname)), "Initial recovery requires an exact isolated development schema set");
  const objects = await tx.query<{ present: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' OR n.nspname ~ '^pg_temp_[0-9]+$')
    OR EXISTS (SELECT 1 FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
    OR EXISTS (SELECT 1 FROM pg_event_trigger) AS present`);
  check(objects.rows.length === 1 && objects.rows[0].present === false,
    "Initial recovery refuses unrelated public, temporary, extension or event-trigger objects");
}

/** A retained proof of this physical transaction, not a caller supplied flag. */
export async function assertFreshInitialMarketplaceRecoveryTarget(tx: WalletSql): Promise<void> {
  await owned(tx, async transactionId => {
    check(!freshTargets.has(tx), "Initial recovery target freshness has already been certified for this handle");
    // Match the standalone v3 restore claim. A competing old snapshot may be
    // refused or retried by its real owner; it can never overwrite a winner.
    await tx.query("SELECT pg_advisory_xact_lock(61422924)");
    await assertNamespaces(tx, []);
    freshTargets.set(tx, { transactionId });
  });
}

async function assertTableShape(tx: WalletSql, namespace: string, expected: Record<string, Table>) {
  const tables = await tx.query<{ relname: string; relkind: string }>(`SELECT c.relname,c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind NOT IN ('i','I') ORDER BY c.relname`, [namespace]);
  check(tables.rows.length === Object.keys(expected).length && tables.rows.every(row => row.relkind === "r" && Object.hasOwn(expected, row.relname)),
    "Initial recovery source has unsupported, missing or additional application tables");
  const columns = (await tx.query<{ table_name: string; column_name: string; type_name: string; type_schema: string; required: boolean }>(
    `SELECT c.relname AS table_name,a.attname AS column_name,t.typname AS type_name,tn.nspname AS type_schema,a.attnotnull AS required
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
      WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attname`, [namespace])).rows;
  const expectedCount = Object.values(expected).reduce((sum, table) => sum + Object.keys(table.columns).length, 0);
  check(columns.length === expectedCount, "Initial recovery source has unsupported, missing or additional application columns");
  for (const column of columns) {
    const specification = expected[column.table_name]?.columns[column.column_name];
    check(specification && column.type_schema === "pg_catalog" && column.type_name === specification.type
      && column.required === specification.required, "Initial recovery source column types or nullability differ from the exact initial fixture schema");
  }
}
async function mobileAuthenticationRelations(tx: WalletSql) {
  const result = await tx.query<{ sessions: boolean; history: boolean }>(`SELECT
    to_regclass('alpha_exchange.mobile_device_sessions') IS NOT NULL AS sessions,
    to_regclass('alpha_exchange.mobile_refresh_token_history') IS NOT NULL AS history`);
  const row = result.rows[0];
  check(result.rows.length === 1 && typeof row?.sessions === "boolean" && typeof row.history === "boolean",
    "Initial recovery could not verify the mobile authentication schema boundary");
  return row;
}

function selectedRow(table: string, specification: Table, fullIdentity = false): string {
  const columns = table === "users" && !fullIdentity
    ? ["id", "role", "seller_status", "created_at", "updated_at", "sort_index"] : Object.keys(specification.columns);
  const fields = columns.flatMap(column => {
    const type = specification.columns[column].type;
    const value = type === "timestamptz"
      ? `to_char(t.${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      : type === "int8" ? `t.${column}::text`
        : type === "bytea" ? `replace(encode(t.${column},'base64'),chr(10),'')` : `t.${column}`;
    return [`'${column}'`, value];
  });
  return `jsonb_build_object(${fields.join(",")})`;
}

/** SQL identifiers come only from the fixed, source-owned table maps above. */
async function capture(tx: WalletSql, namespace: string, name: string, specification: Table, budget: { rows: number; bytes: number }): Promise<Row[]> {
  const count = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${namespace}.${name}`);
  const amount = Number(count.rows[0]?.count);
  check(Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000 && budget.rows + amount <= 10000,
    "Initial combined development recovery row limit exceeded");
  const expression = selectedRow(name, specification);
  const sizes = await tx.query<{ size: string }>(`SELECT coalesce(sum(octet_length((${expression})::text)),0)::text AS size FROM ${namespace}.${name} t`);
  const size = Number(sizes.rows[0]?.size);
  check(Number.isSafeInteger(size) && size >= 0 && budget.bytes + size <= MAX_WALLET_BACKUP_BYTES,
    "Initial combined development recovery byte limit exceeded");
  budget.rows += amount; budget.bytes += size;
  const order = `t.${specification.key}${specification.columns[specification.key].type === "text" ? ' COLLATE "C"' : ""}`;
  const rows = await tx.query<{ row: Row }>(`SELECT ${expression} AS row FROM ${namespace}.${name} t ORDER BY ${order} LIMIT 1001`);
  check(rows.rows.length === amount, "Initial recovery row capture differs from its transaction snapshot");
  const captured = rows.rows.map(row => row.row);
  // Verify JS parsing did not round any retained SQL JSON number, including
  // unrelated histories and private activation/result provenance.
  const roundtrip = await tx.query<{ exact: boolean }>(`SELECT
    coalesce(jsonb_agg(${expression} ORDER BY ${order}),'[]'::jsonb) IS NOT DISTINCT FROM $1::jsonb AS exact
    FROM ${namespace}.${name} t`, [JSON.stringify(captured)]);
  check(roundtrip.rows.length === 1 && roundtrip.rows[0].exact === true,
    "Initial canonical recovery requires lossless JSON precision across the database boundary");
  return captured;
}

/** Preserves every supported financial row; excludes account/session secrets. */
export async function readInitialMarketplaceRecoveryRows(tx: WalletSql): Promise<InitialMarketplaceRecoveryRows> {
  return owned(tx, async () => {
    await assertNamespaces(tx, ["alpha_exchange", "alpha_wallet_simulation", INITIAL_SCHEMA]);
    const recovery = (await tx.query<{ present: boolean }>(
      "SELECT to_regclass('alpha_wallet_initial_marketplace_simulation.recovery_receipts') IS NOT NULL AS present")).rows[0]?.present;
    const mobile = await mobileAuthenticationRelations(tx);
    check(mobile.sessions === mobile.history, "Initial recovery source must contain both exact mobile authentication tables or neither");
    check(!recovery || !mobile.sessions, "Recovered initial marketplace mobile authentication relations must remain absent");
    await assertTableShape(tx, "alpha_exchange", mobile.sessions
      ? { ...canonicalTables, ...excludedMobileAuthenticationTables } : canonicalTables);
    await assertTableShape(tx, INITIAL_SCHEMA, recovery ? { ...coordinationTables, recovery_receipts: recoveryReceiptTable } : coordinationTables);
    const canonical: Record<string, Row[]> = {}, coordination: Record<string, Row[]> = {};
    const budget = { rows: 0, bytes: 0 };
    for (const [name, specification] of Object.entries(canonicalTables)) {
      if (name !== "sessions") canonical[name] = await capture(tx, "alpha_exchange", name, specification, budget);
    }
    for (const name of ["activations", "acceptances", "publications"] as const) {
      coordination[name] = await capture(tx, INITIAL_SCHEMA, name, coordinationTables[name], budget);
    }
    return {
      canonical: parsed(initialMarketplaceCanonicalRowsSchema, canonical, "Initial canonical recovery rows do not match the fixed development format"),
      coordination: parsed(initialMarketplaceCoordinationRowsSchema, coordination, "Initial coordination recovery rows do not match the fixed development format"),
    };
  });
}

function identityStub(row: Row): Row {
  const email = `recovery-${String(row.id)}@example.invalid`;
  return { id: row.id, email, role: row.role, seller_status: row.seller_status,
    availability_status: "away", online_status: "offline", created_at: row.created_at, updated_at: row.updated_at, sort_index: row.sort_index,
    payload: { id: row.id, role: row.role, sellerStatus: row.seller_status, email, disabled: true, emailVerified: false,
      availabilityStatus: "away", onlineStatus: "offline", createdAt: row.created_at, updatedAt: row.updated_at,
      fullName: "Disabled development recovery identity", recoveryIdentityOnly: true } };
}

/** Complete equality, not just a disabled flag alongside retained credentials. */
export async function assertInitialMarketplaceRecoveryIdentityQuarantine(tx: WalletSql): Promise<void> {
  await owned(tx, async () => {
    const mobile = await mobileAuthenticationRelations(tx);
    check(!mobile.sessions && !mobile.history, "Recovered initial marketplace mobile authentication relations must remain absent");
    const count = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM alpha_exchange.sessions");
    check(count.rows[0]?.count === "0", "Recovered initial marketplace sessions must remain empty");
    const expression = selectedRow("users", canonicalTables.users, true);
    const users = (await tx.query<{ row: Row }>(`SELECT ${expression} AS row FROM alpha_exchange.users t ORDER BY id COLLATE "C" LIMIT 1001`)).rows;
    check(users.length > 0 && users.length <= 1000, "Recovered initial marketplace identities are missing or oversized");
    for (const { row } of users) check(walletDigest(row) === walletDigest(identityStub(row)),
      "Recovered initial marketplace identities must remain exact disabled credential-free stubs");
  });
}

async function insertRows(tx: WalletSql, namespace: string, name: string, specification: Table, records: Row[]) {
  const columns = Object.keys(specification.columns);
  const values = columns.map((column, index) => specification.columns[column].type === "bytea"
    ? `decode($${index + 1}::text,'base64')` : `$${index + 1}::${specification.columns[column].type}`).join(",");
  for (const record of records) {
    check(Object.keys(record).length === columns.length && columns.every(column => Object.hasOwn(record, column)),
      "Initial recovery insert requires every fixed column exactly once");
    const params = columns.map(column => specification.columns[column].type === "jsonb" ? JSON.stringify(record[column]) : record[column]);
    await tx.query(`INSERT INTO ${namespace}.${name} (${columns.join(",")}) VALUES (${values})`, params);
  }
}

/**
 * Only this transaction's certified empty target can install original rows.
 * Financial replay plus a NEW quarantine pause precede all canonical writes.
 * The original initial guards are attached unchanged, then recovery-only fences
 * seal every canonical row and prevent further financial commands. No resume.
 */
export async function installInitialMarketplaceRecoveryRows(tx: WalletSql, data: InitialMarketplaceRecoveryRows): Promise<void> {
  await owned(tx, async (transactionId, copy) => {
    const fresh = freshTargets.get(tx);
    check(fresh && fresh.transactionId === transactionId && !fresh.installed,
      "Initial recovery bootstrap needs its same-transaction fresh-target proof");
    await assertNamespaces(tx, ["alpha_wallet_simulation"]);
    const snapshot = await createV3DurableWallet({ mode: "simulation-only", store: bound(tx) }).snapshot();
    check(isV3State(snapshot.state) && Boolean(snapshot.state.haltReason)
      && snapshot.state.initialBindings.size === copy.coordination.acceptances.length
      && snapshot.state.initialAcceptanceReceipts.size === copy.coordination.acceptances.length,
    "Initial recovery bootstrap requires the verified paused v3 wallet and exact initial acceptance inventory");
    const final = (await tx.query<{ command_type: string; command_json: Row }>(
      "SELECT command_type,command_json FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1")).rows[0];
    check(final?.command_type === "pause" && final.command_json.version === 3
      && final.command_json.engineVersion === "alpha-wallet-simulation-v3"
      && (final.command_json.actor as Row | undefined)?.kind === "operator"
      && (final.command_json.actor as Row | undefined)?.id === "initial-marketplace-backup-recovery"
      && typeof final.command_json.requestId === "string" && /^restore-[a-f0-9]{64}$/.test(final.command_json.requestId),
    "Initial recovery bootstrap requires its new dedicated quarantine command");
    const sql = (name: string) => readFileSync(resolve(process.cwd(), "docs/alpha-wallet", name), "utf8");
    await tx.exec(sql("initial-marketplace-recovery-canonical.sql"));
    for (const [name, specification] of Object.entries(canonicalTables)) {
      if (name === "sessions") continue;
      const rows = copy.canonical[name as keyof CanonicalRows] as Row[];
      await insertRows(tx, "alpha_exchange", name, specification, name === "users" ? rows.map(identityStub) : rows);
    }
    // This is not normal activation, and cannot call its initializer (which
    // correctly refuses preexisting bindings/pauses). The fresh-target proof,
    // original records and deferred receipt seal own this separate bootstrap.
    await tx.exec(sql("initial-marketplace-tables.sql"));
    for (const name of ["activations", "acceptances", "publications"] as const) {
      await insertRows(tx, INITIAL_SCHEMA, name, coordinationTables[name], copy.coordination[name]);
    }
    await tx.exec(sql("initial-marketplace-guards.sql"));
    await tx.exec(sql("initial-marketplace-recovery-bootstrap.sql"));
    await tx.query(`INSERT INTO alpha_wallet_initial_marketplace_simulation.recovery_receipts
      (singleton,bootstrap_transaction_id,receipt) VALUES (true,txid_current()::text,NULL)`);
    fresh.installed = copy;
  }, () => ({
    canonical: parsed(initialMarketplaceCanonicalRowsSchema, structuredClone(data.canonical), "Invalid initial canonical recovery rows"),
    coordination: parsed(initialMarketplaceCoordinationRowsSchema, structuredClone(data.coordination), "Invalid initial coordination recovery rows"),
  }));
}

/** Deferred SQL requires exactly one complete receipt in the original bootstrap. */
export async function writeInitialMarketplaceRecoveryReceipt(tx: WalletSql, receipt: InitialMarketplaceRecoveryReceipt): Promise<void> {
  await owned(tx, async (transactionId, copy) => {
    const fresh = freshTargets.get(tx);
    check(fresh && fresh.transactionId === transactionId && fresh.installed && !fresh.completed,
      "Initial combined recovery receipt requires its original unfinished fresh-target bootstrap");
    check(walletDigest(fresh.installed.canonical) === copy.canonicalDigest && walletDigest(fresh.installed.coordination) === copy.coordinationDigest,
      "Initial combined recovery receipt differs from the source rows selected for installation");
    await assertInitialMarketplaceRecoveryIdentityQuarantine(tx);
    const current = await readInitialMarketplaceRecoveryRows(tx);
    check(walletDigest(current.canonical) === copy.canonicalDigest && walletDigest(current.coordination) === copy.coordinationDigest,
      "Initial combined recovery receipt differs from the actual restored records");
    const result = await tx.query(`UPDATE alpha_wallet_initial_marketplace_simulation.recovery_receipts SET receipt=$1::jsonb
      WHERE singleton=true AND bootstrap_transaction_id=txid_current()::text AND receipt IS NULL RETURNING singleton`, [JSON.stringify(copy)]);
    check(result.rows.length === 1, "Initial combined recovery receipt was not completed exactly once");
    fresh.completed = true;
  }, () => parsed(receiptSchema, structuredClone(receipt), "Invalid initial combined recovery receipt"));
}

/** No missing or partial receipt is treated as evidence of a rolled-back COMMIT. */
export async function readInitialMarketplaceRecoveryReceipt(tx: WalletSql): Promise<InitialMarketplaceRecoveryReceipt | null> {
  return owned(tx, async () => {
    const present = (await tx.query<{ present: boolean }>(
      "SELECT to_regclass('alpha_wallet_initial_marketplace_simulation.recovery_receipts') IS NOT NULL AS present")).rows[0]?.present;
    if (!present) return null;
    const result = await tx.query<{ receipt: unknown }>("SELECT receipt FROM alpha_wallet_initial_marketplace_simulation.recovery_receipts WHERE singleton=true");
    check(result.rows.length === 1 && result.rows[0].receipt !== null, "Initial recovery target has no complete immutable receipt");
    return parsed(receiptSchema, result.rows[0].receipt, "Malformed retained initial combined recovery receipt");
  });
}
