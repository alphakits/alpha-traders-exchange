// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { COMPLETE_SELLER_APPROVAL_CHECKLIST } from "@/lib/seller-approval-verification";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  recordApprovedSellerVerificationByAdmin: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  recordApprovedSellerVerificationByAdmin: mocks.recordApprovedSellerVerificationByAdmin,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST } from "@/app/api/alpha-exchange/admin/seller-applications/[applicationId]/verification/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/seller-applications/application-1/verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ applicationId: "application-1" }) };

describe("approved-seller verification reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });
    mocks.recordApprovedSellerVerificationByAdmin.mockResolvedValue({
      id: "application-1",
      status: "approved",
      verification: {
        method: "manual_authorized_reviewer_v1",
        ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
        verifiedAt: "2026-09-19T20:00:00.000Z",
        verifiedByUserId: "owner-1",
      },
    });
  });

  it("records a complete, reasoned attestation for an existing approved seller", async () => {
    const response = await POST(request({
      reason: " Reconciled the existing seller evidence. ",
      verification: COMPLETE_SELLER_APPROVAL_CHECKLIST,
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.recordApprovedSellerVerificationByAdmin).toHaveBeenCalledWith(
      "application-1",
      "owner-1",
      "Reconciled the existing seller evidence.",
      COMPLETE_SELLER_APPROVAL_CHECKLIST,
    );
  });

  it.each([
    { reason: "", verification: COMPLETE_SELLER_APPROVAL_CHECKLIST },
    { reason: "x", verification: COMPLETE_SELLER_APPROVAL_CHECKLIST },
    { reason: "Evidence reconciled.", verification: { ...COMPLETE_SELLER_APPROVAL_CHECKLIST, identityDocumentReviewed: false } },
  ])("rejects an incomplete or unreasoned attestation", async (body) => {
    const response = await POST(request(body), context);

    expect(response.status).toBe(400);
    expect(mocks.recordApprovedSellerVerificationByAdmin).not.toHaveBeenCalled();
  });

  it("requires an authenticated administrator", async () => {
    mocks.requireApiAdmin.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request({
      reason: "Evidence reconciled.",
      verification: COMPLETE_SELLER_APPROVAL_CHECKLIST,
    }), context);

    expect(response.status).toBe(401);
    expect(mocks.recordApprovedSellerVerificationByAdmin).not.toHaveBeenCalled();
  });
});
