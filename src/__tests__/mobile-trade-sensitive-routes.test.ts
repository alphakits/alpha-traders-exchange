// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  getTradeRoomBankDetails: vi.fn(),
  getTradeRoomData: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireMobileApiUser: vi.fn(),
  uploadTradeEvidence: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomBankDetails: mocks.getTradeRoomBankDetails,
  getTradeRoomData: mocks.getTradeRoomData,
  uploadTradeEvidence: mocks.uploadTradeEvidence,
}));
vi.mock("@/lib/marketplace-email-events", () => ({ prepareTradeEventEmails: mocks.prepareTradeEventEmails }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { GET as getBankDetails } from "@/app/api/mobile/v1/trades/[requestId]/bank-details/route";
import { POST as uploadEvidence } from "@/app/api/mobile/v1/trades/[requestId]/evidence/route";

function headers() {
  return {
    "authorization": "Bearer token",
    "content-type": "application/json",
    "x-app-version": "1.0.0",
    "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
    "x-platform": "ios",
    "x-request-id": "sensitive-route-request",
  };
}

function tradeRequest(status = "accepted") {
  return {
    id: "purchase-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    listingId: "listing-1",
    buyerName: "Buyer",
    usdtAmount: "500",
    fiatAmount: "1650.00",
    pricePerUsdt: "3.30",
    listingPriceAtRequest: "3.30",
    priceMode: "listing_price",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: { id: "buyer-1", role: "buyer" },
    accessToken: "access",
    unauthorized: null,
  });
  mocks.getTradeRoomData.mockResolvedValue({
    request: tradeRequest(),
    counterpart: { buyerName: "Buyer", sellerName: "Seller" },
  });
  mocks.getTradeRoomBankDetails.mockResolvedValue({
    requestId: "purchase-1",
    tradeId: "trade-private-id",
    bankAccountId: "bank-private-id",
    accountHolderName: "Seller Holder",
    bankName: "Bank Hapoalim",
    branchNumber: "123",
    accountNumber: "12345678",
    accountLast4: "5678",
  });
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.prepareTradeEventEmails.mockResolvedValue(async () => undefined);
  mocks.uploadTradeEvidence.mockResolvedValue({
    request: tradeRequest("payment_sent"),
    metrics: { autoAdvancedToPaymentSent: false, autoAdvancedToUsdtSent: false },
  });
});

describe("mobile trade sensitive routes", () => {
  it("returns bank coordinates to the buyer without leaking internal bank or trade identifiers", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/bank-details", {
      headers: headers(),
    });
    const response = await getBankDetails(request, { params: Promise.resolve({ requestId: "purchase-1" }) });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.bankDetails).toMatchObject({
      accountHolderName: "Seller Holder",
      bankName: "Bank Hapoalim",
      accountNumber: "12345678",
    });
    expect(serialized).not.toContain("trade-private-id");
    expect(serialized).not.toContain("bank-private-id");
  });

  it("derives the permitted evidence side from the authenticated participant", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/evidence", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        side: "seller",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        contentBase64: "/9j/",
      }),
    });

    const response = await uploadEvidence(request, { params: Promise.resolve({ requestId: "purchase-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVIDENCE_INVALID" } });
    expect(mocks.uploadTradeEvidence).not.toHaveBeenCalled();
  });

  it("accepts a bounded multipart image without trusting client file metadata", async () => {
    const form = new FormData();
    form.set("side", "buyer");
    form.set(
      "evidence",
      new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "private-phone-number.jpg", {
        type: "image/jpeg",
      }),
    );
    const multipartHeaders = { ...headers() } as Record<string, string>;
    delete multipartHeaders["content-type"];
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/evidence", {
      method: "POST",
      headers: multipartHeaders,
      body: form,
    });

    const response = await uploadEvidence(request, { params: Promise.resolve({ requestId: "purchase-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.uploadTradeEvidence).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "buyer-1",
      side: "buyer",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      contentBase64: "/9j/2Q==",
      fileName: "mobile-payment-evidence",
    }));
    expect(JSON.stringify(mocks.uploadTradeEvidence.mock.calls[0]?.[0])).not.toContain("private-phone-number");
  });

  it("rejects unsupported multipart content before the evidence store", async () => {
    const form = new FormData();
    form.set("side", "buyer");
    form.set("evidence", new File(["not evidence"], "notes.txt", { type: "text/plain" }));
    const multipartHeaders = { ...headers() } as Record<string, string>;
    delete multipartHeaders["content-type"];
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/evidence", {
      method: "POST",
      headers: multipartHeaders,
      body: form,
    });

    const response = await uploadEvidence(request, { params: Promise.resolve({ requestId: "purchase-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVIDENCE_INVALID" } });
    expect(mocks.uploadTradeEvidence).not.toHaveBeenCalled();
  });

  it("uses neutral server-owned evidence metadata and ignores a forged filename", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/evidence", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        side: "buyer",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        contentBase64: "/9j/",
        fileName: "call-me-at-private-number.jpg",
      }),
    });

    const response = await uploadEvidence(request, { params: Promise.resolve({ requestId: "purchase-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.uploadTradeEvidence).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "buyer-1",
      side: "buyer",
      fileName: "mobile-payment-evidence",
    }));
    const input = mocks.uploadTradeEvidence.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.fileName).not.toContain("private-number");
  });
});
