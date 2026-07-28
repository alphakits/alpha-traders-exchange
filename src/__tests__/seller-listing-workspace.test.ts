import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const mockLoadSnapshot = vi.fn();
const mockSaveSnapshot = vi.fn();

vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: vi.fn(async () => ({
    loadSnapshot: mockLoadSnapshot,
    saveSnapshot: mockSaveSnapshot,
  })),
}));

import { getSellerListingWorkspaceSummary } from "@/lib/alpha-exchange-store";

function buildDb(overrides: Partial<AlphaExchangeDb> = {}): AlphaExchangeDb {
  return {
    users: [],
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
    ...overrides,
  };
}

beforeEach(() => {
  mockLoadSnapshot.mockReset();
  mockSaveSnapshot.mockReset();
  mockLoadSnapshot.mockResolvedValue(buildDb());
});

describe("seller listing workspace summary", () => {
  it("allows a seller to create another listing when existing listings are paused", async () => {
    const db = buildDb({
      marketplaceListings: [
        {
          id: "listing-1",
          sellerId: "seller-1",
          sellerName: "Seller One",
          title: "Listing 1",
          price: "100",
          currency: "USD",
          availableAmount: "100",
          minimumTrade: "10",
          maximumTrade: "100",
          network: "TRC20",
          status: "paused",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        } as never,
        {
          id: "listing-2",
          sellerId: "seller-1",
          sellerName: "Seller One",
          title: "Listing 2",
          price: "100",
          currency: "USD",
          availableAmount: "100",
          minimumTrade: "10",
          maximumTrade: "100",
          network: "TRC20",
          status: "paused",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        } as never,
      ],
    });
    mockLoadSnapshot.mockResolvedValue(db);

    const summary = await getSellerListingWorkspaceSummary("seller-1");
    expect(summary.canCreateListing).toBe(true);
    expect(summary.blockedReason).toBeNull();
  });
});
