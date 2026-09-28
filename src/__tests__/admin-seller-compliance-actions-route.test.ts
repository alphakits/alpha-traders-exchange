import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  issueMarketplaceEnforcementFeeByAdmin: vi.fn(),
  confirmMarketplaceEnforcementPaymentByOwner: vi.fn(),
  decideMarketplaceEnforcementAppealByOwner: vi.fn(),
  markMarketplaceEnforcementFeePaidByAdmin: vi.fn(),
  removeMarketplaceEnforcementRestrictionByAdmin: vi.fn(),
  revokeSellerMarketplacePrivilegesByAdmin: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: mocks.requireApiAdmin,
}));

vi.mock("@/lib/alpha-exchange-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alpha-exchange-store")>();
  return {
    ...actual,
    issueMarketplaceEnforcementFeeByAdmin: mocks.issueMarketplaceEnforcementFeeByAdmin,
    confirmMarketplaceEnforcementPaymentByOwner: mocks.confirmMarketplaceEnforcementPaymentByOwner,
    decideMarketplaceEnforcementAppealByOwner: mocks.decideMarketplaceEnforcementAppealByOwner,
    markMarketplaceEnforcementFeePaidByAdmin: mocks.markMarketplaceEnforcementFeePaidByAdmin,
    removeMarketplaceEnforcementRestrictionByAdmin: mocks.removeMarketplaceEnforcementRestrictionByAdmin,
    revokeSellerMarketplacePrivilegesByAdmin: mocks.revokeSellerMarketplacePrivilegesByAdmin,
  };
});

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import { POST } from "@/app/api/alpha-exchange/admin/sellers/[userId]/enforcement/route";

describe("admin seller compliance actions route", () => {
  beforeEach(() => {
    mocks.requireApiAdmin.mockReset();
    mocks.issueMarketplaceEnforcementFeeByAdmin.mockReset();
    mocks.confirmMarketplaceEnforcementPaymentByOwner.mockReset();
    mocks.decideMarketplaceEnforcementAppealByOwner.mockReset();
    mocks.markMarketplaceEnforcementFeePaidByAdmin.mockReset();
    mocks.removeMarketplaceEnforcementRestrictionByAdmin.mockReset();
    mocks.revokeSellerMarketplacePrivilegesByAdmin.mockReset();
    mocks.logEvent.mockReset();

    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });

    const enforcementState = { restricted: true, blockReason: "Pending payment" };
    mocks.issueMarketplaceEnforcementFeeByAdmin.mockResolvedValue(enforcementState);
    mocks.confirmMarketplaceEnforcementPaymentByOwner.mockResolvedValue({ restricted: false, blockReason: null });
    mocks.decideMarketplaceEnforcementAppealByOwner.mockResolvedValue(enforcementState);
    mocks.markMarketplaceEnforcementFeePaidByAdmin.mockResolvedValue({ restricted: false, blockReason: null });
    mocks.removeMarketplaceEnforcementRestrictionByAdmin.mockResolvedValue({ restricted: false, blockReason: null });
    mocks.revokeSellerMarketplacePrivilegesByAdmin.mockResolvedValue({ restricted: false, blockReason: null });
  });

  it("issues a marketplace recovery fee with notes and evidence", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/admin/sellers/seller-1/enforcement", {
      method: "POST",
      body: JSON.stringify({
        action: "issue_fee",
        feeAmount: 125,
        reason: "Policy breach",
        notes: "Internal notes",
        evidenceFiles: [
          {
            fileName: "proof.png",
            mimeType: "image/png",
            sizeBytes: 1234,
            fileData: "data:image/png;base64,abc",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ userId: "seller-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.issueMarketplaceEnforcementFeeByAdmin).toHaveBeenCalledWith({
      sellerId: "seller-1",
      actorUserId: "owner-1",
      feeAmount: 125,
      reason: "Policy breach",
      adminNotes: "Internal notes",
      evidenceFiles: [
        {
          fileName: "proof.png",
          mimeType: "image/png",
          sizeBytes: 1234,
          fileData: "data:image/png;base64,abc",
        },
      ],
      dueAt: undefined,
    });
  });

  it("confirms payment", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/admin/sellers/seller-1/enforcement", {
      method: "POST",
      body: JSON.stringify({ action: "confirm_payment", reason: "Verified" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ userId: "seller-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.confirmMarketplaceEnforcementPaymentByOwner).toHaveBeenCalledWith({
      sellerId: "seller-1",
      actorUserId: "owner-1",
      reason: "Verified",
      notes: undefined,
    });
  });

  it("returns 400 for invalid action", async () => {
    const request = new NextRequest("http://localhost/api/alpha-exchange/admin/sellers/seller-1/enforcement", {
      method: "POST",
      body: JSON.stringify({ action: "unknown" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ userId: "seller-1" }) });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid compliance action.");
  });
});
