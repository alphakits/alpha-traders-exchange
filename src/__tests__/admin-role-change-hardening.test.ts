import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  changeUserRoleByAdmin,
  findUserById,
  invalidateAlphaExchangeStoreCache,
} from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";

function user(input: Partial<AlphaExchangeUser> & Pick<AlphaExchangeUser, "id" | "email" | "role" | "sellerStatus">): AlphaExchangeUser {
  const now = "2026-09-19T00:00:00.000Z";
  return {
    fullName: input.id,
    passwordHash: "hash",
    whatsappNumber: "",
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    onlineStatus: "offline",
    availabilityStatus: "available",
    roles: [input.role],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function seed(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      user({ id: "owner", email: "jozenmark834@yahoo.com", role: "owner", roles: ["owner", "admin"], sellerStatus: "buyer" }),
      user({ id: "admin", email: "admin@example.test", role: "admin", roles: ["buyer", "admin"], sellerStatus: "buyer" }),
      user({ id: "buyer", email: "buyer@example.test", role: "buyer", sellerStatus: "buyer" }),
      user({
        id: "seller",
        email: "seller@example.test",
        role: "approved_seller",
        roles: ["buyer", "approved_seller"],
        sellerStatus: "approved_seller",
        sellerApprovalVerification: createTestSellerApprovalVerification(),
      }),
    ],
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [],
    auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [],
    disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [],
    privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [],
    adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
}

describe("generic admin role changes", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seed() as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("atomically removes additive admin privileges during demotion", async () => {
    await changeUserRoleByAdmin({
      userId: "admin",
      role: "buyer",
      reason: "Administrative access no longer required.",
      actorUserId: "owner",
    });

    const updated = await findUserById("admin");
    expect(updated?.role).toBe("buyer");
    expect(updated?.roles).toEqual(["buyer"]);
    expect(hasRole(updated!, "admin")).toBe(false);
  });

  it("cannot bypass the seller verification workflow or assign owner access", async () => {
    await expect(changeUserRoleByAdmin({
      userId: "buyer",
      role: "approved_seller",
      reason: "Unsafe shortcut.",
      actorUserId: "owner",
    })).rejects.toThrow("verified seller application workflow");
    await expect(changeUserRoleByAdmin({
      userId: "buyer",
      role: "owner",
      reason: "Unsafe owner assignment.",
      actorUserId: "owner",
    })).rejects.toThrow("Owner access cannot be assigned");
  });

  it("requires dedicated controls for seller accounts", async () => {
    await expect(changeUserRoleByAdmin({
      userId: "seller",
      role: "buyer",
      reason: "Use the wrong control.",
      actorUserId: "owner",
    })).rejects.toThrow("dedicated seller controls");
  });

  it("rejects direct calls from a non-owner actor", async () => {
    await expect(changeUserRoleByAdmin({
      userId: "admin",
      role: "buyer",
      reason: "Unauthorized change.",
      actorUserId: "buyer",
    })).rejects.toThrow("Owner access is required");
  });
});
