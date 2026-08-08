import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiOwner: vi.fn(),
  updateOwnerMarketplaceComplianceRecoveryWallet: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiOwner: mocks.requireApiOwner,
}));

vi.mock("@/lib/alpha-exchange-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alpha-exchange-store")>();
  return {
    ...actual,
    updateOwnerMarketplaceComplianceRecoveryWallet: mocks.updateOwnerMarketplaceComplianceRecoveryWallet,
  };
});

import { POST } from "@/app/api/alpha-exchange/admin/compliance/recovery-wallet/route";

describe("admin compliance recovery wallet route", () => {
  beforeEach(() => {
    mocks.requireApiOwner.mockReset();
    mocks.updateOwnerMarketplaceComplianceRecoveryWallet.mockReset();

    mocks.requireApiOwner.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });

    mocks.updateOwnerMarketplaceComplianceRecoveryWallet.mockResolvedValue({
      network: "TRC20",
      walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      defaultPaymentRail: "manual_wallet_transfer",
      updatedAt: new Date().toISOString(),
      updatedByUserId: "owner-1",
    });
  });

  it("returns 400 for unsupported network", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/admin/compliance/recovery-wallet", {
      method: "POST",
      body: JSON.stringify({ network: "INVALID", walletAddress: "abc" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Unsupported wallet network.");
    expect(mocks.updateOwnerMarketplaceComplianceRecoveryWallet).not.toHaveBeenCalled();
  });

  it("saves owner recovery wallet config", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/admin/compliance/recovery-wallet", {
      method: "POST",
      body: JSON.stringify({
        network: "TRC20",
        walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        defaultPaymentRail: "manual_wallet_transfer",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = await response.json() as { config?: { network: string; walletAddress: string } };

    expect(response.status).toBe(200);
    expect(payload.config?.network).toBe("TRC20");
    expect(payload.config?.walletAddress).toBe("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE");
    expect(mocks.updateOwnerMarketplaceComplianceRecoveryWallet).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      network: "TRC20",
      walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      defaultPaymentRail: "manual_wallet_transfer",
    });
  });
});
