// @vitest-environment node
// Stored synthetic sessions, real canonical SQL and real v3 history in disposable stores.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeUser, CommissionRecord, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import {
  createDevelopmentInitialMarketplaceWalletCoordinator, createDevelopmentMobileInitialMarketplaceWalletCoordinator,
  type DevelopmentInitialMarketplaceAcceptanceInput,
} from "./initial-marketplace-coordinator";
import { balance, expectedCustody } from "./ledger";
import { exportV3WalletBackup } from "./v3-backup";
import { v3Command } from "./v3-commands";
import { createV3DurableWallet, verifyV3History } from "./v3-durable";
import { isV3State } from "./v3-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const SCHEMA = "alpha_wallet_initial_marketplace_simulation";
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records",
  "evidence", "disputes", "notifications", "audit_logs"] as const;
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
let coordinator: ReturnType<typeof createDevelopmentInitialMarketplaceWalletCoordinator>;
let mobile: ReturnType<typeof createDevelopmentMobileInitialMarketplaceWalletCoordinator>;
const clock = () => now;
const ownerInput = () => ({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });
const activationInput = (operationId = "initial-owner-activate") => ({ ...ownerInput(), operationId,
  walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId, assetId: fixture.assetId });
const sellerInput = (operationId = "initial-seller-accept"): DevelopmentInitialMarketplaceAcceptanceInput => ({
  sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId,
  ...(fixture.initialRequest.paymentMethod !== "Bank Transfer" ? { safetyAcknowledged: true as const } : {}),
});
const mobileInput = (operationId = "initial-mobile-accept") => ({ ...fixture.mobile.credentials[fixture.sellerId],
  requestId: fixture.requestId, operationId,
  ...(fixture.initialRequest.paymentMethod !== "Bank Transfer" ? { safetyAcknowledged: true as const } : {}),
});
const wrapped = (wrap: (tx: WalletSql) => WalletSql): WalletStore => ({ transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined });

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-initial-coordinator-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);
async function setup(options: Parameters<typeof buildInitialMarketplaceFixture>[1] = {}, activate = true) {
  fixture = (await buildInitialMarketplaceFixture(store, options)).canonical;
  now = fixture.acceptedAtMs;
  coordinator = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  mobile = createDevelopmentMobileInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  if (activate) await coordinator.activateRequest(activationInput());
}
async function footprint() {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV3History(commands);
    if (!isV3State(snapshot.state)) throw new Error("Expected an actual v3 fixture");
    const canonical: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) canonical[table] = (await tx.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    const activations = (await tx.query(`SELECT * FROM ${SCHEMA}.activations ORDER BY request_id`)).rows;
    const acceptances = (await tx.query(`SELECT * FROM ${SCHEMA}.acceptances ORDER BY request_id`)).rows;
    const publications = (await tx.query(`SELECT * FROM ${SCHEMA}.publications ORDER BY id`)).rows;
    return { commands, snapshot: { ...snapshot, state: snapshot.state }, canonical, activations, acceptances, publications };
  });
}
async function patchUser(userId: string, patch: (user: AlphaExchangeUser) => void) {
  await store.transaction(async tx => {
    const user = (await tx.query<{ payload: AlphaExchangeUser }>("SELECT payload FROM alpha_exchange.users WHERE id=$1", [userId])).rows[0].payload;
    patch(user);
    await tx.query("UPDATE alpha_exchange.users SET role=$2,seller_status=$3,availability_status=$4,online_status=$5,payload=$6::jsonb WHERE id=$1",
      [user.id, user.role, user.sellerStatus, user.availabilityStatus, user.onlineStatus, JSON.stringify(user)]);
  });
}
async function patchRequest(requestId: string, patch: (request: PurchaseRequest) => void) {
  await store.transaction(async tx => {
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [requestId])).rows[0].payload;
    patch(request);
    await tx.query("UPDATE alpha_exchange.purchase_requests SET status=$2,payload=$3::jsonb WHERE id=$1",
      [request.id, request.status, JSON.stringify(request)]);
  });
}
async function insertOtherSellerTrade(index: number) {
  await store.transaction(async tx => {
    const source = fixture.users.find(user => user.id === fixture.otherBuyerId)!;
    const buyer = { ...structuredClone(source), id: `cap-buyer-${index}`, email: `cap-buyer-${index}@example.invalid` };
    await tx.query(`INSERT INTO alpha_exchange.users VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)`,
      [buyer.id, buyer.email, buyer.role, buyer.sellerStatus, buyer.availabilityStatus, buyer.onlineStatus, buyer.createdAt, buyer.updatedAt, 100 + index, JSON.stringify(buyer)]);
    const listing: MarketplaceListing = { ...structuredClone(fixture.initialListing), id: `cap-listing-${index}`,
      status: "matched", activeTradeRequestId: `cap-request-${index}` };
    await tx.query(`INSERT INTO alpha_exchange.listings VALUES ($1,$2,$3,$4,NULL,$5::timestamptz,$6::timestamptz,$7,$8::jsonb)`,
      [listing.id, listing.sellerId, listing.status, listing.activeTradeRequestId, listing.createdAt, listing.updatedAt, 100 + index, JSON.stringify(listing)]);
    const request: PurchaseRequest = { ...structuredClone(fixture.initialRequest), id: `cap-request-${index}`, tradeId: `cap-trade-${index}`,
      listingId: listing.id, buyerId: buyer.id, status: "accepted", timeline: [] };
    await tx.query(`INSERT INTO alpha_exchange.purchase_requests VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)`,
      [request.id, request.tradeId, request.listingId, request.sellerId, request.buyerId, request.status,
        request.createdAt, request.updatedAt, 100 + index, JSON.stringify(request)]);
  });
}

