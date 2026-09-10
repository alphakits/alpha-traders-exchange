import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  getNotificationsForUser,
  getSellerCommissionStatus,
  invalidateAlphaExchangeStoreCache,
  reverifyPendingCommissionPayments,
  reverifyCommissionByAdmin,
  submitSellerCommissionWalletPayment,
  updateCommissionPaymentStatus,
} from "@/lib/alpha-exchange-store";
import { commissionPaymentDestination, getCommissionPaymentNotificationDestination } from "@/lib/commission-payment-destination";

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

function tronReceipt(input?: { txId?: string; contractHex?: string; recipientHex?: string; amountMicros?: bigint }) {
  const txId = input?.txId ?? VERIFIED_TRON_TX_A;
  const contractHex = input?.contractHex ?? TRON_USDT_CONTRACT_HEX;
  const recipientHex = input?.recipientHex ?? TRC20_WALLET_HEX;
  const amountMicros = input?.amountMicros ?? BigInt(5_000_000);
  return {
    id: txId,
    blockNumber: 86_000_000,
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
    return jsonResponse(tronReceipt({ txId: payload.value }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("commission wallet payment routing", () => {
  beforeEach(() => {
    clearCommissionWalletEnvironment();
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
      payableAmountDue: 3,
      totalAmountDue: 8,
      amountDue: 8,
      pendingCount: 2,
    });
    expect(selected.payableRecords).toEqual([
      expect.objectContaining({ commissionId: COMMISSION_ID, amountDue: 5 }),
      expect.objectContaining({ commissionId: "commission-2", amountDue: 3 }),
    ]);

    const invalid = await getSellerCommissionStatus(SELLER_ID, db, { commissionId: "not-owned-or-settled" });
    expect(invalid.commissionId).toBeUndefined();
    expect(invalid.payableAmountDue).toBe(0);
    expect(invalid.selectionError).toMatch(/not available/i);
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

  it("permits only one verified settlement when a signature is raced across commissions", async () => {
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

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);

    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.filter((record) => record.paymentStatus === "paid")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
    expect(snapshot.notifications.filter((notification) => notification.title === "Commission payment verified")).toHaveLength(1);
  });
});
