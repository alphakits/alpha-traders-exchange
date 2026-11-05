import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { MAX_WALLET_BACKUP_BYTES, WalletBackupError, type WalletBackupCheckpoint } from "./backup";
import { walletDigest } from "./commands";
import type { WalletSql, WalletStore } from "./durable-store";
import {
  marketplaceCanonicalRowsSchema, marketplaceCoordinationRowsSchema,
  type MarketplaceCanonicalRows, type MarketplaceCoordinationRows,
} from "./marketplace-backup-manifest";
import { assertSimulationRuntime } from "./runtime";
import { isV2State } from "./v2-engine";
import { createVersionedDurableWallet } from "./versioned-durable";

type Row = Record<string, unknown>;
type Column = { type: "text" | "jsonb" | "bool" | "int4" | "int8" | "timestamptz"; required: boolean };
type Table = { columns: Record<string, Column>; key: string };
const required = (type: Column["type"] = "text"): Column => ({ type, required: true });
const optional = (type: Column["type"] = "text"): Column => ({ type, required: false });
const canonicalTables: Record<string, Table> = {
  runtime_meta: { key: "singleton", columns: { singleton: required("bool"), version: required("int8"), updated_at: required("timestamptz") } },
  purchase_requests: { key: "id", columns: { id: required(), trade_id: optional(), listing_id: required(), buyer_id: required(),
    seller_id: required(), status: required(), updated_at: required("timestamptz"), payload: required("jsonb") } },
  users: { key: "id", columns: { id: required(), payload: required("jsonb"), email: required(), role: required(), seller_status: required() } },
  listings: { key: "id", columns: { id: required(), seller_id: required(), payload: required("jsonb"), status: required(), active_trade_request_id: optional() } },
  commissions: { key: "id", columns: { id: required(), seller_id: required(), payload: required("jsonb"),
    purchase_request_id: optional(), listing_id: optional(), buyer_id: optional() } },
  trust_snapshots: { key: "seller_id", columns: { seller_id: required(), payload: required("jsonb") } },
  evidence: { key: "id", columns: { id: required(), purchase_request_id: required(), payload: required("jsonb") } },
  disputes: { key: "id", columns: { id: required(), purchase_request_id: required(), payload: required("jsonb") } },
  notifications: { key: "id", columns: { id: required(), user_id: required(), category: required(), is_read: required("bool"),
    created_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  audit_logs: { key: "id", columns: { id: required(), action: required(), actor_user_id: required(), target_user_id: optional(),
    listing_id: optional(), purchase_request_id: optional(), created_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  activity_logs: { key: "id", columns: { id: required(), user_id: required(), category: required(), created_at: required("timestamptz"),
    sort_index: required("int4"), payload: required("jsonb") } },
  sessions: { key: "token_hash", columns: { token_hash: required(), user_id: required(), expires_at: required("timestamptz"),
    created_at: required("timestamptz"), sort_index: required("int4"), payload: required("jsonb") } },
  trades: { key: "id", columns: { id: required(), purchase_request_id: required(), listing_id: required(), seller_id: required(),
    buyer_id: required(), status: required(), payload: required("jsonb") } },
};
// Source compatibility only. These are the exact optional native-session
// columns from the retained mobile migration, not additional recovery rows.
// Keep them outside canonicalTables so neither capture nor installation can
// accidentally serialize a token hash, installation identity or refresh history.
const excludedMobileAuthenticationTables: Record<string, Table> = {
  mobile_device_sessions: { key: "id", columns: {
    id: required(), user_id: required(), device_id_hash: required(), access_token_hash: required(), refresh_token_hash: required(),
    token_family_id: required(), refresh_generation: required("int4"), platform: required(), app_version: required(), locale: required(),
    access_expires_at: required("timestamptz"), refresh_expires_at: required("timestamptz"), last_seen_at: required("timestamptz"),
    revoked_at: optional("timestamptz"), revoke_reason: optional(), created_at: required("timestamptz"), updated_at: required("timestamptz"),
  } },
  mobile_refresh_token_history: { key: "token_hash", columns: {
    token_hash: required(), session_id: required(), generation: required("int4"), used_at: required("timestamptz"),
    expires_at: required("timestamptz"),
  } },
};
const coordinationTables: Record<string, Table> = {
  transaction_contexts: { key: "transaction_id", columns: { transaction_id: required(), request_id: required(), operation: required(),
    actor_user_id: required(), planned_command: optional("jsonb"), planned_command_key: optional() } },
  enrollments: { key: "request_id", columns: { request_id: required(), cohort: required("bool"), platform_listing_id: required(),
    platform_trade_id: optional(), wallet_listing_id: required(), wallet_trade_id: required(), buyer_id: required(), seller_id: required(),
    asset_id: required(), actor_user_id: required(), input_digest: required(), wallet_command_revision: required("int4"),
    wallet_command_key: required(), wallet_event_hash: required(), binding: required("jsonb") } },
  acceptances: { key: "acceptance_key", columns: { acceptance_key: required(), request_id: required(), proposal_id: required(),
    actor_user_id: required(), input_digest: required(), wallet_command_revision: required("int4"), wallet_command_key: required(),
    wallet_event_hash: required(), receipt: required("jsonb"), publication_id: required() } },
  publications: { key: "id", columns: { id: required(), acceptance_key: required(), payload: required("jsonb") } },
};
const recoveryReceiptTable: Table = { key: "singleton", columns: { singleton: required("bool"), bootstrap_transaction_id: required(), receipt: optional("jsonb") } };

export type MarketplaceRecoveryRows = { canonical: MarketplaceCanonicalRows; coordination: MarketplaceCoordinationRows };
export type MarketplaceRecoveryReceipt = {
  checksum: string; source: WalletBackupCheckpoint; restored: WalletBackupCheckpoint;
  requestId: string; ownerId: string; restoredAtMs: number;
  canonicalDigest: string; coordinationDigest: string; quarantineCommandKey: string;
};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const checkpoint = z.strictObject({ revision: z.number().int().min(1).max(1001), eventHash: hash, stateHash: hash, lastCommandAtMs: timestamp });
const receiptSchema = z.strictObject({ checksum: hash, source: checkpoint, restored: checkpoint, requestId: identity,
  ownerId: identity, restoredAtMs: timestamp, canonicalDigest: hash, coordinationDigest: hash,
  quarantineCommandKey: z.string().min(1).max(512) });
type Fresh = { transactionId: string; installed?: MarketplaceRecoveryRows; completed?: boolean };
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
async function transactionIdentity(tx: WalletSql, expected?: string, full = true) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null }>(
    `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode`);
  const row = result.rows[0];
  check(result.rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || row.transaction_id === expected), "Recovery storage transaction identity changed or ended");
  if (full) check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "Recovery storage requires one writable SERIALIZABLE simulation transaction");
  assertSimulationRuntime("simulation-only");
  return row.transaction_id;
}
async function owned<T>(tx: WalletSql, work: (transactionId: string) => Promise<T>): Promise<T> {
  let certified: string | undefined;
  try {
    const identity = await transactionIdentity(tx);
    await transactionIdentity(tx, identity);
    certified = identity;
    const result = await work(identity);
    await transactionIdentity(tx, identity);
    return result;
  } catch (error) {
    if (certified !== undefined) {
      try {
        await transactionIdentity(tx, certified, false);
        await tx.query("SELECT 1 / 0 /* abort failed marketplace recovery storage */");
      } catch { /* Preserve the original failure; the real owner must roll back. */ }
    }
    throw error;
  }
}

