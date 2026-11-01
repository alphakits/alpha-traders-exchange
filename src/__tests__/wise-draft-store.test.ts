// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, PurchaseRequest } from "@/types/alpha-exchange";
import type { WiseUsdAccount, WiseUsdAccountDetails } from "@/types/wise";
import { demandTestDb, demandTestUser, DEMAND_TEST_WALLET } from "@/test-utils/usdt-demand-fixtures";
import { getWiseUsdAccountFingerprint } from "@/lib/wise-bank-transfer";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", () => ({ DEFAULT_USD_ILS_RATE: 3.05, getUsdtIlsReferenceRate: async () => 4 }));
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { createMarketplaceListing, createPurchaseRequest, deleteWiseAccount, getMarketplaceListings, getMyMarketplaceListings, getTradeRoomBankDetails,
  getWiseAccountReviewQueue, getWiseAccountsForUser, invalidateAlphaExchangeStoreCache, reviewWiseAccount,
  sanitizePurchaseRequestForActor, saveWiseAccount, updateMarketplaceListingForSeller, updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";

const current = () => globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
const reviewVersion = async (id: string) => (await getWiseAccountReviewQueue("reviewer")).find(account => account.id === id)!.reviewVersion;
const details = (userId = "buyer"): WiseUsdAccountDetails => ({ provider: "wise", currency: "USD", countryCode: "US",
  accountHolderType: "personal", accountHolderName: `Private ${userId}`, bankName: "Synthetic Bank", bankAddress: "1 Test Way",
  accountType: "checking", routingNumber: "021000021", accountNumber: "00123456789" });
function reviewedAccount(userId: string): WiseUsdAccount {
  const now = new Date().toISOString();
  const value = details(userId);
  return { ...value, id: `wise-${userId}`, userId, createdAt: now, updatedAt: now, ownershipReview: {
    status: "manually_reviewed", method: "document_review", reviewedBy: "reviewer", reviewedAt: now,
    evidenceReference: "local-fixture-reviewed-document", verifiedAccountHolderName: value.accountHolderName,
    accountFingerprint: getWiseUsdAccountFingerprint(value),
  } };
}
const purchaseInput = () => ({ buyerId: "buyer", actorUserId: "buyer", listingId: "listing-seller", usdtAmount: "100",
  buyerName: "Private buyer", buyerReceivingWalletAddress: DEMAND_TEST_WALLET, receivingNetwork: "TRC20",
  paymentMethod: "Bank Transfer", bankTransferProvider: "wise" as const, currency: "USD" as const,
  buyerWiseAccountId: "wise-buyer", feePolicyVersion: "buyer_seller_1pct_v1" as const });
beforeEach(() => {
  vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "1"); vi.stubEnv("ALPHA_EXCHANGE_DATA_BACKEND", "json");
  vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
  vi.stubEnv("SUPABASE_DB_URL", ""); vi.stubEnv("DATABASE_URL", "");
  for (const key of ["VERCEL", "VERCEL_ENV", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID"]) vi.stubEnv(key, "");
  const db = demandTestDb();
  const reviewer = demandTestUser("reviewer"); reviewer.role = "admin"; reviewer.roles = ["admin"];
  db.users.push(reviewer);
  for (const user of db.users) {
    user.notificationPreferences = { inApp: false, email: false, sms: false };
    if (user.sellerStatus === "approved_seller") user.sellerApprovalVerification = {
      method: "manual_authorized_reviewer_v1", identityDocumentReviewed: true, liveIdentityVideoReviewed: true,
      contactOwnershipConfirmed: true, marketplaceRulesAccepted: true, verifiedAt: new Date().toISOString(), verifiedByUserId: "reviewer",
    };
    if (["buyer", "seller"].includes(user.id)) user.wiseUsdAccounts = [reviewedAccount(user.id)];
  }
  Object.assign(db.marketplaceListings[0], { currency: "USD", price: "1", bankTransferProvider: "wise", wiseAccountId: "wise-seller", bankAccountId: undefined, bankName: "Wise" });
  globalThis.__alphaExchangeMemorySnapshot = db as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaTradersRuntimeDbPool = undefined;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Wise USD isolated draft accounts", () => {
  it("creates pending manual review and cannot accept client verification metadata", async () => {
    const account = await saveWiseAccount({ actorUserId: "buyer-two", details: { ...details("buyer-two"), ownershipReview: { status: "manually_reviewed" }, userId: "seller" } });
    expect(account.ownershipReviewStatus).toBe("pending_review");
    expect(account).not.toHaveProperty("accountNumber"); expect(account).not.toHaveProperty("routingNumber");
    const stored = current().users.find(user => user.id === "buyer-two")?.wiseUsdAccounts?.[0];
    expect(stored?.userId).toBe("buyer-two"); expect(stored?.ownershipReview).toEqual({ status: "pending_review" });
    expect(JSON.stringify(current().auditLogs)).not.toContain("00123456789");
  });
  it("rejects self review, another user's update, and identity mismatch", async () => {
    await expect(reviewWiseAccount({ actorUserId: "reviewer", userId: "reviewer", accountId: "x", decision: "approve", evidenceReference: "test-document", expectedReviewVersion: "" })).rejects.toThrow(/own/);
    await expect(saveWiseAccount({ actorUserId: "buyer", accountId: "wise-seller", details: details() })).rejects.toThrow(/not found/);
    await expect(reviewWiseAccount({ actorUserId: "reviewer", userId: "buyer", accountId: "wise-buyer", decision: "approve", evidenceReference: "test-document", identityMatched: true, verifiedAccountHolderName: "Different Person", expectedReviewVersion: await reviewVersion("wise-buyer") })).rejects.toThrow(/identity/);
  });
  it("requires an authorized reviewer and resets review after edits", async () => {
    const account = await saveWiseAccount({ actorUserId: "buyer-two", details: details("buyer-two") });
    await expect(reviewWiseAccount({ actorUserId: "buyer", userId: "buyer-two", accountId: account.id, decision: "approve", evidenceReference: "test-document", expectedReviewVersion: "" })).rejects.toThrow(/Admin/);
    const approved = await reviewWiseAccount({ actorUserId: "reviewer", userId: "buyer-two", accountId: account.id, decision: "approve", evidenceReference: "private-local-document-123", verifiedAccountHolderName: "PRIVATE   buyer-two", identityMatched: true, expectedReviewVersion: await reviewVersion(account.id) });
    expect(approved.ownershipReviewStatus).toBe("manually_reviewed");
    expect((await saveWiseAccount({ actorUserId: "buyer-two", accountId: account.id, details: { ...details("buyer-two"), accountNumber: "00987654321" } })).ownershipReviewStatus).toBe("pending_review");
    await expect(getWiseAccountReviewQueue("buyer")).rejects.toThrow(/Admin/);
  });
  it("fails closed when disabled and blocks deletion of an account linked to a listing", async () => {
    await expect(deleteWiseAccount({ actorUserId: "seller", accountId: "wise-seller" })).rejects.toThrow(/linked/);
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    await expect(saveWiseAccount({ actorUserId: "buyer", details: details() })).rejects.toThrow(/unavailable/);
    await expect(getWiseAccountsForUser("buyer")).rejects.toThrow(/unavailable/);
  });
  it("rejects a review if account numbers change after the reviewer reads them, including a commit race", async () => {
    const account = await saveWiseAccount({ actorUserId: "buyer-two", details: details("buyer-two") });
    const expectedReviewVersion = await reviewVersion(account.id);
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      const latest = await repository.loadSnapshot();
      const changed = latest.users.find(user => user.id === "buyer-two")!.wiseUsdAccounts![0];
      changed.accountNumber = "00777777777";
      await persist(latest, { selectedTables: ["users"] });
      await persist(incoming, options);
    });
    await expect(reviewWiseAccount({ actorUserId: "reviewer", userId: "buyer-two", accountId: account.id, decision: "approve",
      evidenceReference: "private-local-document-123", verifiedAccountHolderName: "Private buyer-two", identityMatched: true, expectedReviewVersion })).rejects.toThrow(/changed/);
    expect(current().users.find(user => user.id === "buyer-two")!.wiseUsdAccounts![0].ownershipReview.status).toBe("pending_review");
  });
});

