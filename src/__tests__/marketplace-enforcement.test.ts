import { beforeEach, describe, expect, it } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

import {
  createMarketplaceListing,
  getSellerMarketplaceEnforcementStatus,
  invalidateAlphaExchangeStoreCache,
  issueMarketplaceEnforcementFeeByAdmin,
  markMarketplaceEnforcementFeePaidByAdmin,
  renewMarketplaceListing,
  reviewMarketplaceListingByOwner,
  revokeSellerMarketplacePrivilegesByAdmin,
  updateMarketplaceListingForSeller,
} from "@/lib/alpha-exchange-store";

const OWNER_ID = "owner-1";
const ADMIN_ID = "admin-1";
const SELLER_ID = "seller-1";
const TEST_EVIDENCE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pW9mWQAAAAASUVORK5CYII=";

function createUser(id: string, role: "owner" | "admin" | "approved_seller") {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email: `${id}@example.com`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
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
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
    ownerSettings: role === "owner"
      ? {
          marketplaceComplianceRecoveryWallet: {
            network: "TRC20",
            walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
            defaultPaymentRail: "manual_wallet_transfer",
            updatedAt: now,
            updatedByUserId: id,
          },
        }
      : undefined,
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser(OWNER_ID, "owner"),
      createUser(ADMIN_ID, "admin"),
      createUser(SELLER_ID, "approved_seller"),
    ] as AlphaExchangeDb["users"],
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

async function createApprovedListing() {
  const listing = await createMarketplaceListing({
    sellerId: SELLER_ID,
    sellerDisplayName: "Seller One",
    availableAmount: "500",
    price: "3.55",
    currency: "ILS",
    network: "TRC20",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Leumi",
    minimumTrade: "50",
    maximumTrade: "500",
    responseTime: "5 min",
    acceptedCommissionPolicy: true,
    actorUserId: SELLER_ID,
  });
  await reviewMarketplaceListingByOwner({
    listingId: listing.id,
    ownerUserId: OWNER_ID,
    decision: "approve",
  });
  return listing;
}

describe("marketplace enforcement workflow", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("blocks seller listing edits and renew while enforcement restriction is active", async () => {
    const listing = await createApprovedListing();

    await issueMarketplaceEnforcementFeeByAdmin({
      sellerId: SELLER_ID,
      actorUserId: ADMIN_ID,
      feeAmount: 125,
      reason: "Off-platform payment coercion",
      adminNotes: "Internal compliance review completed.",
      evidenceFiles: [{
        fileName: "policy-violation.png",
        mimeType: "image/png",
        fileData: TEST_EVIDENCE_DATA_URL,
      }],
    });

    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.57",
      changeReason: "Price update",
      changeExplanation: "Market moved",
    })).rejects.toThrow(/temporarily restricted/i);

    await expect(renewMarketplaceListing({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
    })).rejects.toThrow(/temporarily restricted/i);
  });

  it("restores seller permissions after admin marks enforcement fee paid", async () => {
    const listing = await createApprovedListing();

    await issueMarketplaceEnforcementFeeByAdmin({
      sellerId: SELLER_ID,
      actorUserId: ADMIN_ID,
      feeAmount: 80,
      reason: "Policy breach",
      adminNotes: "Internal compliance review completed.",
      evidenceFiles: [{
        fileName: "policy-violation.png",
        mimeType: "image/png",
        fileData: TEST_EVIDENCE_DATA_URL,
      }],
    });

    await markMarketplaceEnforcementFeePaidByAdmin({
      sellerId: SELLER_ID,
      actorUserId: ADMIN_ID,
      reason: "Verified transfer",
    });

    const enforcement = await getSellerMarketplaceEnforcementStatus(SELLER_ID);
    expect(enforcement.restricted).toBe(false);
    expect(enforcement.activeRecord).toBeUndefined();

    await expect(updateMarketplaceListingForSeller({
      listingId: listing.id,
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      price: "3.58",
      changeReason: "Price update",
      changeExplanation: "Market moved",
    })).resolves.toMatchObject({ id: listing.id, price: "3.58" });
  });

  it("permanently revokes seller privileges and closes open listings", async () => {
    const listing = await createApprovedListing();

    await issueMarketplaceEnforcementFeeByAdmin({
      sellerId: SELLER_ID,
      actorUserId: ADMIN_ID,
      feeAmount: 90,
      reason: "First confirmed violation",
      adminNotes: "Internal compliance review completed.",
      evidenceFiles: [{
        fileName: "policy-violation.png",
        mimeType: "image/png",
        fileData: TEST_EVIDENCE_DATA_URL,
      }],
    });

    await revokeSellerMarketplacePrivilegesByAdmin({
      sellerId: SELLER_ID,
      actorUserId: ADMIN_ID,
      reason: "Second confirmed violation",
    });

    const db = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const seller = db.users.find((user) => user.id === SELLER_ID);
    const revokedListing = db.marketplaceListings.find((item) => item.id === listing.id);

    expect(seller?.sellerStatus).toBe("buyer");
    expect(seller?.roles).toContain("buyer");
    expect(revokedListing?.status).toBe("closed");

    const audit = db.auditLogs.find((entry) => entry.action === "marketplace_enforcement_seller_revoked" && entry.targetUserId === SELLER_ID);
    expect(audit).toBeDefined();
  });
});
