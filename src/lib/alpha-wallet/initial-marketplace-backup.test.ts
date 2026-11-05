// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { parseUnits } from "./amounts";
import { walletDigest } from "./commands";
import { initializeDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import {
  exportInitialMarketplaceWalletBackup, exportMobileInitialMarketplaceWalletBackup,
  inspectInitialMarketplaceWalletBackup, inspectRestoredInitialMarketplaceWallet, restoreInitialMarketplaceWalletBackup,
} from "./initial-marketplace-backup";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "./initial-marketplace-coordinator";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { inspectMarketplaceWalletBackup, restoreMarketplaceWalletBackup } from "./marketplace-backup";
import { exportV3WalletBackup, inspectV3WalletBackup, restoreV3WalletBackup } from "./v3-backup";
import { v3Command, v3CommandKey } from "./v3-commands";
import { createV3DurableWallet, verifyV3History } from "./v3-durable";
import { isV3State } from "./v3-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const SCHEMA = "alpha_wallet_initial_marketplace_simulation";
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
const TABLES = ["runtime_meta", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records",
  "evidence", "disputes", "notifications", "audit_logs"] as const;
const stores: WalletStore[] = [];
let directory: string;
let retained: Awaited<ReturnType<typeof sourceBackup>>;

function guardedRuntime() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeAll(async () => {
  guardedRuntime();
  const dataDir = await mkdtemp(join(tmpdir(), "alpha-initial-recovery-retained-"));
  const store = await createFileWalletStore({ mode: MODE, dataDir });
  try { retained = await sourceBackup(store); }
  finally { try { await store.close(); } finally { await rm(dataDir, { recursive: true, force: true }); vi.unstubAllEnvs(); } }
}, TIMEOUT);
beforeEach(async () => { guardedRuntime(); directory = await mkdtemp(join(tmpdir(), "alpha-initial-recovery-test-")); });
afterEach(async () => {
  try {
    const results = await Promise.allSettled(stores.splice(0).map(store => store.close()));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  } finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);
async function connected(name: string) {
  const dataDir = join(directory, name), store = await createFileWalletStore({ mode: MODE, dataDir });
  stores.push(store); return { store, dataDir };
}
function bound(store: WalletStore, wrapper: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(wrapper(tx))), close: async () => undefined };
}
async function financialRows(store: WalletStore) {
  return store.transaction(async tx => {
    const canonical: Record<string, unknown[]> = {}, coordination: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      canonical[table] = (await tx.query<{ row: unknown }>(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t
        ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    }
    for (const table of ["activations", "acceptances", "publications"] as const) {
      coordination[table] = (await tx.query<{ row: unknown }>(`SELECT to_jsonb(t) AS row FROM ${SCHEMA}.${table} t
        ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows.map(row => row.row);
    }
    return { commands: (await tx.query(COMMANDS)).rows, canonical, coordination };
  });
}
async function footprint(store: WalletStore) {
  return store.transaction(async tx => (await tx.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    OR n.nspname NOT IN ('pg_catalog','information_schema','public') AND n.nspname NOT LIKE 'pg_%'
    ORDER BY n.nspname,c.relname,c.relkind`)).rows);
}
async function sourceBackup(store: WalletStore, options: Parameters<typeof buildInitialMarketplaceFixture>[1] & {
  accepted?: boolean; paused?: boolean;
} = {}) {
  const { canonical: fixture } = await buildInitialMarketplaceFixture(store, options);
  let now = fixture.acceptedAtMs;
  const clock = () => now;
  const coordinator = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  const ownerInput = { sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId };
  await coordinator.activateRequest({ ...ownerInput, operationId: "recovery-owner-activation",
    assetId: fixture.assetId, walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId });
  const acceptance = options.accepted === false ? null : await coordinator.acceptRequest({
    sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId: "recovery-seller-acceptance",
    ...(fixture.initialRequest.paymentMethod !== "Bank Transfer" ? { safetyAcknowledged: true as const } : {}),
  });
  if (options.paused !== false) {
    now += 1000;
    await coordinator.pause({ ...ownerInput, operationId: "recovery-source-pause" });
  }
  const original = await financialRows(store);
  const serialized = options.paused === false ? "" : await exportInitialMarketplaceWalletBackup({ mode: MODE, store, ...ownerInput, clock });
  if (serialized) expect(await financialRows(store)).toEqual(original);
  return { fixture, coordinator, ownerInput, clock, acceptance, original, serialized,
    inspection: serialized ? inspectInitialMarketplaceWalletBackup(serialized) : null, restoreAt: now + 1000 };
}
function restore(store: WalletStore, source = retained) {
  return restoreInitialMarketplaceWalletBackup({ mode: MODE, store, backup: source.serialized,
    acknowledgeFreshTarget: true, expectedChecksum: source.inspection!.checksum, clock: () => source.restoreAt });
}
function inspect(store: WalletStore, source = retained) {
  return inspectRestoredInitialMarketplaceWallet({ mode: MODE, store, expectedChecksum: source.inspection!.checksum });
}
function quarantineKey() {
  return v3CommandKey(v3Command("pause", { kind: "operator", id: "initial-marketplace-backup-recovery" }, `restore-${retained.inspection!.checksum}`, null));
}
function assertNoCredentials(value: unknown, source = retained) {
  const output = JSON.stringify(value);
  for (const token of [source.fixture.ownerSessionToken, source.fixture.sellerSessionToken, source.fixture.buyerSessionToken,
    ...Object.values(source.fixture.mobile.credentials).map(row => row.accessToken)]) {
    expect(output).not.toContain(token);
    expect(output).not.toContain(createHash("sha256").update(token).digest("hex"));
  }
  for (const token of ["passwordHash", "refresh_token_hash", "access_token_hash", "device_id_hash", "token_hash", "verifiedPhone"]) {
    expect(output).not.toContain(token);
  }
}

describe("initial marketplace combined recovery", () => {
  it("atomically preserves original v1/v2/v3 and canonical history, quarantines, and verifies the same reopened target", async () => {
    const target = await connected("restored");
    let transactions = 0;
    const counted: WalletStore = { transaction: work => { transactions++; return target.store.transaction(work); }, close: async () => undefined };
    const result = await restore(counted);
    expect(transactions).toBe(1);
    expect(result).toMatchObject({ backup: retained.inspection, quarantined: true, quarantineCommandKey: quarantineKey(),
      restored: { revision: retained.inspection!.commandCount + 1, lastCommandAtMs: retained.restoreAt } });
    assertNoCredentials(result);
    const rows = await financialRows(target.store);
    expect(rows.canonical).toEqual(retained.original.canonical);
    expect(rows.coordination).toEqual(retained.original.coordination);
    expect(rows.commands.slice(0, -1)).toEqual(retained.original.commands);
    expect(rows.commands.at(-1)).toMatchObject({ command_type: "pause", command_key: quarantineKey(), occurred_at_ms: String(retained.restoreAt) });
    const snapshot = verifyV3History(rows.commands);
    expect(isV3State(snapshot.state)).toBe(true);
    if (!isV3State(snapshot.state)) throw new Error("Expected v3");
    expect(snapshot.state.haltReason).toBeTruthy();
    expect(snapshot.state.initialAcceptanceReceipts.size).toBe(1);
    expect(snapshot.state.initialBindings.size).toBe(1);
    expect(balance(snapshot.state, retained.fixture.assetId, `listing:${retained.fixture.walletListingId}`)).toBe(parseUnits("300", 6));
    expect(balance(snapshot.state, retained.fixture.assetId, `trade:${retained.fixture.walletTradeId}`)).toBe(parseUnits("200", 6));
    expect(expectedCustody(snapshot.state, retained.fixture.assetId)).toBe(parseUnits("500", 6));
    expect(snapshot.state.payouts.size).toBe(0);
    assertLedgerInvariants(snapshot.state);
    await target.store.close();
    const reopened = await connected("restored");
    expect(await inspect(reopened.store)).toMatchObject({ checksum: retained.inspection!.checksum, source: retained.inspection!.checkpoint,
      restored: result.restored, quarantined: true });
    const before = await financialRows(reopened.store);
    await expect(restore(reopened.store)).rejects.toThrow();
    expect(await financialRows(reopened.store)).toEqual(before);
  }, TIMEOUT);

  it.each(["absent", "pending"] as const)("preserves paused activation without fabricating acceptance (%s trade)", async tradeProjection => {
    const sourceStore = await connected(`activated-${tradeProjection}`);
    const source = await sourceBackup(sourceStore.store, { accepted: false, tradeProjection });
    const target = await connected(`activated-target-${tradeProjection}`);
    await restore(target.store, source);
    const rows = await financialRows(target.store), state = verifyV3History(rows.commands).state;
    expect(rows.canonical).toEqual(source.original.canonical); expect(rows.coordination).toEqual(source.original.coordination);
    if (!isV3State(state)) throw new Error("Expected v3");
    expect(state.initialBindings.size).toBe(0); expect(state.initialAcceptanceReceipts.size).toBe(0);
    expect(state.trades.size).toBe(0); expect(state.payouts.size).toBe(0);
    expect(balance(state, source.fixture.assetId, `listing:${source.fixture.walletListingId}`)).toBe(parseUnits("500", 6));
    expect((await inspect(target.store, source)).quarantined).toBe(true);
  }, TIMEOUT);

  it.each(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"] as const)("retains Face-to-Face consent and exact %s principal", async assetId => {
    const sourceStore = await connected("face-source");
    const source = await sourceBackup(sourceStore.store, { paymentMethod: "Face-to-Face", assetId, tradeProjection: "pending", platform: "android" });
    const target = await connected("face-target"); await restore(target.store, source);
    const rows = await financialRows(target.store), snapshot = verifyV3History(rows.commands);
    expect(rows.commands.slice(0, -1)).toEqual(source.original.commands); expect(rows.canonical).toEqual(source.original.canonical);
    expect(balance(snapshot.state, assetId, `trade:${source.fixture.walletTradeId}`)).toBe(parseUnits("200", assetId === "tron-sim-usdt" ? 6 : 18));
    expect((await inspect(target.store, source)).quarantined).toBe(true);
  }, TIMEOUT);

  it("exports identically through current web/mobile owner credentials and excludes every credential", async () => {
    const sourceStore = await connected("owner-source"), source = await sourceBackup(sourceStore.store);
    const mobile = await exportMobileInitialMarketplaceWalletBackup({ mode: MODE, store: sourceStore.store,
      requestId: source.fixture.requestId, ...source.fixture.mobile.credentials[source.fixture.ownerId], clock: source.clock });
    expect(mobile).toBe(source.serialized); assertNoCredentials(source.serialized, source);
    for (const sessionToken of [source.fixture.buyerSessionToken, source.fixture.sellerSessionToken]) {
      await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: sourceStore.store,
        requestId: source.fixture.requestId, sessionToken, clock: source.clock })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    }
    await expect(exportMobileInitialMarketplaceWalletBackup({ mode: MODE, store: sourceStore.store,
      requestId: source.fixture.requestId, ...source.fixture.mobile.credentials[source.fixture.sellerId], clock: source.clock })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    expect(await financialRows(sourceStore.store)).toEqual(source.original);
  }, TIMEOUT);

  it("requires the owner to pause the source before export", async () => {
    const sourceStore = await connected("unpaused"), source = await sourceBackup(sourceStore.store, { paused: false });
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: sourceStore.store,
      ...source.ownerInput, clock: source.clock })).rejects.toMatchObject({ code: "SOURCE_NOT_PAUSED" });
    expect(await financialRows(sourceStore.store)).toEqual(source.original);
  }, TIMEOUT);

  it("rechecks owner expiry after private row capture and rolls back the export registration", async () => {
    const sourceStore = await connected("owner-expiry"), source = await sourceBackup(sourceStore.store);
    let now = source.clock(), capturedRows = false;
    const expiry = bound(sourceStore.store, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (sql.includes("jsonb_agg") && sql.includes(`${SCHEMA}.publications`)) {
          capturedRows = true; now = source.fixture.sessionsExpireAtMs;
        }
        return result;
      } }));
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: expiry,
      ...source.ownerInput, clock: () => now })).rejects.toThrow();
    expect(capturedRows).toBe(true); expect(await financialRows(sourceStore.store)).toEqual(source.original);
  }, TIMEOUT);

  it("rejects a non-UTC target before writing any wallet or canonical records", async () => {
    const target = await connected("wrong-timezone"), before = await footprint(target.store);
    const nonUtc: WalletStore = { transaction: work => target.store.transaction(async tx => {
      await tx.exec("SET LOCAL TIME ZONE 'Asia/Jerusalem'"); return work(tx);
    }), close: async () => undefined };
    await expect(restore(nonUtc)).rejects.toThrow(/UTC/);
    expect(await footprint(target.store)).toEqual(before);
  }, TIMEOUT);

  it("restores exact disabled identity stubs with empty web sessions and no mobile authentication relations", async () => {
    const target = await connected("credential-quarantine"); await restore(target.store);
    const rows = await target.store.transaction(async tx => ({
      users: (await tx.query<{ payload: Record<string, unknown> }>("SELECT payload FROM alpha_exchange.users ORDER BY id")).rows,
      sessions: (await tx.query("SELECT * FROM alpha_exchange.sessions")).rows,
      mobile: (await tx.query("SELECT to_regclass('alpha_exchange.mobile_device_sessions') AS sessions,to_regclass('alpha_exchange.mobile_refresh_token_history') AS history")).rows,
    }));
    expect(rows.sessions).toEqual([]); expect(rows.mobile).toEqual([{ sessions: null, history: null }]);
    expect(rows.users.length).toBeGreaterThan(0);
    for (const user of rows.users) expect(user.payload.disabled).toBe(true);
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: target.store,
      ...retained.ownerInput, clock: () => retained.restoreAt })).rejects.toThrow();
    const wallet = createV3DurableWallet({ mode: MODE, store: target.store });
    await expect(wallet.snapshot()).rejects.toThrow();
    expect((await inspect(target.store)).quarantined).toBe(true);
  }, TIMEOUT);

  it.each([
    ["initialized wallet", async (store: WalletStore) => initializeDurableWallet(store)],
    ["canonical schema", async (store: WalletStore) => store.transaction(tx => tx.exec("CREATE SCHEMA alpha_exchange"))],
    ["initial namespace", async (store: WalletStore) => store.transaction(tx => tx.exec(`CREATE SCHEMA ${SCHEMA}`))],
    ["correction namespace", async (store: WalletStore) => store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation"))],
    ["public data", async (store: WalletStore) => store.transaction(tx => tx.exec("CREATE TABLE public.keep_me(value text); INSERT INTO public.keep_me VALUES ('retained')"))],
  ] as const)("refuses a target containing %s without replacing anything", async (_name, arrange) => {
    const target = await connected("nonempty"); await arrange(target.store);
    const before = await footprint(target.store); await expect(restore(target.store)).rejects.toThrow();
    expect(await footprint(target.store)).toEqual(before);
  }, TIMEOUT);

  it.each(["quarantine", "canonical", "receipt"] as const)("rolls back the entire restore after a late %s SQL failure", async stage => {
    const target = await connected(`fault-${stage}`), before = await footprint(target.store);
    let reached = false, inserted = 0;
    const faulted = bound(target.store, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const isCommand = /^\s*INSERT\s+INTO\s+alpha_wallet_simulation\.commands\b/i.test(sql);
        const failure = stage === "quarantine" && isCommand && params?.[1] === quarantineKey()
          || stage === "canonical" && /INSERT\s+INTO\s+alpha_exchange\."?purchase_requests\b/i.test(sql)
          || stage === "receipt" && /UPDATE\s+alpha_wallet_initial_marketplace_simulation\."?recovery_receipts\b/i.test(sql);
        if (failure) { reached = true; await tx.query("SELECT 1 / 0"); }
        const result = await tx.query<Row>(sql, params); if (isCommand) inserted++; return result;
      } }));
    await expect(restore(faulted)).rejects.toThrow(); expect(reached).toBe(true);
    expect(inserted).toBe(retained.inspection!.commandCount + (stage === "quarantine" ? 0 : 1));
    expect(await footprint(target.store)).toEqual(before); expect((await restore(target.store)).quarantined).toBe(true);
  }, TIMEOUT);

  it("preserves an actually committed restore after a lost reply and refuses another restore over it", async () => {
    const target = await connected("unknown-commit"); let commits = 0;
    const lost: WalletStore = { async transaction(work) { await target.store.transaction(work); commits++;
      throw new CommitOutcomeUnknownError(new Error(`Synthetic private driver cause ${retained.fixture.ownerSessionToken}`)); }, close: async () => undefined };
    let failure: unknown; try { await restore(lost); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" }); expect(commits).toBe(1);
    expect(String((failure as Error).cause)).not.toContain(retained.fixture.ownerSessionToken);
    await target.store.close(); const reopened = await connected("unknown-commit");
    expect((await inspect(reopened.store)).quarantined).toBe(true);
    const before = await financialRows(reopened.store); await expect(restore(reopened.store)).rejects.toThrow();
    expect(await financialRows(reopened.store)).toEqual(before);
  }, TIMEOUT);

  it.each([
    "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','false')",
    "UPDATE alpha_exchange.runtime_meta SET version=version+1",
    "UPDATE alpha_exchange.purchase_requests SET status='completed'",
    "DELETE FROM alpha_exchange.notifications",
    "TRUNCATE alpha_wallet_initial_marketplace_simulation.publications",
  ])("refuses a late write after early deferred checks: %s", async sql => {
    const target = await connected("late-write"), before = await footprint(target.store); let returned = false;
    const late: WalletStore = { transaction: work => target.store.transaction(async tx => {
      const result = await work(tx); returned = true;
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED");
      await tx.exec(sql); return result;
    }), close: async () => undefined };
    await expect(restore(late)).rejects.toThrow(); expect(returned).toBe(true);
    expect(await footprint(target.store)).toEqual(before);
  }, TIMEOUT);

  it.each(["mobile_device_sessions", "mobile_refresh_token_history"])("refuses late %s creation at normal deferred COMMIT", async name => {
    const target = await connected("late-auth-schema"), before = await footprint(target.store); let returned = false;
    const late: WalletStore = { transaction: work => target.store.transaction(async tx => {
      const result = await work(tx); returned = true;
      await tx.exec(`CREATE TABLE alpha_exchange.${name}(id text)`); return result;
    }), close: async () => undefined };
    await expect(restore(late)).rejects.toThrow(); expect(returned).toBe(true);
    expect(await footprint(target.store)).toEqual(before);
  }, TIMEOUT);

  it("rejects old recovery formats and namespaces without reinterpreting their histories", async () => {
    expect(() => inspectMarketplaceWalletBackup(retained.serialized)).toThrow();
    expect(() => inspectV3WalletBackup(retained.serialized)).toThrow();
    const noTransaction: WalletStore = { transaction: vi.fn(async () => { throw new Error("Must reject before storage"); }), close: async () => undefined };
    await expect(restoreMarketplaceWalletBackup({ mode: MODE, store: noTransaction, backup: retained.serialized,
      acknowledgeFreshTarget: true, expectedChecksum: retained.inspection!.checksum })).rejects.toThrow();
    await expect(restoreV3WalletBackup({ mode: MODE, store: noTransaction, backup: retained.serialized,
      acknowledgeFreshTarget: true, expectedChecksum: retained.inspection!.checksum })).rejects.toThrow();
    expect(noTransaction.transaction).not.toHaveBeenCalled();
    const sourceStore = await connected("isolated-export-refused"), source = await sourceBackup(sourceStore.store);
    await expect(exportV3WalletBackup({ mode: MODE, store: sourceStore.store, clock: source.clock })).rejects.toThrow();
  }, TIMEOUT);

  it.each(["truncated", "checksum", "fresh-ack", "old-clock", "hosted"] as const)("rejects %s before target storage", async scenario => {
    const noTransaction: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target must not open"); }), close: async () => undefined };
    if (scenario === "hosted") vi.stubEnv("VERCEL_ENV", "production");
    await expect(restoreInitialMarketplaceWalletBackup({ mode: MODE, store: noTransaction,
      backup: scenario === "truncated" ? retained.serialized.slice(0, -20) : retained.serialized,
      acknowledgeFreshTarget: (scenario !== "fresh-ack") as true,
      expectedChecksum: scenario === "checksum" ? "0".repeat(64) : retained.inspection!.checksum,
      clock: () => scenario === "old-clock" ? 0 : retained.restoreAt })).rejects.toThrow();
    expect(noTransaction.transaction).not.toHaveBeenCalled();
  });

  it("rejects a mismatched expected backup checksum during same-target inspection", async () => {
    const target = await connected("inspection-mismatch"); await restore(target.store);
    const wrong = { ...JSON.parse(retained.serialized), requestId: "different-request" };
    delete wrong.checksum;
    await expect(inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: target.store,
      expectedChecksum: walletDigest(wrong) })).rejects.toThrow();
    expect((await inspect(target.store)).quarantined).toBe(true);
  }, TIMEOUT);
});
