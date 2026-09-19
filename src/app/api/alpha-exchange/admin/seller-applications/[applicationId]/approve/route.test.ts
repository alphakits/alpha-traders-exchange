// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { COMPLETE_SELLER_APPROVAL_CHECKLIST } from "@/lib/seller-approval-verification";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  approveSellerApplicationByAdmin: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  approveSellerApplicationByAdmin: mocks.approveSellerApplicationByAdmin,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST } from "@/app/api/alpha-exchange/admin/seller-applications/[applicationId]/approve/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/seller-applications/application-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ applicationId: "application-1" }) };

describe("admin seller approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });
    mocks.approveSellerApplicationByAdmin.mockResolvedValue({
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

  it("binds a complete identity attestation to the authenticated reviewer", async () => {
    const response = await POST(request({
      reason: " Verified identity and seller eligibility. ",
      verification: COMPLETE_SELLER_APPROVAL_CHECKLIST,
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.approveSellerApplicationByAdmin).toHaveBeenCalledWith(
      "application-1",
      "owner-1",
      "Verified identity and seller eligibility.",
      COMPLETE_SELLER_APPROVAL_CHECKLIST,
    );
    await expect(response.json()).resolves.toMatchObject({
      application: { id: "application-1", status: "approved" },
    });
  });

  it.each([
    { name: "a missing reason", body: { verification: COMPLETE_SELLER_APPROVAL_CHECKLIST } },
    { name: "a missing checklist", body: { reason: "Verified identity." } },
    {
      name: "an incomplete checklist",
      body: {
        reason: "Verified identity.",
        verification: { ...COMPLETE_SELLER_APPROVAL_CHECKLIST, liveIdentityVideoReviewed: false },
      },
    },
  ])("rejects $name before approval", async ({ body }) => {
    const response = await POST(request(body), context);

    expect(response.status).toBe(400);
    expect(mocks.approveSellerApplicationByAdmin).not.toHaveBeenCalled();
  });

  it("returns the admin auth response without approving an applicant", async () => {
    mocks.requireApiAdmin.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request({
      reason: "Verified identity.",
      verification: COMPLETE_SELLER_APPROVAL_CHECKLIST,
    }), context);

    expect(response.status).toBe(401);
    expect(mocks.approveSellerApplicationByAdmin).not.toHaveBeenCalled();
  });
});
