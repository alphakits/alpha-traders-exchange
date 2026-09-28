import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  getTradeRoomData: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomData: mocks.getTradeRoomData,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: vi.fn(),
}));

import { GET } from "@/app/api/alpha-exchange/trade-room/[requestId]/route";

describe("Trade Room email verification gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer", emailVerified: true, verifiedPhone: "", phoneVerifiedAt: "" },
      unauthorized: null,
    });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.getTradeRoomData.mockResolvedValue({
      request: { id: "request-1", status: "accepted" },
      listing: null,
      counterpart: { buyerName: "Buyer", sellerName: "Seller" },
      messages: [],
      poke: { available: true, canPoke: true, cooldownUntil: null, cooldownRemainingSeconds: 0, counterpartRole: "seller" },
      deadlineAt: null,
      timeRemainingSeconds: null,
      releaseDeadlineActive: false,
      releaseDeadlineOverdue: false,
      hasOpenDispute: false,
      canOpenDispute: false,
      isOverdue: false,
      sellerCommissionDueAmount: 0,
      sellerCommissionDueCount: 0,
    });
  });

  it("allows a verified-email Buyer with no verified phone to enter the Trade Room", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/alpha-exchange/trade-room/request-1"),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getTradeRoomData).toHaveBeenCalledWith(expect.objectContaining({
      purchaseRequestId: "request-1",
      actorUserId: "buyer-1",
      markMessagesRead: false,
    }));
  });

  it("denies an unverified email before loading any Trade Room data", async () => {
    mocks.requireEmailVerificationForTrading.mockReturnValueOnce(
      NextResponse.json({ code: "EMAIL_VERIFICATION_REQUIRED" }, { status: 403 }),
    );
    const response = await GET(
      new NextRequest("http://localhost/api/alpha-exchange/trade-room/request-1"),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.getTradeRoomData).not.toHaveBeenCalled();
  });

  it("requests a canonical owner history view without marking messages read", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { id: "owner-1", role: "owner", emailVerified: true }, unauthorized: null });
    const response = await GET(
      new NextRequest("http://localhost/api/alpha-exchange/trade-room/request-1?view=history"),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getTradeRoomData).toHaveBeenCalledWith({
      purchaseRequestId: "request-1", actorUserId: "owner-1", actorRole: "owner",
      markMessagesRead: false, strongConsistency: true, ownerHistory: true,
    });
  });

  it("returns a private forbidden response when the canonical owner history check fails", async () => {
    mocks.getTradeRoomData.mockRejectedValue(new Error("You are not allowed to access trade history."));
    const response = await GET(
      new NextRequest("http://localhost/api/alpha-exchange/trade-room/request-1?view=history"),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "TRADE_FORBIDDEN" });
  });
});
