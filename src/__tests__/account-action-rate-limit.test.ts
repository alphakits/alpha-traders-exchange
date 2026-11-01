// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  user: { id: "shared-network-buyer-1", role: "buyer", roles: ["buyer"] } as unknown as AlphaExchangeUser,
}));

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: async () => ({ user: mocks.user, unauthorized: null }),
  requireMarketplaceVerificationForTrading: () => null,
}));
vi.mock("@/lib/mobile-api-auth", () => ({
  requireMobileApiUser: async () => ({ user: mocks.user, unauthorized: null }),
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  submitBuyerTradeReview: async () => ({ request: { status: "review_open" } }),
  submitSellerReviewResponse: vi.fn(),
  submitSellerBuyerReview: vi.fn(),
  approveSellerApplicationByAdmin: async () => undefined,
  rejectSellerApplicationByAdmin: vi.fn(),
  reviewMarketplaceListingByOwner: vi.fn(),
  getOwnerPendingListingsDashboardData: async () => ({ pendingListings: [], allListings: [], purchaseRequests: [] }),
  getPendingSellerApplicationsForAdmin: async () => [],
}));
vi.mock("@/lib/marketplace-email-events", () => ({ prepareListingReviewEmails: vi.fn() }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`https://www.alphatraders.co.il${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.19",
      "x-app-version": "1.2.0",
      "x-device-id": "shared-network-test-device",
      "x-platform": "ios",
    },
    body: JSON.stringify(body),
  });
}

describe("authenticated actions on a shared network", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.user = { id: "shared-network-buyer-1", role: "buyer", roles: ["buyer"] } as AlphaExchangeUser;
  });

  it("keeps the buyer review limit while allowing another buyer on the same IP", async () => {
    const { POST } = await import("@/app/api/alpha-exchange/purchase-requests/[requestId]/review/route");
    const send = () => POST(
      request("/api/alpha-exchange/purchase-requests/review-test/review", { rating: 5, comment: "Synthetic trade review." }),
      { params: Promise.resolve({ requestId: "review-test" }) },
    );
    for (let index = 0; index < 20; index += 1) expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);

    mocks.user = { ...mocks.user, id: "shared-network-buyer-2" };
    expect((await send()).status).toBe(200);
  });

  it("keeps the native owner review limit while isolating another owner on the same IP", async () => {
    mocks.user = { id: "shared-network-owner-1", role: "owner", roles: ["owner"] } as AlphaExchangeUser;
    const { POST } = await import("@/app/api/mobile/v1/admin/overview/route");
    const send = () => POST(request("/api/mobile/v1/admin/overview", {
      target: "seller_application", id: "synthetic-application", decision: "approve", reason: "Synthetic review.",
    }));
    for (let index = 0; index < 30; index += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);

    mocks.user = { ...mocks.user, id: "shared-network-owner-2" };
    expect((await send()).status).toBe(200);
  });
});
