import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

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

    expect(notification.title).toBe("Flagged seller: Rod Molla");
    expect(notification.message).toBe("Rod Molla triggered trust/risk signals. Trust score: 38.5/100.");
    expect(notification.relatedSellerName).toBe("Rod Molla");
    expect(notification.relatedSellerUsername).toBe("rod-molla");
    expect(notification.actionLabel).toBe("Review Seller");
    expect(notification.actionHref).toBe("/exchange/seller/rod-molla");
    expect(`${notification.title} ${notification.message} ${notification.actionHref}`).not.toContain(SELLER_ID);
  });

  it("lets the owner find the notification by seller name or username", async () => {
    await expect(getNotificationsForUser({ userId: OWNER_ID, query: "Rod Molla" })).resolves.toMatchObject({ total: 1 });
    await expect(getNotificationsForUser({ userId: OWNER_ID, query: "rod-molla" })).resolves.toMatchObject({ total: 1 });
  });
});
