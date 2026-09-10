// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  getSellerCommissionStatus: vi.fn(),
  requireMobileApiUser: vi.fn(),
  submitSellerCommissionWalletPayment: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getSellerCommissionStatus: mocks.getSellerCommissionStatus,
  submitSellerCommissionWalletPayment: mocks.submitSellerCommissionWalletPayment,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { GET, POST } from "@/app/api/mobile/v1/seller/commissions/route";

const CANONICAL_WALLET = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8";
const TX_ID = "a1".repeat(32);
const headers = {
  authorization: "Bearer mobile-access",
  "content-type": "application/json",
  "x-app-version": "1.2.0",
  "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
  "x-platform": "ios",
  "x-request-id": "mobile-commission-request",
};

function request(method: "GET" | "POST", body?: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/seller/commissions", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function commissionStatus() {
  return {
    status: "pending" as const,
    pendingCount: 1,
    amountDue: 7,
    totalAmountDue: 7,
    payableAmountDue: 7.000001,
    payableRecords: [{
      commissionId: "commission-1",
      amountDue: 7,
      paymentAmountDue: 7.000001,
      paymentExpectedAmountMode: "unique_v1" as const,
      relatedRequestId: "request-1",
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: { id: "seller-1", role: "approved_seller", sellerStatus: "approved_seller" },
    unauthorized: null,
  });
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.getSellerCommissionStatus.mockResolvedValue(commissionStatus());
  mocks.submitSellerCommissionWalletPayment.mockResolvedValue({
    verification: { verified: false, pending: true, reference: TX_ID, notes: "Waiting for finality." },
  });
});

describe("mobile seller commission route", () => {
  it("requires the exact-amount-capable mobile release and blocks installed 1.1 clients", async () => {
    const response = await GET(new NextRequest(
      "https://www.alphatraders.co.il/api/mobile/v1/seller/commissions",
      { headers: { ...headers, "x-app-version": "1.1.0" } },
    ));

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "APP_UPDATE_REQUIRED" } });
    expect(mocks.requireMobileApiUser).not.toHaveBeenCalled();
  });

  it("lets a suspended seller access payment so commission restrictions can be cleared", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { id: "seller-1", role: "buyer", roles: ["buyer"], sellerStatus: "suspended" },
      unauthorized: null,
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(mocks.getSellerCommissionStatus).toHaveBeenCalledWith("seller-1");
  });

  it("returns only the canonical Binance TRC20 rail and exact six-decimal amount", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      payableRecords: [{
        amountDue: 7.000001,
        paymentAmountDue: 7.000001,
        paymentExpectedAmountMode: "unique_v1",
      }],
      paymentNetworks: [{
        network: "TRC20",
        available: true,
        walletAddress: CANONICAL_WALLET,
      }],
    });
  });

  it("rejects malformed TxIDs and legacy networks before touching payment state", async () => {
    const malformed = await POST(request("POST", {
      commissionId: "commission-1",
      network: "TRC20",
      paymentSignature: "not-a-tron-txid",
    }));
    expect(malformed.status).toBe(400);

    const legacy = await POST(request("POST", {
      commissionId: "commission-1",
      network: "ERC20",
      paymentSignature: TX_ID,
    }));
    expect(legacy.status).toBe(400);
    expect(mocks.submitSellerCommissionWalletPayment).not.toHaveBeenCalled();
  });

  it("submits a valid 64-character TxID as a TRC20 payment for the authenticated seller", async () => {
    const response = await POST(request("POST", {
      commissionId: "commission-1",
      network: "TRC20",
      paymentSignature: TX_ID,
      sellerUserId: "forged-seller",
    }));

    expect(response.status).toBe(200);
    expect(mocks.submitSellerCommissionWalletPayment).toHaveBeenCalledWith({
      sellerUserId: "seller-1",
      commissionId: "commission-1",
      network: "TRC20",
      payerWalletAddress: "",
      paymentSignature: TX_ID,
    });
  });
});
