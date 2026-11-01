import { describe, expect, it } from "vitest";
import type { BuyerVolumeCredit, PurchaseRequest, SellerReviewRecord } from "@/types/alpha-exchange";
import { getBuyerPrestigeProgress } from "@/lib/buyer-rank";
import { effectiveBuyerPurchaseMicros, isCompletedBuyerPurchase, summarizeBuyerPurchases, validatedBuyerVolumeCredit } from "@/lib/buyer-purchase-progress";

const recordedAt = "2026-11-01T15:00:00.000Z";
function purchase(id: string, amount: string, overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return { id, buyerId: "buyer", sellerId: "seller", listingId: "listing", usdtAmount: amount, fiatAmount: "1000", pricePerUsdt: "3.2",
    status: "completed", timeline: [], createdAt: recordedAt, updatedAt: recordedAt, ...overrides } as PurchaseRequest;
}
function credit(request: PurchaseRequest, overrides: Partial<BuyerVolumeCredit> = {}): BuyerVolumeCredit {
  return { source: "owner_attestation", operationId: "buyer-credit-test-0001", inputFingerprint: "a".repeat(64), recordedAt,
    recordedByUserId: "owner", reason: "Owner confirmed the complete historical purchase.", requestId: request.id,
    buyerId: request.buyerId, settledUsdtAmount: request.usdtAmount, creditedUsdtAmount: "15000", ...overrides };
}

