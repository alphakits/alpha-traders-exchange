import { FxReferenceUnavailableError } from "@/lib/fx-reference-policy";
import { derivePublicProfileUsername } from "@/lib/alpha-exchange-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";
import type { AlphaExchangeDb, AuditLogEntry } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  createMarketplaceListing,
  adminOverrideMarketplaceListing,
  renewMarketplaceListing,
  getSellerListingWorkspaceSummary,
  createPurchaseRequest,
  deleteMarketplaceListingForSeller,
  getUserBlockStatus,
  getAccountProfileData,
  getHallOfFameEntries,
  getListingReliabilityForAdmin,
  getMarketplaceListings,
  getNotificationsForUser,
  getPremiumSellerProfile,
  getSellerReviews,
  getSellerCommissionStatus,
  getMyPurchaseRequests,
  getTradeRoomData,
  getPublicUserProfileById,
  getSellerProfileRouteData,
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  setUserBlockStatus,
  updateUserSellerSettings,
  updateMarketplaceListingForSeller,
  updatePurchaseRequestStatus,
  updateCommissionPaymentStatus,
  updateTradeTerms,
} from "@/lib/alpha-exchange-store";
import { toMobileTradeDetail } from "@/lib/mobile-trades";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";
import { realtimeEventForUser } from "@/lib/realtime-event-visibility";

const fxReference = vi.hoisted(() => ({ rate: vi.fn() }));
vi.mock("@/lib/market-service", () => ({ DEFAULT_USD_ILS_RATE: 3.05, getUsdtIlsReferenceRate: fxReference.rate }));

const OWNER_ID = "owner-1";
const SELLER_ID = "seller-1";
const SELLER_TWO_ID = "seller-2";
const BUYER_ID = "buyer-1";

function createUser(id: string, email: string, role: "owner" | "approved_seller" | "buyer") {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    sellerApprovalVerification: role === "approved_seller"
      ? createTestSellerApprovalVerification(now, OWNER_ID)
      : undefined,
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
    sellerBankAccounts: role === "approved_seller" ? [{
      id: `bank-${id}-hapoalim`,
      sellerId: id,
      accountHolderName: id,
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber: "1234567890",
      accountLast4: "7890",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }] : undefined,
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser(OWNER_ID, "owner@example.test", "owner"),
      createUser(SELLER_ID, "seller@example.com", "approved_seller"),
      createUser(SELLER_TWO_ID, "seller-two@example.com", "approved_seller"),
      createUser(BUYER_ID, "buyer@example.com", "buyer"),
    ] as AlphaExchangeDb["users"],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [],
    tradeEvidenceFiles: [],
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}

async function createApprovedListing(amount: string, price: string, sellerId: string = SELLER_ID) {
  const listing = await createMarketplaceListing({
    sellerId,
    sellerDisplayName: sellerId,
    availableAmount: amount,
    price,
    currency: "ILS",
    network: "TRC20",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "100",
    maximumTrade: amount,
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: sellerId,
  });
  await reviewMarketplaceListingByOwner({ listingId: listing.id, ownerUserId: OWNER_ID, decision: "approve" });
  return listing;
}

function auditLogs(): AuditLogEntry[] {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
  return snapshot.auditLogs;
}

