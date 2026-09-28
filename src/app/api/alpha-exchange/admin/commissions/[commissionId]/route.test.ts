// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  updateCommissionPaymentStatus: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  updateCommissionPaymentStatus: mocks.updateCommissionPaymentStatus,
}));

import { PATCH } from "@/app/api/alpha-exchange/admin/commissions/[commissionId]/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/commissions/commission-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ commissionId: "commission-1" }) };

describe("admin commission payment status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });
    mocks.updateCommissionPaymentStatus.mockResolvedValue({
      id: "commission-1",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
    });
  });

  it("binds the authenticated admin and normalized verified settlement", async () => {
    const response = await PATCH(request({
      paymentStatus: " paid ",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: " Binance internal transfer 410678442518. ",
      reason: " Owner confirmed receipt. ",
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.updateCommissionPaymentStatus).toHaveBeenCalledWith({
      commissionId: "commission-1",
      actorUserId: "owner-1",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Binance internal transfer 410678442518.",
      reason: "Owner confirmed receipt.",
    });
    await expect(response.json()).resolves.toMatchObject({
      commission: { id: "commission-1", paymentStatus: "paid" },
    });
  });

  it("returns the admin auth response without mutating a commission", async () => {
    mocks.requireApiAdmin.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await PATCH(request({}), context);

    expect(response.status).toBe(401);
    expect(mocks.updateCommissionPaymentStatus).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an unknown payment status",
      body: { paymentStatus: "settled", reason: "Invalid status." },
      error: "Invalid commission status.",
    },
    {
      name: "an unknown verification status",
      body: { paymentStatus: "paid", paymentVerificationStatus: "trusted", reason: "Invalid verification." },
      error: "Invalid payment verification status.",
    },
    {
      name: "a paid and failed state combination",
      body: { paymentStatus: "paid", paymentVerificationStatus: "failed", reason: "Contradictory state." },
      error: "A paid commission must have verified payment status.",
    },
    {
      name: "a pending and verified state combination",
      body: { paymentStatus: "pending", paymentVerificationStatus: "verified", reason: "Contradictory state." },
      error: "Only a paid commission can have verified payment status.",
    },
    {
      name: "non-text verification notes",
      body: { paymentStatus: "paid", paymentVerificationStatus: "verified", paymentVerificationNotes: 410678442518, reason: "Invalid notes." },
      error: "Invalid payment verification notes.",
    },
    {
      name: "an oversized audit reason",
      body: { paymentStatus: "paid", paymentVerificationStatus: "verified", reason: "x".repeat(501) },
      error: "Reason must be 500 characters or fewer.",
    },
  ])("rejects $name before persistence", async ({ body, error }) => {
    const response = await PATCH(request(body), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.updateCommissionPaymentStatus).not.toHaveBeenCalled();
  });

  it("surfaces a canonical store failure without returning a false success", async () => {
    mocks.updateCommissionPaymentStatus.mockRejectedValueOnce(new Error("Commission record not found."));

    const response = await PATCH(request({
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      reason: "Owner confirmed receipt.",
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Commission record not found." });
  });
});
