// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { createDevelopmentCancellationMarketplaceWalletCoordinator } from "./cancellation-marketplace-coordinator";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "./initial-marketplace-coordinator";
import { walletDigest } from "./commands";
import { assertCancellationMarketplaceContext, bindCancellationMarketplaceCommand,
  prepareCancellationMarketplaceUpgrade, readCancellationMarketplaceTransition, registerCancellationMarketplaceContext,
  type CancellationMarketplaceContext } from "./cancellation-marketplace-coordination-store";
import { createCoordinatedV4DurableWallet, upgradeCoordinatedDurableWalletV4 } from "./v4-durable";
import { v4Command } from "./v4-commands";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const;
const TIMEOUT = 120_000;
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
let coordinator: ReturnType<typeof createDevelopmentCancellationMarketplaceWalletCoordinator>;
const failures: unknown[] = [];
const diagnostic = (tx: WalletSql): WalletSql => ({
  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: unknown[]) {
    try { return await tx.query<T>(sql, parameters); }
    catch (error) { if (!sql.includes("1 / 0")) failures.push({ message: (error as Error).message,
      where: (error as { where?: string }).where, position: (error as { position?: string }).position, sql: sql.slice(0, 150) }); throw error; }
  },
  async exec(sql: string) {
    try { await tx.exec(sql); }
    catch (error) { failures.push({ message: (error as Error).message, where: (error as { where?: string }).where,
      position: (error as { position?: string }).position, sql: sql.slice(0, 150) }); throw error; }
  },
});
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-cancellation-store-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  failures.length = 0;
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
}, TIMEOUT);
async function setup() {
  fixture = (await buildInitialMarketplaceFixture(store)).canonical;
  now = fixture.acceptedAtMs;
  const initial = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => now });
  await initial.activateRequest({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId, operationId: "store-original-activate",
    assetId: fixture.assetId, walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId });
  await initial.acceptRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId: "store-original-accept" });
  now += 10;
  const inspected: WalletStore = { transaction: work => store.transaction(tx => work(diagnostic(tx))), close: async () => undefined };
  coordinator = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: inspected, clock: () => now });
}
async function upgrade() {
  return coordinator.upgradeRequest({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId,
    operationId: "store-owner-upgrade", acknowledgeVersionUpgrade: true });
}
async function footprint() {
  return store.transaction(async tx => ({
    head: (await tx.query("SELECT revision,format_version,last_event_hash FROM alpha_wallet_simulation.head")).rows,
    commands: (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows,
    journals: (await tx.query("SELECT * FROM alpha_wallet_simulation.journals ORDER BY journal_id")).rows,
    entries: (await tx.query("SELECT * FROM alpha_wallet_simulation.entries ORDER BY journal_id,account")).rows,
    runtime: (await tx.query("SELECT * FROM alpha_exchange.runtime_meta")).rows,
    requests: (await tx.query("SELECT * FROM alpha_exchange.purchase_requests ORDER BY id")).rows,
    listings: (await tx.query("SELECT * FROM alpha_exchange.listings ORDER BY id")).rows,
    trades: (await tx.query("SELECT * FROM alpha_exchange.trades ORDER BY id")).rows,
    notifications: (await tx.query("SELECT * FROM alpha_exchange.notifications ORDER BY id")).rows,
    audits: (await tx.query("SELECT * FROM alpha_exchange.audit_logs ORDER BY id")).rows,
    successor: (await tx.query("SELECT to_regnamespace('alpha_wallet_cancellation_marketplace_simulation') IS NOT NULL AS present")).rows,
  }));
}

describe("cancellation successor storage admission and immutable predecessor", () => {
  it("switches the exact old hooks atomically and commits one coordinated cancellation", async () => {
    await setup();
    const original = await store.transaction(async tx => (await tx.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(v)) FROM alpha_wallet_initial_marketplace_simulation.activations v) AS activations,
      (SELECT jsonb_agg(to_jsonb(a)) FROM alpha_wallet_initial_marketplace_simulation.acceptances a) AS acceptances,
      (SELECT jsonb_agg(to_jsonb(p)) FROM alpha_wallet_initial_marketplace_simulation.publications p) AS publications`)).rows);
    try {
      const transition = await upgrade();
      now += 10;
      const result = await coordinator.cancelRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId: "store-cancel" });
      expect(result.walletRevision).toBe(transition.walletRevision + 1);
      expect(result.listingAvailableAfterRaw).toBe("500000000");
      const retained = await store.transaction(async tx => (await tx.query(`SELECT
        (SELECT jsonb_agg(to_jsonb(v)) FROM alpha_wallet_initial_marketplace_simulation.activations v) AS activations,
        (SELECT jsonb_agg(to_jsonb(a)) FROM alpha_wallet_initial_marketplace_simulation.acceptances a) AS acceptances,
        (SELECT jsonb_agg(to_jsonb(p)) FROM alpha_wallet_initial_marketplace_simulation.publications p) AS publications`)).rows);
      expect(walletDigest(retained)).toBe(walletDigest(original));
    } catch (error) { console.error("Cancellation SQL diagnostics", failures); throw error; }
  }, TIMEOUT);

  it.each(["preparation-only", "missing-transition"] as const)("refuses committing a %s half-profile", async stage => {
    await setup(); const before = await footprint();
    await expect(store.transaction(async tx => {
      const context = await registerCancellationMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId,
        actorUserId: fixture.ownerId, operation: "upgrade" });
      const current = await createCoordinatedV4DurableWallet({ mode: MODE, context }).snapshot();
      const command = v4Command("continueFromV3", { kind: "operator", id: fixture.ownerId }, "partial-store-upgrade", {
        checkpoint: { revision: current.revision, eventHash: current.eventHash, stateHash: walletDigest(current.state), lastCommandAtMs: current.lastCommandAtMs },
      });
      await bindCancellationMarketplaceCommand(context, command);
      if (stage === "preparation-only") {
        await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
        await tx.exec("SET CONSTRAINTS ALL DEFERRED");
        await prepareCancellationMarketplaceUpgrade(context);
        return;
      }
      await upgradeCoordinatedDurableWalletV4({ mode: MODE, context, command, acknowledgeVersionUpgrade: true, clock: () => now });
      // Deliberately omit the coordinator transition. Deferred SQL owns the final seal.
    })).rejects.toThrow(/successor must retain|coordinated|transition|bootstrap must install/);
    expect(await footprint()).toEqual(before);
    await expect(upgrade()).resolves.toMatchObject({ replayed: false });
  }, TIMEOUT);

  it("seals every predecessor table against new rows, no-op mutations and truncation", async () => {
    await setup(); await upgrade(); const before = await footprint();
    for (const table of ["transaction_contexts", "activations", "acceptances", "publications"]) {
      const column = table === "transaction_contexts" ? "transaction_id" : table === "publications" ? "id" : "request_id";
      for (const sql of [
        `INSERT INTO alpha_wallet_initial_marketplace_simulation.${table} SELECT * FROM alpha_wallet_initial_marketplace_simulation.${table} WHERE false`,
        `UPDATE alpha_wallet_initial_marketplace_simulation.${table} SET ${column}=${column} WHERE false`,
        `DELETE FROM alpha_wallet_initial_marketplace_simulation.${table} WHERE false`,
        `TRUNCATE alpha_wallet_initial_marketplace_simulation.${table} CASCADE`,
      ]) await expect(store.transaction(tx => tx.exec(sql))).rejects.toThrow(/immutable/);
    }
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("installs RLS and denies public access on both preserved and successor evidence", async () => {
    await setup(); await upgrade();
    const result = await store.transaction(async tx => {
      await tx.exec("CREATE ROLE cancellation_unprivileged");
      return {
        tables: (await tx.query(`SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN
          ('alpha_wallet_initial_marketplace_simulation','alpha_wallet_cancellation_marketplace_simulation') AND c.relkind='r'`)).rows,
        access: (await tx.query(`SELECT has_schema_privilege('cancellation_unprivileged','alpha_wallet_cancellation_marketplace_simulation','USAGE') schema_access,
          has_table_privilege('cancellation_unprivileged','alpha_wallet_cancellation_marketplace_simulation.transitions','SELECT,INSERT,UPDATE,DELETE') table_access,
          has_function_privilege('cancellation_unprivileged','alpha_wallet_cancellation_marketplace_simulation.require_context()','EXECUTE') function_access`)).rows[0],
      };
    });
    expect(result.tables).toHaveLength(8);
    expect(result.tables.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true);
    expect(result.access).toEqual({ schema_access: false, table_access: false, function_access: false });
  }, TIMEOUT);

  it.each(["wrong-party", "wrong-physical-handle", "malformed-command", "runtime-refusal"] as const)(
    "poisons previously changed certified owner after a caught %s context refusal", async kind => {
      await setup(); await upgrade(); const before = await footprint();
      await expect(store.transaction(async tx => {
        const context = await registerCancellationMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId,
          actorUserId: fixture.ownerId, operation: "inspect" });
        await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+100 WHERE singleton=true");
        try {
          if (kind === "malformed-command") await bindCancellationMarketplaceCommand(context, (() => undefined) as never);
          else if (kind === "runtime-refusal") {
            vi.stubEnv("VERCEL", "1");
            try { await readCancellationMarketplaceTransition(context); } finally { vi.stubEnv("VERCEL", undefined); }
          } else await assertCancellationMarketplaceContext(context, { tx: kind === "wrong-physical-handle" ? { ...tx } : tx,
            requestId: fixture.requestId, operation: "inspect", actorUserId: kind === "wrong-party" ? fixture.buyerId : fixture.ownerId });
        } catch { /* A caller cannot make its earlier companion write committable. */ }
      })).rejects.toThrow();
      expect(await footprint()).toEqual(before);
    }, TIMEOUT);

  it("rejects forged and expired opaque contexts while preserving a later owner transaction", async () => {
    await setup(); await upgrade();
    await expect(readCancellationMarketplaceTransition({} as CancellationMarketplaceContext)).rejects.toThrow(/opaque/);
    let expired!: CancellationMarketplaceContext;
    await store.transaction(async tx => { expired = await registerCancellationMarketplaceContext({ mode: MODE, tx,
      requestId: fixture.requestId, actorUserId: fixture.ownerId, operation: "inspect" }); });
    await expect(readCancellationMarketplaceTransition(expired)).rejects.toThrow(/no longer active|changed or ended/);
    expect(await coordinator.inspect({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId }))
      .toMatchObject({ marketplace: { status: "accepted" } });
  }, TIMEOUT);

  it.each(["request-terms", "listing-inventory", "physical-trade"] as const)(
    "independent SQL rejects an altered %s persistence row after the real financial return", async alteration => {
      await setup(); await upgrade(); now += 10; const before = await footprint(); let attacked = false;
      const altered: WalletStore = { transaction: work => store.transaction(tx => work({ ...tx,
        async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: unknown[]) {
          const target = alteration === "request-terms" ? "request persistence" : alteration === "listing-inventory" ? "listing persistence" : "trade persistence";
          if (sql.includes(`prepayment cancellation: ${target}`)) {
            const copied = structuredClone(parameters!), payload = JSON.parse(copied[3] as string);
            if (alteration === "request-terms") payload.usdtAmount = "1";
            else if (alteration === "listing-inventory") payload.availableAmount = "499";
            else payload.createdAt = new Date(now).toISOString();
            copied[3] = JSON.stringify(payload); attacked = true;
            return diagnostic(tx).query<T>(sql, copied);
          }
          return tx.query<T>(sql, parameters);
        },
      })), close: async () => undefined };
      const broken = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: altered, clock: () => now });
      await expect(broken.cancelRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId: "tampered-canonical-row" })).rejects.toThrow();
      expect(attacked).toBe(true);
      expect(failures.some(value => (value as { message?: string }).message?.includes("exact canonical prepayment cancellation delta"))).toBe(true);
      expect(await footprint()).toEqual(before);
    }, TIMEOUT);

  it("detects an out-of-band missing cancellation notification during independent retained-coherence inspection", async () => {
    await setup(); await upgrade(); now += 10;
    await coordinator.cancelRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId: "event-integrity-cancel" });
    // Explicit privileged corruption for the audit test: normal row writers
    // cannot remove these records. The independent retained proof must still detect it.
    await store.transaction(async tx => {
      await tx.exec("ALTER TABLE alpha_exchange.notifications DISABLE TRIGGER cancellation_marketplace_listing_fence");
      await tx.query("DELETE FROM alpha_exchange.notifications WHERE id LIKE 'prepayment-cancellation-notification-buyer-%'");
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.exec("ALTER TABLE alpha_exchange.notifications ENABLE TRIGGER cancellation_marketplace_listing_fence");
    });
    await expect(coordinator.inspect({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId })).rejects.toThrow();
    expect(failures.some(value => (value as { message?: string }).message?.includes("notification or reminder archive is incomplete"))).toBe(true);
  }, TIMEOUT);
});