describe("listing accountability: reason + audit + reliability", () => {
  beforeEach(() => {
    fxReference.rate.mockReset().mockResolvedValue(4);
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("checks creation at the same cent ceiling shown to sellers, with no writes on rejection", async () => {
    fxReference.rate.mockResolvedValue(3.05272);
    await expect(createApprovedListing("1000", "3.40")).resolves.toMatchObject({ price: "3.40" });
    const before = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).marketplaceListings.length;
    await expect(createApprovedListing("1000", "3.41")).rejects.toThrow("Maximum allowed price: ₪3.40");
    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).marketplaceListings).toHaveLength(before);
    fxReference.rate.mockRejectedValue(new FxReferenceUnavailableError());
    await expect(createApprovedListing("1000", "3.20")).rejects.toThrow("out of date");
    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).marketplaceListings).toHaveLength(before);
  });

  it.each(["reprice", "resume", "renew", "expiry", "inventory", "approve", "admin-renew", "admin-extend"])(
    "rechecks %s against the current quote before changing the listing or sending notifications", async (action) => {
      const listing = await createApprovedListing("1000", "3.60");
      const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
      const stored = db.marketplaceListings.find((entry) => entry.id === listing.id)!;
      if (action === "resume") stored.status = "paused";
      if (action === "approve") { stored.status = "draft"; stored.approvalStatus = "pending"; }
      invalidateAlphaExchangeStoreCache();
      const before = JSON.stringify({ listings: db.marketplaceListings, audit: db.auditLogs, notifications: db.notifications });
      const identity = { listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID };
      const mutate = () => {
        if (action === "renew") return renewMarketplaceListing(identity);
        if (action === "approve") return reviewMarketplaceListingByOwner({ listingId: listing.id, ownerUserId: OWNER_ID, decision: "approve" });
        if (action === "admin-renew" || action === "admin-extend") return adminOverrideMarketplaceListing({ listingId: listing.id, adminUserId: OWNER_ID, action: action === "admin-renew" ? "renew" : "extend", expirationHours: 24 });
        return updateMarketplaceListingForSeller({
          ...identity,
          ...(action === "resume" ? { status: "active" as const } : {}),
          ...(action === "reprice" ? { price: "3.41" } : {}),
          ...(action === "inventory" ? { availableAmount: "1100" } : {}),
          ...(action === "expiry" ? { expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() } : {}),
        });
      };
      fxReference.rate.mockResolvedValue(3.05272);
      await expect(mutate()).rejects.toThrow("Maximum allowed price: ₪3.40");
      fxReference.rate.mockRejectedValue(new FxReferenceUnavailableError());
      await expect(mutate()).rejects.toThrow("out of date");
      const after = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
      expect(JSON.stringify({ listings: after.marketplaceListings, audit: after.auditLogs, notifications: after.notifications })).toBe(before);
    },
  );

  it("keeps pausing, inventory reduction and removal available during an FX outage", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    fxReference.rate.mockRejectedValue(new FxReferenceUnavailableError());
    const identity = { listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID };
    await expect(updateMarketplaceListingForSeller({ ...identity, status: "paused" })).resolves.toMatchObject({ status: "paused" });
    await expect(updateMarketplaceListingForSeller({ ...identity, availableAmount: "900", maximumTrade: "900" })).resolves.toMatchObject({ availableAmount: "900" });
    await expect(deleteMarketplaceListingForSeller(identity)).resolves.toBeUndefined();
  });

  it.each([
    ["listing_price", "pending"], ["buyer_offer", "pending"],
    ["listing_price", "overdue"], ["buyer_offer", "overdue"],
    ["listing_price", "verifying"], ["buyer_offer", "verifying"],
  ] as const)("receives %s requests with %s commission, then accepts the same request only after verified payment", async (priceMode, state) => {
    const listing = await createApprovedListing("1000", "3.60");
    await getNotificationsForUser({ userId: BUYER_ID, includeActivity: false });
    const canonical = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const now = new Date().toISOString();
    canonical.commissionRecords.push({
      id: "acceptance-commission", source: "admin_manual", sellerId: SELLER_ID,
      issuedByUserId: OWNER_ID, issueReason: "Acceptance gate test", rate: 0, grossAmount: 0,
      commissionAmount: 7, paymentStatus: state === "overdue" ? "overdue" : "pending",
      paymentVerificationStatus: state === "verifying" ? "pending_verification" : undefined,
      dueAt: new Date(Date.now() + (state === "overdue" ? -1 : 1) * 86400000).toISOString(),
      createdAt: now, updatedAt: now,
    });
    const card = (await getMarketplaceListings("active")).find(item => item.id === listing.id);
    expect(card).toMatchObject({ id: listing.id, newRequestBlockReason: undefined });
    expect(JSON.stringify(card)).not.toContain("commission");
    const { request } = await createPurchaseRequest({
      listingId: listing.id, buyerId: BUYER_ID, actorUserId: BUYER_ID, usdtAmount: "250",
      buyerName: "Buyer", buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      priceMode, offeredPrice: priceMode === "buyer_offer" ? "3.50" : undefined,
    });
    expect(request.status).toBe("pending");
    const sellerNotifications = await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false });
    expect(sellerNotifications.notifications.some(n => n.relatedRequestId === request.id)).toBe(true);
    const sellerRoom = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(sellerRoom.sellerCommissionDueCount).toBe(1);
    expect(toMobileTradeDetail(sellerRoom, SELLER_ID, "en").actions.canAccept).toBe(false);
    const buyerRoom = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: BUYER_ID, actorRole: "buyer", markMessagesRead: false });
    expect(buyerRoom.sellerCommissionDueCount).toBe(0);
    expect(toMobileTradeDetail(buyerRoom, BUYER_ID, "en").sellerCommissionDue).toBeUndefined();
    const accept = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const, nextStatus: "accepted" as const };
    await expect(updatePurchaseRequestStatus(accept)).rejects.toMatchObject({ code: "commission-due", details: expect.objectContaining({ commissionId: "acceptance-commission", actionHref: expect.stringContaining("commission=pay") }) });
    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).purchaseRequests.find(r => r.id === request.id)).toMatchObject({ status: "pending" });
    expect((await getMarketplaceListings("active")).find(item => item.id === listing.id)).toMatchObject({ availableAmount: "1000", sellerActiveTradeCount: 0 });
    if (priceMode === "buyer_offer") {
      const counter = await updateTradeTerms({ requestId: request.id, actorUserId: SELLER_ID, action: "counter_offer", value: "3.55", expectedUpdatedAt: request.updatedAt });
      let error: unknown;
      try { await updatePurchaseRequestStatus({ requestId: request.id, actorUserId: BUYER_ID, actorRole: "buyer", nextStatus: "accepted", acceptCounterOfferId: counter.termsProposal!.id }); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ code: "seller-not-ready" });
      expect(String(error)).not.toMatch(/commission|7 USDT/i);
      await updateTradeTerms({ requestId: request.id, actorUserId: SELLER_ID, action: "withdraw_terms", proposalId: counter.termsProposal!.id });
    }
    await updateCommissionPaymentStatus({ commissionId: "acceptance-commission", actorUserId: OWNER_ID, paymentStatus: "paid", paymentVerificationStatus: "verified", reason: "Verified test payment" });
    const paidRoom = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", markMessagesRead: false });
    expect(toMobileTradeDetail(paidRoom, SELLER_ID, "en").actions.canAccept).toBe(true);
    await expect(updatePurchaseRequestStatus(accept)).resolves.toMatchObject({ request: { id: request.id, status: "accepted" } });
  });

  it("does not leak submitted inventory or hidden seller presence through real live mutations", async () => {
    const events: RealtimeEvent[] = [];
    const unsubscribe = subscribeRealtimeEvents((event) => events.push(event));
    try {
      const listing = await createApprovedListing("1000", "3.60");
      const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
      const draft = db.marketplaceListings.find((entry) => entry.id === listing.id)!;
      draft.status = "draft";
      draft.approvalStatus = "pending";
      invalidateAlphaExchangeStoreCache();
      await updateMarketplaceListingForSeller({ listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID,
        availableAmount: "900", maximumTrade: "900", changeReason: "Changed available balance", changeExplanation: "Updated private inventory" });
      await updateUserSellerSettings({ userId: SELLER_ID, showLastActive: false, onlineStatus: "offline" });
      const otherSeller = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).users.find((entry) => entry.id === SELLER_TWO_ID)!;
      const privateUpdates = events.filter((event) => ["listing.created", "listing.quantity_changed", "seller.status_changed"].includes(event.type));
      expect(privateUpdates.map((event) => event.type)).toEqual(expect.arrayContaining(["listing.created", "listing.quantity_changed", "seller.status_changed"]));
      for (const event of privateUpdates) {
        expect(realtimeEventForUser(event, otherSeller)).toBeNull();
        const seller = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).users.find((entry) => entry.id === SELLER_ID)!;
        expect(realtimeEventForUser(event, seller)).not.toBeNull();
      }
    } finally { unsubscribe(); }
  });

  it("allowlists public listings without private review, bank, delivery or active-trade metadata", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const stored = db.marketplaceListings.find((entry) => entry.id === listing.id)!;
    Object.assign(stored, { ownerReviewReason: "Private owner review", ownerReviewedBy: "private-reviewer", ownerReviewedAt: "private-review-time",
      expirationEmailPendingAt: "private-email-queue", expirationEmailSentAt: "private-email-time", activeTradeRequestId: "private-other-trade",
      lockedAt: "private-lock-time", blockingReason: "Private internal reason", futurePrivateField: "future-secret" });
    invalidateAlphaExchangeStoreCache();
    const publicListing = (await getMarketplaceListings("active", undefined, BUYER_ID)).find((entry) => entry.id === listing.id)!;
    expect(publicListing).toMatchObject({ id: listing.id, availableAmount: "1000", price: "3.60" });
    for (const key of ["ownerReviewReason", "ownerReviewedBy", "ownerReviewedAt", "expirationEmailPendingAt", "expirationEmailSentAt", "activeTradeRequestId", "lockedAt", "blockingReason", "futurePrivateField", "bankAccountId"]) expect(publicListing).not.toHaveProperty(key);
    expect(JSON.stringify(publicListing)).not.toMatch(/Private owner review|private-reviewer|private-other-trade|future-secret/);
  });

  it("keeps commissions, audit logs, trade activity and review trade identifiers out of public seller profiles", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const { request } = await createPurchaseRequest({
      listingId: listing.id, buyerId: BUYER_ID, actorUserId: BUYER_ID, usdtAmount: "250",
      buyerName: "Buyer", buyerWhatsapp: "+972500000000", buyerNotes: "",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    });
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    db.users.find((entry) => entry.id === SELLER_ID)!.lifetimeCompletedVolumeUsdt = 12345.67;
    const stored = db.purchaseRequests.find((entry) => entry.id === request.id)!;
    stored.status = "completed";
    stored.completedAt = new Date().toISOString();
    stored.buyerReview = { reviewerUserId: BUYER_ID, rating: 5, comment: "Excellent service.", createdAt: stored.completedAt };
    stored.sellerResponse = { responderUserId: SELLER_ID, message: "Thank you.", createdAt: stored.completedAt };
    db.commissionRecords.push({ id: "private-commission", sellerId: SELLER_ID, purchaseRequestId: request.id, listingId: listing.id,
      buyerId: BUYER_ID, rate: 0.02, grossAmount: 250, commissionAmount: 5, paymentStatus: "paid",
      dueAt: stored.completedAt, createdAt: stored.completedAt, updatedAt: stored.completedAt });
    db.auditLogs.push({ id: "private-audit", action: "listing_renewed", targetUserId: SELLER_ID, actorUserId: SELLER_ID,
      details: "Private seller audit details", createdAt: stored.completedAt } as AuditLogEntry);
    db.trustScoreHistory.push({ id: "private-trust-history", sellerId: SELLER_ID, oldScore: 60, newScore: 70, createdAt: stored.completedAt } as never);
    invalidateAlphaExchangeStoreCache();

    for (const viewer of [
      {}, { viewerUserId: BUYER_ID }, { viewerUserId: SELLER_TWO_ID }, { viewerUserId: OWNER_ID },
      { viewerUserId: BUYER_ID, viewerRole: "owner" as const, viewerEmail: "jozenmark834@yahoo.com", includePrivateData: true },
      { viewerUserId: SELLER_TWO_ID, includePrivateData: true },
    ]) {
      const profile = await getPremiumSellerProfile({ sellerId: SELLER_ID, ...viewer });
      expect(profile).not.toHaveProperty("ownerTools");
      expect(profile?.recentActivity).toEqual([]);
      expect(profile?.commissionPaid).toBeUndefined();
      expect(profile?.latestReviews[0]).toMatchObject({ tradeId: "", buyerId: expect.stringMatching(/^AT-/), comment: "Excellent service." });
      expect(profile?.latestReviews[0].sellerResponse?.responderUserId).toMatch(/^AT-/);
      for (const secret of [request.id, request.tradeId!, "private-commission", "private-audit", "Private seller audit details", "private-trust-history", BUYER_ID]) {
        expect(JSON.stringify(profile)).not.toContain(secret);
      }
    }
    const own = await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId: SELLER_ID });
    expect(own?.tradeVolume).toBe(12345.67);
    expect(own?.latestReviews[0].tradeId).toBe(request.tradeId);
    expect(own).not.toHaveProperty("ownerTools");
    const owner = await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId: OWNER_ID, includePrivateData: true });
    expect(owner?.ownerTools?.commissionHistory).toContainEqual(expect.objectContaining({ id: "private-commission" }));
    expect(owner?.ownerTools?.auditHistory).toContainEqual(expect.objectContaining({ id: "private-audit" }));
    db.users.find((entry) => entry.id === OWNER_ID)!.disabled = true;
    invalidateAlphaExchangeStoreCache();
    expect(await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId: OWNER_ID, includePrivateData: true })).not.toHaveProperty("ownerTools");
  });

  it("isolates seller commissions and trade rooms and hides private pending-listing counts", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const { request } = await createPurchaseRequest({
      listingId: listing.id, buyerId: BUYER_ID, actorUserId: BUYER_ID, usdtAmount: "250",
      buyerName: "Buyer", buyerWhatsapp: "+972500000000", buyerNotes: "",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    });
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const now = new Date().toISOString();
    db.commissionRecords.push({ id: "other-seller-commission", sellerId: SELLER_TWO_ID, rate: 0,
      grossAmount: 0, commissionAmount: 9, paymentStatus: "pending", dueAt: now, createdAt: now, updatedAt: now } as never);
    db.marketplaceListings.push({ ...db.marketplaceListings[0], id: "private-pending-listing", status: "draft", approvalStatus: "pending" });
    invalidateAlphaExchangeStoreCache();
    const status = await getSellerCommissionStatus(SELLER_ID, db, { commissionId: "other-seller-commission" });
    expect(status.payableRecords).toEqual([]);
    expect(JSON.stringify(status)).not.toContain("other-seller-commission");
    expect((await getSellerCommissionStatus(SELLER_TWO_ID, db)).payableRecords).toHaveLength(1);
    expect(await getMyPurchaseRequests(SELLER_TWO_ID, "approved_seller", db)).toEqual([]);
    await expect(getTradeRoomData({ purchaseRequestId: request.id, actorUserId: SELLER_TWO_ID, actorRole: "approved_seller", markMessagesRead: false })).rejects.toThrow();
    expect((await getPublicUserProfileById({ userId: SELLER_ID, viewerUserId: BUYER_ID }))?.stats?.pendingListings).toBe(0);
    expect((await getPublicUserProfileById({ userId: SELLER_ID, viewerUserId: SELLER_ID }))?.stats?.pendingListings).toBeGreaterThan(0);
  });

  it("public reviews never reveal another trade's amount, network, reference or buyer identity", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const { request } = await createPurchaseRequest({
      listingId: listing.id, buyerId: BUYER_ID, actorUserId: BUYER_ID, usdtAmount: "250",
      buyerName: "Buyer", buyerWhatsapp: "+972500000000", buyerNotes: "",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    });
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const stored = db.purchaseRequests.find((entry) => entry.id === request.id)!;
    stored.status = "completed";
    stored.completedAt = new Date().toISOString();
    stored.buyerReview = { reviewerUserId: BUYER_ID, rating: 5, comment: "Excellent service.", createdAt: stored.completedAt };
    invalidateAlphaExchangeStoreCache();
    for (const actor of [{}, { actorUserId: SELLER_TWO_ID }, { actorUserId: SELLER_TWO_ID, actorRole: "owner" as const }]) {
      const reviews = await getSellerReviews({ sellerId: SELLER_ID, ...actor });
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({ tradeId: "", tradeAmount: "", network: "", buyerId: expect.stringMatching(/^AT-/), verifiedTrade: true });
      expect(JSON.stringify(reviews)).not.toContain(request.id);
      expect(JSON.stringify(reviews)).not.toContain(BUYER_ID);
      expect(JSON.stringify(reviews)).not.toContain(request.tradeId!);
    }
    expect((await getSellerReviews({ sellerId: SELLER_ID, actorUserId: BUYER_ID }))[0].tradeId).toBe(request.tradeId);
    expect((await getSellerReviews({ sellerId: SELLER_ID, actorUserId: SELLER_ID }))[0].tradeAmount).toBe("250");
    stored.buyerReview.hidden = true;
    invalidateAlphaExchangeStoreCache();
    expect(await getSellerReviews({ sellerId: SELLER_ID, actorUserId: SELLER_TWO_ID, actorRole: "owner" })).toEqual([]);
  });

  it("keeps pause, resume, edit and removal usable on legacy partially sold listings", async () => {
    const listing = await createApprovedListing("7000", "3.30");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const stored = snapshot.marketplaceListings.find((entry) => entry.id === listing.id)!;
    stored.availableAmount = "2011.285267";
    stored.maximumTrade = "7,000";
    invalidateAlphaExchangeStoreCache();
    const actor = { listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID };

    expect((await updateMarketplaceListingForSeller({ ...actor, status: "paused" })).status).toBe("paused");
    expect((await getMarketplaceListings("active")).some((entry) => entry.id === listing.id)).toBe(false);
    const resumed = await updateMarketplaceListingForSeller({ ...actor, status: "active" });
    expect(resumed).toMatchObject({ status: "active", availableAmount: "2011.285267", maximumTrade: "2011.285267" });
    const edited = await updateMarketplaceListingForSeller({ ...actor, sellerDescription: "Available in the evening" });
    expect(edited.sellerDescription).toBe("Available in the evening");
    await deleteMarketplaceListingForSeller({ ...actor, changeReason: "Personal reason", changeExplanation: "No longer available this week" });
    await deleteMarketplaceListingForSeller({ ...actor, changeReason: "Personal reason", changeExplanation: "No longer available this week" });
    expect((await getMarketplaceListings("active")).some((entry) => entry.id === listing.id)).toBe(false);
    expect(auditLogs().filter((entry) => entry.listingId === listing.id && entry.action === "listing_closed")).toHaveLength(1);
  });

  it("allows a safe pause even when legacy payout bank details need repair", async () => {
    const listing = await createApprovedListing("1000", "3.30");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    snapshot.marketplaceListings.find((entry) => entry.id === listing.id)!.bankName = "";
    invalidateAlphaExchangeStoreCache();
    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID, status: "paused",
    })).resolves.toMatchObject({ status: "paused" });
  });

  it("keeps ownership and active trade locks enforced for pause and removal", async () => {
    const listing = await createApprovedListing("1000", "3.30");
    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id, sellerId: SELLER_TWO_ID, actorUserId: SELLER_TWO_ID, status: "paused",
    })).rejects.toThrow(/only your own/);
    const { request } = await createPurchaseRequest({
      listingId: listing.id, buyerId: BUYER_ID, actorUserId: BUYER_ID, usdtAmount: "250",
      buyerName: "Buyer", buyerWhatsapp: "+972500000000", buyerNotes: "",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    });
    await updatePurchaseRequestStatus({
      requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller", nextStatus: "accepted",
    });
    const actor = { listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID };
    await expect(updateMarketplaceListingForSeller({ ...actor, status: "paused" })).rejects.toThrow(/locked by an active trade/);
    await expect(deleteMarketplaceListingForSeller(actor)).rejects.toThrow(/locked by an active trade/);
  });

  it("blocks listing creation when a commission was assigned after this instance cached a clear seller", async () => {
    const canonical = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false });
    const now = new Date().toISOString();
    canonical.commissionRecords.push({
      id: "commission-newly-assigned",
      purchaseRequestId: "request-manual",
      listingId: "listing-manual",
      sellerId: SELLER_ID,
      buyerId: OWNER_ID,
      rate: 0,
      grossAmount: 0,
      commissionAmount: 7,
      paymentStatus: "pending",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    await expect(createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: SELLER_ID,
      availableAmount: "1000",
      price: "3.60",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    })).rejects.toThrow(/Pay all outstanding commission first before adding/i);
    expect(canonical.marketplaceListings).toHaveLength(0);
  });

  it("blocks a replacement immediately after the seller's only sale and permits it after settlement", async () => {
    const listing = await createApprovedListing("100", "3.30");
    await updateMarketplaceListingForSeller({ listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID,
      paymentMethods: ["Face-to-Face (Meet in Person)"] });
    const { request } = await createPurchaseRequest({
      listingId: listing.id, buyerId: BUYER_ID, actorUserId: BUYER_ID, usdtAmount: "100",
      buyerName: "Buyer", buyerWhatsapp: "+972500000000", buyerNotes: "",
      paymentMethod: "Face-to-Face (Meet in Person)", safetyAcknowledged: true, buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    });
    const actor = { requestId: request.id, actorUserId: SELLER_ID, actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...actor, nextStatus: "accepted", safetyAcknowledged: true });
    await updatePurchaseRequestStatus({ ...actor, nextStatus: "funds_received" });
    const completion = await updatePurchaseRequestStatus({ ...actor, nextStatus: "completed", completionMode: "seller", usdtSentConfirmed: true });
    if (completion.deferredTrustWrite) await completion.deferredTrustWrite();
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(db.purchaseRequests).toHaveLength(1);
    expect(db.commissionRecords).toHaveLength(1);
    expect(db.commissionRecords[0]).toMatchObject({ sellerId: SELLER_ID, paymentStatus: "pending" });
    expect(Date.now() - new Date(completion.request.completedAt!).getTime()).toBeLessThan(86400000);
    expect(await getSellerListingWorkspaceSummary(SELLER_ID)).toMatchObject({ openListingCount: 0, openTradeCount: 0, canCreateListing: false });
    await expect(createApprovedListing("100", "3.30")).rejects.toThrow(/Pay all outstanding commission first/);
    await updateCommissionPaymentStatus({ commissionId: db.commissionRecords[0].id, actorUserId: OWNER_ID, paymentStatus: "paid", paymentVerificationStatus: "verified", reason: "Verified fixture payment" });
    await expect(createApprovedListing("100", "3.30")).resolves.toBeDefined();
  });

  it.each([
    [1, "pending"], [23, "pending"], [25, "overdue"], [1, "verifying"],
  ] as const)("blocks every relisting path for one unpaid sale %s hours ago (%s), then unlocks after payment", async (hours, state) => {
    const listing = await createApprovedListing("1000", "3.30");
    const canonical = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const soldAt = new Date(Date.now() - hours * 3600000).toISOString();
    canonical.commissionRecords.push({
      id: "single-sale-fee", purchaseRequestId: "single-sale", listingId: listing.id,
      sellerId: SELLER_ID, buyerId: BUYER_ID, rate: 0.02, grossAmount: 100,
      commissionAmount: 2, paymentStatus: state === "overdue" ? "overdue" : "pending",
      paymentVerificationStatus: state === "verifying" ? "pending_verification" : undefined,
      dueAt: new Date(Date.now() + (state === "overdue" ? -1 : 1) * 86400000).toISOString(),
      createdAt: soldAt, updatedAt: soldAt,
    });
    invalidateAlphaExchangeStoreCache();
    const actor = { listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID };
    const blocked = /Pay all outstanding commission first/;
    expect(await getSellerListingWorkspaceSummary(SELLER_ID)).toMatchObject({ canCreateListing: false, pendingCommissionCount: 1 });
    await expect(createApprovedListing("500", "3.30")).rejects.toThrow(blocked);
    await expect(renewMarketplaceListing(actor)).rejects.toThrow(blocked);
    await expect(updateMarketplaceListingForSeller({ ...actor, expirationHours: 48 })).rejects.toThrow(blocked);
    await expect(updateMarketplaceListingForSeller({ ...actor, expiresAt: new Date(Date.now() + 48 * 3600000).toISOString() })).rejects.toThrow(blocked);
    await expect(updateMarketplaceListingForSeller({ ...actor, availableAmount: "1500" })).rejects.toThrow(blocked);
    // Existing stock can stay visible, be reduced, or be paused/closed.
    expect((await getMarketplaceListings("active")).some(item => item.id === listing.id)).toBe(true);
    await expect(updateMarketplaceListingForSeller({ ...actor, availableAmount: "900" })).resolves.toMatchObject({ availableAmount: "900" });
    await updateMarketplaceListingForSeller({ ...actor, status: "paused" });
    await expect(updateMarketplaceListingForSeller({ ...actor, status: "active" })).rejects.toThrow(blocked);
    await expect(renewMarketplaceListing(actor)).rejects.toThrow(blocked);
    // Closing the old listing must not erase the debt or allow a replacement.
    await deleteMarketplaceListingForSeller(actor);
    await expect(createApprovedListing("500", "3.30")).rejects.toThrow(blocked);
    await updateCommissionPaymentStatus({ commissionId: "single-sale-fee", actorUserId: OWNER_ID, paymentStatus: "paid", paymentVerificationStatus: "verified", reason: "Verified fixture payment" });
    expect(await getSellerListingWorkspaceSummary(SELLER_ID)).toMatchObject({ canCreateListing: true, pendingCommissionCount: 0 });
    const replacement = await createApprovedListing("500", "3.30");
    await expect(renewMarketplaceListing({ ...actor, listingId: replacement.id })).resolves.toMatchObject({ status: "active" });
  });

  it("requires payment before resubmitting a draft, without blocking another seller", async () => {
    const listing = await createApprovedListing("1000", "3.30");
    const canonical = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    Object.assign(canonical.marketplaceListings.find(item => item.id === listing.id)!, { status: "draft", approvalStatus: "changes_requested" });
    const now = new Date().toISOString();
    canonical.commissionRecords.push({ id: "draft-fee", source: "admin_manual", sellerId: SELLER_ID,
      rate: 0, grossAmount: 0, commissionAmount: 2, paymentStatus: "pending", createdAt: now, updatedAt: now });
    invalidateAlphaExchangeStoreCache();
    const actor = { listingId: listing.id, sellerId: SELLER_ID, actorUserId: SELLER_ID };
    await expect(updateMarketplaceListingForSeller({ ...actor, sellerDescription: "Updated listing" })).rejects.toThrow(/Pay all outstanding commission first/);
    await expect(createApprovedListing("500", "3.30", SELLER_TWO_ID)).resolves.toBeDefined();
    await updateCommissionPaymentStatus({ commissionId: "draft-fee", actorUserId: OWNER_ID, paymentStatus: "paid", paymentVerificationStatus: "verified", reason: "Verified fixture payment" });
    await expect(updateMarketplaceListingForSeller({ ...actor, sellerDescription: "Updated listing" })).resolves.toMatchObject({ approvalStatus: "pending" });
  });

  it("keeps buyer requests available without exposing a cross-instance commission assignment", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const canonical = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;

    // Keep this instance's ordinary cache in the pre-commission state, then
    // emulate another instance committing the financial lock.
    await getNotificationsForUser({ userId: BUYER_ID, includeActivity: false });
    const now = new Date().toISOString();
    canonical.commissionRecords.push({
      id: "commission-public-visibility-lock",
      source: "admin_manual",
      sellerId: SELLER_ID,
      issuedByUserId: OWNER_ID,
      issueReason: "Public visibility cache regression.",
      rate: 0,
      grossAmount: 0,
      commissionAmount: 7,
      paymentStatus: "pending",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    expect((await getMarketplaceListings("active")).find((item) => item.id === listing.id)).toMatchObject({ id: listing.id, newRequestBlockReason: undefined });
  });

  it("keeps commission private on public seller profile listings too", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const canonical = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;

    await getNotificationsForUser({ userId: BUYER_ID, includeActivity: false });
    const now = new Date().toISOString();
    canonical.commissionRecords.push({
      id: "commission-profile-visibility-lock",
      source: "admin_manual",
      sellerId: SELLER_ID,
      issuedByUserId: OWNER_ID,
      issueReason: "Seller profile visibility cache regression.",
      rate: 0,
      grossAmount: 0,
      commissionAmount: 8,
      paymentStatus: "pending",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    const routeData = await getSellerProfileRouteData({
      username: derivePublicProfileUsername({ id: SELLER_ID }),
      viewerUserId: BUYER_ID,
      viewerRole: "buyer",
    });
    expect(routeData).not.toBeNull();
    expect(routeData?.sellerListings.find((item) => item.id === listing.id)).toMatchObject({ id: listing.id, newRequestBlockReason: undefined });
  });

  it("records reason + before/after when a listing price is edited", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    await updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.70",
      changeReason: "Price updated",
      changeExplanation: "Adjusted to match the market rate.",
    });

    const edit = auditLogs().find((entry) => entry.action === "listing_edited" && entry.listingId === listing.id);
    expect(edit).toBeDefined();
    expect(edit?.reason).toBe("Price updated");
    expect(edit?.oldValue).toMatchObject({ price: "3.60" });
    expect(edit?.newValue).toMatchObject({ price: "3.70" });
    expect(edit?.details).toContain("Adjusted to match the market rate.");
  });

  it("keeps seller volume and reconstructable totals private across profile and listing responses", async () => {
    await createApprovedListing("1000", "3.60");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const seller = snapshot.users.find(user => user.id === SELLER_ID)!;
    seller.lifetimeCompletedVolumeUsdt = 123456.78;
    seller.sellerAchievements = [{ id: "volume", key: "volume_500k", title: "500K Volume", description: "Volume", earnedAt: new Date().toISOString(), source: "automatic", metadata: { lifetimeVolumeUsdt: 123456.78 } }];
    invalidateAlphaExchangeStoreCache();
    const privateKeys = ["totalUsdtVolume", "lifetimeCompletedVolumeUsdt", "prestigeVolumeUsdt", "tradeVolume", "exactTradeVolume", "commissionPaid", "estimatedCommissionPaid", "averageTradeSize", "revenueGenerated", "amountToNextRankUsdt", "remainingVolumeToNextRank", "progressToNextRankPercent", "prestigeProgressPercent", "lifetimeVolumeUsdt"];
    for (const viewerUserId of [undefined, BUYER_ID, SELLER_TWO_ID]) {
      const profile = await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId });
      const serialized = JSON.stringify(profile);
      for (const key of privateKeys) expect(serialized).not.toContain(`"${key}":`);
      expect(profile?.sellerLevel).toBeTruthy();
      expect(profile?.publicVolumeRange).toBe("");
      expect(profile?.achievements).toEqual([]);
      const listings = await getMarketplaceListings("active", undefined, viewerUserId);
      expect(listings.length).toBeGreaterThan(0);
      const json = JSON.stringify(listings);
      for (const key of privateKeys) expect(json).not.toContain(`"${key}":`);
      expect(listings[0].sellerReputation?.level).toBeTruthy();
    }
    const ownProfile = await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId: SELLER_ID });
    expect(ownProfile?.lifetimeCompletedVolumeUsdt).toBe(123456.78);
    expect((await getAccountProfileData(SELLER_ID)).stats.lifetimeCompletedVolumeUsdt).toBeTypeOf("number");
    seller.sellerPrestigeRank = "elite";
    invalidateAlphaExchangeStoreCache();
    const hall = await getHallOfFameEntries();
    expect(hall.length).toBeGreaterThan(0);
    for (const key of privateKeys) expect(JSON.stringify(hall)).not.toContain(`"${key}":`);
  });

  it("records reason when a listing is removed", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    await deleteMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      changeReason: "Personal reason",
      changeExplanation: "No longer selling this week.",
    });

    const closed = auditLogs().find((entry) => entry.action === "listing_closed" && entry.listingId === listing.id);
    expect(closed).toBeDefined();
    expect(closed?.reason).toBe("Personal reason");
    expect(closed?.newValue).toMatchObject({ status: "closed" });
  });

  it("rejects direct contact content from public seller profiles, listings, and listing audit text", async () => {
    await expect(updateUserSellerSettings({
      userId: SELLER_ID,
      bio: "WhatsApp https://wa.me/972501234567",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(updateUserSellerSettings({
      userId: SELLER_ID,
      fullName: "Email seller@example.test",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    await expect(createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: SELLER_ID,
      availableAmount: "1000",
      price: "3.60",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      responseTime: "5 min",
      notes: "Email seller@example.test",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Call 050-123-4567",
      availableAmount: "1000",
      price: "3.60",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);

    const listing = await createApprovedListing("1000", "3.60");
    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      sellerDescription: "Telegram: @seller_private",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      photos: ["https://wa.me/972501234567"],
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
    await expect(deleteMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      changeReason: "Call 050-123-4567",
    })).rejects.toThrow(DIRECT_CONTACT_CONTENT_ERROR);
  });

  it("surfaces deterministic reliability metrics for admins", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    await updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.70",
      changeReason: "Price updated",
      changeExplanation: "Market moved.",
    });
    const second = await createApprovedListing("500", "3.55");
    await deleteMarketplaceListingForSeller({
      listingId: second.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      changeReason: "Network issue",
      changeExplanation: "Pausing during a network incident.",
    });

    const first = await getListingReliabilityForAdmin();
    const again = await getListingReliabilityForAdmin();
    const sellerReport = first.find((report) => report.sellerId === SELLER_ID);
    expect(sellerReport).toBeDefined();
    expect(sellerReport?.editCount).toBeGreaterThanOrEqual(1);
    expect(sellerReport?.removalCount).toBeGreaterThanOrEqual(1);
    expect(sellerReport?.reliability.reliabilityScore).toBe(
      again.find((report) => report.sellerId === SELLER_ID)?.reliability.reliabilityScore,
    );
    expect(sellerReport?.reliability.reliabilityScore).toBeGreaterThanOrEqual(0);
    expect(sellerReport?.reliability.reliabilityScore).toBeLessThanOrEqual(100);
  });

  it("orders the marketplace feed deterministically across repeated reads", async () => {
    await createApprovedListing("1000", "3.60", SELLER_ID);
    await createApprovedListing("800", "3.58", SELLER_TWO_ID);

    const firstOrder = (await getMarketplaceListings()).map((listing) => listing.id);
    invalidateAlphaExchangeStoreCache();
    const secondOrder = (await getMarketplaceListings()).map((listing) => listing.id);

    expect(firstOrder.length).toBeGreaterThanOrEqual(2);
    expect(secondOrder).toEqual(firstOrder);
  });

  it("never exposes a seller's private email or phone in marketplace listing DTOs", async () => {
    const seller = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).users
      .find((user) => user.id === SELLER_ID);
    if (!seller) throw new Error("seller fixture missing");
    seller.email = "seller-private@example.test";
    seller.whatsappNumber = "+972501234567";
    seller.showEmailPublic = true;
    seller.showPhonePublic = true;
    await createApprovedListing("1000", "3.60");

    const [listing] = await getMarketplaceListings("active");
    const serialized = JSON.stringify(listing);
    expect(listing.sellerProfile).not.toHaveProperty("contact");
    expect(serialized).not.toContain("seller-private@example.test");
    expect(serialized).not.toContain("+972501234567");
  });

  it("never exposes a seller's direct contact in a public seller profile, even when legacy public flags are enabled", async () => {
    const seller = (globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).users
      .find((user) => user.id === SELLER_ID);
    if (!seller) throw new Error("seller fixture missing");
    seller.email = "seller-profile-private@example.test";
    seller.whatsappNumber = "+972501111111";
    seller.verifiedPhone = "+972501111111";
    seller.showEmailPublic = true;
    seller.showPhonePublic = true;

    for (const viewer of [
      {},
      { viewerUserId: "buyer-1", viewerRole: "buyer" as const },
    ]) {
      const profile = await getPremiumSellerProfile({ sellerId: SELLER_ID, ...viewer });
      const serialized = JSON.stringify(profile);
      expect(profile).not.toBeNull();
      expect(serialized).not.toContain("seller-profile-private@example.test");
      expect(serialized).not.toContain("+972501111111");
      expect(profile?.profile).not.toHaveProperty("contact");
    }
  });

  it("redacts legacy direct-contact notification content and external contact destinations before REST or SSE snapshots", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    snapshot.notifications.push({
      id: "legacy-contact-notification",
      userId: "buyer-1",
      category: "trade",
      title: "Contact seller-profile-private@example.test",
      message: "Telegram @seller_private or https://wa.me/972501111111",
      relatedHref: "https://t.me/seller_private",
      actionHref: "https://wa.me/972501111111",
      isRead: false,
      createdAt: new Date().toISOString(),
    } as never);

    const { notifications } = await getNotificationsForUser({ userId: "buyer-1", includeActivity: false });
    const notification = notifications.find((item) => item.id === "legacy-contact-notification");
    const serialized = JSON.stringify(notification);

    expect(serialized).not.toContain("seller-profile-private@example.test");
    expect(serialized).not.toContain("@seller_private");
    expect(serialized).not.toContain("wa.me");
    expect(serialized).not.toContain("t.me");
    expect(notification?.relatedHref).toBeUndefined();
    expect(notification?.actionHref).toBeUndefined();
  });

  it("scrubs embedded legacy contact data even when a historical listing has no seller record", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const storedListing = snapshot.marketplaceListings.find((item) => item.id === listing.id);
    if (!storedListing) throw new Error("listing fixture missing");
    storedListing.sellerProfile = {
      sellerId: SELLER_ID,
      sellerName: "Legacy seller",
      profilePhotoUrl: "",
      memberSince: new Date().toISOString(),
      languages: ["English"],
      preferredNetworks: ["TRC20"],
      bio: "",
      onlineStatus: "offline",
      availabilityStatus: "available",
      contact: { email: "legacy-private@example.test", phone: "+972509999999" },
    };
    snapshot.users = snapshot.users.filter((user) => user.id !== SELLER_ID);

    const [result] = await getMarketplaceListings("active");
    const serialized = JSON.stringify(result);
    expect(result?.sellerProfile).not.toHaveProperty("contact");
    expect(serialized).not.toContain("legacy-private@example.test");
    expect(serialized).not.toContain("+972509999999");
  });

  it("redacts legacy user-authored profile and listing text before it reaches public marketplace viewers", async () => {
    const listing = await createApprovedListing("1000", "3.60");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const seller = snapshot.users.find((user) => user.id === SELLER_ID);
    const storedListing = snapshot.marketplaceListings.find((item) => item.id === listing.id);
    if (!seller || !storedListing) throw new Error("seller listing fixture missing");
    seller.fullName = "Seller 050-123-4567";
    seller.bio = "Email seller-private@example.test";
    seller.tradingExperience = "Telegram: @seller_private";
    seller.profilePhotoUrl = "https://wa.me/972501234567";
    storedListing.sellerDisplayName = "Seller 050-123-4567";
    storedListing.notes = "WhatsApp https://wa.me/972501234567";
    storedListing.sellerDescription = "Email seller-private@example.test";
    storedListing.photos = ["https://t.me/seller_private"];
    invalidateAlphaExchangeStoreCache();

    const [publicListing] = await getMarketplaceListings("active");
    const profile = await getPremiumSellerProfile({ sellerId: SELLER_ID, viewerUserId: "buyer-1", viewerRole: "buyer" });
    const serialized = JSON.stringify({ publicListing, profile });

    expect(serialized).not.toContain("050-123-4567");
    expect(serialized).not.toContain("seller-private@example.test");
    expect(serialized).not.toContain("@seller_private");
    expect(serialized).not.toContain("wa.me");
    expect(serialized).not.toContain("t.me");
    expect(publicListing?.photos).toEqual([]);
  });

  it("lets either account block future marketplace matches and restore them on unblock", async () => {
    const listing = await createApprovedListing("1000", "3.60");

    expect(await getUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID })).toEqual({ blocked: false });
    await setUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID, blocked: true });
    expect(await getUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID })).toEqual({ blocked: true });
    expect((await getMarketplaceListings("active", undefined, BUYER_ID)).some((item) => item.id === listing.id)).toBe(false);
    expect((await getMarketplaceListings("active", undefined, SELLER_TWO_ID)).some((item) => item.id === listing.id)).toBe(true);

    await expect(createPurchaseRequest({
      buyerId: BUYER_ID,
      listingId: listing.id,
      usdtAmount: "100",
      buyerName: "Buyer",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      paymentMethod: "Bank Transfer",
      actorUserId: BUYER_ID,
    })).rejects.toMatchObject({ code: "USER_INTERACTION_BLOCKED" });

    await setUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID, blocked: false });
    expect(await getUserBlockStatus({ actorUserId: BUYER_ID, targetUserId: SELLER_ID })).toEqual({ blocked: false });
    expect((await getMarketplaceListings("active", undefined, BUYER_ID)).some((item) => item.id === listing.id)).toBe(true);

    await setUserBlockStatus({ actorUserId: SELLER_ID, targetUserId: BUYER_ID, blocked: true });
    expect((await getMarketplaceListings("active", undefined, BUYER_ID)).some((item) => item.id === listing.id)).toBe(false);
    await setUserBlockStatus({ actorUserId: SELLER_ID, targetUserId: BUYER_ID, blocked: false });
    expect((await getMarketplaceListings("active", undefined, BUYER_ID)).some((item) => item.id === listing.id)).toBe(true);
  });
});
