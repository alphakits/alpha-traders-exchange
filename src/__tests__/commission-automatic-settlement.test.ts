// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const delivery = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/marketplace-email-delivery", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/marketplace-email-delivery")>(),
  sendMarketplaceEmail: delivery.sendEmail,
}));

import { GET } from "@/app/api/cron/commission-payment-verification/route";
import {
  getSellerCommissionStatus,
  getSellerListingWorkspaceData,
  invalidateAlphaExchangeStoreCache,
} from "@/lib/alpha-exchange-store";
import { CANONICAL_TRC20_COMMISSION_WALLET } from "@/lib/commission-config";

const SELLER_ID = "automatic-commission-seller";
const COMMISSION_ID = "automatic-commission-1";
const DEPOSIT_ID = "769800519366885376";
const SECRET = "local-integration-cron-secret-at-least-32-characters";

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  const now = new Date(Date.now() - 60_000).toISOString();
  return {
    users: [{
      id: SELLER_ID,
      fullName: "Automatic Commission Seller",
      email: "automatic-commission@example.test",
      passwordHash: "test-hash",
      whatsappNumber: "",
      role: "approved_seller",
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
      availabilityStatus: "available",
      onlineStatus: "online",
      preferredLocale: "en",
      createdAt: now,
      updatedAt: now,
      preferredNetworks: [],
      preferredPaymentMethods: [],
      profilePhotoUrl: "",
      languages: ["English"],
      bio: "",
      country: "Israel",
      isFeaturedSeller: false,
      isProfileHidden: false,
      notificationPreferences: { inApp: false, email: false, sms: false },
    }] as AlphaExchangeDb["users"],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [{
      id: COMMISSION_ID,
      source: "admin_manual",
      issueReason: "Documented commission for the local integration test",
      sellerId: SELLER_ID,
      rate: 0.01,
      grossAmount: 500,
      commissionAmount: 5,
      paymentStatus: "pending",
      createdAt: now,
      updatedAt: now,
    }],
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

function snapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
}

function currentCommission() {
  return snapshot().commissionRecords.find((record) => record.id === COMMISSION_ID)!;
}

function runCron() {
  return GET(new NextRequest("https://www.alphatraders.co.il/api/cron/commission-payment-verification", {
    headers: { authorization: `Bearer ${SECRET}` },
  }));
}

