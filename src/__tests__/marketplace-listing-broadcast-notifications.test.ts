import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

const { sendMarketplaceEmailMock } = vi.hoisted(() => ({
  sendMarketplaceEmailMock: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/lib/marketplace-email-delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketplace-email-delivery")>("@/lib/marketplace-email-delivery");
  return {
    ...actual,
    sendMarketplaceEmail: sendMarketplaceEmailMock,
  };
});

import {
  approveSellerApplicationByAdmin,
  createMarketplaceListing,
  createPurchaseRequest,
  createSellerApplication,
  getNotificationsForUser,
  invalidateAlphaExchangeStoreCache,
  reviewMarketplaceListingByOwner,
  updatePurchaseRequestStatus,
} from "@/lib/alpha-exchange-store";
import { adminMarketplaceListingsDestination, listingDestination, sellerApplicationReviewDestination } from "@/lib/action-destinations";
import { prepareListingReviewEmails } from "@/lib/marketplace-email-events";

const OWNER_ID = "owner-1";
const LISTING_CREATOR_ID = "seller-creator";
const BUYER_ID = "buyer-eligible";
const DUAL_ROLE_BUYER_ID = "seller-buyer-eligible";
const GUEST_ID = "guest-excluded";
const SUSPENDED_BUYER_ID = "buyer-suspended-excluded";
const DISABLED_BUYER_ID = "buyer-disabled-excluded";

function createUser(input: {
  id: string;
  email: string;
  role: UserRole;
  roles?: UserRole[];
  sellerStatus?: "buyer" | "pending_seller_approval" | "approved_seller" | "rejected" | "suspended";
  disabled?: boolean;
}) {
  const now = new Date().toISOString();
  const roles = input.roles ?? [input.role];
  return {
    id: input.id,
    fullName: input.id,
    email: input.email,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role: input.role,
    roles,
    sellerStatus: input.sellerStatus ?? (roles.includes("approved_seller") ? "approved_seller" : "buyer"),
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    isFoundingMember: false,
    isFoundingSeller: false,
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    onboardingSelection: roles.includes("buyer") ? "buyer" : undefined,
    onboardingCompletedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerRankOverride: undefined,
    sellerPromotionHistory: [],
    sellerAchievements: [],
    disabled: input.disabled ?? false,
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser({ id: OWNER_ID, email: "jozenmark834@yahoo.com", role: "owner", roles: ["owner", "admin"] }),
      createUser({ id: LISTING_CREATOR_ID, email: "seller.creator@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" }),
      createUser({ id: BUYER_ID, email: "buyer.eligible@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "buyer" }),
      createUser({ id: DUAL_ROLE_BUYER_ID, email: "seller.buyer.eligible@example.com", role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller" }),
      createUser({ id: GUEST_ID, email: "guest.excluded@example.com", role: "guest", roles: ["guest"], sellerStatus: "buyer" }),
      createUser({ id: SUSPENDED_BUYER_ID, email: "buyer.suspended@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "suspended" }),
      createUser({ id: DISABLED_BUYER_ID, email: "buyer.disabled@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", disabled: true }),
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

describe("marketplace listing publication broadcasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("repairs blank notification content while preserving the unread count", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    snapshot.notifications.push({
      id: "notification-blank-content",
      userId: BUYER_ID,
      category: "trade",
      title: "",
      message: "",
      isRead: false,
      state: "unread",
      createdAt: new Date().toISOString(),
    });

    const result = await getNotificationsForUser({ userId: BUYER_ID });
    const notification = result.notifications.find((item) => item.id === "notification-blank-content");
    expect(result.unreadCount).toBe(1);
    expect(notification).toMatchObject({ title: "Trade update", message: "Open notifications for the latest account update." });
  });

  it("delivers seller-application approval alerts even when owner optional notifications are disabled", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const owner = snapshot.users.find((user) => user.id === OWNER_ID);
    expect(owner).toBeDefined();
    owner!.notificationPreferences = { inApp: false, email: false, sms: false };

    const application = await createSellerApplication({
      userId: BUYER_ID,
      fullName: "Eligible Buyer",
      email: "buyer.eligible@example.com",
      whatsappNumber: "+972501234567",
      preferredNetworks: ["USDT (TRC20 / Tron)"],
      expectedMonthlyTradingVolume: "2500",
      additionalNotes: "Ready to sell",
    });

    const ownerNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    expect(ownerNotifications.notifications).toContainEqual(expect.objectContaining({
      category: "application",
      title: "New Approved Seller Application",
      priority: "critical",
      state: "unread",
      actionHref: sellerApplicationReviewDestination(application.id),
      relatedHref: sellerApplicationReviewDestination(application.id),
      actionLabel: "Review Application",
    }));
    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "owner_seller_application_review_required",
      to: "jozenmark834@yahoo.com",
      actionUrl: expect.stringContaining(`/en${sellerApplicationReviewDestination(application.id)}`),
    }));

    await approveSellerApplicationByAdmin(application.id, OWNER_ID, "Verified from owner notification");

    const activeNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    expect(activeNotifications.notifications.some((notification) => notification.actionHref === sellerApplicationReviewDestination(application.id))).toBe(false);
    const archivedNotifications = await getNotificationsForUser({ userId: OWNER_ID, state: "archived" });
    expect(archivedNotifications.notifications).toContainEqual(expect.objectContaining({
      category: "application",
      state: "archived",
      isRead: true,
      actionHref: sellerApplicationReviewDestination(application.id),
    }));
  });

  it("keeps listing approvals visible, actionable, and backed up by email until resolved", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const owner = snapshot.users.find((user) => user.id === OWNER_ID);
    expect(owner).toBeDefined();
    owner!.notificationPreferences = { inApp: false, email: false, sms: false };

    const listing = await createMarketplaceListing({
      sellerId: LISTING_CREATOR_ID,
      sellerDisplayName: "Listing Creator",
      availableAmount: "700",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Face-to-Face (Meet in Person)"],
      minimumTrade: "50",
      maximumTrade: "700",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: LISTING_CREATOR_ID,
    });

    const reviewDestination = adminMarketplaceListingsDestination(listing.id);
    const ownerNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    expect(ownerNotifications.notifications).toContainEqual(expect.objectContaining({
      category: "listing",
      title: "New Listing Pending Review",
      priority: "critical",
      state: "unread",
      relatedListingId: listing.id,
      actionHref: reviewDestination,
      relatedHref: reviewDestination,
      actionLabel: "Review Listing",
    }));
    expect(sendMarketplaceEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "owner_listing_review_required",
      to: "jozenmark834@yahoo.com",
      actionUrl: expect.stringContaining(`/en${reviewDestination}`),
    }));

    await reviewMarketplaceListingByOwner({
      listingId: listing.id,
      ownerUserId: OWNER_ID,
      decision: "approve",
    });

    const activeNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    expect(activeNotifications.notifications.some((notification) => notification.relatedListingId === listing.id)).toBe(false);
    const archivedNotifications = await getNotificationsForUser({ userId: OWNER_ID, state: "archived" });
    expect(archivedNotifications.notifications).toContainEqual(expect.objectContaining({
      category: "listing",
      state: "archived",
      isRead: true,
      relatedListingId: listing.id,
    }));
  });

  it("shows owner mobile notifications when a trade request is submitted and accepted", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const owner = snapshot.users.find((user) => user.id === OWNER_ID);
    expect(owner).toBeDefined();
    owner!.notificationPreferences = { inApp: false, email: false, sms: false };

    const listing = await createMarketplaceListing({
      sellerId: LISTING_CREATOR_ID,
      sellerDisplayName: "Listing Creator",
      availableAmount: "500",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Face-to-Face (Meet in Person)"],
      minimumTrade: "50",
      maximumTrade: "500",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: LISTING_CREATOR_ID,
    });
    await reviewMarketplaceListingByOwner({
      listingId: listing.id,
      ownerUserId: OWNER_ID,
      decision: "approve",
    });

    const created = await createPurchaseRequest({
      buyerId: BUYER_ID,
      listingId: listing.id,
      usdtAmount: "100",
      buyerName: "Eligible Buyer",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      paymentMethod: "Face-to-Face (Meet in Person)",
      safetyAcknowledged: true,
      actorUserId: BUYER_ID,
    });

    let ownerNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    expect(ownerNotifications.notifications).toContainEqual(expect.objectContaining({
      category: "trade",
      title: "New Trade Request Submitted",
      relatedRequestId: created.request.id,
      actionHref: expect.stringContaining(`requestId=${created.request.id}`),
      actionLabel: "Monitor Request",
    }));

    await updatePurchaseRequestStatus({
      requestId: created.request.id,
      actorUserId: LISTING_CREATOR_ID,
      actorRole: "approved_seller",
      nextStatus: "accepted",
      safetyAcknowledged: true,
    });

    ownerNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    expect(ownerNotifications.notifications).toContainEqual(expect.objectContaining({
      category: "trade",
      title: "Trade Request Accepted",
      relatedRequestId: created.request.id,
      relatedTradeId: created.request.tradeId,
      actionHref: expect.stringContaining(`requestId=${created.request.id}`),
      actionLabel: "Monitor Trade",
    }));
  });

  it("sends exactly one in-app new-listing notification to each eligible buyer", async () => {
    const listing = await createMarketplaceListing({
      sellerId: LISTING_CREATOR_ID,
      sellerDisplayName: "Listing Creator",
      availableAmount: "700",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "700",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: LISTING_CREATOR_ID,
    });

    const ownerNotifications = await getNotificationsForUser({ userId: OWNER_ID });
    const ownerReview = ownerNotifications.notifications.find(
      (notification) => notification.title === "New Listing Pending Review" && notification.relatedListingId === listing.id,
    );
    expect(ownerReview).toMatchObject({
      relatedHref: adminMarketplaceListingsDestination(listing.id),
      actionHref: adminMarketplaceListingsDestination(listing.id),
      actionLabel: "Review Listing",
    });

    await reviewMarketplaceListingByOwner({
      listingId: listing.id,
      ownerUserId: OWNER_ID,
      decision: "approve",
    });

    const buyerNotifications = await getNotificationsForUser({ userId: BUYER_ID });
    const dualRoleNotifications = await getNotificationsForUser({ userId: DUAL_ROLE_BUYER_ID });
    const guestNotifications = await getNotificationsForUser({ userId: GUEST_ID });
    const suspendedNotifications = await getNotificationsForUser({ userId: SUSPENDED_BUYER_ID });
    const disabledNotifications = await getNotificationsForUser({ userId: DISABLED_BUYER_ID });
    const creatorNotifications = await getNotificationsForUser({ userId: LISTING_CREATOR_ID });

    const buyerHits = buyerNotifications.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id);
    const dualRoleHits = dualRoleNotifications.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id);
    const guestHits = guestNotifications.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id);
    const suspendedHits = suspendedNotifications.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id);
    const disabledHits = disabledNotifications.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id);
    const creatorHits = creatorNotifications.notifications.filter((n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id);

    expect(buyerHits).toHaveLength(1);
    expect(dualRoleHits).toHaveLength(1);
    expect(guestHits).toHaveLength(0);
    expect(suspendedHits).toHaveLength(0);
    expect(disabledHits).toHaveLength(0);
    expect(creatorHits).toHaveLength(0);
    expect(buyerHits[0]).toMatchObject({ relatedHref: listingDestination(listing) });
    expect(dualRoleHits[0]).toMatchObject({ relatedHref: listingDestination(listing) });
  });

  it("uses the same eligible buyers for email fan-out and does not depend on generic email opt-in", async () => {
    const listing = await createMarketplaceListing({
      sellerId: LISTING_CREATOR_ID,
      sellerDisplayName: "Listing Creator",
      availableAmount: "450",
      price: "3.10",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "450",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: LISTING_CREATOR_ID,
    });

    const approvedListing = await reviewMarketplaceListingByOwner({
      listingId: listing.id,
      ownerUserId: OWNER_ID,
      decision: "approve",
    });

    const deliver = await prepareListingReviewEmails({
      decision: "approve",
      listing: approvedListing,
    });
    await deliver();

    const rawCalls = sendMarketplaceEmailMock.mock.calls as unknown[][];
    const calls: Array<{ event: string; to: string }> = [];
    for (const call of rawCalls) {
      const maybeCall = call[0] as Record<string, unknown> | undefined;
      if (!maybeCall) continue;
      if (typeof maybeCall.event !== "string" || typeof maybeCall.to !== "string") continue;
      calls.push({ event: maybeCall.event, to: maybeCall.to });
    }
    const listingBroadcastCalls = calls.filter((call) => call.event === "new_listing_published");

    expect(calls.some((call) => call.event === "listing_approved" && call.to === "seller.creator@example.com")).toBe(true);

    const listingRecipientEmails = listingBroadcastCalls.map((call) => call.to).sort();
    expect(listingRecipientEmails).toEqual([
      "buyer.eligible@example.com",
      "seller.buyer.eligible@example.com",
    ]);
    expect(new Set(listingRecipientEmails).size).toBe(listingRecipientEmails.length);

    expect(listingBroadcastCalls.every((call) => call.to !== "guest.excluded@example.com")).toBe(true);
    expect(listingBroadcastCalls.every((call) => call.to !== "buyer.suspended@example.com")).toBe(true);
    expect(listingBroadcastCalls.every((call) => call.to !== "buyer.disabled@example.com")).toBe(true);
    expect(listingBroadcastCalls.every((call) => call.to !== "seller.creator@example.com")).toBe(true);

    const candidateUserIds = [
      BUYER_ID,
      DUAL_ROLE_BUYER_ID,
      GUEST_ID,
      SUSPENDED_BUYER_ID,
      DISABLED_BUYER_ID,
      LISTING_CREATOR_ID,
    ] as const;
    const inAppRecipientIds = new Set<string>();
    for (const userId of candidateUserIds) {
      const notifications = await getNotificationsForUser({ userId });
      const hasListingBroadcast = notifications.notifications.some(
        (n) => n.title === "🟢 New USDT Listing Available" && n.relatedListingId === listing.id,
      );
      if (hasListingBroadcast) inAppRecipientIds.add(userId);
    }

    const emailToUserId = new Map<string, string>([
      ["buyer.eligible@example.com", BUYER_ID],
      ["seller.buyer.eligible@example.com", DUAL_ROLE_BUYER_ID],
      ["guest.excluded@example.com", GUEST_ID],
      ["buyer.suspended@example.com", SUSPENDED_BUYER_ID],
      ["buyer.disabled@example.com", DISABLED_BUYER_ID],
      ["seller.creator@example.com", LISTING_CREATOR_ID],
    ] as const);
    const emailRecipientIds = new Set(
      listingBroadcastCalls
        .map((call) => emailToUserId.get(call.to))
        .filter((value): value is string => typeof value === "string"),
    );

    expect([...inAppRecipientIds].sort()).toEqual([...emailRecipientIds].sort());
  });
});
