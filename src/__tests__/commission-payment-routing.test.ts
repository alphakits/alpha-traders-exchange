import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  invalidateAlphaExchangeStoreCache,
  submitSellerCommissionWalletPayment,
} from "@/lib/alpha-exchange-store";

const SELLER_ID = "commission-seller";
const BUYER_ID = "commission-buyer";
const COMMISSION_ID = "commission-1";
const ERC20_WALLET = "0x1111111111111111111111111111111111111111";
const POLYGON_WALLET = "0x2222222222222222222222222222222222222222";
const SOL_WALLET = "11111111111111111111111111111111";

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
});
