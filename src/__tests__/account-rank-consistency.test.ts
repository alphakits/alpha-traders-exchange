import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { derivePublicProfileUsername, getAccountProfileData, updateAccountProfileData, createPurchaseRequest, getMarketplaceListings, getMyPurchaseRequests, getNotificationsForUser, getTradeRoomData, getPremiumSellerProfile, getPublicUserProfileRouteData, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { publicAccountId } from "@/lib/public-account-identity";
import { toMobileAccountProfile } from "@/lib/mobile-account-profile";
import { toMobileTradeDetail } from "@/lib/mobile-trades";

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
  it("shows the public owner identity while reserving members' identities and contact details for the canonical owner", async () => {
    const db = seed();
    const owner = { ...user("owner-one", true), fullName: "Alex Morgan", role: "owner", roles: ["owner", "admin"], profilePhotoUrl: "https://example.test/owner.jpg", whatsappNumber: "+972501111111" } as AlphaExchangeUser;
    const seller = db.users[0];
    const buyer = db.users[2];
    Object.assign(seller, { fullName: "Maya Chen", whatsappNumber: "+972502222222", profilePhotoUrl: "https://example.test/seller.jpg", bio: "Maya Chen", city: "Haifa" });
    Object.assign(buyer, { fullName: "Amir Hassan", whatsappNumber: "+972503333333" });
    db.users.push(owner, { ...user("admin-one"), role: "admin", roles: ["admin"] });
    db.marketplaceListings.push({ ...db.marketplaceListings[0], id: "owner-listing", sellerId: owner.id, sellerDisplayName: owner.fullName });
    const request = db.purchaseRequests[0];
    request.listingId = db.marketplaceListings[0].id;
    request.buyerName = buyer.fullName;
    request.buyerWhatsapp = buyer.whatsappNumber;
    // A persisted or client-originated flag must never grant the owner exemption.
    request.buyerIsOwner = true;
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    invalidateAlphaExchangeStoreCache();
    const publicOwner = await getPublicUserProfileRouteData({ username: derivePublicProfileUsername(owner) });
    expect(publicOwner?.profile).toMatchObject({ fullName: owner.fullName, profilePhotoUrl: owner.profilePhotoUrl, roleBadge: "owner", contact: { email: "", phone: "" } });
    const listings = await getMarketplaceListings("active");
    expect(listings.find(row => row.sellerId === owner.id)?.sellerDisplayName).toBe(owner.fullName);
    expect(listings.find(row => row.sellerId === seller.id)?.sellerDisplayName).toBe(publicAccountId(seller));
    expect(JSON.stringify(listings)).not.toContain(buyer.whatsappNumber);
    const ownerListings = await getMarketplaceListings("active", undefined, owner.id);
    expect(ownerListings.find(row => row.sellerId === seller.id)?.sellerDisplayName).toBe(seller.fullName);
    for (const viewerUserId of [buyer.id, "admin-one"]) {
      const profile = await getPublicUserProfileRouteData({ username: derivePublicProfileUsername(seller), viewerUserId, viewerRole: "owner" });
      expect(profile?.profile).toMatchObject({ fullName: publicAccountId(seller), profilePhotoUrl: "", contact: { email: "", phone: "" } });
      const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: viewerUserId, actorRole: viewerUserId === buyer.id ? "buyer" : "admin", markMessagesRead: false });
      expect(room.request.buyerIsOwner).toBe(false);
      expect(room.request.buyerName).toBe(publicAccountId(buyer));
      expect(JSON.stringify(room)).not.toMatch(/Maya Chen|Amir Hassan|502222222|503333333/);
    }
    const ownerProfile = await getPublicUserProfileRouteData({ username: derivePublicProfileUsername(seller), viewerUserId: owner.id, viewerRole: "buyer" });
    expect(ownerProfile?.profile).toMatchObject({ fullName: seller.fullName, city: "Haifa", bio: seller.bio, contact: { phone: seller.whatsappNumber, email: seller.email } });
    for (const strongConsistency of [false, true]) {
      const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: owner.id, actorRole: "owner", markMessagesRead: false, strongConsistency });
      expect(room.counterpart).toEqual({ buyerName: buyer.fullName, sellerName: seller.fullName, buyerPublicId: publicAccountId(buyer), sellerPublicId: publicAccountId(seller) });
      expect(room.request.buyerWhatsapp).toBe(buyer.whatsappNumber);
    }
    const ownerHistory = await getMyPurchaseRequests(owner.id, "owner");
    expect(ownerHistory.find(row => row.id === request.id)).toMatchObject({ buyerName: buyer.fullName, buyerWhatsapp: buyer.whatsappNumber });
    const ownerTrade = { ...request, id: "owner-as-buyer", buyerId: owner.id, buyerName: owner.fullName };
    db.purchaseRequests.push(ownerTrade);
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    invalidateAlphaExchangeStoreCache();
    const sellerRoom = await getTradeRoomData({ purchaseRequestId: ownerTrade.id, actorUserId: seller.id, actorRole: "approved_seller", markMessagesRead: false });
    expect(sellerRoom.request.buyerName).toBe(owner.fullName);
    expect(sellerRoom.request.buyerWhatsapp).toBeUndefined();
  });

  it("requires a durable private contact before new purchases and prevents clearing it", async () => {
    const db = seed();
    const buyer = db.users[2];
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    invalidateAlphaExchangeStoreCache();
    await expect(createPurchaseRequest({ buyerId: buyer.id, actorUserId: buyer.id, buyerName: "Spoofed Name", buyerWhatsapp: "+972501234567", listingId: db.marketplaceListings[0].id, usdtAmount: "100", buyerReceivingWalletAddress: "wallet" })).rejects.toMatchObject({ code: "PRIVATE_CONTACT_REQUIRED" });
    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).purchaseRequests).toHaveLength(db.purchaseRequests.length);
    await expect(updateAccountProfileData({ userId: buyer.id, whatsappNumber: "invalid" })).rejects.toMatchObject({ code: "PRIVATE_CONTACT_REQUIRED" });
    await updateAccountProfileData({ userId: buyer.id, whatsappNumber: "٠٥٠١٢٣٤٥٦٧", showPhonePublic: true, showEmailPublic: true });
    invalidateAlphaExchangeStoreCache();
    const privateProfile = (await getAccountProfileData(buyer.id)).profile;
    expect(privateProfile).toMatchObject({ whatsappNumber: "+972501234567", showPhonePublic: false, showEmailPublic: false });
    await expect(updateAccountProfileData({ userId: buyer.id, whatsappNumber: "" })).rejects.toMatchObject({ code: "PRIVATE_CONTACT_REQUIRED" });
    const publicProfile = await getPublicUserProfileRouteData({ username: derivePublicProfileUsername(buyer), viewerUserId: "seller-one" });
    expect(publicProfile?.profile.contact).toEqual({ phone: "", email: "" });
    expect((await getAccountProfileData(buyer.id)).profile.whatsappNumber).toBe("+972501234567");
  });

  it("uses dashboard AT IDs across historical listings, rooms, reviews, profiles and notifications", async () => {
    const db = seed();
    const seller = db.users[0];
    const buyer = db.users[2];
    Object.assign(seller, { fullName: "Maya Chen", buyerDisplayName: "Maya OTC", email: "maya.chen@example.test", whatsappNumber: "+972501234567", profilePhotoUrl: "https://example.test/maya-portrait.jpg", bio: "Maya Chen welcomes you. Ask Maya or Chen." });
    Object.assign(buyer, { fullName: "Amir Hassan", buyerDisplayName: "Amir Trading", email: "amir@example.test", whatsappNumber: "+972509876543" });
    const listing = db.marketplaceListings[0];
    Object.assign(listing, { sellerDisplayName: seller.fullName, sellerDescription: "Maya Chen, +972501234567", notes: "Maya OTC" });
    const request = db.purchaseRequests[0];
    Object.assign(request, { listingId: listing.id, buyerName: buyer.fullName, buyerWhatsapp: buyer.whatsappNumber, buyerNotes: buyer.email, messages: [{ id: "legacy-message", purchaseRequestId: request.id, senderUserId: buyer.id, senderRole: "buyer", message: "Amir Hassan to Maya Chen: amir@example.test +972509876543", createdAt: now }], timeline: [{ id: "legacy-event", type: "request_created", actorUserId: buyer.id, actorRole: "buyer", message: "Amir Hassan requested from Maya Chen", createdAt: now }], buyerReview: { reviewerUserId: buyer.id, rating: 5, comment: "Maya Chen was helpful", createdAt: now } });
    request.buyerReview!.comment = "Maya Chen was helpful. Thanks Maya!";
    request.sellerResponse = { responderUserId: seller.id, message: "Thanks Amir and Hassan.", createdAt: now };
    db.notifications.push({ id: "legacy-notice", userId: seller.id, category: "trade", title: "Amir Hassan sent a request", message: "Amir Trading +972509876543 amir@example.test", titleAr: "Amir Hassan", actionHref: "/exchange/seller/maya-otc", relatedRequestId: request.id, isRead: false, createdAt: now });
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    invalidateAlphaExchangeStoreCache();
    const listings = await getMarketplaceListings("active");
    expect(listings[0].sellerDisplayName).toBe(publicAccountId(seller));
    const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: seller.id, actorRole: "approved_seller", markMessagesRead: false });
    expect(room.counterpart).toEqual({ buyerName: publicAccountId(buyer), sellerName: publicAccountId(seller), buyerPublicId: publicAccountId(buyer), sellerPublicId: publicAccountId(seller) });
    const buyerRoom = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: buyer.id, actorRole: "buyer", markMessagesRead: false });
    const mobileSellerRoom = toMobileTradeDetail(room, seller.id, "en");
    const mobileBuyerRoom = toMobileTradeDetail(buyerRoom, buyer.id, "ar");
    expect(mobileSellerRoom.counterpartyDisplayName).toBe(publicAccountId(buyer));
    expect(mobileBuyerRoom.counterpartyDisplayName).toBe(publicAccountId(seller));
    const trades = await getMyPurchaseRequests(seller.id, "approved_seller", db);
    const profile = await getPremiumSellerProfile({ sellerId: seller.id, viewerUserId: buyer.id, viewerRole: "buyer" });
    expect(profile?.latestReviews[0].buyerName).toBe(publicAccountId(buyer));
    const notices = await getNotificationsForUser({ userId: seller.id, includeActivity: false });
    expect(notices.notifications[0].tradeSnapshot?.counterpartyName).toBe(publicAccountId(buyer));
    for (const projection of [listings, room, buyerRoom, mobileSellerRoom, mobileBuyerRoom, trades, profile, notices]) {
      expect(JSON.stringify(projection)).not.toMatch(/Maya|Chen|Amir|Hassan|maya-portrait|1234567|9876543|example\.test/i);
    }
    expect(await getPublicUserProfileRouteData({ username: "maya-otc", viewerUserId: buyer.id })).toBeNull();
    for (const account of [seller, buyer]) {
      const privateProfile = (await getAccountProfileData(account.id)).profile;
      expect(privateProfile.fullName).toBe(account.fullName);
      expect(toMobileAccountProfile(privateProfile).fullName).toBe(account.fullName);
      const publicProfile = await getPublicUserProfileRouteData({ username: derivePublicProfileUsername({ id: account.id }), viewerUserId: account.id });
      expect(publicProfile?.profile.fullName).toBe(publicAccountId(account));
      expect(JSON.stringify(publicProfile)).not.toMatch(/Maya|Chen|Amir|Hassan|1234567|9876543|example\.test/i);
    }
  });
  it("keeps old review authors and saved names private for every public-profile viewer", async () => {
    const db = seed();
    const buyer = db.users[2];
    buyer.fullName = "Current Private Reviewer";
    const owner = { ...user("review-owner"), fullName: "Public Owner", role: "owner", roles: ["owner", "admin"] } as AlphaExchangeUser;
    db.users.push(owner);
    const request = db.purchaseRequests[0];
    request.buyerName = "Historical Private Reviewer";
    request.buyerReview = { reviewerUserId: buyer.id, rating: 5, comment: "Historical Private Reviewer had a good trade.", createdAt: now };
    request.sellerResponse = { responderUserId: request.sellerId, message: "Thanks Historical Private Reviewer and Current Private Reviewer.", createdAt: now };
    for (const viewerUserId of [undefined, buyer.id, request.sellerId, owner.id]) {
      const profile = await getPremiumSellerProfile({ sellerId: request.sellerId, viewerUserId, dbInput: db });
      expect(profile?.latestReviews).toHaveLength(1);
      expect(profile?.latestReviews[0]).toMatchObject({ buyerName: publicAccountId(buyer), verifiedPurchase: true, hidden: false });
      expect(JSON.stringify(profile?.latestReviews)).not.toMatch(/Historical|Current|Private|Reviewer/);
      expect(profile?.latestReviews[0]).not.toHaveProperty("tradeAmount");
    }
    // Older reviews can outlive the buyer account; the saved trade ID still gives
    // the same stable public identity, without falling back to the saved name.
    db.users = db.users.filter((entry) => entry.id !== buyer.id);
    const orphaned = await getPremiumSellerProfile({ sellerId: request.sellerId, dbInput: db });
    expect(orphaned?.latestReviews[0].buyerName).toBe(publicAccountId(buyer));
    expect(orphaned?.latestReviews[0].comment).not.toContain(request.buyerName);

    request.buyerReview.hidden = true;
    const hiddenPublic = await getPremiumSellerProfile({ sellerId: request.sellerId, dbInput: db });
    expect(hiddenPublic?.latestReviews).toHaveLength(0);
    const hiddenOwner = await getPremiumSellerProfile({ sellerId: request.sellerId, viewerUserId: owner.id, dbInput: db });
    expect(hiddenOwner?.latestReviews[0].hidden).toBe(true);
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
