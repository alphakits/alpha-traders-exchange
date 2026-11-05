// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { createDevelopmentCancellationMarketplaceWalletCoordinator,
  createDevelopmentMobileCancellationMarketplaceWalletCoordinator } from "./cancellation-marketplace-coordinator";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "./initial-marketplace-coordinator";
import { balance, expectedCustody } from "./ledger";
import { exportInitialMarketplaceWalletBackup } from "./initial-marketplace-backup";
import { createV3DurableWallet } from "./v3-durable";
import { createV4DurableWallet, verifyV4History } from "./v4-durable";
import { isV4State } from "./v4-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const SCHEMA = "alpha_wallet_cancellation_marketplace_simulation";
const ORIGINAL = "alpha_wallet_initial_marketplace_simulation";
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions",
  "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"] as const;
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
let initial: ReturnType<typeof createDevelopmentInitialMarketplaceWalletCoordinator>;
let coordinator: ReturnType<typeof createDevelopmentCancellationMarketplaceWalletCoordinator>;
let mobile: ReturnType<typeof createDevelopmentMobileCancellationMarketplaceWalletCoordinator>;
const clock = () => now;
const ownerInput = () => ({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });
const upgradeInput = (operationId = "cancel-owner-upgrade") => ({ ...ownerInput(), operationId, acknowledgeVersionUpgrade: true as const });
const partyInput = (actor: "seller" | "buyer" = "seller", operationId = "cancel-party-request") => ({
  requestId: fixture.requestId, operationId,
  sessionToken: actor === "seller" ? fixture.sellerSessionToken : fixture.buyerSessionToken,
});
const mobilePartyInput = (actor: "seller" | "buyer" = "seller", operationId = "cancel-mobile-retry") => ({
  ...fixture.mobile.credentials[actor === "seller" ? fixture.sellerId : fixture.buyerId], requestId: fixture.requestId, operationId,
});
const wrapped = (wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-cancellation-coordinator-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);

async function setup(options: Parameters<typeof buildInitialMarketplaceFixture>[1] = {}, upgrade = true, sourcePaused = false) {
  fixture = (await buildInitialMarketplaceFixture(store, options)).canonical;
  now = fixture.acceptedAtMs;
  initial = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  await initial.activateRequest({ ...ownerInput(), operationId: "cancel-original-activate", assetId: fixture.assetId,
    walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId });
  await initial.acceptRequest({ ...partyInput(), operationId: "cancel-original-accept",
    ...(fixture.initialRequest.paymentMethod === "Bank Transfer" ? {} : { safetyAcknowledged: true }) });
  now += 10;
  if (sourcePaused) { await initial.pause({ ...ownerInput(), operationId: "cancel-source-inherited-pause" }); now++; }
  coordinator = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  mobile = createDevelopmentMobileCancellationMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  if (upgrade) await coordinator.upgradeRequest(upgradeInput());
  now += 10;
}
async function footprint() {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV4History(commands);
    const canonical: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) canonical[table] = (await tx.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    const predecessor: Record<string, Record<string, unknown>[]> = {};
    for (const table of ["activations", "acceptances", "publications"]) predecessor[table] = (await tx.query(
      `SELECT * FROM ${ORIGINAL}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA])).rows[0].present;
    const coordination: Record<string, Record<string, unknown>[]> = {};
    if (present) for (const table of ["transitions", "cancellations", "publications"]) coordination[table] = (await tx.query(
      `SELECT * FROM ${SCHEMA}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    return { commands, snapshot, canonical, predecessor, present, coordination };
  });
}
async function patchUser(userId: string, change: (user: AlphaExchangeUser) => void) {
  await store.transaction(async tx => {
    const user = (await tx.query<{ payload: AlphaExchangeUser }>("SELECT payload FROM alpha_exchange.users WHERE id=$1", [userId])).rows[0].payload;
    change(user);
    await tx.query("UPDATE alpha_exchange.users SET role=$2,seller_status=$3,payload=$4::jsonb WHERE id=$1",
      [user.id, user.role, user.sellerStatus, JSON.stringify(user)]);
  });
}