describe("canonical buyer purchase progress", () => {
  it("credits the attested full purchase once while preserving settled terms and the other buyer", () => {
    const target = purchase("target", "14672.940267");
    target.buyerVolumeCredit = credit(target);
    const other = purchase("other", "327.059733", { buyerId: "other-buyer" });
    const original = structuredClone([target, other]);
    for (let index = 0; index < 2; index++) {
      const result = summarizeBuyerPurchases([target, other], "buyer");
      expect(result).toEqual({ lifetimeCompletedVolumeUsdt: 15000, completedTrades: 1, activeTrades: 0, reviewsGiven: 0 });
      expect(getBuyerPrestigeProgress(result.lifetimeCompletedVolumeUsdt)).toMatchObject({ rank: "silver", nextRank: "gold", remainingVolumeUsdt: 35000 });
      expect(summarizeBuyerPurchases([target, other], "other-buyer")).toMatchObject({ lifetimeCompletedVolumeUsdt: 327.059733, completedTrades: 1 });
    }
    expect([target, other]).toEqual(original);
  });

  it.each([
    { source: "unverified" }, { operationId: "bad" }, { inputFingerprint: "bad" }, { recordedAt: "bad" },
    { recordedAt: "2026-11-01" }, { recordedByUserId: "" }, { reason: " " }, { reason: "x".repeat(1001) },
    { requestId: "another-trade" }, { buyerId: "another-buyer" }, { settledUsdtAmount: "14672.94" },
    { creditedUsdtAmount: "-15000" }, { creditedUsdtAmount: "15000oops" }, { creditedUsdtAmount: "15000.0000001" },
    { creditedUsdtAmount: "15,000" }, { creditedUsdtAmount: "1000" },
  ])("ignores a credit that fails its trade, value, or provenance binding: %j", invalid => {
    const request = purchase("target", "14672.940267");
    request.buyerVolumeCredit = credit(request, invalid as Partial<BuyerVolumeCredit>);
    expect(validatedBuyerVolumeCredit(request)).toBeNull();
    expect(effectiveBuyerPurchaseMicros(request)).toBe(BigInt("14672940267"));
  });

  it("does not create completion or review achievements from a credit marker", () => {
    const request = purchase("pending", "14672.940267", { status: "pending" });
    request.buyerVolumeCredit = credit(request);
    expect(validatedBuyerVolumeCredit(request)).toBeNull();
    expect(summarizeBuyerPurchases([request], "buyer")).toEqual({ lifetimeCompletedVolumeUsdt: 0, completedTrades: 0, activeTrades: 1, reviewsGiven: 0 });
  });

  it("keeps exact micro-USDT precision on both sides of a rank threshold", () => {
    const requests = [purchase("first", "14999.994"), purchase("second", "0.002")];
    const below = summarizeBuyerPurchases(requests, "buyer");
    expect(below.lifetimeCompletedVolumeUsdt).toBe(14999.996);
    expect(getBuyerPrestigeProgress(below.lifetimeCompletedVolumeUsdt).rank).toBe("bronze");
    requests.push(purchase("third", "0.004"));
    expect(summarizeBuyerPurchases(requests, "buyer").lifetimeCompletedVolumeUsdt).toBe(15000);
    expect(getBuyerPrestigeProgress(summarizeBuyerPurchases(requests, "buyer").lifetimeCompletedVolumeUsdt).rank).toBe("silver");
  });

  it("preserves valid historical grouped amounts without turning malformed values into credit", () => {
    const valid = ["350,000", "75,000", "25,000", "6,000", "١٬٠٠٠٫٥"];
    const invalid = ["-500000", "NaN", "Infinity", "15000oops", "1e5", "0", "1,20,000", "15000.0000001"];
    const requests = [...valid, ...invalid].map((amount, index) => purchase(`purchase-${index}`, amount));
    expect(summarizeBuyerPurchases(requests, "buyer")).toMatchObject({ lifetimeCompletedVolumeUsdt: 457000.5, completedTrades: requests.length });
  });

  it("uses completion evidence consistently while excluding other buyers and unfinished review states", () => {
    const requests = [
      purchase("completed", "100"), purchase("review-completed", "100", { status: "review_open", completedAt: recordedAt }),
      purchase("locked-completed", "100", { status: "locked", completedAt: recordedAt }),
      purchase("historical-cancelled", "100", { status: "cancelled", completedAt: recordedAt }),
      purchase("other", "500000", { buyerId: "other" }),
      purchase("uncompleted-review", "500000", { status: "review_open" }),
      purchase("uncompleted-locked", "500000", { status: "locked" }),
      purchase("invalid-completion", "500000", { status: "locked", completedAt: "bad" }),
      purchase("pending", "500000", { status: "pending" }),
    ];
    expect(summarizeBuyerPurchases(requests, "buyer")).toEqual({ lifetimeCompletedVolumeUsdt: 400, completedTrades: 4, activeTrades: 1, reviewsGiven: 0 });
  });

  it("recognizes historical owner completion without inventing a completion timestamp", () => {
    const request = purchase("historical", "14672.940267", { status: "locked" });
    request.historicalCompletion = { ...credit(request), offlineCompletionConfirmed: true, reconciledUsdtAmount: request.usdtAmount,
      reconstructedFiatAmount: "47000", fiatAmountBasis: "saved_quote_reconstruction", listingTotalUsdt: "15000", preservedCompletedRequestIds: ["earlier"],
      originalTerms: { status: "cancelled", usdtAmount: "15000", fiatAmount: "48000", pricePerUsdt: "3.2" }, stateHash: "b".repeat(64), planHash: "c".repeat(64) };
    expect(request.completedAt).toBeUndefined();
    expect(isCompletedBuyerPurchase(request)).toBe(true);
    expect(summarizeBuyerPurchases([request], "buyer")).toMatchObject({ lifetimeCompletedVolumeUsdt: 14672.940267, completedTrades: 1 });
  });

  it("counts written reviews once and only for that buyer's completed purchase", () => {
    const reviewed = purchase("reviewed", "100", { tradeId: "trade-reviewed", buyerReview: { reviewerUserId: "buyer", rating: 5, comment: "Good", createdAt: recordedAt } });
    const canonicalOnly = purchase("canonical", "100", { tradeId: "trade-canonical" });
    const review = (tradeId: string, buyerId = "buyer") => ({ tradeId, buyerId } as SellerReviewRecord);
    const reviews = [review("trade-reviewed"), review("trade-canonical"), review("trade-canonical"), review("unrelated"), review("third", "other-buyer")];
    expect(summarizeBuyerPurchases([reviewed, canonicalOnly, purchase("third", "100")], "buyer", reviews)).toMatchObject({ completedTrades: 3, reviewsGiven: 2 });
  });
});