describe("authenticated initial canonical v3 coordination", () => {
  it.each(["absent", "pending"] as const)("commits full retained-price reservation with %s canonical trade projection", async tradeProjection => {
    await setup({ tradeProjection });
    const before = await footprint();
    const receipt = await coordinator.acceptRequest(sellerInput());
    const after = await footprint();
    expect(receipt).toMatchObject({ replayed: false, requestId: fixture.requestId, platformTradeId: fixture.tradeId,
      walletTradeId: fixture.walletTradeId, principalRaw: "200000000", acceptedAt: new Date(now).toISOString(),
      terms: { usdtAmount: "200", pricePerUsdt: "3.10", fiatAmount: "626.20", buyerFeeRaw: "2000000", sellerFeeRaw: "2000000" } });
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.commands.slice(0, -1)).toEqual(before.commands);
    expect(after.commands.at(-1)?.command_json).toMatchObject({ type: "acceptInitialSellerRequest", actor: { kind: "seller", id: fixture.sellerId } });
    expect(after.snapshot.state.trades.get(fixture.walletTradeId)).toMatchObject({ sellerId: fixture.sellerId, buyerId: fixture.buyerId, status: "reserved" });
    expect(balance(after.snapshot.state, fixture.assetId, `listing:${fixture.walletListingId}`)).toBe(BigInt(300_000_000));
    expect(balance(after.snapshot.state, fixture.assetId, `trade:${fixture.walletTradeId}`)).toBe(BigInt(200_000_000));
    expect(expectedCustody(after.snapshot.state, fixture.assetId)).toBe(BigInt(500_000_000));
    expect(after.snapshot.state.payouts.size).toBe(0);
    expect(after.snapshot.state.listings.get(fixture.walletListingId)?.price).toBe("3.20");
    const request = after.canonical.purchase_requests.find(row => row.id === fixture.requestId)!;
    expect(request).toMatchObject({ status: "accepted", trade_id: fixture.tradeId,
      payload: { pricePerUsdt: "3.10", listingPriceAtRequest: "3.10", usdtAmount: "200", fiatAmount: "626.20" } });
    expect((request.payload as PurchaseRequest).timeline).toHaveLength(2);
    expect(after.canonical.listings.find(row => row.id === fixture.listingId)).toMatchObject({ status: "matched",
      active_trade_request_id: fixture.requestId, payload: { price: "3.20", availableAmount: "500" } });
    expect(after.canonical.trades).toHaveLength(1);
    if (tradeProjection === "pending") expect(after.canonical.trades[0].sort_index).toBe(31);
    expect(after.canonical.notifications).toHaveLength(1); expect(after.canonical.audit_logs).toHaveLength(1);
    expect(after.acceptances).toHaveLength(1); expect(after.publications).toHaveLength(1);
    for (const name of ["users", "commissions", "marketplace_enforcement_records", "evidence", "disputes"]) expect(after.canonical[name]).toEqual(before.canonical[name]);
    for (const name of ["purchase_requests", "listings"]) {
      const targetId = name === "purchase_requests" ? fixture.requestId : fixture.listingId;
      expect(after.canonical[name].filter(row => row.id !== targetId)).toEqual(before.canonical[name].filter(row => row.id !== targetId));
    }
    const serialized = JSON.stringify({ receipt, inspection: await coordinator.inspect(ownerInput()), publications: after.publications });
    for (const privateText of [fixture.sellerSessionToken, fixture.ownerSessionToken, "passwordHash", "accountNumber", "branchNumber", "sim://", "canonicalBasis"]) {
      expect(serialized).not.toContain(privateText);
    }
  }, TIMEOUT);

  it.each(["ios", "android"] as const)("uses stored %s seller authority with explicit face-to-face consent", async platform => {
    await setup({ platform, paymentMethod: "Face-to-Face", tradeProjection: "pending" });
    const before = await footprint();
    await expect(mobile.acceptRequest({ ...mobileInput(), safetyAcknowledged: undefined })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    const receipt = await mobile.acceptRequest(mobileInput());
    expect(receipt.replayed).toBe(false);
    expect(receipt.terms.paymentMethod).toBe("Face-to-Face (Meet in Person)");
    expect((await footprint()).canonical.purchase_requests.find(row => row.id === fixture.requestId)?.payload).toMatchObject({ sellerSafetyAcknowledged: true });
    expect(await coordinator.acceptRequest(sellerInput("web-retry"))).toEqual({ ...receipt, replayed: true });
  }, TIMEOUT);

  it("coordinates BSC principal with eighteen-decimal wallet units and the same retained quote", async () => {
    await setup({ assetId: "bsc-sim-binance-peg-usdt", tradeProjection: "pending" });
    const receipt = await coordinator.acceptRequest(sellerInput());
    const after = await footprint();
    expect(receipt.terms).toMatchObject({ assetId: "bsc-sim-binance-peg-usdt", usdtAmount: "200", pricePerUsdt: "3.10",
      fiatAmount: "626.20", principalRaw: "200000000000000000000", buyerFeeRaw: "2000000000000000000", sellerFeeRaw: "2000000000000000000" });
    expect(balance(after.snapshot.state, fixture.assetId, `listing:${fixture.walletListingId}`)).toBe(BigInt("300000000000000000000"));
    expect(balance(after.snapshot.state, fixture.assetId, `trade:${fixture.walletTradeId}`)).toBe(BigInt("200000000000000000000"));
    expect(after.canonical.purchase_requests.find(row => row.id === fixture.requestId)?.payload).toMatchObject({ network: "BEP20" });
    expect(after.snapshot.state.payouts.size).toBe(0);
    expect(await mobile.acceptRequest(mobileInput("bsc-mobile-recovery"))).toEqual({ ...receipt, replayed: true });
  }, TIMEOUT);

  it("requires explicit activation and accepts the stored seller without buyer capability", async () => {
    await setup({}, false);
    const before = await footprint();
    await expect(coordinator.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "ACTIVATION_REQUIRED" });
    expect(await footprint()).toEqual(before);
    expect(fixture.users.find(user => user.id === fixture.sellerId)?.role).toBe("approved_seller");
    await coordinator.activateRequest(activationInput());
    expect((await coordinator.acceptRequest(sellerInput())).replayed).toBe(false);
  }, TIMEOUT);

  it.each(["buyerSessionToken", "sellerSessionToken", "otherSellerSessionToken"] as const)("refuses %s as activation owner", async key => {
    await setup({}, false);
    const before = await footprint();
    await expect(coordinator.activateRequest({ ...activationInput(), sessionToken: fixture[key] })).rejects.toMatchObject({ code: "ACTOR" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["buyerSessionToken", "ownerSessionToken", "otherSellerSessionToken"] as const)("refuses %s as the canonical accepting seller", async key => {
    await setup(); const before = await footprint();
    await expect(coordinator.acceptRequest({ ...sellerInput(), sessionToken: fixture[key] })).rejects.toMatchObject({ code: "ACTOR" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each([
    { actorUserId: "fixture-seller" }, { amount: "1" }, { pricePerUsdt: "0.01" }, { walletTradeId: "substituted" },
    { terms: {} }, { command: {} }, { accessToken: "credential-fallback" }, { metadata: {} },
  ])("refuses caller-supplied authority or financial fields %j before a transaction", async extra => {
    await setup(); const before = await footprint();
    await expect(coordinator.acceptRequest({ ...sellerInput(), ...extra })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("recovers activation by stable mapping and rejects replacement mapping or trade aliases", async () => {
    await setup({}, false);
    const first = await coordinator.activateRequest(activationInput());
    const before = await footprint();
    expect(await coordinator.activateRequest(activationInput("another-transport"))).toEqual({ ...first, replayed: true });
    await expect(coordinator.activateRequest({ ...activationInput(), walletTradeId: "different-trade" })).rejects.toMatchObject({ code: "STALE" });
    await expect(coordinator.acceptRequest({ ...sellerInput(), requestId: fixture.tradeId })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("returns the exact original receipt across transports and after owner pause", async () => {
    await setup(); const receipt = await coordinator.acceptRequest(sellerInput());
    now += 10;
    await coordinator.pause({ ...ownerInput(), operationId: "pause-after-acceptance" });
    const paused = await footprint();
    expect(paused.snapshot.state.haltReason).toBeTruthy();
    expect(await mobile.acceptRequest(mobileInput("cross-transport-receipt"))).toEqual({ ...receipt, replayed: true });
    expect(await coordinator.acceptRequest(sellerInput("second-web-receipt"))).toEqual({ ...receipt, replayed: true });
    expect(await footprint()).toEqual(paused);
  }, TIMEOUT);

  it("inspects the same target after unknown COMMIT and recovers the original receipt", async () => {
    await setup(); let actual: unknown;
    const uncertain: WalletStore = { transaction: async work => {
      actual = await store.transaction(work);
      throw new CommitOutcomeUnknownError(new Error("synthetic lost commit reply"));
    }, close: async () => undefined };
    await expect(createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store: uncertain, clock }).acceptRequest(sellerInput()))
      .rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const after = await footprint();
    expect((await coordinator.inspect(ownerInput())).marketplace.status).toBe("accepted");
    expect(await mobile.acceptRequest(mobileInput("recover-unknown-outcome"))).toEqual({ ...(actual as object), replayed: true });
    expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it.each(["role", "session", "expiry"] as const)("requires fresh %s authority for an original receipt", async kind => {
    await setup(); await coordinator.acceptRequest(sellerInput());
    if (kind === "role") await patchUser(fixture.sellerId, user => { user.sellerStatus = "suspended"; });
    if (kind === "session") await store.transaction(tx => tx.query("DELETE FROM alpha_exchange.sessions WHERE token_hash=$1",
      [createHash("sha256").update(fixture.sellerSessionToken).digest("hex")]));
    if (kind === "expiry") now = fixture.sessionsExpireAtMs;
    const before = await footprint();
    await expect(coordinator.acceptRequest(sellerInput("denied-receipt"))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["buyer-phone", "seller-vacation", "seller-hidden", "seller-block", "buyer-block"] as const)("rechecks current %s eligibility after activation", async kind => {
    await setup();
    await patchUser(kind.startsWith("buyer") ? fixture.buyerId : fixture.sellerId, user => {
      if (kind === "buyer-phone") { delete user.verifiedPhone; delete user.phoneVerifiedAt; }
      if (kind === "seller-vacation") user.availabilityStatus = "vacation";
      if (kind === "seller-hidden") user.isProfileHidden = true;
      if (kind === "seller-block") user.blockedUserIds = [fixture.buyerId];
      if (kind === "buyer-block") user.blockedUserIds = [fixture.sellerId];
    });
    const before = await footprint();
    await expect(coordinator.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "LOCKED" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["buyer", "seller"] as const)("reads the %s's unpaid seller commissions after activation", async participant => {
    await setup();
    const row: CommissionRecord = { id: "late-commission", sellerId: participant === "buyer" ? fixture.buyerId : fixture.sellerId,
      source: "admin_manual", rate: 0.01, grossAmount: 10, commissionAmount: 0.1, paymentStatus: "pending", createdAt: fixture.at, updatedAt: fixture.at };
    await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.commissions VALUES ($1,NULL,NULL,$2,NULL,$3,NULL,$4::timestamptz,$4::timestamptz,91,$5::jsonb)`,
      [row.id, row.sellerId, row.paymentStatus, fixture.at, JSON.stringify(row)]));
    const before = await footprint();
    await expect(coordinator.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "LOCKED" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["accepted", "completed"] as const)("reads buyer %s history at another seller", async status => {
    await setup();
    await patchRequest(fixture.buyerHistoryRequestId, request => { request.status = status; });
    const before = await footprint();
    await expect(coordinator.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "LOCKED" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each([2, 3])("preserves the general seller limit with %i other canonical commitments", async count => {
    await setup();
    for (let index = 0; index < count; index++) await insertOtherSellerTrade(index);
    const before = await footprint();
    if (count === 2) {
      expect((await coordinator.acceptRequest(sellerInput())).replayed).toBe(false);
      const after = await footprint();
      expect(after.canonical.purchase_requests.filter(row => row.seller_id === fixture.sellerId && row.status === "accepted")).toHaveLength(3);
    } else {
      await expect(coordinator.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(await footprint()).toEqual(before);
    }
  }, TIMEOUT);

  it.each(["initial_acceptance_receipts", "request persistence", "listing persistence", `${SCHEMA}.acceptances`, `${SCHEMA}.publications`] as const)(
    "rolls back the whole decision after actual %s persistence fails", async marker => {
      await setup(); const before = await footprint(); let injected = false;
      const failed = wrapped(tx => ({ exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
        const result = await tx.query<Row>(sql, values);
        if (!injected && sql.includes(marker) && /INSERT|UPDATE/i.test(sql)) {
          injected = true; await tx.query("SELECT 1 / 0 /* synthetic late initial coordination failure */");
        }
        return result;
      } }));
      await expect(createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store: failed, clock }).acceptRequest(sellerInput())).rejects.toThrow();
      expect(injected).toBe(true); expect(await footprint()).toEqual(before);
    }, TIMEOUT);

  it("rechecks seller expiry after actual canonical persistence", async () => {
    await setup(); const before = await footprint(); let persisted = false;
    const expiring = wrapped(tx => ({ exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
      const result = await tx.query<Row>(sql, values);
      if (sql.includes("request persistence")) { persisted = true; now = fixture.sessionsExpireAtMs; }
      return result;
    } }));
    await expect(createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store: expiring, clock }).acceptRequest(sellerInput()))
      .rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect(persisted).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("refuses a command clock that regresses after its stored authentication checkpoints", async () => {
    await setup(); const before = await footprint(); let reads = 0;
    const regressed = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store,
      clock: () => ++reads === 3 ? now - 1 : now });
    await expect(regressed.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(reads).toBe(3); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("retains paused financial and canonical evidence across reopening and refuses isolated export", async () => {
    await setup(); const receipt = await coordinator.acceptRequest(sellerInput());
    now += 10; await coordinator.pause({ ...ownerInput(), operationId: "close-paused" });
    const before = await footprint(); await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    coordinator = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
    expect((await coordinator.inspect(ownerInput())).wallet.halted).toBe(true);
    expect(await coordinator.acceptRequest(sellerInput("reopened-receipt"))).toEqual({ ...receipt, replayed: true });
    await expect(exportV3WalletBackup({ mode: MODE, store, clock })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("fences a standalone wallet writer and stops a new acceptance after owner pause", async () => {
    await setup(); const before = await footprint();
    const wallet = createV3DurableWallet({ mode: MODE, store, clock });
    await expect(wallet.execute(v3Command("pause", { kind: "operator", id: fixture.ownerId }, "standalone-pause", null))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    await coordinator.pause({ ...ownerInput(), operationId: "owner-pause-before-accept" });
    const paused = await footprint();
    await expect(coordinator.acceptRequest(sellerInput())).rejects.toMatchObject({ code: "LOCKED" });
    expect(await footprint()).toEqual(paused);
  }, TIMEOUT);
});
