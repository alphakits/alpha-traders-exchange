import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  getTradeRoomBankDetails: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomBankDetails: mocks.getTradeRoomBankDetails,
}));

import { GET } from "@/app/api/alpha-exchange/trade-room/[requestId]/bank-details/route";

describe("trade room bank details route", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset();
    mocks.getTradeRoomBankDetails.mockReset();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer", emailVerified: true },
      unauthorized: null,
    });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
  });

  it("returns bank details for an authorized participant", async () => {
    mocks.getTradeRoomBankDetails.mockResolvedValue({
      requestId: "req-1",
      tradeId: "trade-1",
      bankAccountId: "bank-1",
      accountHolderName: "Seller One",
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber: "1234567890",
      accountLast4: "7890",
    });

    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/bank-details");
    const response = await GET(request, { params: Promise.resolve({ requestId: "req-1" }) });
    const payload = await response.json() as { bankDetails?: { accountNumber: string } };

    expect(response.status).toBe(200);
    expect(payload.bankDetails?.accountNumber).toBe("1234567890");
    expect(mocks.getTradeRoomBankDetails).toHaveBeenCalledWith({
      purchaseRequestId: "req-1",
      actorUserId: "buyer-1",
      actorRole: "buyer",
    });
  });

  it("maps not-allowed errors to 403", async () => {
    mocks.getTradeRoomBankDetails.mockRejectedValue(new Error("Bank details are available only after the seller accepts the trade."));

    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/bank-details");
    const response = await GET(request, { params: Promise.resolve({ requestId: "req-1" }) });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/only after/i);
  });

  it("maps missing trade errors to 404", async () => {
    mocks.getTradeRoomBankDetails.mockRejectedValue(new Error("Trade not found."));

    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/missing/bank-details");
    const response = await GET(request, { params: Promise.resolve({ requestId: "missing" }) });

    expect(response.status).toBe(404);
  });

  it("denies an unverified email before loading bank details", async () => {
    mocks.requireEmailVerificationForTrading.mockReturnValueOnce(new Response(null, { status: 403 }));
    const request = new NextRequest("http://localhost/api/alpha-exchange/trade-room/req-1/bank-details");
    const response = await GET(request, { params: Promise.resolve({ requestId: "req-1" }) });
    expect(response.status).toBe(403);
    expect(mocks.getTradeRoomBankDetails).not.toHaveBeenCalled();
  });
});
