// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateBuyerFiatFee, calculateCardlessUsdtAmount, calculateFiatAmount,
  calculateSellerCommissionAmount, calculateSellerTotalAlphaDue,
  calculateTradeBuyerFiatFee, calculateTradePaymentTotal,
} from "@alpha-traders/contracts";
import { demandTestDb, demandTestListing, demandTestTerms, DEMAND_TEST_WALLET } from "@/test-utils/usdt-demand-fixtures";
import { offerDemand, publishDemand, readDemands } from "@/lib/usdt-demand-store";
import {
  createPurchaseRequest, getSellerCommissionStatus, getTradeRoomData,
  invalidateAlphaExchangeStoreCache, updatePurchaseRequestStatus,
} from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import type { DemandTerms } from "@/types/usdt-demand";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", async () => {
  const { demandTestMarket } = await import("@/test-utils/usdt-demand-fixtures");
  return { DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: async () => demandTestMarket(3.1), getUsdtIlsReferenceRate: async () => 3.1 };
});

beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  vi.stubEnv("ALPHA_EXCHANGE_QA_COMMISSION_MODE", "0");
  globalThis.__alphaExchangeMemorySnapshot = structuredClone(demandTestDb());
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const stored = async () => (await getAlphaExchangeRepository()).loadSnapshot();
const FACE_TO_FACE = "Face-to-Face (Meet in Person)";

describe("Buy Request exact fee contract", () => {
  it.each([
    { amount: "660.6607", price: "3.10", subtotal: "2048.05", buyerFiat: "20.48", total: "2068.53", eachUsdt: 6.606607, dueUsdt: 13.213214 },
    { amount: "660.6607", price: "3.25", subtotal: "2147.15", buyerFiat: "21.47", total: "2168.62", eachUsdt: 6.606607, dueUsdt: 13.213214 },
    { amount: "100.5", price: "3.23", subtotal: "324.62", buyerFiat: "3.24", total: "327.86", eachUsdt: 1.005, dueUsdt: 2.01 },
    { amount: "415.202811", price: "3.10", subtotal: "1287.13", buyerFiat: "12.87", total: "1300.00", eachUsdt: 4.152028, dueUsdt: 8.304056 },
  ])("keeps every displayed and settled share exact for $amount USDT at $price", ({ amount, price, subtotal, buyerFiat, total, eachUsdt, dueUsdt }) => {
    expect(calculateFiatAmount(amount, price)).toBe(subtotal);
    expect(calculateTradeBuyerFiatFee(amount, price)).toBe(buyerFiat);
    expect(calculateTradePaymentTotal(amount, price, true)).toBe(total);
    expect(BigInt(subtotal.replace(".", "")) + BigInt(buyerFiat.replace(".", ""))).toBe(BigInt(total.replace(".", "")));
    expect(calculateSellerCommissionAmount(amount)).toBe(eachUsdt);
    expect(calculateSellerTotalAlphaDue(amount)).toBe(dueUsdt);
  });

  it("allocates the cent to the buyer fee instead of rounding the subtotal twice", () => {
    // Raw subtotal 324.615; inclusive raw total 327.86115 rounds to 327.86.
    // Adding 1% of the already-rounded subtotal would incorrectly charge 327.87.
    expect(calculateBuyerFiatFee("324.62")).toBe("3.25");
    expect(calculateTradeBuyerFiatFee("100.5", "3.23")).toBe("3.24");
    expect(calculateTradePaymentTotal("100.5", "3.23", true)).toBe("327.86");
  });
});

