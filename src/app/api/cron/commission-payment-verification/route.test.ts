// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8";
const TX_ID = "81b3e4c7fbd1a9748d8d718f781cf08cd38a142b7c7484ffca94ea7329f7d8a7";
const USDT_CONTRACT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const SECRET = "test-cron-secret-that-is-at-least-32-characters";

const mocks = vi.hoisted(() => ({
  getAdminPrepDashboardData: vi.fn(),
  reverifyPendingCommissionPayments: vi.fn(),
  submitSellerCommissionWalletPayment: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getAdminPrepDashboardData: mocks.getAdminPrepDashboardData,
  reverifyPendingCommissionPayments: mocks.reverifyPendingCommissionPayments,
  submitSellerCommissionWalletPayment: mocks.submitSellerCommissionWalletPayment,
}));

import { GET } from "@/app/api/cron/commission-payment-verification/route";

function request(authorization?: string) {
  return new NextRequest("https://www.alphatraders.co.il/api/cron/commission-payment-verification", {
    headers: authorization ? { authorization } : undefined,
  });
}

function tronGridTransfer(value = "6250000", timestamp = Date.now()) {
  return {
    success: true,
    data: [{
      transaction_id: TX_ID,
      block_timestamp: timestamp,
      from: "TPayerWalletAddress111111111111111111",
      to: WALLET,
      type: "Transfer",
      value,
      token_info: { address: USDT_CONTRACT, decimals: 6, symbol: "USDT" },
    }],
  };
}

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

