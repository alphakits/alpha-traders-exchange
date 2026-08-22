// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSeller: vi.fn(),
  rateLimit: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSellerWorkspaceActor: mocks.requireSeller,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  submitSellerCommissionWalletPayment: mocks.submit,
}));

import { POST } from "@/app/api/alpha-exchange/commissions/pay/route";

function request(payload: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/alpha-exchange/commissions/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("commission payment route network handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSeller.mockResolvedValue({ user: { id: "seller-1" }, unauthorized: null });
    mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.submit.mockResolvedValue({
      verification: { verified: false, notes: "Pending verification." },
      metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, verificationMs: 1, businessMs: 0, writeDbMs: 0 },
    });
  });

  it("rejects an omitted network instead of silently defaulting to TRC20", async () => {
    const response = await POST(request({ commissionId: "commission-1", paymentSignature: "signature" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Commission payment network is required." });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("passes an explicit selected network to the canonical server verifier", async () => {
    const response = await POST(request({
      commissionId: "commission-1",
      paymentSignature: "signature",
      network: "SOL",
    }));

    expect(response.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith({
      sellerUserId: "seller-1",
      commissionId: "commission-1",
      network: "SOL",
      paymentSignature: "signature",
      payerWalletAddress: "",
    });
  });
});
