import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  publishRealtimeEvent: vi.fn(),
  scheduleMobilePushDelivery: vi.fn(),
  sendMarketplaceEmail: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

vi.mock("@/lib/realtime", () => ({
  publishRealtimeEvent: mocks.publishRealtimeEvent,
}));

vi.mock("@/lib/mobile-push", () => ({
  scheduleMobilePushDelivery: mocks.scheduleMobilePushDelivery,
}));

vi.mock("@/lib/marketplace-email-delivery", () => ({
  sendMarketplaceEmail: mocks.sendMarketplaceEmail,
}));

import {
  invalidateAlphaExchangeStoreCache,
  runTradeActionReminders,
  sanitizePurchaseRequestForActor,
  TRADE_ACTION_REMINDER_INTERVAL_MS,
} from "@/lib/alpha-exchange-store";

const BUYER_ID = "buyer-reminder";
const SELLER_ID = "seller-reminder";
const NOW = new Date("2026-09-10T12:05:00.000Z");
const STALE = new Date(NOW.getTime() - TRADE_ACTION_REMINDER_INTERVAL_MS - 5 * 60_000).toISOString();

function user(id: string, role: "buyer" | "approved_seller", locale: "ar" | "en"): AlphaExchangeUser {
  return {
    id,
    fullName: id === BUYER_ID ? "Buyer Reminder" : "Seller Reminder",
    email: `${id}@example.test`,
    passwordHash: "not-used",
    whatsappNumber: "+972500000000",
    role,
    roles: [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    availabilityStatus: "available",
    onlineStatus: "offline",
    createdAt: STALE,
    updatedAt: STALE,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Bank Transfer"],
    profilePhotoUrl: "",
    languages: locale === "ar" ? ["Arabic"] : ["English"],
    preferredLocale: locale,
    bio: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    // Required trade-safety reminders intentionally survive optional channel
    // preferences, just like the existing lifecycle and manual-Poke emails.
    notificationPreferences: { inApp: false, email: false, sms: false },
    emailVerified: true,
    emailVerifiedAt: STALE,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: STALE,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user(BUYER_ID, "buyer", "ar"),
      user(SELLER_ID, "approved_seller", "en"),
    ],
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
    smsDeliveries: [],
    marketplaceEnforcementRecords: [],
    marketplaceEnforcementAuditLog: [],
    __runtimeVersion: 0,
  };
}

function currentSnapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
}

function requestForStatus(status: PurchaseRequest["status"], overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  const stageFields: Partial<PurchaseRequest> = status === "accepted"
    ? { tradeCreatedAt: STALE }
    : status === "payment_sent"
      ? { tradeCreatedAt: STALE, paymentSentAt: STALE }
      : status === "funds_received"
        ? { tradeCreatedAt: STALE, paymentSentAt: STALE, fundsReceivedAt: STALE }
        : status === "usdt_release_pending"
          ? {
              tradeCreatedAt: STALE,
              paymentSentAt: STALE,
              fundsReceivedAt: STALE,
              usdtReleaseStartedAt: STALE,
              usdtReleaseDeadlineAt: new Date(NOW.getTime() + TRADE_ACTION_REMINDER_INTERVAL_MS).toISOString(),
            }
          : status === "usdt_sent"
            ? { tradeCreatedAt: STALE, paymentSentAt: STALE, usdtSentAt: STALE }
            : {};
  return {
    id: `request-${status}`,
    tradeId: `trade-${status}`,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    listingId: "listing-reminder",
    buyerName: "Buyer Reminder",
    usdtAmount: "100",
    fiatAmount: "350",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status,
    createdAt: STALE,
    updatedAt: STALE,
    ...stageFields,
    ...overrides,
  };
}