describe("authenticated initial cancellation successor", () => {
  it.each(["seller", "buyer"] as const)("commits one exact %s principal return and canonical cancellation", async actor => {
    await setup();
    const before = await footprint();
    const receipt = await coordinator.cancelRequest(partyInput(actor));
    const after = await footprint();
    expect(receipt).toMatchObject({ replayed: false, requestId: fixture.requestId, actorKind: actor,
      actorUserId: actor === "seller" ? fixture.sellerId : fixture.buyerId, principalRaw: "200000000",
      listingAvailableAfterRaw: "500000000", cancelledAt: new Date(now).toISOString() });
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.commands.slice(0, -1)).toEqual(before.commands);
    expect(after.predecessor).toEqual(before.predecessor);
    expect(after.coordination.transitions).toEqual(before.coordination.transitions);
    expect(after.coordination.cancellations).toHaveLength(1);
    expect(after.coordination.publications).toHaveLength(1);
    expect(isV4State(after.snapshot.state)).toBe(true);
    expect(balance(after.snapshot.state, fixture.assetId, `listing:${fixture.walletListingId}`)).toBe(BigInt(500_000_000));
    expect(balance(after.snapshot.state, fixture.assetId, `trade:${fixture.walletTradeId}`)).toBe(BigInt(0));
    expect(expectedCustody(after.snapshot.state, fixture.assetId)).toBe(BigInt(500_000_000));
    expect(after.snapshot.state.payouts.size).toBe(0);
    const request = after.canonical.purchase_requests.find(row => row.id === fixture.requestId)!;
    expect(request).toMatchObject({ status: "cancelled", payload: { status: "cancelled", usdtAmount: "200", pricePerUsdt: "3.10",
      fiatAmount: "626.20", trustReconciliation: { requestedByUserId: receipt.actorUserId } } });
    expect((request.payload as PurchaseRequest).timeline).toHaveLength(3);
    expect(after.canonical.listings.find(row => row.id === fixture.listingId)).toMatchObject({ status: "active",
      active_trade_request_id: null, payload: { availableAmount: "500", price: "3.20" } });
    expect(after.canonical.trades[0]).toMatchObject({ status: "cancelled" });
    expect(after.canonical.trades[0].created_at).toBe(before.canonical.trades[0].created_at);
    expect(after.canonical.notifications).toHaveLength(before.canonical.notifications.length + 2);
    expect(after.canonical.audit_logs).toHaveLength(before.canonical.audit_logs.length + 1);
    expect(await mobile.cancelRequest(mobilePartyInput(actor))).toEqual({ ...receipt, replayed: true });
    expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it.each(["ios", "android"] as const)("cancels face-to-face through current %s credentials with eighteen-decimal principal", async platform => {
    await setup({ paymentMethod: "Face-to-Face", platform, assetId: "bsc-sim-binance-peg-usdt", tradeProjection: "pending" });
    const receipt = await mobile.cancelRequest(mobilePartyInput("buyer", `cancel-${platform}`));
    const after = await footprint();
    expect(receipt).toMatchObject({ actorKind: "buyer", principalRaw: "200000000000000000000", listingAvailableAfterRaw: "500000000000000000000" });
    expect(balance(after.snapshot.state, fixture.assetId, `trade:${fixture.walletTradeId}`)).toBe(BigInt(0));
    expect(after.canonical.trades[0].sort_index).toBe(31);
    expect(await coordinator.cancelRequest(partyInput("buyer", "face-to-face-web-retry"))).toEqual({ ...receipt, replayed: true });
  }, TIMEOUT);

  it("upgrades once under current owner authority and preserves original accepted records", async () => {
    await setup({}, false);
    const before = await footprint();
    const receipt = await coordinator.upgradeRequest(upgradeInput());
    const after = await footprint();
    expect(receipt).toMatchObject({ replayed: false, sourcePaused: false, sourceRevision: before.snapshot.revision });
    expect(after.commands.slice(0, -1)).toEqual(before.commands);
    expect(after.commands.at(-1)?.command_type).toBe("continueFromV3");
    expect(after.predecessor).toEqual(before.predecessor);
    for (const table of TABLES.filter(name => name !== "runtime_meta")) expect(after.canonical[table]).toEqual(before.canonical[table]);
    expect(after.canonical.runtime_meta[0].version).toBe(Number(before.canonical.runtime_meta[0].version) + 1);
    expect(after.canonical.runtime_meta[0].updated_at).toBe(before.canonical.runtime_meta[0].updated_at);
    expect(await coordinator.upgradeRequest(upgradeInput("owner-upgrade-retry"))).toEqual({ ...receipt, replayed: true });
    expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it("requires explicit upgrade and never implicitly migrates through cancellation", async () => {
    await setup({}, false); const before = await footprint();
    await expect(coordinator.cancelRequest(partyInput())).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    await expect(coordinator.upgradeRequest({ ...upgradeInput(), acknowledgeVersionUpgrade: false } as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("uses retained owner membership when the account's primary role is buyer", async () => {
    await setup({}, false);
    await patchUser(fixture.ownerId, user => { user.role = "buyer"; user.roles = ["buyer", "owner"]; });
    const receipt = await coordinator.upgradeRequest(upgradeInput());
    expect(receipt).toMatchObject({ replayed: false, requestId: fixture.requestId });
    expect((await footprint()).coordination.transitions[0].actor_user_id).toBe(fixture.ownerId);
    expect((await coordinator.inspect(ownerInput())).transition.walletRevision).toBe(receipt.walletRevision);
    expect((await coordinator.cancelRequest(partyInput())).actorKind).toBe("seller");
  }, TIMEOUT);

  it.each(["sellerSessionToken", "buyerSessionToken", "otherSellerSessionToken"] as const)("refuses upgrade by %s", async name => {
    await setup({}, false); const before = await footprint();
    await expect(coordinator.upgradeRequest({ ...upgradeInput(), sessionToken: fixture[name] })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("preserves a paused accepted predecessor through upgrade and refuses a fresh return", async () => {
    await setup({}, true, true); const before = await footprint();
    expect(before.snapshot.state.haltReason).not.toBeNull();
    expect((await coordinator.inspect(ownerInput())).transition.sourcePaused).toBe(true);
    await expect(coordinator.cancelRequest(partyInput())).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    expect(balance(before.snapshot.state, fixture.assetId, `trade:${fixture.walletTradeId}`)).toBe(BigInt(200_000_000));
  }, TIMEOUT);

  it.each(["ownerSessionToken", "otherSellerSessionToken", "otherBuyerSessionToken"] as const)("refuses cancellation by unrelated %s", async name => {
    await setup(); const before = await footprint();
    await expect(coordinator.cancelRequest({ ...partyInput(), sessionToken: fixture[name] })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["suspended", "rejected"] as const)("does not substitute new-sale %s eligibility for retained seller cancellation authority", async status => {
    await setup(); await patchUser(fixture.sellerId, user => { user.sellerStatus = status; });
    expect((await coordinator.cancelRequest(partyInput())).actorKind).toBe("seller");
  }, TIMEOUT);

  it("permits the retained buyer without current new-purchase capability", async () => {
    await setup(); await patchUser(fixture.buyerId, user => { user.role = "guest"; user.roles = []; });
    expect((await coordinator.cancelRequest(partyInput("buyer"))).actorKind).toBe("buyer");
  }, TIMEOUT);

  it.each(["seller", "buyer"] as const)("refuses a disabled %s despite its retained party identity", async actor => {
    await setup(); await patchUser(actor === "seller" ? fixture.sellerId : fixture.buyerId, user => { user.disabled = true; });
    const before = await footprint();
    await expect(coordinator.cancelRequest(partyInput(actor))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("requires fresh web authority before recovering the original receipt", async () => {
    await setup(); await coordinator.cancelRequest(partyInput());
    await store.transaction(tx => tx.query("DELETE FROM alpha_exchange.sessions WHERE token_hash=$1",
      [createHash("sha256").update(fixture.sellerSessionToken).digest("hex")]));
    const before = await footprint();
    await expect(coordinator.cancelRequest(partyInput("seller", "revoked-retry"))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    expect((await mobile.cancelRequest(mobilePartyInput())).replayed).toBe(true);
  }, TIMEOUT);

  it("recovers one original receipt after pause and rejects a counterparty claiming that identity", async () => {
    await setup(); const receipt = await coordinator.cancelRequest(partyInput()); now++;
    await coordinator.pause({ ...ownerInput(), operationId: "cancel-after-pause" });
    const before = await footprint();
    expect(await mobile.cancelRequest(mobilePartyInput())).toEqual({ ...receipt, replayed: true });
    await expect(coordinator.cancelRequest(partyInput("buyer", "different-actor-retry"))).rejects.toMatchObject({ code: "STALE" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("refuses caller authority, changed money, destination, and mixed credential shapes", async () => {
    await setup(); const before = await footprint();
    for (const extra of [{ actorUserId: fixture.sellerId }, { actorKind: "seller" }, { amount: "1" }, { pricePerUsdt: "0.01" },
      { destination: "changed" }, { command: {} }, { terms: {} }, { reason: "force" }, { accessToken: "fallback" }, { metadata: {} }]) {
      await expect(coordinator.cancelRequest({ ...partyInput(), ...extra })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(coordinator.cancelRequest({ ...partyInput(), requestId: fixture.tradeId })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("keeps credentials, bank data and destination out of public receipts, inspection and publication", async () => {
    await setup(); const receipt = await coordinator.cancelRequest(partyInput());
    const after = await footprint();
    const output = JSON.stringify({ receipt, inspection: await coordinator.inspect(ownerInput()), publications: after.coordination.publications });
    for (const secret of [fixture.sellerSessionToken, fixture.ownerSessionToken, "passwordHash", "accountNumber", "branchNumber", "sim://", "canonicalBasis", "account_payload"]) {
      expect(output).not.toContain(secret);
    }
    expect(after.coordination.publications[0].payload).toMatchObject({ type: "initial_trade_cancelled",
      actorUserId: fixture.sellerId, actorKind: "seller", acceptanceKey: receipt.acceptanceKey, cancellationKey: receipt.cancellationKey });
  }, TIMEOUT);

  it("rolls back the complete principal return and canonical effects after late publication SQL failure", async () => {
    await setup(); const before = await footprint(); let injected = false;
    const fault = wrapped(tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes(`${SCHEMA}.publications`) && /INSERT INTO/i.test(sql)) {
        injected = true; await tx.query("SELECT 1 / 0 /* late cancellation publication failure */");
      }
      return tx.query<Row>(sql, values);
    } }));
    const broken = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: fault, clock });
    await expect(broken.cancelRequest(partyInput())).rejects.toThrow();
    expect(injected).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rolls back the return when the stored session expires after canonical persistence", async () => {
    await setup(); const before = await footprint(); let injected = false;
    const fault = wrapped(tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await tx.query<Row>(sql, values);
      if (sql.includes("prepayment cancellation: listing persistence")) { injected = true; now = fixture.sessionsExpireAtMs; }
      return result;
    } }));
    const expiring = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: fault, clock });
    await expect(expiring.cancelRequest(partyInput())).rejects.toThrow();
    expect(injected).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("recovers one receipt across transports after an actual commit with a lost response", async () => {
    await setup(); const before = await footprint(); let lost = true;
    const uncertain: WalletStore = { async transaction(work) {
      const result = await store.transaction(work);
      if (lost) { lost = false; throw new CommitOutcomeUnknownError(new Error("Synthetic lost cancellation reply")); }
      return result;
    }, close: async () => undefined };
    const sender = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store: uncertain, clock });
    await expect(sender.cancelRequest(partyInput())).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const committed = await footprint(); expect(committed.commands).toHaveLength(before.commands.length + 1);
    const recovered = await mobile.cancelRequest(mobilePartyInput());
    expect(recovered.replayed).toBe(true);
    expect(recovered.walletRevision).toBe(committed.snapshot.revision);
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it("fences old coordinated and standalone writers and the old combined export", async () => {
    await setup(); const before = await footprint();
    await expect(initial.inspect(ownerInput())).rejects.toThrow();
    await expect(initial.acceptRequest({ ...partyInput(), operationId: "old-accept-retry" })).rejects.toThrow();
    await expect(createV3DurableWallet({ mode: MODE, store }).snapshot()).rejects.toThrow();
    await expect(createV4DurableWallet({ mode: MODE, store }).snapshot()).rejects.toThrow();
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store, ...ownerInput(), clock })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("refuses direct canonical cancellation without the paired financial and immutable receipt", async () => {
    await setup(); const before = await footprint();
    await expect(store.transaction(async tx => {
      await tx.query("UPDATE alpha_exchange.purchase_requests SET status='cancelled',payload=jsonb_set(payload,'{status}','\"cancelled\"'::jsonb) WHERE id=$1", [fixture.requestId]);
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
});
