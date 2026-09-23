import { publicAccountId } from "@/lib/public-account-identity";
import { publicAccountUsername } from "@/lib/public-account-username";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";
import { formatListingId } from "@/lib/format-id";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  getNotificationsForUser,
  invalidateAlphaExchangeStoreCache,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "owner-notification-test";
const SELLER_ID = "user-46d412ed-f33a-4e0b-a9a7-c14b2c4220db";

function user(input: {
  id: string;
  fullName: string;
  email: string;
  role: AlphaExchangeUser["role"];
  roles: AlphaExchangeUser["roles"];
  sellerStatus: AlphaExchangeUser["sellerStatus"];
  buyerDisplayName?: string;
}): AlphaExchangeUser {
  const now = "2026-08-25T20:00:00.000Z";
  return {
    id: input.id,
    fullName: input.fullName,
    email: input.email,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    onlineStatus: "online",
    availabilityStatus: "available",
    role: input.role,
    roles: input.roles,
    sellerStatus: input.sellerStatus,
    sellerApprovalVerification: input.sellerStatus === "approved_seller"
      ? createTestSellerApprovalVerification(now)
      : undefined,
    emailVerified: true,
    emailVerifiedAt: now,
    notificationPreferences: { inApp: true, email: false, sms: false },
    buyerDisplayName: input.buyerDisplayName,
    createdAt: now,
    updatedAt: now,
  } as AlphaExchangeUser;
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user({ id: OWNER_ID, fullName: "Mark Jozen", email: "jozenmark834@yahoo.com", role: "owner", roles: ["owner", "admin"], sellerStatus: "buyer" }),
      user({ id: SELLER_ID, fullName: "Rod Molla", email: "rod@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", buyerDisplayName: "rod-molla" }),
    ],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [{
      id: "legacy-flagged-seller-notification",
      userId: OWNER_ID,
      category: "trust",
      title: "Flagged seller detected",
      message: `Seller ${SELLER_ID} is flagged for trust/risk signals.`,
      isRead: false,
      state: "unread",
      priority: "high",
      createdAt: "2026-08-25T20:30:00.000Z",
    }],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [{
      sellerId: SELLER_ID,
      snapshot: { sellerId: SELLER_ID, trustScore: 38.5 } as AlphaExchangeDb["trustSnapshots"][number]["snapshot"],
      updatedAt: "2026-08-25T20:30:00.000Z",
    }],
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

describe("owner seller notification identity", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("repairs legacy UUID-only alerts into a named, actionable seller notification", async () => {
    const result = await getNotificationsForUser({ userId: OWNER_ID });
    const notification = result.notifications[0];

    expect(notification.title).toBe(`Flagged seller: ${publicAccountId({ id: SELLER_ID, role: "approved_seller" })}`);
    expect(notification.message).toBe(`${publicAccountId({ id: SELLER_ID, role: "approved_seller" })} triggered trust/risk signals. Trust score: 38.5/100.`);
    expect(notification.relatedSellerName).toBe(publicAccountId({ id: SELLER_ID, role: "approved_seller" }));
    expect(notification.relatedSellerUsername).toBe(publicAccountUsername(SELLER_ID));
    expect(notification.actionLabel).toBe("Review Seller");
    expect(notification.actionHref).toBe(`/exchange/seller/${publicAccountUsername(SELLER_ID)}`);
    expect(`${notification.title} ${notification.message} ${notification.actionHref}`).not.toContain(SELLER_ID);
  });

  it("lets the owner find the notification by AT ID or anonymous profile key", async () => {
    await expect(getNotificationsForUser({ userId: OWNER_ID, query: publicAccountId({ id: SELLER_ID, role: "approved_seller" }) })).resolves.toMatchObject({ total: 1 });
    await expect(getNotificationsForUser({ userId: OWNER_ID, query: publicAccountUsername(SELLER_ID) })).resolves.toMatchObject({ total: 1 });
  });

  it.each([OWNER_ID, SELLER_ID])("keeps the listing badge consistent with the submitted listing before any trade for %s", async (userId) => {
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const listingId = "listing-28d07777-5325-467a-a23c-6263a6851219";
    const timestamp = "2026-09-22T04:22:34.000Z";
    db.marketplaceListings.push({
      id: listingId,
      displayNumber: 96,
      sellerId: SELLER_ID,
      sellerDisplayName: "Review Seller",
      photos: [],
      originalAmount: "10",
      availableAmount: "10",
      price: "3.03",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Face-to-Face (Meet in Person)",
      paymentMethods: ["Face-to-Face (Meet in Person)"],
      minimumTrade: "1",
      maximumTrade: "10",
      notes: "",
      sellerDescription: "Review demonstration",
      responseTime: "5 min",
      status: "draft",
      approvalStatus: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.notifications.push({
      id: "listing-submitted-notification",
      userId,
      category: "listing",
      title: "Listing submitted",
      message: `Listing ${listingId} was submitted for admin review.`,
      relatedListingId: listingId,
      isRead: false,
      createdAt: timestamp,
    });

    const result = await getNotificationsForUser({ userId });
    const notification = result.notifications.find((entry) => entry.id === "listing-submitted-notification")!;

    expect(notification.relatedListingId).toBe(listingId);
    expect(notification.relatedListingDisplayNumber).toBe(96);
    expect(formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)).toBe("#LS-000096");
    expect(notification.message).toContain("#LS-000096");
    expect(notification.relatedRequestId).toBeUndefined();
  });

  it("retains a saved listing number when the listing is no longer in the notification snapshot", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    db.notifications.push({
      id: "archived-listing-notification",
      userId: SELLER_ID,
      category: "listing",
      title: "Listing update",
      message: "Listing #LS-000096 is no longer active.",
      relatedListingId: "listing-removed",
      relatedListingDisplayNumber: 96,
      isRead: false,
      createdAt: "2026-09-22T04:22:34.000Z",
    });

    const result = await getNotificationsForUser({ userId: SELLER_ID });
    expect(result.notifications[0].relatedListingDisplayNumber).toBe(96);
  });
});
