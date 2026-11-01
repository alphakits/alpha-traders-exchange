import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requireMarketplaceVerificationForTrading: vi.fn(),
  checkRateLimit: vi.fn(),
  closePurchaseRequestManually: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireMarketplaceVerificationForTrading: mocks.requireMarketplaceVerificationForTrading,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  closePurchaseRequestManually: mocks.closePurchaseRequestManually,
}));

import { PATCH } from "@/app/api/alpha-exchange/trade-room/[requestId]/close/route";

describe("trade room manual close route", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset();
    mocks.requireMarketplaceVerificationForTrading.mockReset();
    mocks.checkRateLimit.mockReset();
    mocks.closePurchaseRequestManually.mockReset();

    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer", emailVerified: true },
      unauthorized: null,
    });
    mocks.requireMarketplaceVerificationForTrading.mockReturnValue(null);
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.closePurchaseRequestManually.mockResolvedValue({ id: "req-1", status: "cancelled", closeReason: "Buyer requested close" });
  });

  it("closes with the authenticated identity and ignores submitted actor or role overrides", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/close", {
      method: "PATCH",
      body: JSON.stringify({ reason: "Buyer requested close", explanation: "No counterparty response.", actorUserId: "owner-1", actorRole: "owner" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, { params: Promise.resolve({ requestId: "req-1" }) });
    const payload = await response.json() as { request?: { status: string } };

    expect(response.status).toBe(200);
    expect(payload.request?.status).toBe("cancelled");
    expect(mocks.closePurchaseRequestManually).toHaveBeenCalledWith({
      requestId: "req-1",
      actorUserId: "buyer-1",
      actorRole: "buyer",
      reason: "Buyer requested close",
      explanation: "No counterparty response.",
    });
  });

  it("returns 429 when close route is rate-limited", async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 20 });

    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/close", {
      method: "PATCH",
      body: JSON.stringify({ reason: "Busy" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, { params: Promise.resolve({ requestId: "req-1" }) });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(429);
    expect(payload.error).toMatch(/Too many close requests/i);
    expect(mocks.closePurchaseRequestManually).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated closure before verification, rate limiting or store access", async () => {
    mocks.requireApiUser.mockResolvedValueOnce({ user: null, unauthorized: new Response(null, { status: 401 }) });
    const response = await PATCH(new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/close", {
      method: "PATCH", body: JSON.stringify({ reason: "Attempted close" }),
    }), { params: Promise.resolve({ requestId: "req-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.requireMarketplaceVerificationForTrading).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.closePurchaseRequestManually).not.toHaveBeenCalled();
  });

  it("returns a cancellation guard rejection without claiming closure succeeded", async () => {
    mocks.closePurchaseRequestManually.mockRejectedValueOnce(new Error("Bank details have been revealed. Only the seller can cancel while the trade is unpaid."));
    const response = await PATCH(new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/close", {
      method: "PATCH", body: JSON.stringify({ reason: "Attempted close" }),
    }), { params: Promise.resolve({ requestId: "req-1" }) });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("Only the seller can cancel");
    expect(payload.request).toBeUndefined();
  });

  it("denies an unverified email before closing the trade", async () => {
    mocks.requireMarketplaceVerificationForTrading.mockReturnValueOnce(new Response(null, { status: 403 }));
    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/close", {
      method: "PATCH",
      body: JSON.stringify({ reason: "Busy" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, { params: Promise.resolve({ requestId: "req-1" }) });
    expect(response.status).toBe(403);
    expect(mocks.closePurchaseRequestManually).not.toHaveBeenCalled();
  });
});