/** No application namespace or object may be silently overwritten or omitted. */
async function assertNamespaces(tx: WalletSql, allowed: string[]) {
  const namespaces = await tx.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname !~ '^pg_(toast|temp_[0-9]+|toast_temp_[0-9]+)$' ORDER BY nspname`);
  check(namespaces.rows.every(row => allowed.includes(row.nspname)), "Recovery requires an exact isolated development schema set");
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
    "Recovery refuses unrelated public, temporary, extension or event-trigger objects");
}

/** A same-transaction capability; a caller cannot present a remembered boolean. */
export async function assertFreshMarketplaceRecoveryTarget(tx: WalletSql): Promise<void> {
  await owned(tx, async transactionId => {
    check(!freshTargets.has(tx), "Recovery target freshness has already been certified for this handle");
    await assertNamespaces(tx, []);
    freshTargets.set(tx, { transactionId });
  });
}

async function assertTableShape(tx: WalletSql, namespace: string, expected: Record<string, Table>) {
  const tables = await tx.query<{ relname: string; relkind: string }>(`SELECT c.relname,c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind NOT IN ('i','I') ORDER BY c.relname`, [namespace]);
  check(tables.rows.length === Object.keys(expected).length && tables.rows.every(row => row.relkind === "r" && Object.hasOwn(expected, row.relname)),
    "Recovery source has unsupported, missing or additional application tables");
  const columns = (await tx.query<{ table_name: string; column_name: string; type_name: string; type_schema: string; required: boolean }>(
    `SELECT c.relname AS table_name,a.attname AS column_name,t.typname AS type_name,tn.nspname AS type_schema,a.attnotnull AS required
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
      WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attname`, [namespace])).rows;
  const expectedCount = Object.values(expected).reduce((sum, table) => sum + Object.keys(table.columns).length, 0);
  check(columns.length === expectedCount, "Recovery source has unsupported, missing or additional application columns");
  for (const column of columns) {
    const specification = expected[column.table_name]?.columns[column.column_name];
    check(specification && column.type_schema === "pg_catalog" && column.type_name === specification.type
      && column.required === specification.required, "Recovery source column types or nullability differ from the explicit fixture schema");
  }
}

async function mobileAuthenticationRelations(tx: WalletSql) {
  const result = await tx.query<{ sessions: boolean; history: boolean }>(`SELECT
    to_regclass('alpha_exchange.mobile_device_sessions') IS NOT NULL AS sessions,
    to_regclass('alpha_exchange.mobile_refresh_token_history') IS NOT NULL AS history`);
  const row = result.rows[0];
  check(result.rows.length === 1 && typeof row?.sessions === "boolean" && typeof row.history === "boolean",
    "Recovery could not verify the mobile authentication schema boundary");
  return row;
}

async function assertNoRecoveredMobileAuthentication(tx: WalletSql) {
  const mobile = await mobileAuthenticationRelations(tx);
  check(!mobile.sessions && !mobile.history, "Recovered marketplace mobile authentication relations must remain absent");
}

function selectedRow(table: string, specification: Table): string {
  const columns = table === "users" ? ["id", "role", "seller_status"] : Object.keys(specification.columns);
  const fields = columns.flatMap(column => {
    const type = specification.columns[column].type;
    const value = type === "timestamptz"
      ? `to_char(t.${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      : type === "int8" ? `t.${column}::text` : `t.${column}`;
    return [`'${column}'`, value];
  });
  return `jsonb_build_object(${fields.join(",")})`;
}

