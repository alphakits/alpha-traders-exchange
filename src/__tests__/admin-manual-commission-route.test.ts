// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  issueSellerCommissionByAdmin: vi.fn(),
  requireApiAdmin: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  issueSellerCommissionByAdmin: mocks.issueSellerCommissionByAdmin,
}));
vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));

import { POST } from "@/app/api/alpha-exchange/admin/commissions/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/commissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin manual commission route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });
    mocks.issueSellerCommissionByAdmin.mockResolvedValue({
      id: "commission-manual-1",
      source: "admin_manual",
      sellerId: "seller-1",
      commissionAmount: 12.5,
      paymentStatus: "pending",
    });
  });

  it("binds the authenticated admin and normalized form fields", async () => {
    const response = await POST(request({
      sellerId: " seller-1 ",
      commissionAmount: "12.50",
      reason: " Manual adjustment. ",
      dueAt: "2030-01-02T00:00:00.000Z",
    }));

    expect(response.status).toBe(201);
    expect(mocks.issueSellerCommissionByAdmin).toHaveBeenCalledWith({
      sellerId: "seller-1",
      actorUserId: "owner-1",
      commissionAmount: 12.5,
      reason: "Manual adjustment.",
      dueAt: "2030-01-02T00:00:00.000Z",
    });
    await expect(response.json()).resolves.toMatchObject({
      commission: { id: "commission-manual-1", paymentStatus: "pending" },
    });
  });

  it("returns the admin auth response without invoking the store", async () => {
    mocks.requireApiAdmin.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(mocks.issueSellerCommissionByAdmin).not.toHaveBeenCalled();
  });

  it("surfaces validation failures as a client error", async () => {
    mocks.issueSellerCommissionByAdmin.mockRejectedValueOnce(new Error("Commission amount must be at least 0.01 USDT."));

    const response = await POST(request({
      sellerId: "seller-1",
      commissionAmount: 0,
      reason: "Invalid amount.",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Commission amount must be at least 0.01 USDT." });
  });
});
