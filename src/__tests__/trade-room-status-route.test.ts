import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  updatePurchaseRequestStatus: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/runtime-safety", () => ({ allowsRuntimeDiagnostics: () => false }));
vi.mock("@/lib/action-destinations", () => ({ tradeDestination: () => "/trade-room/purchase-1" }));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
  tradeEmailEventForStatus: (status: string) => status === "funds_received" ? "seller_funds_received" : null,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  sanitizePurchaseRequestForActor: (request: unknown) => request,
  TradeBlockedError: class TradeBlockedError extends Error {},
  updatePurchaseRequestStatus: mocks.updatePurchaseRequestStatus,
}));

import { PATCH } from "@/app/api/alpha-exchange/purchase-requests/[requestId]/route";

function statusRequest(status: string) {
  return new NextRequest("http://localhost/api/alpha-exchange/purchase-requests/purchase-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

describe("Trade Room status route post-commit reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "seller-1", role: "approved_seller", emailVerified: true },
      unauthorized: null,
    });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.updatePurchaseRequestStatus.mockResolvedValue({
      request: {
        id: "purchase-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "funds_received",
      },
      statusChanged: true,
      additionallyDeclinedRequests: [],
      metrics: {
        totalMs: 1,
        readDbMs: 0,
        timelineMs: 0,
        chatMs: 0,
        notificationMs: 0,
        writeDbMs: 1,
        sseMs: 0,
        trustMs: 0,
      },
    });
  });

  it("keeps the successful status response when lifecycle email preparation fails", async () => {
    mocks.prepareTradeEventEmails.mockRejectedValueOnce(new Error("recipient lookup unavailable"));

    const response = await PATCH(statusRequest("funds_received"), {
      params: Promise.resolve({ requestId: "purchase-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ request: { id: "purchase-1", status: "funds_received" }, statusChanged: true });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "trade_lifecycle_email_schedule",
      resourceId: "purchase-1",
      reason: "status_post_commit_schedule_failed",
    }));
  });
});
