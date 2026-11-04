// @vitest-environment node
// Actual canonical SQL, real session/account rows and the unchanged v2 engine
// share one disposable store. Native interleavings/COMMIT faults have a CLI drill.
import { calculateTradeTermsQuote } from "@alpha-traders/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeNotification, AuditLogEntry, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { BUYER, FIXTURE_TIME, OPERATOR, SELLER, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { assetFor, parseUnits, quoteTrade, type AssetId } from "./amounts";
import { walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { createMarketplaceCoordinationFixture } from "./marketplace-coordination-fixture";
import { initializeMarketplaceCoordination } from "./marketplace-coordination-store";
import { createDevelopmentMarketplaceWalletCoordinator } from "./marketplace-coordinator";
import { simulatedDestination } from "./sandbox";
import { v2Command } from "./v2-commands";
import { isV2State } from "./v2-engine";
import { createVersionedDurableWallet, upgradeDurableWalletV2, verifyVersionedHistory } from "./versioned-durable";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));

const MODE = "simulation-only" as const;
const TIMEOUT = 120_000;
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof createMarketplaceCoordinationFixture>>;
let coordinator: ReturnType<typeof createDevelopmentMarketplaceWalletCoordinator>;
const clock = () => now;
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-marketplace-coordinator-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await initializeDurableWallet(store);
  now = FIXTURE_TIME + 1000;
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function updateRequest(mutate: (request: PurchaseRequest) => void, requestId = fixture.requestId) {
  await store.transaction(async tx => {
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [requestId])).rows[0].payload;
    mutate(request);
    await tx.query(`UPDATE alpha_exchange.purchase_requests SET trade_id=$2,listing_id=$3,seller_id=$4,buyer_id=$5,status=$6,
      updated_at=$7::timestamptz,payload=$8::jsonb WHERE id=$1`,
    [request.id, request.tradeId ?? null, request.listingId, request.sellerId, request.buyerId, request.status, request.updatedAt, JSON.stringify(request)]);
  });
}
async function updateListing(mutate: (listing: MarketplaceListing) => void) {
  await store.transaction(async tx => {
    const listing = (await tx.query<{ payload: MarketplaceListing }>("SELECT payload FROM alpha_exchange.listings WHERE id=$1", [fixture.listingId])).rows[0].payload;
    mutate(listing);
    await tx.query("UPDATE alpha_exchange.listings SET seller_id=$2,payload=$3::jsonb WHERE id=$1", [listing.id, listing.sellerId, JSON.stringify(listing)]);
  });
}
async function setup(options: {
  paymentMethod?: "Bank Transfer" | "Face-to-Face"; proposedAmount?: string; assetId?: AssetId;
  arrangeWallet?: (seed: ReturnType<typeof durableFixture>) => Promise<unknown>;
} = {}) {
  fixture = await store.transaction(tx => createMarketplaceCoordinationFixture({ mode: MODE, tx, paymentMethod: options.paymentMethod }));
  const assetId = options.assetId ?? TRON;
  if (assetId !== TRON) {
    for (const requestId of [fixture.requestId, fixture.otherRequestId]) {
      await updateRequest(request => {
        request.network = "BEP20";
        request.buyerReceivingWalletAddress = simulatedDestination(assetId, fixture.buyerId);
      }, requestId);
    }
    await updateListing(listing => { listing.network = "BEP20"; });
  }
  if (options.proposedAmount) {
    await updateRequest(request => {
      Object.assign(request.termsProposal!, calculateTradeTermsQuote(request, "propose_amount", options.proposedAmount!)!);
    });
  }
  const wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  const seed = durableFixture(wallet, assetId);
  await seed.fundedListing("500", fixture.listingId);
  await wallet.execute(walletCommand("reserveTrade", BUYER, "coordinator-reserve", {
    id: fixture.tradeId, listingId: fixture.listingId, amount: "200", destination: simulatedDestination(assetId, BUYER.id),
  }));
  await options.arrangeWallet?.(seed);
  const previous = await wallet.snapshot();
  await upgradeDurableWalletV2({ mode: MODE, store, acknowledgeVersionUpgrade: true, clock: () => FIXTURE_TIME,
    command: v2Command("continueFromV1", OPERATOR, "coordinator-upgrade", { checkpoint: {
      revision: previous.revision, eventHash: previous.eventHash, stateHash: walletDigest(previous.state), lastCommandAtMs: FIXTURE_TIME,
    } }) });
  await initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true });
  coordinator = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  return { assetId, seed };
}
function enrollment() {
  return { sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId,
    walletListingId: fixture.listingId, walletTradeId: fixture.tradeId, assetId: TRON, operationId: "coordinator-enroll" };
}
function acceptance() {
  return { sessionToken: fixture.buyerSessionToken, requestId: fixture.requestId, proposalId: fixture.proposalId,
    expectedBindingRevision: 0, operationId: "coordinator-accept" };
}
function inspection() { return { sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId }; }
async function footprint() {
  return store.transaction(async tx => ({
    commands: (await tx.query(COMMANDS)).rows,
    requests: (await tx.query<{ id: string; payload: PurchaseRequest }>("SELECT id,payload FROM alpha_exchange.purchase_requests ORDER BY id")).rows,
    listings: (await tx.query("SELECT * FROM alpha_exchange.listings ORDER BY id")).rows,
    notifications: (await tx.query<{ payload: AlphaExchangeNotification }>("SELECT payload FROM alpha_exchange.notifications ORDER BY id")).rows,
    audits: (await tx.query<{ payload: AuditLogEntry }>("SELECT payload FROM alpha_exchange.audit_logs ORDER BY id")).rows,
    version: (await tx.query<{ version: string }>("SELECT version::text FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].version,
    enrollments: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.enrollments ORDER BY request_id")).rows,
    acceptances: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.acceptances ORDER BY acceptance_key")).rows,
    publications: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.publications ORDER BY id")).rows,
  }));
}
function safeReceipt(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of [fixture.ownerSessionToken, fixture.buyerSessionToken, fixture.sellerSessionToken,
    '"0000000000"', "Synthetic fixture bank", "accountNumber", "accountHolderName", "sellerBankAccountSnapshot",
    "paymentInstructionsDigest", "destination", "sim://", "passwordHash", "token_hash"]) {
    expect(serialized).not.toContain(secret);
  }
}

describe("development canonical marketplace wallet coordinator", () => {
  it.each([
    [TRON, "300"], [TRON, "100"], [TRON, "200"], ["bsc-sim-binance-peg-usdt" as AssetId, "200.00005"],
  ] as const)("atomically accepts %s amount %s using exact canonical terms and one effect", async (assetId, amount) => {
    await setup({ assetId, proposedAmount: amount });
    const original = await footprint();
    const enrolled = await coordinator.enrollReservedTrade({ ...enrollment(), assetId });
    expect(enrolled).toMatchObject({ replayed: false, bindingRevision: 0, terms: { usdtAmount: "200" } });
    const afterEnrollment = await footprint();
    expect(Number(afterEnrollment.version)).toBe(Number(original.version) + 1);
    const accepted = await coordinator.acceptAmountCorrection(acceptance());
    const committed = await footprint();
    const snapshot = verifyVersionedHistory(committed.commands);
    expect(isV2State(snapshot.state)).toBe(true);
    const quote = quoteTrade(assetId, amount, "3.20");
    const precision = assetFor(assetId).decimals;
    expect(accepted).toMatchObject({ replayed: false, requestId: fixture.requestId, proposalId: fixture.proposalId,
      bindingRevision: 1, terms: { usdtAmount: amount, principalRaw: quote.principalRaw.toString(),
        buyerFeeRaw: quote.buyerFeeRaw.toString(), sellerFeeRaw: quote.sellerFeeRaw.toString(), totalFeeRaw: quote.totalFeeRaw.toString() } });
    expect(accepted.principalDeltaRaw).toBe((quote.principalRaw - parseUnits("200", precision)).toString());
    expect(balance(snapshot.state, assetId, `trade:${fixture.tradeId}`)).toBe(quote.principalRaw);
    expect(balance(snapshot.state, assetId, `listing:${fixture.listingId}`)).toBe(parseUnits("500", precision) - quote.principalRaw);
    expect(expectedCustody(snapshot.state, assetId)).toBe(parseUnits("500", precision));
    const request = committed.requests.find(row => row.id === fixture.requestId)!.payload;
    expect(request).toMatchObject({ status: "accepted", usdtAmount: amount, fiatAmount: accepted.terms.fiatAmount,
      pricePerUsdt: "3.20", amountAdjustmentCount: 1, termsProposal: { id: fixture.proposalId, status: "accepted", resolvedAt: accepted.acceptedAt },
      updatedAt: accepted.acceptedAt });
    expect(request.messages).toHaveLength(1);
    expect(request.messages![0]).toMatchObject({ id: `wallet-message-${accepted.acceptanceKey}`, kind: "system", senderUserId: fixture.buyerId });
    expect(committed.requests.find(row => row.id === fixture.otherRequestId)).toEqual(original.requests.find(row => row.id === fixture.otherRequestId));
    expect(committed.listings).toEqual(original.listings);
    expect(committed.notifications).toHaveLength(1);
    expect(committed.audits).toHaveLength(1);
    expect(committed.audits[0].payload).toMatchObject({ action: "trade_amount_correction_accepted", actorUserId: fixture.buyerId });
    expect(committed.publications).toHaveLength(1);
    expect(committed.acceptances).toHaveLength(1);
    expect(Number(committed.version)).toBe(Number(afterEnrollment.version) + 1);
    expect(committed.commands.length).toBe(afterEnrollment.commands.length + 1);
    expect(committed.notifications[0].payload).toMatchObject({ userId: fixture.sellerId, relatedRequestId: fixture.requestId });
    expect(committed.notifications[0].payload.whatsappEvent).toBeUndefined();
    safeReceipt(enrolled); safeReceipt(accepted); safeReceipt(committed.publications);
    const retry = await coordinator.acceptAmountCorrection({ ...acceptance(), operationId: "new-transport-attempt" });
    expect(retry).toEqual({ ...accepted, replayed: true });
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it("supports face-to-face with the same stored proposal and canonical fee quote", async () => {
    await setup({ paymentMethod: "Face-to-Face" });
    await coordinator.enrollReservedTrade(enrollment());
    const receipt = await coordinator.acceptAmountCorrection(acceptance());
    expect(receipt.terms).toMatchObject({ paymentMethod: "Face-to-Face (Meet in Person)", usdtAmount: "300", fiatAmount: "969.60" });
    safeReceipt(receipt);
  }, TIMEOUT);

  it("keeps owner inspection/pause usable and recovers the original receipt while paused and after reopen", async () => {
    await setup();
    const before = await coordinator.inspect(inspection());
    expect(before.enrollment).toBeNull();
    const enrolled = await coordinator.enrollReservedTrade(enrollment());
    const receipt = await coordinator.acceptAmountCorrection(acceptance());
    // The trusted clock deliberately does not advance between acceptance/pause.
    const paused = await coordinator.pause({ ...inspection(), operationId: "coordinator-pause" });
    expect(paused).toMatchObject({ halted: true, replayed: false, walletRevision: receipt.walletRevision + 1 });
    const committed = await footprint();
    const viewed = await coordinator.inspect(inspection());
    expect(viewed).toMatchObject({ wallet: { halted: true }, enrollment: { bindingRevision: 1,
      listingAvailableRaw: "200000000", tradeReservedRaw: "300000000" } });
    safeReceipt(viewed); safeReceipt(paused);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    coordinator = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store, clock });
    expect(await coordinator.acceptAmountCorrection({ ...acceptance(), operationId: "after-reopen" })).toEqual({ ...receipt, replayed: true });
    expect(await coordinator.enrollReservedTrade({ ...enrollment(), operationId: "enrollment-after-reopen" })).toEqual({ ...enrolled, replayed: true });
    expect(await coordinator.pause({ ...inspection(), operationId: "coordinator-pause" })).toEqual({ ...paused, replayed: true });
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it("requires fresh owner authority for enrollment/inspection/pause and the exact buyer for acceptance", async () => {
    await setup();
    const before = await footprint();
    for (const sessionToken of [fixture.buyerSessionToken, fixture.sellerSessionToken]) {
      await expect(coordinator.enrollReservedTrade({ ...enrollment(), sessionToken })).rejects.toMatchObject({ code: "ACTOR" });
      await expect(coordinator.inspect({ ...inspection(), sessionToken })).rejects.toMatchObject({ code: "ACTOR" });
      await expect(coordinator.pause({ ...inspection(), sessionToken, operationId: "forbidden-pause" })).rejects.toMatchObject({ code: "ACTOR" });
    }
    expect(await footprint()).toEqual(before);
    await coordinator.enrollReservedTrade(enrollment());
    const enrolled = await footprint();
    for (const sessionToken of [fixture.ownerSessionToken, fixture.sellerSessionToken]) {
      await expect(coordinator.acceptAmountCorrection({ ...acceptance(), sessionToken })).rejects.toMatchObject({ code: "ACTOR" });
    }
    expect(await footprint()).toEqual(enrolled);
  }, TIMEOUT);

  it("denies receipt recovery to a disabled account or revoked/expired session before exposing history", async () => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    await coordinator.acceptAmountCorrection(acceptance());
    const committed = await footprint();
    await store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [fixture.buyerId]));
    await expect(coordinator.acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "WALLET_ACCOUNT_DISABLED" });
    await store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','false') WHERE id=$1", [fixture.buyerId]));
    now = fixture.sessionsExpireAtMs;
    await expect(coordinator.acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    now = FIXTURE_TIME + 1000;
    await store.transaction(tx => tx.query("DELETE FROM alpha_exchange.sessions WHERE user_id=$1", [fixture.buyerId]));
    await expect(coordinator.acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it("rejects changed public input under consumed identities and never treats a trade alias as request identity", async () => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    await coordinator.acceptAmountCorrection(acceptance());
    const committed = await footprint();
    await expect(coordinator.acceptAmountCorrection({ ...acceptance(), expectedBindingRevision: 1 })).rejects.toMatchObject({ code: "STALE" });
    await expect(coordinator.enrollReservedTrade({ ...enrollment(), walletTradeId: "changed-trade" })).rejects.toMatchObject({ code: "STALE" });
    await expect(coordinator.acceptAmountCorrection({ ...acceptance(), requestId: fixture.tradeId })).rejects.toMatchObject({ code: "INTEGRITY" });
    await expect(coordinator.enrollReservedTrade({ ...enrollment(), requestId: fixture.tradeId })).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it.each(["actorUserId", "actor", "terms", "usdtAmount", "fiatAmount", "fees", "snapshot", "sessionHash"])(
    "rejects caller-supplied %s before opening an owner transaction", async key => {
      await setup();
      const before = await footprint();
      const attempted = { ...acceptance(), [key]: "forged" };
      await expect(coordinator.acceptAmountCorrection(attempted)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await footprint()).toEqual(before);
    }, TIMEOUT);

  it.each([
    "ordinary pending", "missing proposal", "counter offer", "cardless", "wise", "payment progress", "inventory mismatch",
    "unapproved listing", "competing reservation", "omitted foreign seller", "evidence", "open dispute", "commission",
  ] as const)("rejects unsupported enrollment: %s", async scenario => {
    await setup();
    if (scenario === "ordinary pending") await updateRequest(request => { request.status = "pending"; });
    if (scenario === "missing proposal") await updateRequest(request => { delete request.termsProposal; });
    if (scenario === "counter offer") await updateRequest(request => { request.termsProposal!.kind = "counter_offer"; });
    if (scenario === "cardless") await updateRequest(request => { request.paymentMethod = "Cardless ATM Withdrawal"; });
    if (scenario === "wise") await updateRequest(request => { request.bankTransferProvider = "wise"; });
    if (scenario === "payment progress") await updateRequest(request => { request.paymentSentAt = fixture.at; });
    if (scenario === "inventory mismatch") await updateListing(listing => { listing.availableAmount = "499"; });
    if (scenario === "unapproved listing") await updateListing(listing => { listing.approvalStatus = "pending"; });
    if (scenario === "competing reservation") await updateRequest(request => { request.status = "accepted"; }, fixture.otherRequestId);
    if (scenario === "omitted foreign seller") await updateRequest(request => { request.sellerId = "other-seller"; }, fixture.otherRequestId);
    if (scenario === "evidence") await store.transaction(tx => tx.query("INSERT INTO alpha_exchange.evidence(id,purchase_request_id,payload) VALUES($1,$2,$3::jsonb)",
      ["evidence", fixture.requestId, JSON.stringify({ id: "evidence", purchaseRequestId: fixture.requestId, side: "buyer" })]));
    if (scenario === "open dispute") await store.transaction(tx => tx.query("INSERT INTO alpha_exchange.disputes(id,purchase_request_id,payload) VALUES($1,$2,$3::jsonb)",
      ["dispute", fixture.requestId, JSON.stringify({ id: "dispute", purchaseRequestId: fixture.requestId, status: "open" })]));
    if (scenario === "commission") await store.transaction(tx => tx.query("INSERT INTO alpha_exchange.commissions(id,seller_id,purchase_request_id,listing_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      ["commission", fixture.sellerId, fixture.requestId, fixture.listingId,
        JSON.stringify({ id: "commission", sellerId: fixture.sellerId, purchaseRequestId: fixture.requestId, paymentStatus: "pending" })]));
    const before = await footprint();
    await expect(coordinator.enrollReservedTrade(enrollment())).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects a second live wallet trade without changing the inherited engine's general capacity", async () => {
    await setup({ arrangeWallet: seed => seed.command("reserveTrade", BUYER, { id: "second-wallet-trade", listingId: fixture.listingId,
      amount: "100", destination: simulatedDestination(TRON, BUYER.id) }) });
    const before = await footprint();
    await expect(coordinator.enrollReservedTrade(enrollment())).rejects.toThrow("one nonterminal wallet trade");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["hidden normalized commission", "contradictory trade status", "contradictory trade completion"])(
    "checks physical canonical records outside the focused payload: %s", async scenario => {
      await setup();
      await store.transaction(async tx => {
        if (scenario === "hidden normalized commission") {
          await tx.query(`INSERT INTO alpha_exchange.commissions(id,seller_id,purchase_request_id,payload)
            VALUES('hidden-commission','other-seller',$1,'{"id":"hidden-commission","sellerId":"other-seller"}'::jsonb)`, [fixture.requestId]);
        } else {
          const payload = { id: fixture.tradeId, purchaseRequestId: fixture.requestId, listingId: fixture.listingId,
            sellerId: fixture.sellerId, buyerId: fixture.buyerId, status: "accepted", timeline: [],
            ...(scenario === "contradictory trade completion" ? { completedAt: fixture.at } : {}) };
          await tx.query(`INSERT INTO alpha_exchange.trades(id,purchase_request_id,listing_id,seller_id,buyer_id,status,payload)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload`,
          [fixture.tradeId, fixture.requestId, fixture.listingId, fixture.sellerId, fixture.buyerId,
            scenario === "contradictory trade status" ? "payment_sent" : "accepted", JSON.stringify(payload)]);
        }
      });
      const before = await footprint();
      await expect(coordinator.enrollReservedTrade(enrollment())).rejects.toThrow();
      expect(await footprint()).toEqual(before);
    }, TIMEOUT);

  it.each(["status", "active reservation"])("rejects contradictory normalized listing %s", async column => {
    await setup();
    await store.transaction(tx => column === "status"
      ? tx.query("UPDATE alpha_exchange.listings SET status='active' WHERE id=$1", [fixture.listingId])
      : tx.query("UPDATE alpha_exchange.listings SET active_trade_request_id=$2 WHERE id=$1", [fixture.listingId, fixture.otherRequestId]));
    const before = await footprint();
    await expect(coordinator.enrollReservedTrade(enrollment())).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["enrollment", "acceptance"])("rejects corrupted retained public input digests: %s", async kind => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    await coordinator.acceptAmountCorrection(acceptance());
    await store.transaction(async tx => {
      // Deliberate retained-data corruption in this disposable fixture, not an
      // allowed coordinator operation. Re-enable every normal writer guard.
      if (kind === "enrollment") {
        const forgedDigest = walletDigest({ kind: "marketplace-enrollment-v1", actorUserId: fixture.ownerId,
          requestId: fixture.requestId, walletListingId: fixture.listingId, walletTradeId: "forged-wallet-trade", assetId: TRON });
        await tx.exec("ALTER TABLE alpha_wallet_marketplace_simulation.enrollments DISABLE TRIGGER ALL");
        await tx.query("UPDATE alpha_wallet_marketplace_simulation.enrollments SET input_digest=$1 WHERE request_id=$2", [forgedDigest, fixture.requestId]);
        await tx.exec("ALTER TABLE alpha_wallet_marketplace_simulation.enrollments ENABLE TRIGGER ALL");
      } else {
        const forgedDigest = walletDigest({ kind: "marketplace-amount-acceptance-v1", actorUserId: fixture.buyerId,
          requestId: fixture.requestId, proposalId: fixture.proposalId, expectedBindingRevision: 1 });
        await tx.exec("ALTER TABLE alpha_wallet_marketplace_simulation.acceptances DISABLE TRIGGER ALL");
        await tx.query("UPDATE alpha_wallet_marketplace_simulation.acceptances SET input_digest=$1 WHERE request_id=$2", [forgedDigest, fixture.requestId]);
        await tx.exec("ALTER TABLE alpha_wallet_marketplace_simulation.acceptances ENABLE TRIGGER ALL");
      }
    });
    const retained = await footprint();
    if (kind === "enrollment") {
      await expect(coordinator.enrollReservedTrade({ ...enrollment(), walletTradeId: "forged-wallet-trade" }))
        .rejects.toMatchObject({ code: "INTEGRITY" });
    } else {
      await expect(coordinator.acceptAmountCorrection({ ...acceptance(), expectedBindingRevision: 1 }))
        .rejects.toMatchObject({ code: "INTEGRITY" });
    }
    expect(await footprint()).toEqual(retained);
  }, TIMEOUT);

  it("refuses global activation while an unrelated withdrawal payout is unfinished", async () => {
    await setup({ arrangeWallet: async seed => {
      await seed.deposit("20", "principal", "coordinator-extra-funding");
      await seed.ready();
      await seed.command("requestWithdrawal", SELLER, { id: "coordinator-withdrawal", assetId: TRON,
        amount: "10", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-coordinator" });
    } });
    const before = await footprint();
    await expect(coordinator.enrollReservedTrade(enrollment())).rejects.toThrow("Unfinished payouts");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects a future canonical timestamp without advancing wallet time or preventing owner pause", async () => {
    await setup();
    await updateRequest(request => { request.updatedAt = new Date(now + 30_000).toISOString(); });
    await coordinator.enrollReservedTrade(enrollment());
    const before = await footprint();
    await expect(coordinator.acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "STALE" });
    expect(await footprint()).toEqual(before);
    await expect(coordinator.pause({ ...inspection(), operationId: "pause-after-future-timestamp" })).resolves.toMatchObject({ halted: true });
  }, TIMEOUT);

  it.each(["wallet append", "request persistence", "after runtime update"])("rolls back every domain after failure at %s", async boundary => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    const before = await footprint();
    let triggered = false;
    const faultStore: WalletStore = { close: async () => undefined, transaction: work => store.transaction(async owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const afterWallet = boundary === "wallet append" && /INSERT INTO alpha_wallet_simulation\.commands/.test(sql);
        const beforeRequest = boundary === "request persistence" && /^update alpha_exchange\.purchase_requests set payload/i.test(sql);
        const afterRuntime = boundary === "after runtime update" && /^update alpha_exchange\.runtime_meta set version/i.test(sql);
        if (!triggered && beforeRequest) { triggered = true; throw new Error("coordinator injected boundary"); }
        const result = await owner.query<Row>(sql, values);
        if (!triggered && (afterWallet || afterRuntime)) { triggered = true; throw new Error("coordinator injected boundary"); }
        return result;
      } };
      return work(tx);
    }) };
    const failing = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store: faultStore, clock });
    await expect(failing.acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(triggered).toBe(true);
    expect(await footprint()).toEqual(before);
    await expect(coordinator.acceptAmountCorrection(acceptance())).resolves.toMatchObject({ replayed: false, bindingRevision: 1 });
  }, TIMEOUT);

  it("rechecks session freshness after actual focused persistence and rolls the entire acceptance back", async () => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    const before = await footprint();
    let changed = false;
    const expiring: WalletStore = { close: async () => undefined, transaction: work => store.transaction(async owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await owner.query<Row>(sql, values);
        if (/^update alpha_exchange\.runtime_meta set version/i.test(sql)) { changed = true; now = fixture.sessionsExpireAtMs; }
        return result;
      } };
      return work(tx);
    }) };
    const current = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store: expiring, clock });
    await expect(current.acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect(changed).toBe(true);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["before commit", "unknown commit"])("does not expose SQL/private error data: %s", async boundary => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    const before = await footprint();
    const secretFailure = () => Object.assign(new Error("Synthetic fixture bank accountNumber 0000000000"), {
      code: "23514", detail: fixture.buyerSessionToken,
    });
    const unsafe: WalletStore = { close: async () => undefined, async transaction(work) {
      const result = await store.transaction(owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (boundary === "before commit" && /^update alpha_exchange\.purchase_requests set payload/i.test(sql)) {
          throw Object.assign(secretFailure(), { params: values });
        }
        return owner.query<Row>(sql, values);
      } };
      return work(tx);
      });
      if (boundary === "unknown commit") throw new CommitOutcomeUnknownError(secretFailure());
      return result;
    } };
    const failing = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store: unsafe, clock });
    let failure: unknown;
    try { await failing.acceptAmountCorrection(acceptance()); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: boundary === "before commit" ? "STORAGE_UNAVAILABLE" : "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" });
    safeReceipt(failure);
    expect(String(failure)).not.toContain("accountNumber");
    safeReceipt({ cause: (failure as Error).cause, message: (failure as Error).message, causeMessage: String((failure as Error).cause) });
    if (boundary === "before commit") expect(await footprint()).toEqual(before);
    else {
      expect(failure).toBeInstanceOf(CommitOutcomeUnknownError);
      await expect(coordinator.acceptAmountCorrection({ ...acceptance(), operationId: "unknown-commit-recovery" }))
        .resolves.toMatchObject({ bindingRevision: 1, replayed: true });
      expect((await footprint()).acceptances).toHaveLength(1);
    }
  }, TIMEOUT);

  it("fences standalone wallet commands and actual old marketplace writers after enrollment", async () => {
    await setup();
    await coordinator.enrollReservedTrade(enrollment());
    const before = await footprint();
    const wallet = createVersionedDurableWallet({ mode: MODE, store, clock });
    await expect(wallet.snapshot()).rejects.toThrow();
    await expect(wallet.execute(v2Command("cancelTrade", BUYER, "bypass-cancel", fixture.tradeId))).rejects.toThrow();
    await expect(updateRequest(request => { request.usdtAmount = "100"; })).rejects.toThrow();
    await expect(updateRequest(request => { request.status = "accepted"; }, fixture.otherRequestId)).rejects.toThrow();
    await expect(updateListing(listing => { listing.availableAmount = "1"; })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    await expect(coordinator.acceptAmountCorrection(acceptance())).resolves.toMatchObject({ bindingRevision: 1 });
  }, TIMEOUT);
});