describe("Wise USD listing and trade boundaries", () => {
  it.each(["disabled", "revoked"])("allows pausing and inventory reduction while Wise is %s without allowing new commitments", async mode => {
    if (mode === "disabled") vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    else current().users.find(user => user.id === "seller")!.wiseUsdAccounts![0].ownershipReview = { status: "rejected", reviewedAt: new Date().toISOString(), reviewedBy: "reviewer", evidenceReference: "ownership-no-longer-valid" };
    invalidateAlphaExchangeStoreCache();
    const input = { listingId: "listing-seller", sellerId: "seller", actorUserId: "seller" };
    const reduced = await updateMarketplaceListingForSeller({ ...input, availableAmount: "9000", changeReason: "Changed available balance", changeExplanation: "Reducing available stock." });
    expect(reduced).toMatchObject({ availableAmount: "9000", maximumTrade: "9000", bankTransferProvider: "wise", wiseAccountId: "wise-seller" });
    expect(current().auditLogs.find(log => log.action === "listing_edited")).toMatchObject({ reason: "Changed available balance", details: expect.stringContaining("Reducing available stock.") });
    for (const unsafe of [
      { availableAmount: "9001" }, { price: "1.01" }, { minimumTrade: "50" }, { expirationHours: 72 },
      { status: "paused" as const, price: "1.01" }, { status: "paused" as const, wiseAccountId: "wise-buyer" },
    ]) await expect(updateMarketplaceListingForSeller({ ...input, ...unsafe })).rejects.toThrow();
    const paused = await updateMarketplaceListingForSeller({ ...input, status: "paused" });
    expect(paused.status).toBe("paused");
    await updateMarketplaceListingForSeller({ ...input, status: "paused" });
    expect(current().auditLogs.filter(log => log.action === "listing_paused")).toHaveLength(1);
    await expect(updateMarketplaceListingForSeller({ ...input, status: "active" })).rejects.toThrow();
    expect(current().marketplaceListings[0]).toMatchObject({ status: "paused", availableAmount: "9000", price: "1" });
  });
  it("rechecks a Wise stock reduction against concurrently lowered stock", async () => {
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      const latest = await repository.loadSnapshot();
      Object.assign(latest.marketplaceListings[0], { availableAmount: "8000", maximumTrade: "8000", updatedAt: new Date(Date.now() + 1000).toISOString() });
      await persist(latest, { selectedTables: ["listings"] });
      await persist(incoming, options);
    });
    await expect(updateMarketplaceListingForSeller({ listingId: "listing-seller", sellerId: "seller", actorUserId: "seller", availableAmount: "9000" })).rejects.toThrow(/unavailable/);
    expect(current().marketplaceListings[0].availableAmount).toBe("8000");
    expect(current().auditLogs.filter(log => log.action === "listing_edited")).toHaveLength(0);
  });
  it("hides a revoked payout account from public listings while preserving management and committed trade access", async () => {
    expect((await getMarketplaceListings("active")).map(listing => listing.id)).toContain("listing-seller");
    const { request } = await createPurchaseRequest(purchaseInput());
    await updatePurchaseRequestStatus({ requestId: request.id, actorUserId: "seller", actorRole: "approved_seller", nextStatus: "accepted" });
    expect((await getMarketplaceListings("active")).map(listing => listing.id)).toContain("listing-seller");
    await reviewWiseAccount({ actorUserId: "reviewer", userId: "seller", accountId: "wise-seller", decision: "reject",
      evidenceReference: "ownership-document-no-longer-valid", expectedReviewVersion: await reviewVersion("wise-seller") });
    for (const status of [undefined, "all", "active"]) {
      expect((await getMarketplaceListings(status)).map(listing => listing.id)).not.toContain("listing-seller");
    }
    expect((await getMyMarketplaceListings("seller")).map(listing => listing.id)).toContain("listing-seller");
    const paymentDetails = await getTradeRoomBankDetails({ purchaseRequestId: request.id, actorUserId: "buyer", actorRole: "buyer" });
    expect(paymentDetails.accountNumber).toBe("00123456789");
    expect(current().purchaseRequests.find(trade => trade.id === request.id)?.status).toBe("accepted");
  });
  it.each([{ currency: "ILS" }, { paymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)"] }, { wiseAccountId: "wise-buyer" }])("rejects invalid Wise listing terms %j", async invalid => {
    await expect(createMarketplaceListing({ sellerId: "seller", actorUserId: "seller", sellerDisplayName: "Seller", availableAmount: "1000", price: "1", currency: "USD", network: "TRC20", paymentMethods: ["Bank Transfer"], bankTransferProvider: "wise", wiseAccountId: "wise-seller", acceptedCommissionPolicy: true, responseTime: "5 min", ...invalid })).rejects.toThrow();
  });
  it("requires explicit Wise USD review and the buyer's own reviewed account", async () => {
    await expect(createPurchaseRequest({ ...purchaseInput(), clientPlatform: "mobile" })).rejects.toThrow(/website/);
    await expect(createPurchaseRequest({ ...purchaseInput(), bankTransferProvider: undefined })).rejects.toThrow(/explicitly/);
    await expect(createPurchaseRequest({ ...purchaseInput(), buyerWiseAccountId: "wise-seller" })).rejects.toThrow(/own/);
    current().users.find(user => user.id === "buyer")!.wiseUsdAccounts![0].ownershipReview = { status: "pending_review" };
    invalidateAlphaExchangeStoreCache();
    await expect(createPurchaseRequest(purchaseInput())).rejects.toThrow(/ownership review/);
  });
  it("freezes both accounts, strips snapshots, and permits private participant disclosure only", async () => {
    const { request } = await createPurchaseRequest(purchaseInput());
    expect(request.currency).toBe("USD"); expect(request.fiatAmount).toBe("101.00");
    expect(request.sellerWiseAccountSnapshot?.accountNumber).toBe("00123456789");
    expect(request.buyerWiseAccountSnapshot?.accountNumber).toBe("00123456789");
    for (const [id, role] of [["buyer", "buyer"], ["seller", "approved_seller"], ["reviewer", "admin"]] as const) {
      const response = sanitizePurchaseRequestForActor(request, id, role);
      expect(response.sellerWiseAccountSnapshot).toBeUndefined(); expect(response.buyerWiseAccountSnapshot).toBeUndefined();
    }
    await expect(getTradeRoomBankDetails({ purchaseRequestId: request.id, actorUserId: "reviewer", actorRole: "admin" })).rejects.toThrow(/only for/);
    const view = await getTradeRoomBankDetails({ purchaseRequestId: request.id, actorUserId: "buyer", actorRole: "buyer" });
    expect(view.accountHolderName).toBe("Private seller"); expect(view.buyerSender?.accountHolderName).toBe("Private buyer");
    await expect(saveWiseAccount({ actorUserId: "buyer", accountId: "wise-buyer", details: details() })).rejects.toThrow(/linked/);
    expect(JSON.stringify(current().auditLogs)).not.toContain("00123456789");
  });
  it("blocks mobile financial mutations and pending disclosure after review revocation", async () => {
    const { request } = await createPurchaseRequest(purchaseInput());
    await expect(updatePurchaseRequestStatus({ requestId: request.id, actorUserId: "seller", actorRole: "approved_seller", nextStatus: "accepted", clientPlatform: "mobile" })).rejects.toThrow(/website/);
    current().users.find(user => user.id === "seller")!.wiseUsdAccounts![0].ownershipReview = { status: "pending_review" };
    invalidateAlphaExchangeStoreCache();
    await expect(getTradeRoomBankDetails({ purchaseRequestId: request.id, actorUserId: "buyer", actorRole: "buyer" })).rejects.toThrow(/ownership review/);
    await expect(updatePurchaseRequestStatus({ requestId: request.id, actorUserId: "seller", actorRole: "approved_seller", nextStatus: "accepted" })).rejects.toThrow(/ownership review/);
  });
  it("rechecks ownership review under the persistence lock", async () => {
    const repository = await getAlphaExchangeRepository();
    const persist = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
      const latest = await repository.loadSnapshot();
      latest.users.find(user => user.id === "buyer")!.wiseUsdAccounts![0].ownershipReview = { status: "pending_review" };
      await persist(latest, { selectedTables: ["users"] });
      await persist(incoming, options);
    });
    await expect(createPurchaseRequest(purchaseInput())).rejects.toThrow(/ownership review/);
    expect(current().purchaseRequests).toHaveLength(0);
  });
  it("accepts a Wise trade using its frozen payment instructions", async () => {
    const { request } = await createPurchaseRequest(purchaseInput());
    const accepted = await updatePurchaseRequestStatus({ requestId: request.id, actorUserId: "seller", actorRole: "approved_seller", nextStatus: "accepted" });
    expect(accepted).toBeDefined(); expect(current().purchaseRequests.find(trade => trade.id === request.id)?.status).toBe("accepted");
  });
  it.each([
    { threshold: "100.5", alerts: 0 },
    { threshold: "99", alerts: 1 },
  ])("preserves the USD lifecycle and applies a $threshold USDT large-trade threshold", async ({ threshold, alerts }) => {
    vi.stubEnv("ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD", threshold);
    const owner = demandTestUser("owner");
    owner.role = "owner"; owner.roles = ["owner", "admin"];
    owner.notificationPreferences = { inApp: true, email: false, sms: false };
    current().users.push(owner);
    invalidateAlphaExchangeStoreCache();
    const { request } = await createPurchaseRequest(purchaseInput());
    const seller = { requestId: request.id, actorUserId: "seller", actorRole: "approved_seller" as const };
    const buyer = { requestId: request.id, actorUserId: "buyer", actorRole: "buyer" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted" });
    await expect(updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" })).rejects.toThrow();
    await expect(updatePurchaseRequestStatus({ ...buyer, nextStatus: "payment_sent" })).rejects.toThrow(/evidence/);
    current().tradeEvidenceFiles.push({ id: "offline-buyer-evidence", purchaseRequestId: request.id, side: "buyer", uploadedByUserId: "buyer",
      uploadedAt: new Date().toISOString(), fileName: "synthetic.png", mimeType: "image/png", sizeBytes: 100, storagePath: "memory://synthetic", status: "uploaded" });
    invalidateAlphaExchangeStoreCache();
    await updatePurchaseRequestStatus({ ...buyer, nextStatus: "payment_sent" });
    await expect(updatePurchaseRequestStatus({ ...buyer, nextStatus: "cancelled" })).rejects.toThrow();
    await expect(updatePurchaseRequestStatus({ ...buyer, nextStatus: "funds_received" })).rejects.toThrow();
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_release_pending" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "completed", completionMode: "seller" });
    expect(current().purchaseRequests.find(trade => trade.id === request.id)).toMatchObject({ status: "review_open", currency: "USD", fiatAmount: "101.00" });
    expect(current().marketplaceListings[0].availableAmount).toBe("9900");
    expect(current().commissionRecords.filter(commission => commission.purchaseRequestId === request.id)).toHaveLength(1);
    expect(current().commissionRecords.find(commission => commission.purchaseRequestId === request.id)).toMatchObject({ grossCurrency: "USD", grossAmount: 101, commissionAmount: 2 });
    const largeTradeAlerts = current().notifications.filter(notification => notification.title === "Large-value trade completed");
    expect(largeTradeAlerts).toHaveLength(alerts);
    if (alerts) expect(largeTradeAlerts[0].message).toContain(`USD 101.00 (threshold ${threshold} USDT)`);
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "completed", completionMode: "seller" });
    expect(current().marketplaceListings[0].availableAmount).toBe("9900");
    expect(current().commissionRecords.filter(commission => commission.purchaseRequestId === request.id)).toHaveLength(1);
  });
  it("keeps committed trade detail access when the new-Wise gate is disabled", async () => {
    const { request } = await createPurchaseRequest(purchaseInput());
    const stored = current().purchaseRequests.find(trade => trade.id === request.id)!;
    stored.status = "payment_sent"; invalidateAlphaExchangeStoreCache();
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    const result = await getTradeRoomBankDetails({ purchaseRequestId: request.id, actorUserId: "seller", actorRole: "approved_seller" });
    expect(result.currency).toBe("USD");
    expect(sanitizePurchaseRequestForActor(stored as PurchaseRequest, "buyer", "buyer").buyerWiseAccountSnapshot).toBeUndefined();
  });
});