function installDepositHistory(amount: string) {
  let binanceReads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.trongrid.io"
      && url.pathname === `/v1/accounts/${CANONICAL_TRC20_COMMISSION_WALLET}/transactions/trc20`) {
      return Response.json({ success: true, data: [], meta: {} });
    }
    if (url.origin === "https://api.binance.com" && url.pathname === "/sapi/v1/capital/deposit/hisrec") {
      // Both discovery and final receipt verification must use read-only
      // receiving-account history. There is no live request fallback here.
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("X-MBX-APIKEY")).toBe("local-read-only-key");
      expect(url.searchParams.get("coin")).toBe("USDT");
      expect(url.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
      binanceReads++;
      return Response.json([{
        id: DEPOSIT_ID,
        txId: "410678442518",
        coin: "USDT",
        network: "TRX",
        address: CANONICAL_TRC20_COMMISSION_WALLET,
        amount,
        status: 1,
        transferType: 1,
        insertTime: Date.now(),
        travelRuleStatus: 0,
      }]);
    }
    throw new Error(`Unexpected integration-test request to ${url.origin}${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getBinanceReads: () => binanceReads };
}

describe("automatic commission settlement through the scheduler and receiving-account history", () => {
  beforeEach(() => {
    delivery.sendEmail.mockReset().mockResolvedValue({ ok: true });
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("ALPHA_EXCHANGE_BINANCE_READ_API_KEY", "local-read-only-key");
    vi.stubEnv("ALPHA_EXCHANGE_BINANCE_READ_API_SECRET", "local-read-only-secret");
    vi.stubEnv("ALPHA_EXCHANGE_TRONGRID_API_URL", "");
    vi.stubEnv("ALPHA_EXCHANGE_TRONGRID_API_KEY", "");
    vi.stubEnv("ALPHA_EXCHANGE_ETHERSCAN_API_KEY", "");
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    invalidateAlphaExchangeStoreCache();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  });

  it("automatically settles both fee components once, only after the combined receipt is verified", async () => {
    Object.assign(currentCommission(), { source: "trade", feePolicyVersion: "buyer_seller_1pct_v1", sellerFeeAmount: 2.5, buyerFeeCollectedAmount: 2.5 });
    const before = await getSellerListingWorkspaceData({ sellerId: SELLER_ID, status: "all" });
    expect(before.commissionStatus.payableRecords[0]).toMatchObject({ sellerFeeAmount: 2.5, buyerFeeCollectedAmount: 2.5, amountDue: 5 });
    installDepositHistory(before.commissionStatus.payableAmountDue.toFixed(6));
    expect((await runCron()).status).toBe(200);
    expect(currentCommission()).toMatchObject({ sellerFeeAmount: 2.5, buyerFeeCollectedAmount: 2.5, commissionAmount: 5, paymentStatus: "paid", paymentVerificationStatus: "verified" });
    const paidAt = currentCommission().paidAt;
    expect((await runCron()).status).toBe(200);
    expect(currentCommission().paidAt).toBe(paidAt);
  });

  it("credits the exact internal Binance deposit without a TxID submission, unlocks the seller and remains idempotent", async () => {
    const before = await getSellerListingWorkspaceData({ sellerId: SELLER_ID, status: "all" });
    expect(before.summary).toMatchObject({ pendingCommissionCount: 1, canCreateListing: false });
    const exactAmount = before.commissionStatus.payableAmountDue;
    expect(exactAmount).toBe(5.000001);
    expect(currentCommission()).toMatchObject({ paymentExpectedAmount: exactAmount, paymentExpectedAmountMode: "unique_v1" });
    expect(currentCommission().paymentSignature).toBeUndefined();
    const history = installDepositHistory(exactAmount.toFixed(6));

    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      autoReconciliation: {
        candidates: 1, matched: 1, verified: 1, rejected: 0, errors: 0,
        providers: { BINANCE_DEPOSITS: { configured: true, complete: true, deposits: 1 } },
      },
    });
    // Discovery is not proof by itself: the real store rereads the receipt.
    expect(history.getBinanceReads()).toBe(2);
    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentSignature: `binance-deposit:${DEPOSIT_ID}`,
      paymentNetwork: "TRC20",
      recipientWalletAddress: CANONICAL_TRC20_COMMISSION_WALLET,
      paidAt: expect.any(String),
    });
    await expect(getSellerListingWorkspaceData({ sellerId: SELLER_ID, status: "all" })).resolves.toMatchObject({
      summary: { pendingCommissionCount: 0, canCreateListing: true, blockedReason: null },
      commissionStatus: { status: "clear", pendingCount: 0 },
    });
    expect(snapshot().notifications.filter((notification) => notification.userId === SELLER_ID)).toEqual([
      expect.objectContaining({ title: "Commission payment verified", reason: "commission_payment_verified" }),
    ]);
    expect(delivery.sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: "commission_paid", to: "automatic-commission@example.test",
    }));
    const paidAt = currentCommission().paidAt;
    const notificationIds = snapshot().notifications.map(({ id }) => id);

    const repeated = await runCron();
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ autoReconciliation: { candidates: 0, matched: 0, verified: 0 } });
    expect(currentCommission().paidAt).toBe(paidAt);
    expect(snapshot().notifications.map(({ id }) => id)).toEqual(notificationIds);
    expect(snapshot().auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(history.getBinanceReads()).toBe(2);
    expect(delivery.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps a rounded deposit unpaid and the seller locked instead of guessing its commission", async () => {
    await getSellerCommissionStatus(SELLER_ID);
    const history = installDepositHistory("5.000000");

    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      autoReconciliation: { candidates: 1, scannedTransfers: 1, matched: 0, verified: 0, unmatchedAmount: 1, baseAmountOnly: 1 },
    });
    expect(history.getBinanceReads()).toBe(1);
    expect(currentCommission()).toMatchObject({ paymentStatus: "pending", paymentExpectedAmount: 5.000001 });
    expect(currentCommission().paymentSignature).toBeUndefined();
    expect(currentCommission().paidAt).toBeUndefined();
    await expect(getSellerListingWorkspaceData({ sellerId: SELLER_ID, status: "all" })).resolves.toMatchObject({
      summary: { pendingCommissionCount: 1, canCreateListing: false },
      commissionStatus: { status: "pending", pendingCount: 1 },
    });
    expect(snapshot().auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(0);
    expect(snapshot().notifications).toHaveLength(0);
    expect(delivery.sendEmail).not.toHaveBeenCalled();
  });
});
