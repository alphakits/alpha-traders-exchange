import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequest, CommissionRecord } from "@/types/alpha-exchange";

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
  runOwnerFollowUpAlerts,
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

describe("owner follow-up alert lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks();
    const db = seedDb();
    db.users.push({ ...user("owner-followup", "buyer", "en"), role: "owner", roles: ["owner"] });
    db.users.push({ ...user("admin-followup", "buyer", "en"), role: "admin", roles: ["admin"] });
    globalThis.__alphaExchangeMemorySnapshot = db as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });
  afterEach(() => vi.useRealTimers());

  function seedCommission(overrides: Partial<CommissionRecord> = {}) {
    const commission = { id: "commission-followup", sellerId: SELLER_ID, commissionAmount: 2,
      rate: 0.02, grossAmount: 100, dueAt: STALE, paymentStatus: "overdue", paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: STALE, createdAt: STALE, updatedAt: STALE, ...overrides } as CommissionRecord;
    currentSnapshot().commissionRecords.push(commission);
    return commission;
  }

  it("alerts only a canonical active owner with a direct payment link and bilingual privacy-safe copy", async () => {
    seedCommission({ paymentSignature: "private-receipt", payerWalletAddress: "private-wallet" });
    const result = await runOwnerFollowUpAlerts({ now: NOW });
    expect(result).toEqual({ created: 1, archived: 0 });
    expect(currentSnapshot().notifications).toHaveLength(1);
    const alert = currentSnapshot().notifications[0];
    expect(alert).toMatchObject({ userId: "owner-followup", state: "unread", priority: "high",
      actionHref: "/admin/alpha-exchange?section=commissions&commissionId=commission-followup" });
    expect(alert.titleAr).toBeTruthy();
    expect(JSON.stringify(alert)).not.toMatch(/private-receipt|private-wallet/);
    expect(mocks.scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.sendMarketplaceEmail).not.toHaveBeenCalled();
  });

  it("prevents concurrent and repeated cron alerts for the same unresolved issue", async () => {
    seedCommission();
    await Promise.all([runOwnerFollowUpAlerts({ now: NOW }), runOwnerFollowUpAlerts({ now: NOW })]);
    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    await runOwnerFollowUpAlerts();
    expect(currentSnapshot().notifications).toHaveLength(1);
    expect(mocks.scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
  });

  it("archives resolved payments without another push or any settlement mutation", async () => {
    seedCommission(); await runOwnerFollowUpAlerts({ now: NOW });
    const commission = currentSnapshot().commissionRecords[0];
    commission.paymentStatus = "paid"; commission.paymentVerificationStatus = "verified";
    const before = JSON.stringify(commission);
    const result = await runOwnerFollowUpAlerts({ now: NOW });
    expect(result).toEqual({ created: 0, archived: 1 });
    expect(currentSnapshot().notifications[0]).toMatchObject({ state: "archived", isRead: true });
    expect(JSON.stringify(currentSnapshot().commissionRecords[0])).toBe(before);
    expect(mocks.scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
  });

  it("respects dismissal and waits 15 minutes for a newly submitted payment", async () => {
    seedCommission({ paymentSubmittedAt: NOW.toISOString() });
    expect(await runOwnerFollowUpAlerts({ now: NOW })).toEqual({ created: 0, archived: 0 });
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000));
    await runOwnerFollowUpAlerts();
    currentSnapshot().notifications[0].state = "archived";
    await runOwnerFollowUpAlerts();
    expect(currentSnapshot().notifications).toHaveLength(1);
    expect(currentSnapshot().notifications[0].state).toBe("archived");
  });

  it("does not alert ordinary admins or disabled/former owners", async () => {
    seedCommission(); currentSnapshot().users.find(u => u.id === "owner-followup")!.disabled = true;
    expect(await runOwnerFollowUpAlerts({ now: NOW })).toEqual({ created: 0, archived: 0 });
    expect(mocks.scheduleMobilePushDelivery).not.toHaveBeenCalled();
  });

  it("surfaces automatic payment matching that has no submitted transaction yet without claiming a payment was received", async () => {
    seedCommission({ paymentSubmittedAt: undefined, paymentExpectedAmountAssignedAt: STALE });
    expect((await runOwnerFollowUpAlerts({ now: NOW })).created).toBe(1);
    expect(currentSnapshot().notifications[0].message).toContain("awaiting a verified payment match");
    expect(currentSnapshot().commissionRecords[0].paymentStatus).toBe("overdue");
  });

  it("uses direct trade links and clears cancelled trades on the next sweep", async () => {
    currentSnapshot().purchaseRequests.push(requestForStatus("payment_sent"));
    await runOwnerFollowUpAlerts({ now: NOW });
    expect(currentSnapshot().notifications[0].actionHref).toBe("/trade-room/request-payment_sent");
    currentSnapshot().purchaseRequests[0].status = "cancelled";
    expect(await runOwnerFollowUpAlerts({ now: NOW })).toEqual({ created: 0, archived: 1 });
  });

  it("does not lose or repeatedly recreate issues beyond the dashboard's twelve-item preview", async () => {
    for (let i = 0; i < 15; i++) currentSnapshot().purchaseRequests.push(requestForStatus("accepted", { id: `request-${i}` }));
    expect((await runOwnerFollowUpAlerts({ now: NOW })).created).toBe(15);
    expect(await runOwnerFollowUpAlerts({ now: NOW })).toEqual({ created: 0, archived: 0 });
    expect(currentSnapshot().notifications.filter(n => n.state !== "archived")).toHaveLength(15);
  });
});