/** Every dynamic identifier comes only from the fixed tables above. */
async function capture(tx: WalletSql, namespace: string, name: string, specification: Table, budget: { rows: number; bytes: number }): Promise<Row[]> {
  const count = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${namespace}.${name}`);
  const amount = Number(count.rows[0]?.count);
  check(Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000 && budget.rows + amount <= 10000,
    "Combined development recovery row limit exceeded");
  const expression = selectedRow(name, specification);
  const sizes = await tx.query<{ size: string }>(`SELECT coalesce(sum(octet_length((${expression})::text)),0)::text AS size FROM ${namespace}.${name} t`);
  const size = Number(sizes.rows[0]?.size);
  check(Number.isSafeInteger(size) && size >= 0 && budget.bytes + size <= MAX_WALLET_BACKUP_BYTES,
    "Combined development recovery byte limit exceeded");
  budget.rows += amount; budget.bytes += size;
  const order = `t.${specification.key}${specification.columns[specification.key].type === "text" ? ' COLLATE "C"' : ""}`;
  const rows = await tx.query<{ row: Row }>(`SELECT ${expression} AS row FROM ${namespace}.${name} t ORDER BY ${order} LIMIT 1001`);
  check(rows.rows.length === amount, "Recovery row capture differs from its transaction snapshot");
  const captured = rows.rows.map(row => row.row);
  // A pg/PGlite JSON parser uses JavaScript Number. Even an unrelated retained
  // payload can contain a decimal beyond its precision. Compare the received
  // representation back to the ORIGINAL JSONB before checksumming it; silently
  // rounding a historical field is not an exact recovery copy.
  const roundtrip = await tx.query<{ exact: boolean }>(`SELECT
    coalesce(jsonb_agg(${expression} ORDER BY ${order}),'[]'::jsonb) IS NOT DISTINCT FROM $1::jsonb AS exact
    FROM ${namespace}.${name} t`, [JSON.stringify(captured)]);
  check(roundtrip.rows.length === 1 && roundtrip.rows[0].exact === true,
    "Canonical recovery requires lossless JSON precision across the database boundary");
  return captured;
}

/** Full financial capture; web/native sessions, refresh history and profiles are excluded. */
export async function readMarketplaceRecoveryRows(tx: WalletSql): Promise<MarketplaceRecoveryRows> {
  return owned(tx, async () => {
    await assertNamespaces(tx, ["alpha_exchange", "alpha_wallet_simulation", "alpha_wallet_marketplace_simulation"]);
    const recovery = (await tx.query<{ present: boolean }>("SELECT to_regclass('alpha_wallet_marketplace_simulation.recovery_receipts') IS NOT NULL AS present")).rows[0]?.present;
    const mobile = await mobileAuthenticationRelations(tx);
    check(mobile.sessions === mobile.history, "Recovery source must contain both exact mobile authentication tables or neither");
    check(!recovery || !mobile.sessions, "Recovered marketplace mobile authentication relations must remain absent");
    await assertTableShape(tx, "alpha_exchange", mobile.sessions
      ? { ...canonicalTables, ...excludedMobileAuthenticationTables } : canonicalTables);
    await assertTableShape(tx, "alpha_wallet_marketplace_simulation", recovery ? { ...coordinationTables, recovery_receipts: recoveryReceiptTable } : coordinationTables);
    const canonical: Record<string, Row[]> = {}, coordination: Record<string, Row[]> = {};
    const budget = { rows: 0, bytes: 0 };
    for (const [name, specification] of Object.entries(canonicalTables)) {
      if (name !== "sessions") canonical[name] = await capture(tx, "alpha_exchange", name, specification, budget);
    }
    for (const name of ["enrollments", "acceptances", "publications"] as const) {
      coordination[name] = await capture(tx, "alpha_wallet_marketplace_simulation", name, coordinationTables[name], budget);
    }
    return {
      canonical: parsed(marketplaceCanonicalRowsSchema, canonical, "Canonical recovery rows do not match the fixed development format"),
      coordination: parsed(marketplaceCoordinationRowsSchema, coordination, "Coordination recovery rows do not match the fixed development format"),
    };
  });
}

function identityStub(row: Row): Row {
  const email = `recovery-${String(row.id)}@example.invalid`;
  return { id: row.id, role: row.role, seller_status: row.seller_status, email,
    payload: { id: row.id, role: row.role, sellerStatus: row.seller_status, email, disabled: true,
      emailVerified: false, fullName: "Disabled development recovery identity", recoveryIdentityOnly: true } };
}

/** Compare the COMPLETE stub, not merely disabled=true beside hidden credentials. */
export async function assertMarketplaceRecoveryIdentityQuarantine(tx: WalletSql): Promise<void> {
  await owned(tx, async () => {
    // A fresh restored copy never creates mobile auth tables. Refuse even an
    // empty pair added later; disabled account flags alone cannot certify that
    // device-bound credentials and rotation history remained quarantined.
    await assertNoRecoveredMobileAuthentication(tx);
    const count = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM alpha_exchange.sessions");
    check(count.rows[0]?.count === "0", "Recovered marketplace sessions must remain empty");
    const users = (await tx.query<{ row: Row }>("SELECT to_jsonb(u) AS row FROM alpha_exchange.users u ORDER BY id")).rows;
    check(users.length > 0 && users.length <= 1000, "Recovered marketplace identities are missing or oversized");
    for (const { row } of users) check(walletDigest(row) === walletDigest(identityStub(row)),
      "Recovered marketplace identities must remain exact disabled credential-free stubs");
  });
}

async function insertRows(tx: WalletSql, namespace: string, name: string, specification: Table, records: Row[]) {
  const columns = Object.keys(specification.columns);
  const values = columns.map((column, index) => `$${index + 1}::${specification.columns[column].type}`).join(",");
  for (const record of records) {
    check(Object.keys(record).length === columns.length && columns.every(column => Object.hasOwn(record, column)),
      "Recovery insert requires every fixed column exactly once");
    const params = columns.map(column => specification.columns[column].type === "jsonb" ? JSON.stringify(record[column]) : record[column]);
    await tx.query(`INSERT INTO ${namespace}.${name} (${columns.join(",")}) VALUES (${values})`, params);
  }
}

/**
 * Only the transaction previously certified EMPTY can bootstrap a recovered
 * cohort. All original commands plus a NEW durable pause must already exist.
 * Existing guards are never disabled. Common guards attach before this can
 * commit, and a deferred receipt seal makes omission of completion fail closed.
 */
export async function installMarketplaceRecoveryRows(tx: WalletSql, data: MarketplaceRecoveryRows): Promise<void> {
  const copy: MarketplaceRecoveryRows = {
    canonical: parsed(marketplaceCanonicalRowsSchema, structuredClone(data.canonical), "Invalid canonical recovery rows"),
    coordination: parsed(marketplaceCoordinationRowsSchema, structuredClone(data.coordination), "Invalid coordination recovery rows"),
  };
  await owned(tx, async transactionId => {
    const fresh = freshTargets.get(tx);
    check(fresh && fresh.transactionId === transactionId && !fresh.installed, "Recovery bootstrap needs its same-transaction fresh-target proof");
    await assertNamespaces(tx, ["alpha_wallet_simulation"]);
    const snapshot = await createVersionedDurableWallet({ mode: "simulation-only", store: bound(tx) }).snapshot();
    check(isV2State(snapshot.state) && snapshot.state.haltReason !== null && snapshot.state.termsBindings.size === 1,
      "Recovery bootstrap requires a verified paused v2 wallet with its single canonical enrollment");
    const final = (await tx.query<{ command_type: string; command_json: Row }>(
      "SELECT command_type,command_json FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1")).rows[0];
    check(final?.command_type === "pause" && (final.command_json.actor as Row | undefined)?.id === "marketplace-backup-recovery",
      "Recovery bootstrap requires its new dedicated quarantine command");
    const sql = (name: string) => readFileSync(resolve(process.cwd(), "docs/alpha-wallet", name), "utf8");
    await tx.exec(sql("marketplace-recovery-canonical-schema.sql"));
    for (const [name, specification] of Object.entries(canonicalTables)) {
      if (name === "sessions") continue;
      const rows = copy.canonical[name as keyof MarketplaceCanonicalRows] as Row[];
      await insertRows(tx, "alpha_exchange", name, specification, name === "users" ? rows.map(identityStub) : rows);
    }
    await tx.exec(sql("marketplace-coordination-tables.sql"));
    for (const name of ["enrollments", "acceptances", "publications"] as const) {
      await insertRows(tx, "alpha_wallet_marketplace_simulation", name, coordinationTables[name], copy.coordination[name]);
    }
    await tx.exec(sql("marketplace-coordination-guards.sql"));
    await tx.exec(sql("marketplace-recovery-receipts.sql"));
    await tx.query(`INSERT INTO alpha_wallet_marketplace_simulation.recovery_receipts
      (singleton,bootstrap_transaction_id,receipt) VALUES (true,txid_current()::text,NULL)`);
    fresh.installed = copy;
  });
}

/** Completing this receipt is required by a deferred constraint at COMMIT. */
export async function writeMarketplaceRecoveryReceipt(tx: WalletSql, receipt: MarketplaceRecoveryReceipt): Promise<void> {
  const copy = parsed(receiptSchema, structuredClone(receipt), "Invalid combined recovery receipt");
  await owned(tx, async transactionId => {
    const fresh = freshTargets.get(tx);
    check(fresh && fresh.transactionId === transactionId && fresh.installed && !fresh.completed,
      "Combined recovery receipt requires its original unfinished fresh-target bootstrap");
    check(walletDigest(fresh.installed.canonical) === copy.canonicalDigest && walletDigest(fresh.installed.coordination) === copy.coordinationDigest,
      "Combined recovery receipt differs from the source rows selected for installation");
    await assertMarketplaceRecoveryIdentityQuarantine(tx);
    const current = await readMarketplaceRecoveryRows(tx);
    check(walletDigest(current.canonical) === copy.canonicalDigest && walletDigest(current.coordination) === copy.coordinationDigest,
      "Combined recovery receipt differs from the actual restored records");
    const result = await tx.query(`UPDATE alpha_wallet_marketplace_simulation.recovery_receipts SET receipt=$1::jsonb
      WHERE singleton=true AND bootstrap_transaction_id=txid_current()::text AND receipt IS NULL RETURNING singleton`, [JSON.stringify(copy)]);
    check(result.rows.length === 1, "Combined recovery receipt was not completed exactly once");
    fresh.completed = true;
  });
}

/** A missing receipt is never evidence that a failed COMMIT rolled back. */
export async function readMarketplaceRecoveryReceipt(tx: WalletSql): Promise<MarketplaceRecoveryReceipt | null> {
  return owned(tx, async () => {
    const present = (await tx.query<{ present: boolean }>(
      "SELECT to_regclass('alpha_wallet_marketplace_simulation.recovery_receipts') IS NOT NULL AS present")).rows[0]?.present;
    if (!present) return null;
    const result = await tx.query<{ receipt: unknown }>("SELECT receipt FROM alpha_wallet_marketplace_simulation.recovery_receipts WHERE singleton=true");
    check(result.rows.length === 1 && result.rows[0].receipt !== null, "Recovery target has no complete immutable receipt");
    return parsed(receiptSchema, result.rows[0].receipt, "Malformed retained combined recovery receipt");
  });
}
