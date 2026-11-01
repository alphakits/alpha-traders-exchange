import { calculateFiatAmount, calculateTradeBuyerFiatFee, calculateTradePaymentTotal, RECEIPT_EVENT_LABELS, type TradeCompletionReceipt } from "@alpha-traders/contracts";
import { publicAccountId } from "@/lib/public-account-identity";
import { normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import type { CommissionRecord, PurchaseRequest } from "@/types/alpha-exchange";

const decimal = (value: unknown): string | null => typeof value === "string" && /^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/.test(value) ? value : null;
const timestamp = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const commissionAmount = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 ? value.toFixed(6).replace(/\.?0+$/, "") || "0" : null;

function recordedFiatTotal(value: unknown): string | null {
  const regular = decimal(value);
  if (regular !== null) return regular;
  // Older records sometimes stored the result of a JS multiplication, e.g.
  // 0.1 * 3.2 = "0.32000000000000006". Only remove sub-nanounit noise;
  // preserve any materially different saved decimal instead of guessing a price.
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,29})\.\d{7,24}$/.test(value)) return null;
  const fraction = value.split(".")[1]!;
  const scale = BigInt(10) ** BigInt(fraction.length);
  const hundred = BigInt(100);
  const exact = BigInt(value.replace(".", "")) * hundred;
  const cents = (exact + scale / BigInt(2)) / scale;
  const difference = exact >= cents * scale ? exact - cents * scale : cents * scale - exact;
  if (difference * BigInt(1_000_000_000) > hundred * scale) return value;
  return `${cents / hundred}.${(cents % hundred).toString().padStart(2, "0")}`;
}

const comparableDecimal = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

export function buildTradeReceipt(request: PurchaseRequest, commission?: CommissionRecord, source: TradeCompletionReceipt["source"] = "historical_record"): TradeCompletionReceipt | undefined {
  if (!["completed", "review_open", "locked"].includes(request.status) || (!request.completedAt && !request.historicalCompletion && !request.historicalCompletionSummary && !request.timeline?.some(e => e.type === "trade_completed"))) return;
  const amount = decimal(request.usdtAmount);
  const total = recordedFiatTotal(request.fiatAmount);
  if (!amount || !total) return;
  const price = decimal(request.pricePerUsdt);
  const includesBuyerFee = request.feePolicyVersion === "buyer_seller_1pct_v1";
  const expectedTotal = price && calculateTradePaymentTotal(amount, price, includesBuyerFee);
  const reconciles = Boolean(expectedTotal && comparableDecimal(expectedTotal) === comparableDecimal(total));
  const linkedCommission = commission?.purchaseRequestId === request.id && commission.sellerId === request.sellerId ? commission : undefined;
  const method = normalizeMarketplacePaymentMethod(request.paymentMethod);
  return {
    version: 1,
    receiptNumber: `ATR-${request.id}`,
    tradeReference: request.displayNumber ? `#${request.displayNumber}` : request.tradeId ?? request.id,
    source,
    ...(request.historicalCompletion?.fiatAmountBasis || request.historicalCompletionSummary?.fiatAmountBasis ? { fiatAmountBasis: "saved_quote_reconstruction" as const } : {}),
    createdAt: timestamp(request.createdAt),
    // Never use updatedAt: reviews, administrative corrections and fee payments change it.
    completedAt: timestamp(request.completedAt),
    buyerPublicId: publicAccountId({ id: request.buyerId }),
    sellerPublicId: publicAccountId({ id: request.sellerId }),
    usdtAmount: amount,
    currency: /^[A-Z]{3}$/.test(request.currency) ? request.currency : "—",
    pricePerUsdt: price,
    baseFiatAmount: reconciles && price ? calculateFiatAmount(amount, price) : !includesBuyerFee ? total : null,
    buyerFeeFiat: !includesBuyerFee ? "0.00" : reconciles && price ? calculateTradeBuyerFiatFee(amount, price) : null,
    fiatAmount: total,
    buyerFeeUsdt: linkedCommission ? commissionAmount(linkedCommission.buyerFeeCollectedAmount ?? (includesBuyerFee ? undefined : 0)) : null,
    sellerFeeUsdt: linkedCommission ? commissionAmount(linkedCommission.sellerFeeAmount ?? (!includesBuyerFee ? linkedCommission.commissionAmount : undefined)) : null,
    totalPlatformFeeUsdt: commissionAmount(linkedCommission?.commissionAmount),
    network: ["TRC20", "BEP20", "ERC20", "SOL"].includes(request.network) ? request.network : "—",
    paymentMethod: request.bankTransferProvider === "wise" ? "Wise (USD)" : method === "Cardless ATM Withdrawal" ? "Cardless ATM" : method === "Face-to-Face (Meet in Person)" ? "Face-to-Face" : method ?? "—",
    history: (request.timeline ?? []).filter(entry => Object.hasOwn(RECEIPT_EVENT_LABELS, entry.type) && timestamp(entry.createdAt)).map(entry => ({
      event: entry.type,
      at: timestamp(entry.createdAt)!,
      actor: entry.actorUserId === request.buyerId ? "buyer" as const : entry.actorUserId === request.sellerId ? "seller" as const : entry.actorRole === "owner" ? "owner" as const : entry.actorRole === "admin" ? "admin" as const : "system" as const,
    })).sort((a, b) => a.at.localeCompare(b.at)),
  };
}
