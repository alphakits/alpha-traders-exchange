import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  findUserById,
  getAllSellerApplicationsForAdmin,
  invalidateAlphaExchangeStoreCache,
  reactivateSellerByAdmin,
  recordApprovedSellerVerificationByAdmin,
} from "@/lib/alpha-exchange-store";
import { COMPLETE_SELLER_APPROVAL_CHECKLIST } from "@/lib/seller-approval-verification";

function seed(status: "approved_seller" | "suspended" = "approved_seller") {
  const now = "2026-09-19T00:00:00.000Z";
  return {
    users: [{
      id: "legacy-seller",
      fullName: "Legacy Seller",
      email: "legacy-seller@example.test",
      passwordHash: "hash",
      whatsappNumber: "",
      role: status === "approved_seller" ? "approved_seller" : "buyer",
      roles: status === "approved_seller" ? ["buyer", "approved_seller"] : ["buyer"],
      sellerStatus: status,
      preferredNetworks: [],
      profilePhotoUrl: "",
      languages: ["English"],
      bio: "",
      onlineStatus: "offline",
      availabilityStatus: "available",
      createdAt: now,
      updatedAt: now,
    }],
    sellerApplications: [{
      id: "legacy-application",
      userId: "legacy-seller",
      fullName: "Legacy Seller",
      email: "legacy-seller@example.test",
      whatsappNumber: "",
      preferredNetworks: ["Bank Transfer"],
      expectedMonthlyTradingVolume: "",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    }],
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
  } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
}

describe("approved seller verification reconciliation", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seed() as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("binds the attestation to both the approved application and seller with an audit trail", async () => {
    await recordApprovedSellerVerificationByAdmin(
      "legacy-application",
      "owner-1",
      "Reconciled the retained verification evidence.",
      COMPLETE_SELLER_APPROVAL_CHECKLIST,
    );

    const seller = await findUserById("legacy-seller");
    const [application] = await getAllSellerApplicationsForAdmin();
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    const audit = snapshot.auditLogs.find((entry) => entry.action === "seller_verification_recorded");

    expect(seller?.sellerApprovalVerification).toMatchObject({
      method: "manual_authorized_reviewer_v1",
      verifiedByUserId: "owner-1",
      identityDocumentReviewed: true,
      liveIdentityVideoReviewed: true,
      contactOwnershipConfirmed: true,
      marketplaceRulesAccepted: true,
    });
    expect(application?.verification).toEqual(seller?.sellerApprovalVerification);
    expect(audit).toMatchObject({
      actorUserId: "owner-1",
      targetUserId: "legacy-seller",
      reason: "Reconciled the retained verification evidence.",
    });
    expect(JSON.stringify(audit)).not.toMatch(/passport|identity image|video file|document number/i);
  });

  it("refuses an incomplete checklist", async () => {
    await expect(recordApprovedSellerVerificationByAdmin(
      "legacy-application",
      "owner-1",
      "Incomplete evidence should fail.",
      { ...COMPLETE_SELLER_APPROVAL_CHECKLIST, liveIdentityVideoReviewed: false } as never,
    )).rejects.toThrow("Seller identity verification checklist is incomplete.");
  });

  it("blocks reactivation until the verification attestation is recorded", async () => {
    globalThis.__alphaExchangeMemorySnapshot = seed("suspended") as never;
    invalidateAlphaExchangeStoreCache();

    await expect(reactivateSellerByAdmin(
      "legacy-seller",
      "owner-1",
      "Reactivation requested.",
    )).rejects.toThrow("Seller identity verification must be recorded before reactivation.");
  });
});
