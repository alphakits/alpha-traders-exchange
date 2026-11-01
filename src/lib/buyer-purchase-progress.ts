import type { PurchaseRequest, SellerReviewRecord } from "@/types/alpha-exchange";
import { canonicalizeTradeAmount } from "@/lib/trade-amount";
import { isOwnerAttestedHistoricalCompletion } from "@/lib/historical-trade-reconciliation";

const TERMINAL_PURCHASE_STATUSES = new Set<PurchaseRequest["status"]>(["completed", "review_open", "locked", "declined", "cancelled"]);
const USDT_MICROS = BigInt(1_000_000);

function canonicalAmountMicros(value: unknown): { canonical: string; micros: bigint } | null {
  if (typeof value !== "string") return null;
  const canonical = canonicalizeTradeAmount(value);
  if (canonical === null) return null;
  const [whole, fraction = ""] = canonical.split(".");
  return { canonical, micros: BigInt(whole) * USDT_MICROS + BigInt(fraction.padEnd(6, "0")) };
}

/** Review and archive states alone do not establish that a purchase settled. */
export function isCompletedBuyerPurchase(request: PurchaseRequest): boolean {
  return request.status === "completed"
    || (typeof request.completedAt === "string" && Number.isFinite(Date.parse(request.completedAt)))
    || isOwnerAttestedHistoricalCompletion(request);
}

/** Server-owned provenance must describe this exact completed purchase. */
export function validatedBuyerVolumeCredit(request: PurchaseRequest) {
  if (!isCompletedBuyerPurchase(request)) return null;
  const settled = canonicalAmountMicros(request.usdtAmount);
  if (!settled) return null;
  const credit = request.buyerVolumeCredit;
  if (!credit) return null;
  const credited = canonicalAmountMicros(credit.creditedUsdtAmount);
  const recordedTime = typeof credit.recordedAt === "string" ? Date.parse(credit.recordedAt) : Number.NaN;
  if (credit.source !== "owner_attestation"
    || typeof credit.operationId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,119}$/.test(credit.operationId)
    || typeof credit.inputFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(credit.inputFingerprint)
    || !Number.isFinite(recordedTime) || new Date(recordedTime).toISOString() !== credit.recordedAt
    || typeof credit.recordedByUserId !== "string" || !credit.recordedByUserId.trim()
    || typeof credit.reason !== "string" || !credit.reason.trim() || credit.reason.length > 1000
    || credit.requestId !== request.id || credit.buyerId !== request.buyerId
    || credit.settledUsdtAmount !== settled.canonical
    || !credited || credited.canonical !== credit.creditedUsdtAmount || credited.micros < settled.micros) {
    return null;
  }
  return credit;
}

/** A credit changes buyer recognition only; settled trade terms remain intact. */
export function effectiveBuyerPurchaseMicros(request: PurchaseRequest): bigint {
  if (!isCompletedBuyerPurchase(request)) return BigInt(0);
  const settled = canonicalAmountMicros(request.usdtAmount);
  if (!settled) return BigInt(0);
  const credit = validatedBuyerVolumeCredit(request);
  return credit ? canonicalAmountMicros(credit.creditedUsdtAmount)!.micros : settled.micros;
}

/** One evidence and precision policy for account, public profile and buy cards. */
export function summarizeBuyerPurchases(
  requests: readonly PurchaseRequest[],
  buyerId: string,
  sellerReviews: readonly SellerReviewRecord[] = [],
) {
  const reviewedTradeIds = new Set(sellerReviews.filter(review => review.buyerId === buyerId).map(review => review.tradeId));
  let volumeMicros = BigInt(0);
  let completedTrades = 0;
  let activeTrades = 0;
  let reviewsGiven = 0;
  for (const request of requests) {
    if (request.buyerId !== buyerId) continue;
    if (isCompletedBuyerPurchase(request)) {
      completedTrades += 1;
      volumeMicros += effectiveBuyerPurchaseMicros(request);
      if (request.buyerReview || reviewedTradeIds.has(request.tradeId ?? request.id)) reviewsGiven += 1;
    } else if (!TERMINAL_PURCHASE_STATUSES.has(request.status)) {
      activeTrades += 1;
    }
  }
  return { lifetimeCompletedVolumeUsdt: Number(volumeMicros) / Number(USDT_MICROS), completedTrades, activeTrades, reviewsGiven };
}