describe("automatic commission payment verification cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.getAdminPrepDashboardData.mockResolvedValue({ commissionRecords: [] });
    mocks.reverifyPendingCommissionPayments.mockResolvedValue({
      checked: 2,
      verified: 1,
      stillPending: 1,
      failed: 0,
      errors: 0,
    });
    mocks.submitSellerCommissionWalletPayment.mockResolvedValue({
      verification: { verified: true },
      metrics: { totalMs: 1 },
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true, data: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails closed when CRON_SECRET is absent or too short", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    const response = await GET(request("Bearer short"));
    expect(response.status).toBe(503);
    expect(mocks.getAdminPrepDashboardData).not.toHaveBeenCalled();
    expect(mocks.reverifyPendingCommissionPayments).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    const response = await GET(request("Bearer wrong-secret"));
    expect(response.status).toBe(401);
    expect(mocks.getAdminPrepDashboardData).not.toHaveBeenCalled();
    expect(mocks.reverifyPendingCommissionPayments).not.toHaveBeenCalled();
  });

  it("rechecks bounded pending payments without caching when there is no unsubmitted payment", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      autoReconciliation: { scannedTransfers: 0, matched: 0, verified: 0, pending: 0, errors: 0, legacyMatched: 0 },
      checked: 2,
      verified: 1,
      stillPending: 1,
      failed: 0,
      errors: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.reverifyPendingCommissionPayments).toHaveBeenCalledWith({ limit: 2 });
  });

  it("discovers an incoming exact-amount USDT deposit and submits its TxID automatically", async () => {
    const assignedAt = Date.now() - 60_000;
    mocks.getAdminPrepDashboardData.mockResolvedValue({
      commissionRecords: [{
        id: "commission-625",
        sellerId: "seller-625",
        paymentStatus: "pending",
        paymentExpectedAmount: 6.25,
        paymentExpectedAmountMode: "unique_v1",
        paymentExpectedAmountAssignedAt: new Date(assignedAt).toISOString(),
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronGridTransfer("6250000", assignedAt + 30_000))));

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(mocks.submitSellerCommissionWalletPayment).toHaveBeenCalledWith({
      sellerUserId: "seller-625",
      commissionId: "commission-625",
      network: "TRC20",
      payerWalletAddress: "TPayerWalletAddress111111111111111111",
      paymentSignature: TX_ID,
    });
    expect(mocks.reverifyPendingCommissionPayments).toHaveBeenCalledWith({ limit: 1 });
    const body = await response.json();
    expect(body.autoReconciliation).toMatchObject({ matched: 1, verified: 1, legacyMatched: 0, errors: 0 });
  });

  it("backfills a legacy base-amount payment made after commission creation but before the later assignment timestamp", async () => {
    const createdAt = Date.now() - 60 * 60_000;
    const assignedAt = Date.now() - 60_000;
    const transferAt = createdAt + 10 * 60_000;
    mocks.getAdminPrepDashboardData.mockResolvedValue({
      commissionRecords: [{
        id: "legacy-commission-625",
        sellerId: "legacy-seller-625",
        commissionAmount: 6.25,
        createdAt: new Date(createdAt).toISOString(),
        paymentStatus: "pending",
        paymentExpectedAmount: 6.25,
        paymentExpectedAmountMode: "legacy_base",
        paymentExpectedAmountAssignedAt: new Date(assignedAt).toISOString(),
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronGridTransfer("6250000", transferAt))));

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(mocks.submitSellerCommissionWalletPayment).toHaveBeenCalledWith({
      sellerUserId: "legacy-seller-625",
      commissionId: "legacy-commission-625",
      network: "TRC20",
      payerWalletAddress: "TPayerWalletAddress111111111111111111",
      paymentSignature: TX_ID,
    });
    const body = await response.json();
    expect(body.autoReconciliation).toMatchObject({ matched: 1, verified: 1, legacyMatched: 1, errors: 0 });
  });

  it("does not credit a unique-v1 transfer sent before the exact payment intent was assigned", async () => {
    const assignedAt = Date.now() - 60_000;
    mocks.getAdminPrepDashboardData.mockResolvedValue({
      commissionRecords: [{
        id: "commission-625",
        sellerId: "seller-625",
        paymentStatus: "pending",
        paymentExpectedAmount: 6.25,
        paymentExpectedAmountMode: "unique_v1",
        paymentExpectedAmountAssignedAt: new Date(assignedAt).toISOString(),
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronGridTransfer("6250000", assignedAt - 10 * 60_000))));

    await GET(request(`Bearer ${SECRET}`));
    expect(mocks.submitSellerCommissionWalletPayment).not.toHaveBeenCalled();
  });

  it("does not credit a legacy transfer made before its commission existed", async () => {
    const createdAt = Date.now() - 60_000;
    mocks.getAdminPrepDashboardData.mockResolvedValue({
      commissionRecords: [{
        id: "legacy-commission-625",
        sellerId: "legacy-seller-625",
        commissionAmount: 6.25,
        createdAt: new Date(createdAt).toISOString(),
        paymentStatus: "pending",
        paymentExpectedAmount: 6.25,
        paymentExpectedAmountMode: "legacy_base",
        paymentExpectedAmountAssignedAt: new Date().toISOString(),
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronGridTransfer("6250000", createdAt - 10 * 60_000))));

    await GET(request(`Bearer ${SECRET}`));
    expect(mocks.submitSellerCommissionWalletPayment).not.toHaveBeenCalled();
  });

  it("does not guess when two unpaid legacy records share the same base amount", async () => {
    const createdAt = Date.now() - 60_000;
    mocks.getAdminPrepDashboardData.mockResolvedValue({
      commissionRecords: ["one", "two"].map((id) => ({
        id,
        sellerId: `seller-${id}`,
        commissionAmount: 6.25,
        createdAt: new Date(createdAt).toISOString(),
        paymentStatus: "pending",
        paymentExpectedAmount: 6.25,
        paymentExpectedAmountMode: "legacy_base",
        paymentExpectedAmountAssignedAt: new Date().toISOString(),
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tronGridTransfer("6250000", createdAt + 30_000))));

    await GET(request(`Bearer ${SECRET}`));
    expect(mocks.submitSellerCommissionWalletPayment).not.toHaveBeenCalled();
  });

  it("keeps submitted-TxID verification running when the deposit scanner is unavailable", async () => {
    mocks.getAdminPrepDashboardData.mockResolvedValue({
      commissionRecords: [{
        id: "commission-625",
        sellerId: "seller-625",
        paymentStatus: "pending",
        paymentExpectedAmount: 6.25,
        paymentExpectedAmountMode: "unique_v1",
        paymentExpectedAmountAssignedAt: new Date(Date.now() - 60_000).toISOString(),
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response));

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(mocks.reverifyPendingCommissionPayments).toHaveBeenCalledWith({ limit: 2 });
    const body = await response.json();
    expect(body.autoReconciliation.errors).toBe(1);
  });
});
