import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  publishRealtimeEvent: vi.fn(),
}));

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));
vi.mock("@/lib/realtime", () => ({
  publishRealtimeEvent: mocks.publishRealtimeEvent,
}));

import {
  getSellerCommissionStatus,
  getSellerListingWorkspaceSummary,
  invalidateAlphaExchangeStoreCache,
  issueSellerCommissionByAdmin,
  submitSellerCommissionWalletPayment,
  updateCommissionPaymentStatus,
} from "@/lib/alpha-exchange-store";
import { commissionPaymentDestination } from "@/lib/commission-payment-destination";

const SELLER_ID = "manual-commission-seller";
const OWNER_ID = "manual-commission-owner";
const TRON_TX_ID = "a".repeat(64);
const TRON_USDT_CONTRACT_HEX = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const TRON_COMMISSION_WALLET_HEX = "7b662c86c643c01397eff6568df2e4ebc17f779b";
const TRON_TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function user(id: string, role: "owner" | "approved_seller"): AlphaExchangeUser {
  const now = new Date().toISOString();
  return {
    id,
    fullName: role === "owner" ? "Owner" : "Manual Commission Seller",
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "owner" ? ["owner", "admin"] : ["approved_seller"],
    sellerStatus: role === "owner" ? "buyer" : "approved_seller",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
  } as AlphaExchangeUser;
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [user(SELLER_ID, "approved_seller"), user(OWNER_ID, "owner")],
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

function currentSnapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
}

