// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCancellationMarketplaceFixture } from "../../../scripts/alpha-wallet/cancellation-marketplace-fixtures";
import {
  exportCancellationMarketplaceWalletBackup, exportMobileCancellationMarketplaceWalletBackup,
  inspectCancellationMarketplaceWalletBackup, inspectRestoredCancellationMarketplaceWallet, restoreCancellationMarketplaceWalletBackup,
} from "./cancellation-marketplace-backup";
import { parseCancellationMarketplaceWalletBackup } from "./cancellation-marketplace-backup-manifest";
import { createDevelopmentCancellationMarketplaceWalletCoordinator, createDevelopmentMobileCancellationMarketplaceWalletCoordinator } from "./cancellation-marketplace-coordinator";
import { assertFreshCancellationMarketplaceRecoveryTarget, assertCancellationMarketplaceRecoveryIdentityQuarantine,
  readCancellationMarketplaceRecoveryRows } from "./cancellation-marketplace-recovery-store";
import { walletDigest } from "./commands";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { exportInitialMarketplaceWalletBackup } from "./initial-marketplace-backup";
import { balance, expectedCustody } from "./ledger";
import { exportV4WalletBackup } from "./v4-backup";
import { createV4DurableWallet, verifyV4History } from "./v4-durable";
import { assertV4Invariants, isV4State } from "./v4-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000, SCHEMA = "alpha_wallet_cancellation_marketplace_simulation";
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
let directory: string;
const stores: WalletStore[] = [];
let retained: Awaited<ReturnType<typeof sourceBackup>>;
function runtime() {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeAll(async () => {
  runtime();
  const dataDir = await mkdtemp(join(tmpdir(), "alpha-cancellation-recovery-retained-"));
  const store = await createFileWalletStore({ mode: MODE, dataDir });
  try { retained = await sourceBackup(store); }
  finally { try { await store.close(); } finally { await rm(dataDir, { recursive: true, force: true }); vi.unstubAllEnvs(); } }
}, TIMEOUT);
beforeEach(async () => { runtime(); directory = await mkdtemp(join(tmpdir(), "alpha-cancellation-recovery-")); });
afterEach(async () => {
  try {
    const results = await Promise.allSettled(stores.splice(0).map(store => store.close()));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  } finally { try { await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);
async function connected(name: string) {
  const dataDir = join(directory, name), store = await createFileWalletStore({ mode: MODE, dataDir });
  stores.push(store); return { store, dataDir };
}
const inside = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const wrapped = (store: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
const history = (store: WalletStore) => store.transaction(async tx => (await tx.query(COMMANDS)).rows);
const rows = (store: WalletStore) => store.transaction(tx => readCancellationMarketplaceRecoveryRows(tx));
const fresh = (store: WalletStore) => store.transaction(tx => assertFreshCancellationMarketplaceRecoveryTarget(tx));
async function sourceBackup(store: WalletStore, options: Parameters<typeof buildCancellationMarketplaceFixture>[1] = { cancel: true, pause: true }) {
  const fixture = await buildCancellationMarketplaceFixture(store, options), exportAt = fixture.clock() + 1000;
  const original = await rows(store), commands = await history(store);
  const serialized = await exportCancellationMarketplaceWalletBackup({ mode: MODE, store, ...fixture.ownerInput, clock: () => exportAt });
  return { fixture, original, commands, serialized, inspection: inspectCancellationMarketplaceWalletBackup(serialized),
    exportAt, restoreAt: exportAt + 1000 };
}
const restore = (store: WalletStore, source = retained) => restoreCancellationMarketplaceWalletBackup({ mode: MODE, store,
  backup: source.serialized, expectedChecksum: source.inspection.checksum, acknowledgeFreshTarget: true, clock: () => source.restoreAt });
const inspect = (store: WalletStore, source = retained) => inspectRestoredCancellationMarketplaceWallet({ mode: MODE, store, expectedChecksum: source.inspection.checksum });
function assertNoCredentials(value: unknown, source = retained) {
  const serialized = JSON.stringify(value), fixture = source.fixture.canonical;
  const tokens = [fixture.ownerSessionToken, fixture.sellerSessionToken, fixture.buyerSessionToken,
    ...Object.values(fixture.mobile.credentials).map(value => value.accessToken)];
  for (const token of tokens) {
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(createHash("sha256").update(token).digest("hex"));
  }
  for (const field of ["passwordHash", "token_hash", "access_token_hash", "refresh_token_hash", "device_id_hash"]) expect(serialized).not.toContain(field);
}

describe("cancellation successor combined recovery", () => {
  it("restores every original history and both coordination profiles atomically, pauses, reopens and verifies the same target", async () => {
    const target = await connected("target"), result = await restore(target.store);
    expect(result).toMatchObject({ quarantined: true, restored: { revision: retained.inspection.checkpoint.revision + 1 } });
    expect((await history(target.store)).slice(0, -1)).toEqual(retained.commands);
    expect(await rows(target.store)).toEqual(retained.original);
    const recovered = verifyV4History(await history(target.store));
    expect(isV4State(recovered.state)).toBe(true);
    if (!isV4State(recovered.state)) throw new Error("Missing V4 state");
    assertV4Invariants(recovered.state);
    expect(balance(recovered.state, "tron-sim-usdt", `listing:${retained.fixture.canonical.walletListingId}`)).toBe(BigInt("500000000"));
    expect(balance(recovered.state, "tron-sim-usdt", `trade:${retained.fixture.canonical.walletTradeId}`)).toBe(BigInt(0));
    expect(expectedCustody(recovered.state, "tron-sim-usdt")).toBe(BigInt("500000000"));
    expect(recovered.state.initialAcceptanceReceipts.size).toBe(1);
    expect(recovered.state.initialCancellationReceipts.size).toBe(1);
    expect(recovered.state.payouts.size).toBe(0);
    expect(recovered.state.haltReason).toBeTruthy();
    const before = await inspect(target.store);
    await target.store.close(); stores.splice(stores.indexOf(target.store), 1);
    const reopened = await createFileWalletStore({ mode: MODE, dataDir: target.dataDir }); stores.push(reopened);
    expect(await inspect(reopened)).toEqual(before);
    assertNoCredentials(result); assertNoCredentials(before);
  }, TIMEOUT);

  it("restores an accepted BSC successor whose pause was inherited before upgrade, without inventing cancellation", async () => {
    const source = await connected("source"), data = await sourceBackup(source.store, { sourcePaused: true,
      assetId: "bsc-sim-binance-peg-usdt", paymentMethod: "Face-to-Face", platform: "android" });
    expect(data.commands.at(-1)!.command_type).toBe("continueFromV3");
    const target = await connected("target"); await restore(target.store, data);
    const recovered = verifyV4History(await history(target.store));
    if (!isV4State(recovered.state)) throw new Error("Missing V4 state");
    expect(recovered.state.cancellationContinuation.sourceHaltReason).toBeTruthy();
    expect(recovered.state.initialCancellationReceipts.size).toBe(0);
    expect(balance(recovered.state, data.fixture.canonical.assetId, `listing:${data.fixture.canonical.walletListingId}`)).toBe(BigInt("300000000000000000000"));
    expect(balance(recovered.state, data.fixture.canonical.assetId, `trade:${data.fixture.canonical.walletTradeId}`)).toBe(BigInt("200000000000000000000"));
    expect(await rows(target.store)).toEqual(data.original);
    expect(await history(source.store)).toEqual(data.commands);
    expect((await inspect(target.store, data)).quarantined).toBe(true);
  }, TIMEOUT);

  it("exports identical bytes through current web/mobile owner credentials without changing source history", async () => {
    const source = await connected("source"), data = await sourceBackup(source.store);
    expect(await exportMobileCancellationMarketplaceWalletBackup({ mode: MODE, store: source.store, ...data.fixture.mobileOwnerInput,
      clock: () => data.exportAt })).toBe(data.serialized);
    expect(await history(source.store)).toEqual(data.commands);
    expect(await rows(source.store)).toEqual(data.original);
    assertNoCredentials(JSON.parse(data.serialized), data);
  }, TIMEOUT);

  it("authenticates an additional current owner role but restores only the scalar identity and disabled stub", async () => {
    const source = await connected("source");
    const fixture = await buildCancellationMarketplaceFixture(source.store, { cancel: true, pause: true });
    await source.store.transaction(tx => tx.query(`UPDATE alpha_exchange.users SET role='buyer',
      payload=jsonb_set(jsonb_set(payload,'{role}','"buyer"'::jsonb),'{roles}','["owner"]'::jsonb) WHERE id=$1`, [fixture.canonical.ownerId]));
    const exportAt = fixture.clock() + 1000;
    const serialized = await exportCancellationMarketplaceWalletBackup({ mode: MODE, store: source.store, ...fixture.ownerInput, clock: () => exportAt });
    const parsed = parseCancellationMarketplaceWalletBackup(serialized);
    expect(parsed.canonical.users.find(user => user.id === fixture.canonical.ownerId)?.role).toBe("buyer");
    const target = await connected("target");
    await restoreCancellationMarketplaceWalletBackup({ mode: MODE, store: target.store, backup: serialized,
      expectedChecksum: parsed.checksum, acknowledgeFreshTarget: true, clock: () => exportAt + 1000 });
    const user = await target.store.transaction(async tx => (await tx.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM alpha_exchange.users WHERE id=$1", [fixture.canonical.ownerId])).rows[0].payload);
    expect(user).toMatchObject({ role: "buyer", disabled: true, recoveryIdentityOnly: true });
    expect(user).not.toHaveProperty("roles");
    await target.store.transaction(tx => assertCancellationMarketplaceRecoveryIdentityQuarantine(tx));
  }, TIMEOUT);

  it("requires a current owner and an existing durable source pause", async () => {
    const source = await connected("source"), fixture = await buildCancellationMarketplaceFixture(source.store, { cancel: true });
    const before = await history(source.store);
    await expect(exportCancellationMarketplaceWalletBackup({ mode: MODE, store: source.store, ...fixture.ownerInput,
      clock: () => fixture.clock() + 1000 })).rejects.toMatchObject({ code: "SOURCE_NOT_PAUSED" });
    await expect(exportCancellationMarketplaceWalletBackup({ mode: MODE, store: source.store, ...fixture.buyerInput,
      clock: () => fixture.clock() + 1000 })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    expect(await history(source.store)).toEqual(before);
  }, TIMEOUT);

  it("rechecks owner expiry after private capture and rolls back its registration", async () => {
    const source = await connected("source"), data = await sourceBackup(source.store);
    let at = data.exportAt, reached = false;
    const count = () => source.store.transaction(async tx => (await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${SCHEMA}.transaction_contexts`)).rows[0].count);
    const before = await count();
    const delayed = wrapped(source.store, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        if (sql.includes(`${SCHEMA}.publications`) && sql.includes("roundtrip") === false && sql.includes("LIMIT 1001")) {
          reached = true; at = data.fixture.canonical.sessionsExpireAtMs + 1;
        }
        return result;
      } }));
    await expect(exportCancellationMarketplaceWalletBackup({ mode: MODE, store: delayed, ...data.fixture.ownerInput, clock: () => at })).rejects.toThrow();
    expect(reached).toBe(true); expect(await count()).toBe(before);
    expect(await history(source.store)).toEqual(data.commands);
  }, TIMEOUT);

  it.each(["quarantine", "canonical", "predecessor", "successor", "receipt"])("rolls back every new schema and row after a real SQL fault at %s", async stage => {
    const target = await connected("target"); let reached = false;
    const failed = wrapped(target.store, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        const match = stage === "quarantine" && /^\s*INSERT INTO alpha_wallet_simulation\.commands\b/i.test(sql)
          && values?.some(value => typeof value === "string" && value.includes("cancellation-marketplace-backup-recovery"))
          || stage === "canonical" && /^\s*INSERT INTO alpha_exchange\.purchase_requests\b/i.test(sql)
          || stage === "predecessor" && /^\s*INSERT INTO alpha_wallet_initial_marketplace_simulation\.acceptances\b/i.test(sql)
          || stage === "successor" && /^\s*INSERT INTO alpha_wallet_cancellation_marketplace_simulation\.cancellations\b/i.test(sql)
          || stage === "receipt" && /^\s*UPDATE alpha_wallet_cancellation_marketplace_simulation\.recovery_receipts\b/i.test(sql);
        if (match) { reached = true; await tx.query("SELECT 1 / 0"); }
        return result;
      } }));
    await expect(restore(failed)).rejects.toThrow(); expect(reached).toBe(true); await fresh(target.store);
  }, TIMEOUT);

  it("preserves an actual committed target after a lost reply and refuses a second restore over it", async () => {
    const target = await connected("target");
    const lost: WalletStore = { close: async () => undefined, async transaction<T>(work: (tx: WalletSql) => Promise<T>) {
      await target.store.transaction(work); throw new CommitOutcomeUnknownError(new Error("Injected after actual commit"));
    } };
    await expect(restore(lost)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const counts = await target.store.transaction(async tx => ({
      predecessor: (await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM alpha_wallet_initial_marketplace_simulation.transaction_contexts")).rows[0].count,
      successor: (await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${SCHEMA}.transaction_contexts`)).rows[0].count,
    }));
    expect(counts).toEqual({ predecessor: "0", successor: "1" });
    const committed = await inspect(target.store), before = await history(target.store);
    await expect(restore(target.store)).rejects.toThrow();
    expect(await inspect(target.store)).toEqual(committed); expect(await history(target.store)).toEqual(before);
    await expect(inspectRestoredCancellationMarketplaceWallet({ mode: MODE, store: target.store, expectedChecksum: "e".repeat(64) })).rejects.toThrow();
  }, TIMEOUT);

  it("keeps credentials, old profiles, standalone tools and recovered canonical writers closed", async () => {
    const target = await connected("target"); await restore(target.store);
    await target.store.transaction(tx => assertCancellationMarketplaceRecoveryIdentityQuarantine(tx));
    const web = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: target.store, clock: () => retained.restoreAt });
    const mobile = createDevelopmentMobileCancellationMarketplaceWalletCoordinator({ mode: MODE, store: target.store, clock: () => retained.restoreAt });
    await expect(web.inspect(retained.fixture.ownerInput)).rejects.toThrow();
    await expect(mobile.inspect(retained.fixture.mobileOwnerInput)).rejects.toThrow();
    await expect(web.cancelRequest({ ...retained.fixture.buyerInput, operationId: "recovered-cancel" })).rejects.toThrow();
    await expect(createV4DurableWallet({ mode: MODE, store: target.store }).snapshot()).rejects.toThrow();
    await expect(exportV4WalletBackup({ mode: MODE, store: target.store })).rejects.toThrow();
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: target.store, ...retained.fixture.ownerInput, clock: () => retained.restoreAt })).rejects.toThrow();
    for (const table of ["purchase_requests", "users", "sessions"]) await expect(target.store.transaction(tx => tx.query(`DELETE FROM alpha_exchange.${table} WHERE false`))).rejects.toThrow();
    await expect(target.store.transaction(tx => tx.query(`UPDATE ${SCHEMA}.recovery_receipts SET receipt=receipt`))).rejects.toThrow();
    expect((await inspect(target.store)).quarantined).toBe(true);
  }, TIMEOUT);

  it.each(["late authentication tables", "late identity change", "late sibling no-op after forced constraints"])("refuses %s and rolls back the complete restore", async stage => {
    const target = await connected("target"); let reached = false;
    await expect(target.store.transaction(async tx => {
      await restore(inside(tx)); reached = true;
      if (stage === "late authentication tables") await tx.exec("CREATE TABLE alpha_exchange.mobile_device_sessions (id text PRIMARY KEY); CREATE TABLE alpha_exchange.mobile_refresh_token_history (token_hash text PRIMARY KEY)");
      else if (stage === "late identity change") await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','false'::jsonb)");
      else { await tx.query("SET CONSTRAINTS ALL IMMEDIATE"); await tx.query("SET CONSTRAINTS ALL DEFERRED");
        await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE id=$1", [retained.fixture.canonical.otherRequestId]); }
    })).rejects.toThrow();
    expect(reached).toBe(true); await fresh(target.store);
  }, TIMEOUT);

  it.each(["acknowledgment", "checksum", "manifest", "clock"])("caught %s preflight refusal cannot commit an earlier companion write", async kind => {
    const target = await connected("target");
    await target.store.transaction(tx => tx.exec("CREATE TABLE public.companion (id integer PRIMARY KEY)"));
    await expect(target.store.transaction(async tx => {
      await tx.query("INSERT INTO public.companion VALUES (1)");
      try { await restoreCancellationMarketplaceWalletBackup({ mode: MODE, store: inside(tx),
        backup: kind === "manifest" ? "broken" : retained.serialized,
        expectedChecksum: kind === "checksum" ? "e".repeat(64) : retained.inspection.checksum,
        acknowledgeFreshTarget: kind === "acknowledgment" ? false as true : true,
        clock: () => kind === "clock" ? -1 : retained.restoreAt }); } catch { /* Deliberately swallowed. */ }
      return "cannot commit";
    })).rejects.toThrow();
    expect((await target.store.transaction(tx => tx.query("SELECT * FROM public.companion"))).rows).toEqual([]);
  }, TIMEOUT);

  it("captures restore options and evaluated clock before the transaction owner yields", async () => {
    const target = await connected("target"), other = await connected("other");
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const delayed: WalletStore = { close: async () => undefined, transaction: async work => { await gate; return target.store.transaction(work); } };
    const options = { mode: MODE, store: delayed, backup: retained.serialized, expectedChecksum: retained.inspection.checksum,
      acknowledgeFreshTarget: true as const, clock: () => retained.restoreAt };
    const pending = restoreCancellationMarketplaceWalletBackup(options);
    options.backup = "changed"; options.expectedChecksum = "f".repeat(64); options.store = other.store;
    options.acknowledgeFreshTarget = false as true; options.clock = () => -1; release();
    expect((await pending).restored.lastCommandAtMs).toBe(retained.restoreAt);
    expect((await inspect(target.store)).quarantined).toBe(true); await fresh(other.store);
  }, TIMEOUT);

  it("never poisons a replacement physical transaction while reporting refusal", async () => {
    const statements: string[] = []; let probes = 0;
    const tx: WalletSql = { exec: async () => { throw new Error("Unexpected restore SQL"); },
      query: async <Row extends Record<string, unknown>>(sql: string) => {
        statements.push(sql);
        if (sql === "SELECT txid_current()::text AS transaction_id") return { rows: [{ transaction_id: ++probes === 1 ? "101" : "202" }] as unknown as Row[] };
        if (sql.includes("transaction_isolation")) return { rows: [{ transaction_id: "202", isolation: "serializable",
          read_only: "off", development_mode: MODE, timezone: "UTC" }] as unknown as Row[] };
        throw new Error("Unexpected transaction abort");
      } };
    await expect(restore(inside(tx))).rejects.toThrow(/transaction identity/);
    expect(statements.some(sql => sql.includes("SELECT 1 / 0"))).toBe(false);
  });

  it.each(["web", "mobile"] as const)("does not let the %s owner reader certify and abort a replacement transaction", async transport => {
    const source = await connected("source"), data = await sourceBackup(source.store);
    let replaced = false, replacementUsable = false, aborts = 0;
    await source.store.transaction(async raw => {
      const changed: WalletSql = { exec: sql => raw.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          if (sql.includes("SELECT 1 / 0")) aborts++;
          // The outer certificate includes TimeZone; this is the first inner
          // fixed authority reader's probe, immediately after that certificate.
          if (!replaced && sql.includes("current_setting('transaction_isolation')") && !sql.includes("TimeZone")) {
            replaced = true;
            await raw.query("ROLLBACK"); await raw.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
            await raw.query("SELECT set_config('alpha_wallet.development_schema','simulation-only',true)");
          }
          return raw.query<Row>(sql, values);
        } };
      // Invalid current credentials would make an unscoped child authenticate
      // the new transaction and poison it on refusal. The parent certificate
      // must prevent the child receiving that new transaction identity at all.
      const oldAccess = data.fixture.mobileOwnerInput.accessToken;
      const missingAccess = oldAccess.slice(0, -1) + (oldAccess.endsWith("f") ? "e" : "f");
      const operation = transport === "web"
        ? exportCancellationMarketplaceWalletBackup({ mode: MODE, store: inside(changed), ...data.fixture.ownerInput,
          sessionToken: "missing-current-owner-session", clock: () => data.exportAt })
        : exportMobileCancellationMarketplaceWalletBackup({ mode: MODE, store: inside(changed), ...data.fixture.mobileOwnerInput,
          accessToken: missingAccess, clock: () => data.exportAt });
      await expect(operation).rejects.toThrow();
      replacementUsable = (await raw.query<{ value: number }>("SELECT 1 AS value")).rows[0].value === 1;
    });
    expect(replaced).toBe(true); expect(replacementUsable).toBe(true); expect(aborts).toBe(0);
    expect(await history(source.store)).toEqual(data.commands);
  }, TIMEOUT);

  it("preserves unrelated target data and refuses nonzero source/target timezones", async () => {
    const target = await connected("target");
    await target.store.transaction(tx => tx.exec("CREATE TABLE public.retained (id integer PRIMARY KEY); INSERT INTO public.retained VALUES (1)"));
    await expect(restore(target.store)).rejects.toThrow();
    expect((await target.store.transaction(tx => tx.query("SELECT * FROM public.retained"))).rows).toEqual([{ id: 1 }]);
    const empty = await connected("empty"), nonzero = (store: WalletStore): WalletStore => ({ close: async () => undefined,
      transaction: work => store.transaction(async tx => { await tx.exec("SET LOCAL TIME ZONE 'Etc/GMT-2'"); return work(tx); }) });
    await expect(restore(nonzero(empty.store))).rejects.toThrow(/UTC/); await fresh(empty.store);
    const source = await connected("source"), data = await sourceBackup(source.store);
    await expect(exportCancellationMarketplaceWalletBackup({ mode: MODE, store: nonzero(source.store), ...data.fixture.ownerInput,
      clock: () => data.exportAt })).rejects.toThrow(/UTC/);
    expect(walletDigest(await rows(source.store))).toBe(walletDigest(data.original));
  }, TIMEOUT);
});
