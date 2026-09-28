import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSellerWorkspaceActor: vi.fn(),
  getSellerMarketplaceEnforcementStatus: vi.fn(),
  submitMarketplaceEnforcementPaymentBySeller: vi.fn(),
  submitMarketplaceEnforcementAppealBySeller: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSellerWorkspaceActor: mocks.requireApiSellerWorkspaceActor,
}));

vi.mock("@/lib/alpha-exchange-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alpha-exchange-store")>();
  return {
    ...actual,
    getSellerMarketplaceEnforcementStatus: mocks.getSellerMarketplaceEnforcementStatus,
    submitMarketplaceEnforcementPaymentBySeller: mocks.submitMarketplaceEnforcementPaymentBySeller,
    submitMarketplaceEnforcementAppealBySeller: mocks.submitMarketplaceEnforcementAppealBySeller,
  };
});

import { GET, POST } from "@/app/api/alpha-exchange/seller/compliance-payment/route";

describe("seller compliance payment route", () => {
  beforeEach(() => {
    mocks.requireApiSellerWorkspaceActor.mockReset();
    mocks.getSellerMarketplaceEnforcementStatus.mockReset();
    mocks.submitMarketplaceEnforcementPaymentBySeller.mockReset();
    mocks.submitMarketplaceEnforcementAppealBySeller.mockReset();

    mocks.requireApiSellerWorkspaceActor.mockResolvedValue({
      user: {
        id: "seller-1",
        role: "approved_seller",
      },
      unauthorized: null,
    });

    mocks.getSellerMarketplaceEnforcementStatus.mockResolvedValue({ restricted: false, blockReason: null });
    mocks.submitMarketplaceEnforcementPaymentBySeller.mockResolvedValue({ restricted: true, blockReason: "Awaiting verification" });
    mocks.submitMarketplaceEnforcementAppealBySeller.mockResolvedValue({ restricted: true, blockReason: "Appeal submitted" });
  });

  it("returns seller compliance status on GET", async () => {
    const response = await GET();
    const payload = await response.json() as { enforcement: { restricted: boolean } };

    expect(response.status).toBe(200);
    expect(payload.enforcement.restricted).toBe(false);
    expect(mocks.getSellerMarketplaceEnforcementStatus).toHaveBeenCalledWith("seller-1");
  });

  it("submits payment on POST submit_payment", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/seller/compliance-payment", {
      method: "POST",
      body: JSON.stringify({ action: "submit_payment", note: "I have paid." }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = await response.json() as { enforcement: { restricted: boolean } };

    expect(response.status).toBe(200);
    expect(payload.enforcement.restricted).toBe(true);
    expect(mocks.submitMarketplaceEnforcementPaymentBySeller).toHaveBeenCalledWith({
      sellerId: "seller-1",
      note: "I have paid.",
    });
  });

  it("submits appeal on POST submit_appeal", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/seller/compliance-payment", {
      method: "POST",
      body: JSON.stringify({ action: "submit_appeal", appealMessage: "Please review my evidence." }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.submitMarketplaceEnforcementAppealBySeller).toHaveBeenCalledWith({
      sellerId: "seller-1",
      message: "Please review my evidence.",
    });
  });

  it("returns 400 for invalid action", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/seller/compliance-payment", {
      method: "POST",
      body: JSON.stringify({ action: "unknown_action" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid compliance payment action.");
  });
});
