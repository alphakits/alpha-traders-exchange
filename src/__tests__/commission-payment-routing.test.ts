import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  getNotificationsForUser,
  getSellerCommissionStatus,
  invalidateAlphaExchangeStoreCache,
  reverifyCommissionByAdmin,
  submitSellerCommissionWalletPayment,
} from "@/lib/alpha-exchange-store";
import { commissionPaymentDestination, getCommissionPaymentNotificationDestination } from "@/lib/commission-payment-destination";

const SELLER_ID = "commission-seller";
const BUYER_ID = "commission-buyer";
const COMMISSION_ID = "commission-1";
const ERC20_WALLET = "0x1111111111111111111111111111111111111111";
const POLYGON_WALLET = "0x2222222222222222222222222222222222222222";
const SOL_WALLET = "11111111111111111111111111111111";
const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const VERIFIED_SOL_SIGNATURE_A = "3".repeat(44);
const VERIFIED_SOL_SIGNATURE_B = "4".repeat(44);

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: SELLER_ID,
        fullName: "Commission Seller",
        email: "commission-seller@example.test",
        passwordHash: "hash",
        whatsappNumber: "+972500000000",
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
    "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20",
    "ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20",
    "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON",
    "ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON",
    "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL",
    "ALPHA_EXCHANGE_COMMISSION_WALLET_SOL",
    "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS",
    "ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS",
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
    network: "SOL",
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

function mockVerifiedSolanaPayments(expectedStatusRequests: number) {
  let statusRequests = 0;
  let releaseStatusBarrier: (() => void) | undefined;
  const statusBarrier = new Promise<void>((resolve) => {
    releaseStatusBarrier = resolve;
  });
  const jsonResponse = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }) as Response;

  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (payload.method === "getSignatureStatuses") {
      statusRequests += 1;
      if (statusRequests === expectedStatusRequests) releaseStatusBarrier?.();
      await statusBarrier;
      return jsonResponse({ result: { value: [{ confirmationStatus: "finalized", err: null }] } });
    }
    if (payload.method === "getTransaction") {
      return jsonResponse({
        result: {
          meta: {
            err: null,
            preTokenBalances: [{
              accountIndex: 1,
              mint: SOLANA_USDT_MINT,
              owner: SOL_WALLET,
              uiTokenAmount: { uiAmount: 0 },
            }],
            postTokenBalances: [{
              accountIndex: 1,
              mint: SOLANA_USDT_MINT,
              owner: SOL_WALLET,
              uiTokenAmount: { uiAmount: 5 },
            }],
          },
        },
      });
    }
    throw new Error(`Unexpected Solana RPC method: ${payload.method ?? "unknown"}`);
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

  it.each([
    ["ERC20", "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20", ERC20_WALLET],
    ["POLYGON", "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON", POLYGON_WALLET],
    ["SOL", "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL", SOL_WALLET],
  ] as const)("records the selected %s rail with its matching canonical recipient", async (network, envKey, wallet) => {
    vi.stubEnv(envKey, wallet);

    await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network,
      payerWalletAddress: "",
      // A deliberately short hash prevents any real RPC call while preserving
      // the same record-write path used for an unverified submission.
      paymentSignature: "too-short",
    });

    expect(currentCommission()).toMatchObject({
      paymentNetwork: network,
      recipientWalletAddress: wallet,
      paymentSignature: "too-short",
      paymentVerificationStatus: "failed",
      paymentStatus: "pending",
    });
  });

  it("fails before record mutation when the selected network has no canonical destination", async () => {
    vi.stubEnv("NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS", "TLegacyGenericWalletAddress");
    vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_WALLET_SOL", SOL_WALLET);
    const original = structuredClone(currentCommission());

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "SOL",
      payerWalletAddress: "",
      paymentSignature: "too-short",
    })).rejects.toThrow(/No public commission wallet/i);

    expect(currentCommission()).toEqual(original);
  });

  it("fails before record mutation for a mismatched or unsupported network configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20", ERC20_WALLET);
    vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20", POLYGON_WALLET);
    const original = structuredClone(currentCommission());

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "ERC20",
      payerWalletAddress: "",
      paymentSignature: "too-short",
    })).rejects.toThrow(/inconsistent/i);
    expect(currentCommission()).toEqual(original);

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: "too-short",
    })).rejects.toThrow(/only on ERC20, Polygon, or Solana/i);
    expect(currentCommission()).toEqual(original);
  });

  it("rejects a direct attempt to settle another seller's commission without mutation", async () => {
    const original = structuredClone(currentCommission());

    await expect(submitSellerCommissionWalletPayment({
      sellerUserId: "another-seller",
      commissionId: COMMISSION_ID,
      network: "SOL",
      payerWalletAddress: "",
      paymentSignature: "too-short",
    })).rejects.toThrow(/only settle your own commission/i);

    expect(currentCommission()).toEqual(original);
  });

  it("does not accept an EVM hash with different checksum casing as a second commission payment", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const existingHash = `0x${"a".repeat(64)}`;
    addCommission(db, "commission-already-paid", "request-paid", "listing-paid");
    db.commissionRecords[1] = {
      ...db.commissionRecords[1],
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentSignature: existingHash,
    };
    vi.stubEnv("NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20", ERC20_WALLET);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: COMMISSION_ID,
      network: "ERC20",
      payerWalletAddress: "",
      paymentSignature: `0x${"A".repeat(64)}`,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentCommission()).toMatchObject({
      paymentStatus: "pending",
      paymentVerificationStatus: "failed",
    });
    expect(currentCommission().paymentVerificationNotes).toMatch(/already been used/i);
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
    vi.stubEnv("NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL", SOL_WALLET);
    mockVerifiedSolanaPayments(2);

    const attempts = await Promise.allSettled([
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "SOL",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_SOL_SIGNATURE_A,
      }),
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "SOL",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_SOL_SIGNATURE_A,
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

  it("preserves two distinct verified settlements that race from stale snapshots", async () => {
    const db = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    addCommissionRequest(db, "request-1", "listing-1");
    addCommissionRequest(db, "request-2", "listing-2");
    addCommission(db, "commission-2", "request-2", "listing-2");
    vi.stubEnv("NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL", SOL_WALLET);
    mockVerifiedSolanaPayments(2);

    await expect(Promise.all([
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "SOL",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_SOL_SIGNATURE_A,
      }),
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: "commission-2",
        network: "SOL",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_SOL_SIGNATURE_B,
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
    vi.stubEnv("NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL", SOL_WALLET);
    mockVerifiedSolanaPayments(2);

    const attempts = await Promise.allSettled([
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: COMMISSION_ID,
        network: "SOL",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_SOL_SIGNATURE_A,
      }),
      submitSellerCommissionWalletPayment({
        sellerUserId: SELLER_ID,
        commissionId: "commission-2",
        network: "SOL",
        payerWalletAddress: "",
        paymentSignature: VERIFIED_SOL_SIGNATURE_A,
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
