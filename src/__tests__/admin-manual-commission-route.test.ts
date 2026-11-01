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

const OPERATION_ID = "124b41aa-e9e6-4581-b26e-7ad5a64606f0";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/commissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientOperationId: OPERATION_ID, ...body }),
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
      clientOperationId: OPERATION_ID,
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

  it.each([undefined, "", "bad"])("rejects an absent or invalid operation ID before the store (%s)", async clientOperationId => {
    const response = await POST(request({ sellerId: "seller-1", commissionAmount: 12.5, reason: "Adjustment", clientOperationId }));
    expect(response.status).toBe(400);
    expect(mocks.issueSellerCommissionByAdmin).not.toHaveBeenCalled();
  });

  it("returns conflict when an operation ID is reused with different terms", async () => {
    mocks.issueSellerCommissionByAdmin.mockRejectedValueOnce(Object.assign(new Error("Already issued for different terms"), { code: "manual-commission-operation-conflict" }));
    const response = await POST(request({ sellerId: "seller-1", commissionAmount: 12.5, reason: "Changed" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "manual-commission-operation-conflict" });
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
