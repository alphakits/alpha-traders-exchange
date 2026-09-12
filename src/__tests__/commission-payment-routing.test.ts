import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  getAdminPrepDashboardData,
  getNotificationsForUser,
  getSellerCommissionStatus,
  getSellerListingWorkspaceData,
  invalidateAlphaExchangeStoreCache,
  reverifyPendingCommissionPayments,
  reverifyCommissionByAdmin,
  submitSellerCommissionWalletPayment,
  updateCommissionPaymentStatus,
} from "@/lib/alpha-exchange-store";
import { commissionPaymentDestination, getCommissionPaymentNotificationDestination } from "@/lib/commission-payment-destination";
import {
  clearMarketplaceEmailAttempts,
  listMarketplaceEmailAttempts,
} from "@/lib/marketplace-email-delivery";

const SELLER_ID = "commission-seller";
const BUYER_ID = "commission-buyer";
const COMMISSION_ID = "commission-1";
const ERC20_WALLET = "0x1111111111111111111111111111111111111111";
const TRC20_WALLET = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8";
const TRC20_WALLET_HEX = "7b662c86c643c01397eff6568df2e4ebc17f779b";
const TRON_USDT_CONTRACT_HEX = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const TRON_TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const VERIFIED_TRON_TX_A = "c".repeat(64);
const VERIFIED_TRON_TX_B = "d".repeat(64);

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: SELLER_ID,
        fullName: "Commission Seller",
        email: "commission-seller@example.test",
        passwordHash: "hash",
        whatsappNumber: "",
        role: "approved_seller",
        roles: ["approved_seller"],
        sellerStatus: "approved_seller",
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
        isFeaturedSeller: false,
        isProfileHidden: false,
        notificationPreferences: { inApp: true, email: false, sms: false },
      },
    ] as AlphaExchangeDb["users"],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [{
      id: COMMISSION_ID,
      purchaseRequestId: "request-1",
      listingId: "listing-1",
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
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

function clearCommissionWalletEnvironment() {
  for (const key of [
    "ALPHA_EXCHANGE_TRONGRID_API_KEY",
    "ALPHA_EXCHANGE_TRON_RPC_URL",
  ]) {
    vi.stubEnv(key, "");
  }
}

function currentCommission() {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  return snapshot.commissionRecords.find((record) => record.id === COMMISSION_ID)!;
}

function addCommissionRequest(db: AlphaExchangeDb, id: string, listingId: string) {
  const now = new Date().toISOString();
  db.purchaseRequests.push({
    id,
    tradeId: `trade-${id}`,
    listingId,
    sellerId: SELLER_ID,
    buyerId: BUYER_ID,
    buyerName: "Commission Buyer",
    buyerWhatsapp: "",
    usdtAmount: "500",
    fiatAmount: "1500",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status: "review_open",
    createdAt: now,
    updatedAt: now,
  } as AlphaExchangeDb["purchaseRequests"][number]);
}

function addCommission(db: AlphaExchangeDb, id: string, requestId: string, listingId: string) {
  const now = new Date().toISOString();
  db.commissionRecords.push({
    ...db.commissionRecords[0],
    id,
    purchaseRequestId: requestId,
    listingId,
    createdAt: now,
    updatedAt: now,
  });
}

function tronReceipt(input?: { txId?: string; contractHex?: string; recipientHex?: string; amountMicros?: bigint; blockTimeStamp?: number }) {
  const txId = input?.txId ?? VERIFIED_TRON_TX_A;
  const contractHex = input?.contractHex ?? TRON_USDT_CONTRACT_HEX;
  const recipientHex = input?.recipientHex ?? TRC20_WALLET_HEX;
  const amountMicros = input?.amountMicros ?? BigInt(5_000_001);
  return {
    id: txId,
    blockNumber: 86_000_000,
    blockTimeStamp: input?.blockTimeStamp ?? Date.now(),
    receipt: { result: "SUCCESS" },
    log: [{
      address: contractHex,
      topics: [
        TRON_TRANSFER_TOPIC,
        "1".repeat(64),
        recipientHex.padStart(64, "0"),
      ],
      data: amountMicros.toString(16).padStart(64, "0"),
    }],
  };
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function mockVerifiedTronPayments(expectedReceiptRequests: number) {
  let receiptRequests = 0;
  let releaseReceiptBarrier: (() => void) | undefined;
  const receiptBarrier = new Promise<void>((resolve) => {
    releaseReceiptBarrier = resolve;
  });
  const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    if (!String(request).includes("walletsolidity/gettransactioninfobyid")) {
      throw new Error(`Unexpected TRON RPC endpoint: ${String(request)}`);
    }
    const payload = JSON.parse(String(init?.body ?? "{}")) as { value?: string };
    receiptRequests += 1;
    if (receiptRequests === expectedReceiptRequests) releaseReceiptBarrier?.();
    await receiptBarrier;
    return jsonResponse(tronReceipt({
      txId: payload.value,
      amountMicros: BigInt(payload.value === VERIFIED_TRON_TX_B ? 5_000_002 : 5_000_001),
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("commission wallet payment routing", () => {
  beforeEach(() => {
    clearCommissionWalletEnvironment();
    clearMarketplaceEmailAttempts();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  afterEach(() => {
    clearMarketplaceEmailAttempts();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    invalidateAlphaExchangeStoreCache();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  });

  it("sees a newly assigned commission even when this instance cached the seller as clear", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const newlyAssigned = structuredClone(db.commissionRecords[0]!);
    db.commissionRecords = [];

    // Prime the normal process-local snapshot cache before another instance
    // (represented by the canonical memory repository) assigns the debt.
    await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false });
    db.commissionRecords.push(newlyAssigned);

    const status = await getSellerCommissionStatus(SELLER_ID);
    expect(status).toMatchObject({
      status: "pending",
      pendingCount: 1,
      commissionId: COMMISSION_ID,
      payableAmountDue: 5.000001,
    });
  });

  it("returns a coherent locked seller workspace from one strong snapshot", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const newlyAssigned = structuredClone(db.commissionRecords[0]!);
    db.commissionRecords = [];

    await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false });
    db.commissionRecords.push(newlyAssigned);

    const workspace = await getSellerListingWorkspaceData({
      sellerId: SELLER_ID,
      status: "all",
      commissionId: COMMISSION_ID,
    });
    expect(workspace.commissionStatus).toMatchObject({
      status: "pending",
      pendingCount: 1,
      commissionId: COMMISSION_ID,
    });
    expect(workspace.summary).toMatchObject({
      pendingCommissionCount: 1,
      canCreateListing: false,
    });
  });

  it("shows a newly committed commission in a fresh admin dashboard read", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const newlyAssigned = structuredClone(db.commissionRecords[0]!);
    db.commissionRecords = [];

    await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false });
    db.commissionRecords.push(newlyAssigned);

    const dashboard = await getAdminPrepDashboardData();
    expect(dashboard.commissionRecords).toContainEqual(expect.objectContaining({
      id: COMMISSION_ID,
      sellerId: SELLER_ID,
      paymentStatus: "pending",
    }));
  });

  it("settles a newly assigned commission even when this instance cached the seller as clear", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const assignedAt = new Date(Date.now() - 60_000).toISOString();
    const newlyAssigned = {
      ...structuredClone(db.commissionRecords[0]!),
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1" as const,
      paymentExpectedAmountAssignedAt: assignedAt,
    };
    db.commissionRecords = [];

    await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false });
    db.commissionRecords.push(newlyAssigned);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt())));

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    })).resolves.toMatchObject({ verification: { verified: true } });
    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
    });
  });

  it("records only the canonical TRC20 rail and Binance recipient", async () => {
    await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      // A deliberately short hash prevents any real RPC call while preserving
      // the same record-write path used for an unverified submission.
      paymentSignature: "too-short",
    });

    expect(currentCommission()).toMatchObject({
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: "too-short",
      paymentVerificationStatus: "failed",
      paymentStatus: "pending",
    });
  });

  it("does not tell a seller to pay again while an overdue TxID is awaiting verification", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: new Date().toISOString(),
      paymentVerificationStatus: "pending_verification",
    };

    await getSellerCommissionStatus(SELLER_ID);

    expect(currentCommission().paymentStatus).toBe("overdue");
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const notification = snapshot.notifications.find((item) => item.userId === SELLER_ID);
    expect(notification).toMatchObject({
      title: "Commission verification pending",
      actionLabel: "View Payment Status",
    });
    expect(notification?.message).toMatch(/do not send another payment/i);
    expect(notification?.message).not.toMatch(/requires payment/i);
  });

  it("verifies a solidified official USDT TRC20 transfer and unlocks the seller automatically", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    vi.stubEnv("ALPHA_EXCHANGE_TRONGRID_API_KEY", "test-trongrid-key");
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      expect(String(request)).toMatch(/walletsolidity\/gettransactioninfobyid$/);
      expect(init?.headers).toMatchObject({ "TRON-PRO-API-KEY": "test-trongrid-key" });
      expect(JSON.parse(String(init?.body))).toEqual({ value: VERIFIED_TRON_TX_A });
      return jsonResponse(tronReceipt());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({
      verified: true,
      reference: VERIFIED_TRON_TX_A,
      notes: expect.stringMatching(/USDT received on TRON \(TRC20\)/i),
    });
    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentExpectedAmount: 5.000001,
    });
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.purchaseRequests[0]?.timeline.some((entry) => entry.type === "commission_paid")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a TRON transfer that uses a lookalike token instead of official USDT", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ contractHex: "f".repeat(40) }))));

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false });
    expect(result.verification.notes).toMatch(/not official USDT/i);
    expect(currentCommission()).toMatchObject({
      paymentStatus: "pending",
      paymentVerificationStatus: "failed",
    });
  });

  it("rejects official USDT sent to the wrong TRON recipient", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ recipientHex: "e".repeat(40) }))));

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false });
    expect(result.verification.notes).toMatch(/not to the Alpha Traders commission wallet/i);
    expect(currentCommission().paymentVerificationStatus).toBe("failed");
  });

  it.each([
    ["underpayment", BigInt(5_000_000)],
    ["overpayment", BigInt(5_000_002)],
  ])("rejects a TRON %s instead of crediting the wrong commission", async (_label, amountMicros) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ amountMicros }))));

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false });
    expect(result.verification.notes).toMatch(/requires exactly 5\.000001 USDT/i);
    expect(currentCommission()).toMatchObject({
      paymentStatus: "pending",
      paymentVerificationStatus: "failed",
    });
  });

  it("rejects a solidified transfer that predates the commission payment window", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({
      blockTimeStamp: Date.now() - (25 * 60 * 60 * 1000),
    }))));

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false });
    expect(result.verification.notes).toMatch(/predates this commission payment request/i);
    expect(currentCommission().paymentVerificationStatus).toBe("failed");
  });

  it("treats a non-solidified TRON transaction as pending instead of paid", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      if (String(request).includes("walletsolidity")) return jsonResponse({});
      return jsonResponse({ txID: VERIFIED_TRON_TX_A });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false, pending: true });
    expect(result.verification.notes).toMatch(/waiting for final confirmation/i);
    expect(currentCommission()).toMatchObject({
      paymentStatus: "pending",
      paymentVerificationStatus: "pending_verification",
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("queues a just-broadcast TxID that TRON has not indexed yet", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false, pending: true });
    expect(result.verification.notes).toMatch(/keep checking it automatically/i);
    expect(currentCommission().paymentVerificationStatus).toBe("pending_verification");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("automatically settles and unlocks a payment after TRON finality", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL) => (
      String(request).includes("walletsolidity")
        ? jsonResponse({})
        : jsonResponse({ txID: VERIFIED_TRON_TX_A })
    )));

    const submitted = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });
    const originalSubmittedAt = submitted.commission.paymentSubmittedAt;
    expect(submitted.verification).toMatchObject({ verified: false, pending: true });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt())));
    await expect(reverifyPendingCommissionPayments({ limit: 4 })).resolves.toEqual({
      checked: 1,
      verified: 1,
      stillPending: 0,
      failed: 0,
      errors: 0,
    });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: originalSubmittedAt,
    });
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.purchaseRequests[0]?.timeline.filter((entry) => entry.type === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission payment verified")).toHaveLength(1);
    expect(snapshot.notifications.find((notification) => notification.title === "Commission payment verified")?.message)
      .toMatch(/commission-related restrictions have been cleared/i);
    expect(snapshot.notifications.find((notification) => notification.title === "Commission payment verified")?.message)
      .not.toMatch(/fully unlocked/i);
  });

  it("grandfathers an already-submitted pre-cutover payment without changing its base amount", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date().toISOString(),
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ amountMicros: BigInt(5_250_000) }))));

    await expect(reverifyPendingCommissionPayments({ limit: 1 })).resolves.toMatchObject({ verified: 1 });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentExpectedAmount: 5,
      paymentExpectedAmountMode: "legacy_base",
      paymentVerificationStatus: "verified",
    });
  });

  it("binds a grandfathered base-amount payment to its originally submitted TxID", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date().toISOString(),
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const status = await getSellerCommissionStatus(SELLER_ID);
    expect(status.payableRecords[0]).toMatchObject({
      commissionId: COMMISSION_ID,
      paymentExpectedAmountMode: "legacy_base",
      paymentVerificationStatus: "pending_verification",
    });

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_B,
    })).rejects.toThrow(/originally submitted TxID/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentCommission()).toMatchObject({
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentExpectedAmount: 5,
      paymentExpectedAmountMode: "legacy_base",
    });
  });

  it("reissues a failed pre-upgrade payment as a new exact self-service intent", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: "The original TxID was not found.",
      paymentSubmittedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };

    const status = await getSellerCommissionStatus(SELLER_ID);

    expect(status.payableRecords[0]).toMatchObject({ paymentAmountDue: 5.000001 });
    expect(currentCommission()).toMatchObject({
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentVerificationStatus: "failed",
      paymentReservedExpectedAmounts: [5],
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ txId: VERIFIED_TRON_TX_B }))));
    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_B,
    })).resolves.toMatchObject({ verification: { verified: true } });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentSignature: VERIFIED_TRON_TX_B,
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
    });
  });

  it("does not grandfather an old non-TRC20 or non-canonical payment rail", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "ERC20",
      recipientWalletAddress: ERC20_WALLET,
      paymentSignature: `0x${"e".repeat(64)}`,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date().toISOString(),
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };

    await getSellerCommissionStatus(SELLER_ID);

    expect(currentCommission()).toMatchObject({
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: expect.stringMatching(/cannot be checked automatically/i),
      paymentReservedExpectedAmounts: [5],
    });
  });

  it("automatically reconciles a pre-upgrade verified-but-unpaid commission", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    const submittedAt = new Date(Date.now() - 60_000).toISOString();
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: submittedAt,
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Verified by the legacy admin flow.",
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };

    const status = await getSellerCommissionStatus(SELLER_ID);

    expect(status).toMatchObject({ status: "clear", pendingCount: 0 });
    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paidAt: submittedAt,
      paymentSignature: VERIFIED_TRON_TX_A,
    });
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.purchaseRequests[0]?.timeline.filter((entry) => entry.type === "commission_paid")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.find((notification) => notification.title === "Commission payment verified")?.message)
      .toMatch(/commission-related restrictions have been cleared/i);
  });

  it("does not auto-credit a verified-but-unpaid legacy row without blockchain proof", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentVerificationStatus: "verified",
      paymentSignature: undefined,
      paymentNetwork: undefined,
      recipientWalletAddress: undefined,
    };

    const status = await getSellerCommissionStatus(SELLER_ID);

    expect(status).toMatchObject({ status: "pending", pendingCount: 1 });
    expect(currentCommission()).toMatchObject({
      paymentStatus: "pending",
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: expect.stringMatching(/no complete blockchain payment proof/i),
      paymentExpectedAmountMode: "unique_v1",
    });
  });

  it("accepts a payment pasted more than 24 hours later when it follows the immutable intent time", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      createdAt: thirtyHoursAgo,
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: thirtyHoursAgo,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({
      blockTimeStamp: Date.now() - 25 * 60 * 60 * 1000,
    }))));

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification.verified).toBe(true);
    expect(currentCommission().paymentStatus).toBe("paid");
  });

  it("preserves a newer seller submission when an older automatic retry finishes late", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date().toISOString(),
    };

    let announceRpcStarted: (() => void) | undefined;
    let releaseRpc: (() => void) | undefined;
    const rpcStarted = new Promise<void>((resolve) => { announceRpcStarted = resolve; });
    const rpcRelease = new Promise<void>((resolve) => { releaseRpc = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      announceRpcStarted?.();
      await rpcRelease;
      return jsonResponse(tronReceipt({ txId: VERIFIED_TRON_TX_A }));
    }));

    const retry = reverifyPendingCommissionPayments({ limit: 1 });
    await rpcStarted;
    const latest = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    latest.commissionRecords[0] = {
      ...latest.commissionRecords[0],
      paymentSignature: VERIFIED_TRON_TX_B,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date(Date.now() + 1_000).toISOString(),
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    };
    Object.defineProperty(latest, "__runtimeVersion", {
      value: ((latest as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion ?? 0) + 1,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    releaseRpc?.();

    await expect(retry).resolves.toEqual({
      checked: 1,
      verified: 0,
      stillPending: 0,
      failed: 0,
      errors: 1,
    });
    expect(currentCommission()).toMatchObject({
      paymentSignature: VERIFIED_TRON_TX_B,
      paymentVerificationStatus: "pending_verification",
    });
  });

  it("rotates unchanged pending payments fairly without duplicating audit entries", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommission(db, "commission-2", "request-2", "listing-2");
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: "2026-09-10T08:00:00.000Z",
      updatedAt: "2026-09-10T08:00:00.000Z",
    };
    db.commissionRecords[1] = {
      ...db.commissionRecords[1],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_B,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: "2026-09-10T08:01:00.000Z",
      updatedAt: "2026-09-10T08:01:00.000Z",
    };
    const checkedTxIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const txId = String((JSON.parse(String(init?.body ?? "{}")) as { value?: string }).value ?? "");
      if (String(request).includes("walletsolidity")) checkedTxIds.push(txId);
      return String(request).includes("walletsolidity")
        ? jsonResponse({})
        : jsonResponse({ txID: txId });
    }));

    await reverifyPendingCommissionPayments({ limit: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await reverifyPendingCommissionPayments({ limit: 1 });

    expect(checkedTxIds).toEqual([VERIFIED_TRON_TX_A, VERIFIED_TRON_TX_B]);
    expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).auditLogs).toHaveLength(0);
  });

  it("turns an automatically detected terminal mismatch into a visible replace-TxID state", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: new Date().toISOString(),
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ amountMicros: BigInt(5_000_002) }))));

    await expect(reverifyPendingCommissionPayments({ limit: 1 })).resolves.toEqual({
      checked: 1,
      verified: 0,
      stillPending: 0,
      failed: 1,
      errors: 0,
    });

    const status = await getSellerCommissionStatus(SELLER_ID, globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb);
    expect(status.payableRecords[0]).toMatchObject({
      commissionId: COMMISSION_ID,
      paymentVerificationStatus: "failed",
      paymentSignature: VERIFIED_TRON_TX_A,
    });
    expect(status.payableRecords[0]?.paymentVerificationNotes).toMatch(/amount mismatch/i);
    const notification = (globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).notifications
      .find((item) => item.title === "Commission payment needs attention");
    expect(notification).toMatchObject({
      actionLabel: "Replace TxID",
      actionHref: commissionPaymentDestination(COMMISSION_ID),
      relatedHref: commissionPaymentDestination(COMMISSION_ID),
    });
  });

  it("stops retrying a nonexistent TxID after the bounded automatic lookup window", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: eightHoursAgo,
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: sevenHoursAgo,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));

    await expect(reverifyPendingCommissionPayments({ limit: 1 })).resolves.toMatchObject({
      checked: 1,
      stillPending: 0,
      failed: 1,
    });
    expect(currentCommission().paymentVerificationStatus).toBe("failed");
    expect(currentCommission().paymentVerificationNotes).toMatch(/not found on TRON after repeated checks/i);
  });

  it("does not claim the seller is fully unlocked while another commission remains", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    addCommission(db, "commission-2", "request-2", "listing-2");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt())));

    await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    const notification = (globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).notifications
      .find((item) => item.title === "Commission payment verified");
    expect(notification?.message).toMatch(/1 other commission payment remains due/i);
    expect(notification?.message).not.toMatch(/fully unlocked/i);
    expect(notification?.actionHref).toBe(commissionPaymentDestination("commission-2"));
    expect(notification?.relatedHref).toBe(commissionPaymentDestination("commission-2"));
    expect(notification?.actionLabel).toBe("Pay Commission");
  });

  it("does not accept a prefixed case-variant TRON TxID twice", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommission(db, "commission-already-paid", "request-paid", "listing-paid");
    db.commissionRecords[1] = {
      ...db.commissionRecords[1],
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentNetwork: "TRC20",
      paymentSignature: `0x${VERIFIED_TRON_TX_A.toUpperCase()}`,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });

    expect(result.verification).toMatchObject({ verified: false });
    expect(result.verification.notes).toMatch(/already been used/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ERC20", "POLYGON", "SOL", "BEP20"])("rejects the legacy %s rail before mutating a new payment", async (network) => {
    const original = structuredClone(currentCommission());

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network,
      payerWalletAddress: "",
      paymentSignature: "too-short",
    })).rejects.toThrow(/must use USDT on TRON \(TRC20\)/i);

    expect(currentCommission()).toEqual(original);
  });

  it("rejects a direct attempt to settle another seller's commission without mutation", async () => {
    const original = structuredClone(currentCommission());

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: "another-seller",
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: "too-short",
    })).rejects.toThrow(/only settle your own commission/i);

    expect(currentCommission()).toEqual(original);
  });

  it("does not let an admin reverify a case-variant EVM hash already used by another commission", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const existingHash = `0x${"b".repeat(64)}`;
    addCommission(db, "commission-already-paid", "request-paid", "listing-paid");
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "ERC20",
      paymentSignature: `0x${"B".repeat(64)}`,
      payerWalletAddress: ERC20_WALLET,
      recipientWalletAddress: ERC20_WALLET,
      paymentVerificationStatus: "failed",
    };
    db.commissionRecords[1] = {
      ...db.commissionRecords[1],
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentSignature: existingHash,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverifyCommissionByAdmin({
      commissionId: COMMISSION_ID,
      actorUserId: "admin-1",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ verified: false });
    expect(currentCommission().paymentVerificationNotes).toMatch(/already been used/i);
  });

  it("keeps an admin TRON reverification pending when the blockchain lookup is transient", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: new Date().toISOString(),
      paymentVerificationStatus: "pending_verification",
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));

    const result = await reverifyCommissionByAdmin({
      commissionId: COMMISSION_ID,
      actorUserId: "admin-1",
    });

    expect(result).toMatchObject({ verified: false, pending: true });
    expect(currentCommission().paymentVerificationStatus).toBe("pending_verification");
  });

  it("settles and unlocks an unpaid commission when admin reverification confirms it on-chain", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: new Date().toISOString(),
      paymentVerificationStatus: "pending_verification",
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt())));

    await expect(reverifyCommissionByAdmin({
      commissionId: COMMISSION_ID,
      actorUserId: "admin-1",
    })).resolves.toMatchObject({ verified: true });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paidAt: expect.any(String),
    });
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.purchaseRequests[0]?.timeline.filter((entry) => entry.type === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.find((notification) => notification.title === "Commission payment verified")?.message)
      .toMatch(/commission-related restrictions have been cleared/i);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
  });

  it("never downgrades or frees the TxID of an already-paid commission after an inconclusive admin recheck", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentStatus: "paid",
      paidAt: new Date().toISOString(),
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: new Date().toISOString(),
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Previously verified on-chain.",
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));

    await expect(reverifyCommissionByAdmin({
      commissionId: COMMISSION_ID,
      actorUserId: "admin-1",
    })).resolves.toMatchObject({ verified: false, pending: true });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Previously verified on-chain.",
      paymentSignature: VERIFIED_TRON_TX_A,
    });
  });

  it("can reverify a paid legacy TRC20 record without an exact-amount assignment", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentStatus: "paid",
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: new Date().toISOString(),
      paymentVerificationStatus: "verified",
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronReceipt({ amountMicros: BigInt(5_000_000) }))));

    await expect(reverifyCommissionByAdmin({
      commissionId: COMMISSION_ID,
      actorUserId: "admin-1",
    })).resolves.toMatchObject({ verified: true });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
    });
  });

  it("does not let stale admin reverification overwrite newer payment details", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentNetwork: "TRC20",
      recipientWalletAddress: TRC20_WALLET,
      paymentSignature: VERIFIED_TRON_TX_A,
      paymentSubmittedAt: new Date().toISOString(),
      paymentVerificationStatus: "pending_verification",
    };
    let announceLookup: (() => void) | undefined;
    let releaseLookup: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => { announceLookup = resolve; });
    const lookupRelease = new Promise<void>((resolve) => { releaseLookup = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      announceLookup?.();
      await lookupRelease;
      return jsonResponse(tronReceipt({ txId: VERIFIED_TRON_TX_A, amountMicros: BigInt(5_000_000) }));
    }));

    const reverification = reverifyCommissionByAdmin({
      commissionId: COMMISSION_ID,
      actorUserId: "admin-1",
    });
    await lookupStarted;
    const latest = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    latest.commissionRecords[0] = {
      ...latest.commissionRecords[0],
      paymentSignature: VERIFIED_TRON_TX_B,
      paymentVerificationStatus: "pending_verification",
      paymentSubmittedAt: new Date(Date.now() + 1_000).toISOString(),
    };
    Object.defineProperty(latest, "__runtimeVersion", {
      value: ((latest as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion ?? 0) + 1,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    releaseLookup?.();

    await expect(reverification).rejects.toThrow(/newer state was preserved/i);
    expect(currentCommission().paymentSignature).toBe(VERIFIED_TRON_TX_B);
  });

  it("returns one exact owned payable commission while retaining the total outstanding balance", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const now = new Date().toISOString();
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      commissionAmount: 5,
      dueAt: "2026-08-20T00:00:00.000Z",
    };
    db.commissionRecords.push({
      ...db.commissionRecords[0],
      id: "commission-2",
      purchaseRequestId: "request-2",
      commissionAmount: 3,
      dueAt: "2026-08-21T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    });
    db.commissionRecords.push({
      ...db.commissionRecords[0],
      id: "commission-foreign",
      sellerId: "another-seller",
      purchaseRequestId: "request-foreign",
      commissionAmount: 99,
      dueAt: "2026-08-19T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    });
    db.commissionRecords.push({
      ...db.commissionRecords[0],
      id: "commission-settled",
      paymentStatus: "paid",
      purchaseRequestId: "request-settled",
      commissionAmount: 7,
      createdAt: now,
      updatedAt: now,
    });

    const selected = await getSellerCommissionStatus(SELLER_ID, db, { commissionId: "commission-2" });

    expect(selected).toMatchObject({
      commissionId: "commission-2",
      payableAmountDue: 3.000001,
      totalAmountDue: 8,
      amountDue: 8,
      pendingCount: 2,
    });
    expect(selected.payableRecords).toEqual([
      expect.objectContaining({ commissionId: COMMISSION_ID, amountDue: 5, paymentAmountDue: 5.000001 }),
      expect.objectContaining({ commissionId: "commission-2", amountDue: 3, paymentAmountDue: 3.000001 }),
    ]);

    const invalid = await getSellerCommissionStatus(SELLER_ID, db, { commissionId: "not-owned-or-settled" });
    expect(invalid.commissionId).toBeUndefined();
    expect(invalid.payableAmountDue).toBe(0);
    expect(invalid.selectionError).toMatch(/not available/i);
  });

  it("never reuses an exact amount that was assigned to a paid commission", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentStatus: "paid",
      paymentExpectedAmount: 5.000001,
      paymentVerificationStatus: "verified",
      paymentSignature: VERIFIED_TRON_TX_A,
    };
    addCommission(db, "commission-2", "request-2", "listing-2");
    db.commissionRecords[1] = {
      ...db.commissionRecords[1],
      paymentStatus: "pending",
      paymentExpectedAmount: undefined,
      paymentVerificationStatus: undefined,
      paymentSignature: undefined,
    };

    const selected = await getSellerCommissionStatus(SELLER_ID, db, { commissionId: "commission-2" });

    expect(selected.payableAmountDue).toBe(5.000002);
    expect(selected.payableRecords).toEqual([
      expect.objectContaining({ commissionId: "commission-2", paymentAmountDue: 5.000002 }),
    ]);
    expect(db.commissionRecords[0]?.paymentExpectedAmount).toBe(5.000001);
  });

  it("never reuses an exact amount that was superseded by a replacement intent", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentReservedExpectedAmounts: [5.000001],
      paymentExpectedAmount: undefined,
      paymentExpectedAmountMode: undefined,
      paymentExpectedAmountAssignedAt: undefined,
    };

    const selected = await getSellerCommissionStatus(SELLER_ID, db);

    expect(selected.payableAmountDue).toBe(5.000002);
    expect(currentCommission()).toMatchObject({
      paymentExpectedAmount: 5.000002,
      paymentReservedExpectedAmounts: [5.000001],
    });
  });

  it("fails closed instead of silently changing two already-issued duplicate amounts", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: new Date().toISOString(),
    };
    addCommission(db, "commission-2", "request-2", "listing-2");
    db.commissionRecords[1] = {
      ...db.commissionRecords[1],
      paymentExpectedAmount: 5.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: new Date().toISOString(),
    };

    await expect(getSellerCommissionStatus(SELLER_ID, db)).rejects.toThrow(/amount collision/i);
    expect(db.commissionRecords.map((record) => record.paymentExpectedAmount)).toEqual([5.000001, 5.000001]);
  });

  it("keeps commission-payment notifications record-specific and preserves nonparticipant admin destinations", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const now = new Date().toISOString();
    const ownerId = "commission-owner";
    db.users.push({
      ...db.users[0],
      id: ownerId,
      fullName: "Commission Owner",
      email: "commission-owner@example.test",
      role: "owner",
      roles: ["owner", "admin"],
      sellerStatus: "buyer",
      createdAt: now,
      updatedAt: now,
    });
    db.purchaseRequests.push({
      id: "request-1",
      tradeId: "trade-1",
      listingId: "listing-1",
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      buyerName: "Commission Buyer",
      buyerWhatsapp: "",
      usdtAmount: "500",
      fiatAmount: "1500",
      currency: "ILS",
      network: "ERC20",
      paymentMethod: "Bank Transfer",
      timeline: [],
      status: "review_open",
      createdAt: now,
      updatedAt: now,
    } as AlphaExchangeDb["purchaseRequests"][number]);
    db.notifications.push(
      {
        id: "seller-commission-due",
        userId: SELLER_ID,
        category: "trade",
        title: "Commission overdue",
        message: "Commission for trade request-1 is overdue and requires payment.",
        relatedRequestId: "request-1",
        relatedTradeId: "trade-1",
        relatedHref: "/usdt-exchange",
        isRead: false,
        state: "unread",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "owner-commission-review",
        userId: ownerId,
        category: "trade",
        title: "Commission overdue",
        message: "Review the seller commission.",
        relatedRequestId: "request-1",
        relatedTradeId: "trade-1",
        relatedHref: "/admin/alpha-exchange?section=commissions&commissionId=commission-1",
        actionHref: "/admin/alpha-exchange?section=commissions&commissionId=commission-1",
        actionLabel: "Review Commission",
        isRead: false,
        state: "unread",
        createdAt: now,
        updatedAt: now,
      },
    );

    const sellerNotification = (await getNotificationsForUser({ userId: SELLER_ID, includeActivity: false })).notifications[0];
    expect(sellerNotification.actionHref).toBe(commissionPaymentDestination(COMMISSION_ID));
    expect(getCommissionPaymentNotificationDestination(sellerNotification)).toBe(commissionPaymentDestination(COMMISSION_ID));
    expect(sellerNotification.actionLabel).toBe("Pay Commission");

    const ownerNotification = (await getNotificationsForUser({ userId: ownerId, includeActivity: false })).notifications[0];
    expect(ownerNotification.actionHref).toBe("/admin/alpha-exchange?section=commissions&commissionId=commission-1");
    expect(ownerNotification.relatedHref).toBe("/admin/alpha-exchange?section=commissions&commissionId=commission-1");
    expect(ownerNotification.tradeSnapshot).toBeUndefined();
  });

  it("commits one verified settlement when duplicate submissions race", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    mockVerifiedTronPayments(2);

    const attempts = await Promise.allSettled([
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "TRC20",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_TRON_TX_A,
      }),
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "TRC20",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_TRON_TX_A,
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.filter((record) => record.paymentStatus === "paid")).toHaveLength(1);
    expect(snapshot.purchaseRequests[0]?.timeline.filter((entry) => entry.type === "commission_paid")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission payment verified")).toHaveLength(1);
  });

  it("does not let a slow older TxID overwrite a newer pending seller submission", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    let announceOldLookup: (() => void) | undefined;
    let releaseOldLookup: (() => void) | undefined;
    const oldLookupStarted = new Promise<void>((resolve) => { announceOldLookup = resolve; });
    const oldLookupRelease = new Promise<void>((resolve) => { releaseOldLookup = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const txId = String((JSON.parse(String(init?.body ?? "{}")) as { value?: string }).value ?? "");
      const isSolidifiedLookup = String(request).includes("walletsolidity");
      if (txId === VERIFIED_TRON_TX_A && isSolidifiedLookup) {
        announceOldLookup?.();
        await oldLookupRelease;
        return jsonResponse(tronReceipt({ txId: VERIFIED_TRON_TX_A }));
      }
      if (txId === VERIFIED_TRON_TX_B) {
        return isSolidifiedLookup
          ? jsonResponse({})
          : jsonResponse({ txID: VERIFIED_TRON_TX_B });
      }
      throw new Error(`Unexpected TRON lookup for ${txId}`);
    }));

    const oldSubmission = submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_A,
    });
    await oldLookupStarted;

    const newerSubmission = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: VERIFIED_TRON_TX_B,
    });
    expect(newerSubmission.verification).toMatchObject({ verified: false, pending: true });
    releaseOldLookup?.();

    await expect(oldSubmission).rejects.toThrow(/newer submission was preserved/i);
    expect(currentCommission()).toMatchObject({
      paymentSignature: VERIFIED_TRON_TX_B,
      paymentVerificationStatus: "pending_verification",
    });
  });

  it("confirms a manual settlement, clears stale failure notes, unlocks listings, and emails the seller", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    db.users[0] = { ...db.users[0]!, preferredLocale: "en" };
    db.commissionRecords[0] = {
      ...db.commissionRecords[0],
      displayNumber: 10,
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: "The payment timestamp preceded the commission intent.",
    };
    const settlementReason = `Owner verified receipt of 5.00 USDT on TRON. TxID: ${VERIFIED_TRON_TX_A}`;
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Traders <noreply@alphatraders.co.il>");
    const emailFetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      void request;
      void init;
      return { ok: true, status: 200 } as Response;
    });
    vi.stubGlobal("fetch", emailFetch);

    await updateCommissionPaymentStatus({
      commissionId: COMMISSION_ID,
      actorUserId: "owner-1",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      reason: settlementReason,
    });

    expect(currentCommission()).toMatchObject({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: settlementReason,
    });
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.notifications).toContainEqual(expect.objectContaining({
      userId: SELLER_ID,
      title: "Commission marked paid",
      message: expect.stringMatching(/create, manage, and publish listings again/i),
      actionHref: "/dashboard/seller#my-listings-section",
      actionLabel: "Continue Managing Listings",
    }));
    await expect(getSellerListingWorkspaceData({ sellerId: SELLER_ID, status: "all" }))
      .resolves.toMatchObject({
        summary: { pendingCommissionCount: 0, canCreateListing: true },
        commissionStatus: { status: "clear", pendingCount: 0 },
      });
    expect(listMarketplaceEmailAttempts()).toContainEqual(expect.objectContaining({
      event: "commission_paid",
      to: "commission-seller@example.test",
      referenceLabel: "#CM-000010",
    }));
    expect(emailFetch).toHaveBeenCalledOnce();
    const emailRequest = emailFetch.mock.calls[0]?.[1] as RequestInit;
    const emailBody = JSON.parse(String(emailRequest.body)) as { to: string[]; subject: string; text: string };
    expect(emailBody.to).toEqual(["commission-seller@example.test"]);
    expect(emailBody.subject).toMatch(/Commission Payment Confirmed/);
    expect(emailBody.text).toMatch(/create, manage, and publish listings again/i);
  });

  it("commits simultaneous identical admin-paid updates exactly once", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");

    const update = () => updateCommissionPaymentStatus({
      commissionId: COMMISSION_ID,
      actorUserId: "owner-1",
      paymentStatus: "paid",
      reason: "Owner verified the commission payment.",
    });
    const results = await Promise.all([update(), update()]);

    expect(results.every((record) => record.paymentStatus === "paid")).toBe(true);
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.filter((record) => record.paymentStatus === "paid")).toHaveLength(1);
    expect(snapshot.purchaseRequests[0]?.timeline.filter((entry) => entry.type === "commission_paid")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission marked paid")).toHaveLength(1);
    expect(listMarketplaceEmailAttempts().filter((attempt) => attempt.event === "commission_paid")).toHaveLength(1);
  });

  it("preserves simultaneous admin-paid updates to different commissions", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    addCommissionRequest(db, "request-2", "listing-2");
    addCommission(db, "commission-2", "request-2", "listing-2");

    await Promise.all([
      updateCommissionPaymentStatus({
        commissionId: COMMISSION_ID,
        actorUserId: "owner-1",
        paymentStatus: "paid",
        reason: "Owner verified the first commission.",
      }),
      updateCommissionPaymentStatus({
        commissionId: "commission-2",
        actorUserId: "owner-1",
        paymentStatus: "paid",
        reason: "Owner verified the second commission.",
      }),
    ]);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.filter((record) => record.paymentStatus === "paid")).toHaveLength(2);
    expect(snapshot.purchaseRequests.every((request) => request.timeline.filter((entry) => entry.type === "commission_paid").length === 1)).toBe(true);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(2);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission marked paid")).toHaveLength(2);
  });

  it("never lets a stale overdue update overwrite a concurrently paid commission", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");

    await Promise.allSettled([
      updateCommissionPaymentStatus({
        commissionId: COMMISSION_ID,
        actorUserId: "owner-1",
        paymentStatus: "paid",
        reason: "Owner verified the commission payment.",
      }),
      updateCommissionPaymentStatus({
        commissionId: COMMISSION_ID,
        actorUserId: "owner-1",
        paymentStatus: "overdue",
        reason: "Owner marked the commission overdue.",
      }),
    ]);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords[0]?.paymentStatus).toBe("paid");
    expect(snapshot.purchaseRequests[0]?.timeline.filter((entry) => entry.type === "commission_paid")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission marked paid")).toHaveLength(1);
  });

  it("preserves two distinct verified settlements that race from stale snapshots", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    addCommissionRequest(db, "request-2", "listing-2");
    addCommission(db, "commission-2", "request-2", "listing-2");
    mockVerifiedTronPayments(2);

    await expect(Promise.all([
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "TRC20",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_TRON_TX_A,
      }),
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: "commission-2",
        network: "TRC20",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_TRON_TX_B,
      }),
    ])).resolves.toHaveLength(2);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.filter((record) => record.paymentStatus === "paid")).toHaveLength(2);
    expect(snapshot.purchaseRequests.every((request) => request.timeline.some((entry) => entry.type === "commission_paid"))).toBe(true);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(2);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission payment verified")).toHaveLength(2);
  });

  it("credits only the exact matching commission when a signature is raced across commissions", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    addCommissionRequest(db, "request-2", "listing-2");
    addCommission(db, "commission-2", "request-2", "listing-2");
    mockVerifiedTronPayments(2);

    const attempts = await Promise.allSettled([
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "TRC20",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_TRON_TX_A,
      }),
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: "commission-2",
        network: "TRC20",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_TRON_TX_A,
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((attempt) => (
      attempt.status === "fulfilled" && attempt.value.verification.verified
    ))).toHaveLength(1);
    expect(attempts.filter((attempt) => (
      attempt.status === "fulfilled" && !attempt.value.verification.verified
    ))).toHaveLength(1);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.filter((record) => record.paymentStatus === "paid")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission payment verified")).toHaveLength(1);
  });
});