describe("manual seller commission assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateAlphaExchangeStoreCache();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  });

  it("creates a payable exact-amount TRC20 commission without fake trade linkage", async () => {
    const commission = await issueSellerCommissionByAdmin({
      sellerId: SELLER_ID,
      actorUserId: OWNER_ID,
      commissionAmount: 7.25,
      reason: "Manual adjustment approved by operations.",
    });

    expect(commission).toMatchObject({
      source: "admin_manual",
      sellerId: SELLER_ID,
      issuedByUserId: OWNER_ID,
      issueReason: "Manual adjustment approved by operations.",
      commissionAmount: 7.25,
      paymentStatus: "pending",
      paymentExpectedAmount: 7.250001,
      paymentExpectedAmountMode: "unique_v1",
    });
    expect(commission.purchaseRequestId).toBeUndefined();
    expect(commission.listingId).toBeUndefined();
    expect(commission.buyerId).toBeUndefined();

    const status = await getSellerCommissionStatus(SELLER_ID);
    expect(status).toMatchObject({
      status: "pending",
      pendingCount: 1,
      amountDue: 7.25,
      payableAmountDue: 7.250001,
      commissionId: commission.id,
      source: "admin_manual",
      issueReason: "Manual adjustment approved by operations.",
      payableRecords: [expect.objectContaining({
        commissionId: commission.id,
        source: "admin_manual",
        issueReason: "Manual adjustment approved by operations.",
        amountDue: 7.25,
        paymentAmountDue: 7.250001,
        relatedRequestId: undefined,
      })],
    });

    const workspace = await getSellerListingWorkspaceSummary(SELLER_ID, currentSnapshot());
    expect(workspace).toMatchObject({ pendingCommissionCount: 1, canCreateListing: false });

    expect(currentSnapshot().notifications).toContainEqual(expect.objectContaining({
      userId: SELLER_ID,
      title: "Commission payment required",
      reason: "commission_payment_due",
      actionHref: commissionPaymentDestination(commission.id),
      relatedHref: commissionPaymentDestination(commission.id),
    }));
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "notification.created",
      payload: {
        notification: expect.objectContaining({
          userId: SELLER_ID,
          actionHref: commissionPaymentDestination(commission.id),
        }),
      },
    }));
    expect(currentSnapshot().auditLogs).toContainEqual(expect.objectContaining({
      action: "commission_recorded",
      actorUserId: OWNER_ID,
      targetUserId: SELLER_ID,
      listingId: undefined,
      purchaseRequestId: undefined,
    }));
  });

  it("allocates distinct payment amounts to simultaneous manual assignments", async () => {
    const [first, second] = await Promise.all([
      issueSellerCommissionByAdmin({
        sellerId: SELLER_ID,
        actorUserId: OWNER_ID,
        commissionAmount: 5,
        reason: "First manual commission.",
      }),
      issueSellerCommissionByAdmin({
        sellerId: SELLER_ID,
        actorUserId: OWNER_ID,
        commissionAmount: 5,
        reason: "Second manual commission.",
      }),
    ]);

    expect(new Set([first.paymentExpectedAmount, second.paymentExpectedAmount])).toEqual(new Set([5.000001, 5.000002]));
    const status = await getSellerCommissionStatus(SELLER_ID);
    expect(status.pendingCount).toBe(2);
    expect(status.payableRecords).toHaveLength(2);
    expect(currentSnapshot().notifications.filter((notification) => (
      notification.reason === "commission_payment_due"
    ))).toHaveLength(2);
  });

  it("publishes the seller notification once when a canonical rebase closure is replayed", async () => {
    const canonical = seedDb();
    const repository = {
      loadSnapshot: vi.fn(async () => structuredClone(canonical)),
      savePurchaseRequestCreationSnapshotTargeted: vi.fn(),
      saveSnapshot: vi.fn(async (
        incoming: AlphaExchangeDb,
        options?: { rebaseOnLatest?: (snapshot: AlphaExchangeDb) => AlphaExchangeDb | Promise<AlphaExchangeDb> },
      ) => {
        if (!options?.rebaseOnLatest) throw new Error("Expected a canonical rebase callback.");
        let persisted = await options.rebaseOnLatest(structuredClone(canonical));
        // Simulate a repository retry after the first canonical application.
        persisted = await options.rebaseOnLatest(structuredClone(persisted));
        Object.assign(incoming, persisted);
        globalThis.__alphaExchangeMemorySnapshot = persisted as never;
      }),
    };
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository) as never;
    invalidateAlphaExchangeStoreCache();

    const commission = await issueSellerCommissionByAdmin({
      sellerId: SELLER_ID,
      actorUserId: OWNER_ID,
      commissionAmount: 6,
      reason: "Repository replay test.",
    });

    expect(repository.saveSnapshot).toHaveBeenCalledOnce();
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledTimes(1);
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "notification.created",
      payload: { notification: expect.objectContaining({
        actionHref: commissionPaymentDestination(commission.id),
      }) },
    }));
  });

  it("clears the seller lock when the manual commission is settled", async () => {
    const commission = await issueSellerCommissionByAdmin({
      sellerId: SELLER_ID,
      actorUserId: OWNER_ID,
      commissionAmount: 3,
      reason: "Manual commission settlement test.",
    });

    await updateCommissionPaymentStatus({
      commissionId: commission.id,
      actorUserId: OWNER_ID,
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      reason: "Verified by owner.",
    });

    const status = await getSellerCommissionStatus(SELLER_ID);
    expect(status).toMatchObject({ status: "clear", pendingCount: 0, payableRecords: [] });
    const workspace = await getSellerListingWorkspaceSummary(SELLER_ID, currentSnapshot());
    expect(workspace).toMatchObject({ pendingCommissionCount: 0, canCreateListing: true });
  });

  it("verifies official USDT on TRON and unlocks a trade-less manual commission", async () => {
    const commission = await issueSellerCommissionByAdmin({
      sellerId: SELLER_ID,
      actorUserId: OWNER_ID,
      commissionAmount: 4.2,
      reason: "On-chain manual commission settlement test.",
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: TRON_TX_ID,
        blockNumber: 86_000_000,
        blockTimeStamp: Date.now(),
        receipt: { result: "SUCCESS" },
        log: [{
          address: TRON_USDT_CONTRACT_HEX,
          topics: [
            TRON_TRANSFER_TOPIC,
            "1".repeat(64),
            TRON_COMMISSION_WALLET_HEX.padStart(64, "0"),
          ],
          data: BigInt(4_200_001).toString(16).padStart(64, "0"),
        }],
      }),
    }) as Response));

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: SELLER_ID,
      commissionId: commission.id,
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: TRON_TX_ID,
    });

    expect(result.verification).toMatchObject({ verified: true, reference: TRON_TX_ID });
    expect(result.commission).toMatchObject({
      source: "admin_manual",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentExpectedAmount: 4.200001,
    });
    expect(result.commission).not.toHaveProperty("purchaseRequestId");
    expect(result.commission).not.toHaveProperty("listingId");
    expect(result.commission).not.toHaveProperty("buyerId");
    await expect(getSellerCommissionStatus(SELLER_ID)).resolves.toMatchObject({
      status: "clear",
      pendingCount: 0,
    });
    expect(currentSnapshot().notifications).toContainEqual(expect.objectContaining({
      userId: SELLER_ID,
      title: "Commission payment verified",
      actionLabel: "Continue Managing Listings",
      actionHref: "/dashboard/seller#my-listings-section",
    }));
  });

  it("rejects invalid targets and amounts before creating debt", async () => {
    await expect(issueSellerCommissionByAdmin({
      sellerId: "missing-seller",
      actorUserId: OWNER_ID,
      commissionAmount: 5,
      reason: "Invalid target.",
    })).rejects.toThrow("Seller not found");

    await expect(issueSellerCommissionByAdmin({
      sellerId: SELLER_ID,
      actorUserId: OWNER_ID,
      commissionAmount: 0,
      reason: "Invalid amount.",
    })).rejects.toThrow("at least 0.01 USDT");
    expect(currentSnapshot().commissionRecords).toHaveLength(0);
  });
});
