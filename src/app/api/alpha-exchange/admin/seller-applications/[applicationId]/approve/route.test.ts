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
    });
  });

  it("approves after WhatsApp review using the authenticated owner and reason", async () => {
    const response = await POST(request({
      reason: " Verified identity and seller eligibility. ",
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.approveSellerApplicationByAdmin).toHaveBeenCalledWith(
      "application-1",
      "owner-1",
      "Verified identity and seller eligibility.",
    );
    await expect(response.json()).resolves.toMatchObject({
      application: { id: "application-1", status: "approved" },
    });
  });

  it.each([{}, { reason: "   " }])("requires an admin audit reason", async (body) => {
    const response = await POST(request(body), context);
    expect(response.status).toBe(400);
    expect(mocks.approveSellerApplicationByAdmin).not.toHaveBeenCalled();
  });

  it("accepts legacy clients without treating their checklist as identity evidence", async () => {
    const response = await POST(request({
      reason: "Reviewed through WhatsApp.",
      verification: COMPLETE_SELLER_APPROVAL_CHECKLIST,
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.approveSellerApplicationByAdmin).toHaveBeenCalledWith(
      "application-1", "owner-1", "Reviewed through WhatsApp.",
    );
  });

  it("returns the store rejection for an application no longer pending", async () => {
    mocks.approveSellerApplicationByAdmin.mockRejectedValueOnce(new Error("Seller application is no longer pending review."));
    const response = await POST(request({ reason: "Reviewed through WhatsApp." }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Seller application is no longer pending review." });
  });

  it("returns the admin auth response without approving an applicant", async () => {
    mocks.requireApiAdmin.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request({
      reason: "Verified identity.",
    }), context);

    expect(response.status).toBe(401);
    expect(mocks.approveSellerApplicationByAdmin).not.toHaveBeenCalled();
  });
});
