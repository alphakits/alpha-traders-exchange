import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { derivePublicProfileUsername, getAccountProfileData, getMarketplaceListings, getMyPurchaseRequests, getNotificationsForUser, getTradeRoomData, getPremiumSellerProfile, getPublicUserProfileRouteData, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { publicAccountId } from "@/lib/public-account-identity";

const now = new Date().toISOString();
function user(id: string, seller = false): AlphaExchangeUser {
  return { id, fullName: id, buyerDisplayName: id, email: `${id}@example.test`, passwordHash: "hash", whatsappNumber: "", role: seller ? "approved_seller" : "buyer", roles: [seller ? "approved_seller" : "buyer"], sellerStatus: seller ? "approved_seller" : "buyer", createdAt: now, updatedAt: now, emailVerified: true, onlineStatus: "online", availabilityStatus: "available", preferredNetworks: [], languages: ["English"], bio: "", profilePhotoUrl: "", sellerPrestigeRank: "bronze", lifetimeCompletedVolumeUsdt: 0 } as AlphaExchangeUser;
}
function trade(id: string, amount: string, status: PurchaseRequest["status"], sellerId = "seller-one"): PurchaseRequest {
  return { id, buyerId: "buyer-one", buyerName: "Buyer One", sellerId, listingId: "removed-listing", usdtAmount: amount, pricePerUsdt: "3.20", fiatAmount: String(Number(amount) * 3.2), currency: "ILS", network: "TRC20", paymentMethod: "Face-to-Face", status, createdAt: now, updatedAt: now, timeline: [] } as PurchaseRequest;
}
function seed() {
  const listing = { id: "active-listing", sellerId: "seller-one", sellerDisplayName: "seller-one", photos: [], availableAmount: "1000", originalAmount: "1000", sellerDescription: "", responseTime: "Fast", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Face-to-Face", paymentMethods: ["Face-to-Face"], minimumTrade: "50", maximumTrade: "1000", status: "active", approvalStatus: "approved", createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } as MarketplaceListing;
  return { users: [user("seller-one", true), user("seller-two", true), user("buyer-one"), user("buyer-two")], marketplaceListings: [listing], purchaseRequests: [trade("completed-sale", "38000", "completed"), trade("pending-sale", "9000", "pending"), trade("other-seller-sale", "50000", "review_open", "seller-two")], sellerApplications: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0 } as AlphaExchangeDb & { __runtimeVersion: number };
}
beforeEach(() => { globalThis.__alphaExchangeMemorySnapshot = seed() as never; globalThis.__alphaExchangeRepositoryPromise = undefined as never; invalidateAlphaExchangeStoreCache(); });
afterEach(() => { invalidateAlphaExchangeStoreCache(); globalThis.__alphaExchangeMemorySnapshot = undefined as never; globalThis.__alphaExchangeRepositoryPromise = undefined as never; });

describe("account rank consistency and privacy", () => {
  it("uses dashboard AT IDs across historical listings, rooms, reviews, profiles and notifications", async () => {
    const db = seed();
    const seller = db.users[0];
    const buyer = db.users[2];
    Object.assign(seller, { fullName: "Maya Chen", buyerDisplayName: "Maya OTC", email: "maya.chen@example.test", whatsappNumber: "+972501234567", profilePhotoUrl: "https://example.test/maya-portrait.jpg", bio: "Maya Chen welcomes you" });
    Object.assign(buyer, { fullName: "Amir Hassan", buyerDisplayName: "Amir Trading", email: "amir@example.test", whatsappNumber: "+972509876543" });
    const listing = db.marketplaceListings[0];
    Object.assign(listing, { sellerDisplayName: seller.fullName, sellerDescription: "Maya Chen, +972501234567", notes: "Maya OTC" });
    const request = db.purchaseRequests[0];
    Object.assign(request, { listingId: listing.id, buyerName: buyer.fullName, buyerWhatsapp: buyer.whatsappNumber, buyerNotes: buyer.email, messages: [{ id: "legacy-message", purchaseRequestId: request.id, senderUserId: buyer.id, senderRole: "buyer", message: "Amir Hassan to Maya Chen: amir@example.test +972509876543", createdAt: now }], timeline: [{ id: "legacy-event", type: "request_created", actorUserId: buyer.id, actorRole: "buyer", message: "Amir Hassan requested from Maya Chen", createdAt: now }], buyerReview: { reviewerUserId: buyer.id, rating: 5, comment: "Maya Chen was helpful", createdAt: now } });
    db.notifications.push({ id: "legacy-notice", userId: seller.id, category: "trade", title: "Amir Hassan sent a request", message: "Amir Trading +972509876543 amir@example.test", titleAr: "Amir Hassan", actionHref: "/exchange/seller/maya-otc", relatedRequestId: request.id, isRead: false, createdAt: now });
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    invalidateAlphaExchangeStoreCache();
    const listings = await getMarketplaceListings("active");
    expect(listings[0].sellerDisplayName).toBe(publicAccountId(seller));
    const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: seller.id, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.counterpart).toEqual({ buyerName: publicAccountId(buyer), sellerName: publicAccountId(seller) });
    const trades = await getMyPurchaseRequests(seller.id, "approved_seller", db);
    const profile = await getPremiumSellerProfile({ sellerId: seller.id, viewerUserId: buyer.id, viewerRole: "buyer" });
    expect(profile?.latestReviews[0].buyerName).toBe(publicAccountId(buyer));
    const notices = await getNotificationsForUser({ userId: seller.id, includeActivity: false });
    expect(notices.notifications[0].tradeSnapshot?.counterpartyName).toBe(publicAccountId(buyer));
    for (const projection of [listings, room, trades, profile, notices]) {
      expect(JSON.stringify(projection)).not.toMatch(/Maya|Chen|Amir|Hassan|maya-portrait|1234567|9876543|example\.test/i);
    }
    expect(await getPublicUserProfileRouteData({ username: "maya-otc", viewerUserId: buyer.id })).toBeNull();
    expect((await getAccountProfileData(seller.id)).profile.fullName).toBe("Maya Chen");
  });
  it("counts completed sales without the original listing and keeps private, public and listing ranks consistent", async () => {
    const own = await getAccountProfileData("seller-one");
    expect(own.stats).toMatchObject({ kind: "seller", sellerLevel: "silver", lifetimeCompletedVolumeUsdt: 38_000, nextLevel: "gold", amountToNextLevelUsdt: 12_000, progressToNextLevelPercent: 65.71 });
    const publicProfile = await getPremiumSellerProfile({ sellerId: "seller-one", viewerUserId: "buyer-one", viewerRole: "buyer" });
    expect(publicProfile?.sellerLevel).toBe("silver");
    for (const key of ["lifetimeCompletedVolumeUsdt", "tradeVolume", "exactTradeVolume", "amountToNextRankUsdt", "progressToNextRankPercent"] as const) expect(publicProfile?.[key]).toBeUndefined();
    const listings = await getMarketplaceListings("active");
    expect(listings.find(listing => listing.id === "active-listing")?.sellerReputation?.level).toBe("silver");
    expect(JSON.stringify(listings)).not.toContain("lifetimeCompletedVolumeUsdt");
    expect((await getAccountProfileData("seller-two")).stats).toMatchObject({ kind: "seller", sellerLevel: "gold", lifetimeCompletedVolumeUsdt: 50_000 });
  });
  it("publishes only a buyer's earned rank and role, without publishing purchase totals", async () => {
    const profile = await getPublicUserProfileRouteData({ username: derivePublicProfileUsername({ id: "buyer-one" }), viewerUserId: "buyer-two", viewerRole: "buyer" });
    expect(profile?.profile).toMatchObject({ roleBadge: "buyer", buyerRank: "gold" });
    expect(JSON.stringify(profile)).not.toContain("lifetimeCompletedVolumeUsdt");
    expect((await getPublicUserProfileRouteData({ username: derivePublicProfileUsername({ id: "buyer-two" }) }))?.profile.buyerRank).toBe("bronze");
  });
  it("preserves explicit rank overrides across private profile, public profile and listings", async () => {
    const db = seed();
    db.users[0].sellerRankOverride = { rank: "diamond", reason: "Owner approved rank", setAt: now, setByUserId: "owner" };
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    invalidateAlphaExchangeStoreCache();
    expect((await getAccountProfileData("seller-one")).stats).toMatchObject({ sellerLevel: "diamond", nextLevel: "elite", amountToNextLevelUsdt: 462_000 });
    expect((await getPremiumSellerProfile({ sellerId: "seller-one" }))?.sellerLevel).toBe("diamond");
    expect((await getMarketplaceListings("active"))[0]?.sellerReputation?.level).toBe("diamond");
  });
});