describe("automatic hourly Trade Room action reminders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mocks.sendMarketplaceEmail.mockResolvedValue({ ok: true });
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["pending", SELLER_ID],
    ["accepted", BUYER_ID],
    ["payment_sent", SELLER_ID],
    ["funds_received", SELLER_ID],
    ["usdt_release_pending", SELLER_ID],
    ["usdt_sent", BUYER_ID],
  ] as const)("targets only the participant responsible during %s", async (status, recipientUserId) => {
    currentSnapshot().purchaseRequests.push(requestForStatus(status));

    const result = await runTradeActionReminders({ now: NOW });

    expect(result).toEqual({
      activeTradesChecked: 1,
      notificationsCreated: 1,
      emailsSent: 1,
      emailFailures: 0,
    });
    expect(currentSnapshot().notifications).toHaveLength(1);
    expect(currentSnapshot().notifications[0]).toMatchObject({
      userId: recipientUserId,
      state: "unread",
      reason: "automatic_trade_action_reminder",
      actionHref: `/trade-room/request-${status}`,
      actionLabel: "Open Trade Room",
      titleAr: "إجراء مطلوب في صفقتك",
    });
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledWith(expect.objectContaining({
      event: "trade_action_reminder",
      to: `${recipientUserId}@example.test`,
      actionPath: `/trade-room/request-${status}`,
    }));
    expect(mocks.scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
  });

  it("waits a full hour, deduplicates retries, and repeats only after another full hour", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("accepted"));

    await runTradeActionReminders({ now: NOW });
    await runTradeActionReminders({ now: NOW });
    expect(currentSnapshot().notifications).toHaveLength(1);
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledTimes(1);

    const almostNextHour = new Date(NOW.getTime() + TRADE_ACTION_REMINDER_INTERVAL_MS - 1);
    vi.setSystemTime(almostNextHour);
    await runTradeActionReminders({ now: almostNextHour });
    expect(currentSnapshot().notifications).toHaveLength(1);

    const nextHour = new Date(NOW.getTime() + TRADE_ACTION_REMINDER_INTERVAL_MS);
    vi.setSystemTime(nextHour);
    await runTradeActionReminders({ now: nextHour });
    expect(currentSnapshot().notifications).toHaveLength(2);
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledTimes(2);
    expect(currentSnapshot().purchaseRequests[0]?.actionReminderState?.buyer?.reminderCount).toBe(2);
  });

  it("does not let chat activity, reconnects, or refresh timestamps postpone the required action", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("accepted", {
      updatedAt: new Date(NOW.getTime() - 10_000).toISOString(),
      messages: [{
        id: "message-recent",
        purchaseRequestId: "request-accepted",
        kind: "user",
        senderUserId: SELLER_ID,
        senderRole: "approved_seller",
        message: "Still here",
        createdAt: new Date(NOW.getTime() - 10_000).toISOString(),
        readByUserIds: [SELLER_ID],
      }],
    }));

    const result = await runTradeActionReminders({ now: NOW });

    expect(result.notificationsCreated).toBe(1);
    expect(currentSnapshot().notifications[0]?.userId).toBe(BUYER_ID);
  });

  it("starts a fresh one-hour clock after a real lifecycle action and changes the recipient", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("accepted"));
    await runTradeActionReminders({ now: NOW });

    const actionAt = new Date(NOW.getTime() + 5 * 60_000);
    const stored = currentSnapshot().purchaseRequests[0]!;
    stored.status = "payment_sent";
    stored.paymentSentAt = actionAt.toISOString();
    stored.updatedAt = actionAt.toISOString();

    const tooEarly = new Date(actionAt.getTime() + TRADE_ACTION_REMINDER_INTERVAL_MS - 1);
    vi.setSystemTime(tooEarly);
    await runTradeActionReminders({ now: tooEarly });
    expect(currentSnapshot().notifications).toHaveLength(1);

    const due = new Date(actionAt.getTime() + TRADE_ACTION_REMINDER_INTERVAL_MS);
    vi.setSystemTime(due);
    await runTradeActionReminders({ now: due });
    expect(currentSnapshot().notifications).toHaveLength(2);
    expect(currentSnapshot().notifications[0]?.userId).toBe(SELLER_ID);
    expect(currentSnapshot().purchaseRequests[0]?.actionReminderState).toMatchObject({
      stage: "payment_sent",
      seller: { userId: SELLER_ID, reminderCount: 1 },
    });
  });

  it("reminds both participants in a face-to-face trade where either can complete", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("accepted", {
      paymentMethod: "Face-to-Face (Meet in Person)",
    }));

    const result = await runTradeActionReminders({ now: NOW });

    expect(result.notificationsCreated).toBe(2);
    expect(new Set(currentSnapshot().notifications.map((item) => item.userId))).toEqual(new Set([BUYER_ID, SELLER_ID]));
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledTimes(2);
  });

  it("stops immediately for completed, closed, or timed-out trades", async () => {
    currentSnapshot().purchaseRequests.push(
      requestForStatus("review_open", { completedAt: STALE }),
      requestForStatus("accepted", { id: "request-closed", closedAt: STALE }),
      requestForStatus("payment_sent", { id: "request-timeout", timedOutAt: STALE }),
    );

    const result = await runTradeActionReminders({ now: NOW });

    expect(result.notificationsCreated).toBe(0);
    expect(currentSnapshot().notifications).toHaveLength(0);
    expect(mocks.sendMarketplaceEmail).not.toHaveBeenCalled();
  });

  it("atomically prevents duplicate notification and email sends from concurrent cron invocations", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("payment_sent"));

    await Promise.all([
      runTradeActionReminders({ now: NOW }),
      runTradeActionReminders({ now: NOW }),
    ]);

    expect(currentSnapshot().notifications).toHaveLength(1);
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
  });

  it("never exposes server-owned reminder delivery markers in Trade Room payloads", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("accepted"));
    await runTradeActionReminders({ now: NOW });
    const stored = currentSnapshot().purchaseRequests[0]!;

    expect(stored.actionReminderState).toBeTruthy();
    expect(sanitizePurchaseRequestForActor(stored, BUYER_ID, "buyer").actionReminderState).toBeUndefined();
    expect(sanitizePurchaseRequestForActor(stored, "admin-1", "admin").actionReminderState).toBeUndefined();
  });
});