describe("Buy Request commission through canonical completion", () => {
  it.each([
    { method: FACE_TO_FACE, amount: "660.6607", responsePrice: "3.25", fiat: "2168.62", fee: 6.606607, due: 13.213214, remaining: "9339.3393", rollback: false },
    { method: FACE_TO_FACE, amount: "100.5", responsePrice: "3.23", fiat: "327.86", fee: 1.005, due: 2.01, remaining: "9899.5", rollback: false },
    { method: "Cardless ATM Withdrawal", amount: "415.202811", responsePrice: "3.10", fiat: "1300.00", fee: 4.152028, due: 8.304056, remaining: "9584.797189", rollback: false },
    { method: "Cardless ATM Withdrawal", amount: "415.202811", responsePrice: "3.10", fiat: "1300.00", fee: 4.152028, due: 8.304056, remaining: "9584.797189", rollback: true },
  ])("settles $amount USDT via $method at response price $responsePrice exactly once (feature-off rollback=$rollback)", async ({ method, amount, responsePrice, fiat, fee, due, remaining, rollback }) => {
    const cashAtm = method === "Cardless ATM Withdrawal";
    const db = globalThis.__alphaExchangeMemorySnapshot!;
    db.marketplaceListings = [demandTestListing("seller", method)];
    const terms: DemandTerms = { ...demandTestTerms(), amount, price: "3.10", paymentMethod: method as DemandTerms["paymentMethod"], city: cashAtm ? "" : "Haifa" };
    if (cashAtm) expect(calculateCardlessUsdtAmount("1300", "3.10", true)).toBe(amount);
    const demand = await publishDemand("buyer", { terms, operationId: randomUUID() });
    const offer = await offerDemand("seller", demand.id, { listingId: "listing-seller", revision: 1, price: responsePrice, operationId: randomUUID() });
    const match = {
      buyerId: "buyer", actorUserId: "buyer", buyerName: "Private buyer", listingId: "listing-seller", usdtAmount: amount,
      buyerReceivingWalletAddress: DEMAND_TEST_WALLET, receivingNetwork: "TRC20", paymentMethod: method,
      feePolicyVersion: "buyer_seller_1pct_v1" as const, usdtDemandId: demand.id, usdtDemandOfferId: offer.id, usdtDemandRevision: 1,
      safetyAcknowledged: true,
      ...(cashAtm ? { bankName: "Bank Hapoalim", cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth" as const, cardlessVerificationValue: "25/08/1995", cardlessIlsAmount: "1300" } : {}),
    };
    const { request } = await createPurchaseRequest(match);
    expect(request).toMatchObject({ usdtAmount: amount, pricePerUsdt: responsePrice, fiatAmount: fiat, feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2" });
    expect((await stored()).commissionRecords).toHaveLength(0);

    if (rollback) {
      // The rollback closes discovery and new matches, while the canonical
      // Trade Room must retain its prepared credentials, inventory and fees.
      vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0");
      await expect(readDemands("buyer", {})).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE", status: 404 });
      await expect(publishDemand("buyer", { terms, operationId: randomUUID() })).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
      await expect(offerDemand("seller", demand.id, { listingId: "listing-seller", revision: 1, price: responsePrice, operationId: randomUUID() })).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
      await expect(createPurchaseRequest(match)).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    }

    const seller = { requestId: request.id, actorUserId: "seller", actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "accepted", safetyAcknowledged: true });
    if (cashAtm) await updatePurchaseRequestStatus({ requestId: request.id, actorUserId: "buyer", actorRole: "buyer", nextStatus: "payment_sent", usePreparedCardlessDetails: true, clientOperationId: randomUUID() });
    for (const [actorUserId, actorRole] of [["buyer", "buyer"], ["seller", "approved_seller"]] as const) {
      const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId, actorRole, markMessagesRead: false });
      expect(room.request).toMatchObject({ usdtAmount: amount, pricePerUsdt: responsePrice, fiatAmount: fiat });
    }
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "funds_received" });
    await updatePurchaseRequestStatus({ ...seller, nextStatus: "usdt_sent" });
    const complete = { ...seller, nextStatus: "completed" as const, completionMode: "cash_trade" as const };
    await Promise.all([updatePurchaseRequestStatus(complete), updatePurchaseRequestStatus(complete)]);
    await updatePurchaseRequestStatus(complete);
    // Replaying the original Buy Request match also returns the same completed trade.
    if (!rollback) expect((await createPurchaseRequest(match)).request.id).toBe(request.id);

    const snapshot = await stored();
    expect(snapshot.purchaseRequests).toHaveLength(1);
    expect(snapshot.usdtDemands!.find(item => item.id === demand.id)?.purchaseRequestId).toBe(request.id);
    expect(snapshot.purchaseRequests[0]).toMatchObject({ usdtAmount: amount, fiatAmount: fiat, status: "review_open" });
    expect(snapshot.purchaseRequests[0].completedAt).toBeTruthy();
    expect(snapshot.marketplaceListings[0].availableAmount).toBe(remaining);
    expect(snapshot.commissionRecords).toEqual([expect.objectContaining({
      purchaseRequestId: request.id, feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
      sellerFeeAmount: fee, buyerFeeCollectedAmount: fee, commissionAmount: due, grossAmount: Number(fiat), paymentStatus: "pending",
    })]);
    expect(await getSellerCommissionStatus("seller")).toMatchObject({ amountDue: due, pendingCount: 1 });
    const room = await getTradeRoomData({ purchaseRequestId: request.id, actorUserId: "seller", actorRole: "approved_seller", markMessagesRead: false });
    expect(room.sellerCommissionDueAmount).toBe(due);
    expect(room.sellerPayableCommissionAmount).toBe(due);
  });
});
