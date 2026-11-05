import { calculateCardlessUsdtAmount, parseCardlessCashAmount } from "./cardless-withdrawal";
import { calculateTradePaymentTotal, calculateUsdtForPaymentTotal, MARKETPLACE_FEE_POLICY } from "./marketplace-fees";
import { canonicalizeTradeAmount } from "./trade-amount";
import { isSellerCounterPrice, normalizeListingPrice } from "./price-offer";

export type TradeTermsCalculationAction = "counter_offer" | "propose_amount" | "propose_ils_amount";
export const CARDLESS_COUNTER_CALCULATION_POLICY = "cardless_fixed_cash_v1" as const;

/** Shared preview and server calculation. A quote is applied only after buyer approval. */
export function calculateTradeTermsQuote(trade: {
  paymentMethod: string; currency: string; usdtAmount: string; fiatAmount: string;
  pricePerUsdt?: string; listingPriceAtRequest?: string; feePolicyVersion?: string;
}, action: TradeTermsCalculationAction, value: string) {
  const raw = canonicalizeTradeAmount(value);
  if (!raw || ((action === "counter_offer" || action === "propose_ils_amount") && trade.currency !== "ILS")) return null;
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(raw)) return null;
  const price = canonicalizeTradeAmount(action === "counter_offer" ? raw : trade.pricePerUsdt || trade.listingPriceAtRequest);
  if (!price || !/^\d{1,7}(?:\.\d{1,2})?$/.test(price)) return null;
  const pricePerUsdt = Number(price).toFixed(2);
  const includesBuyerFee = trade.feePolicyVersion === MARKETPLACE_FEE_POLICY;
  const cardless = trade.paymentMethod === "Cardless ATM Withdrawal";
  if (cardless && trade.currency !== "ILS") return null;
  let usdtAmount: string | null;
  if (action === "counter_offer") {
    // ATM codes represent a cash amount in whole ₪100 steps. A new rate must
    // quote the USDT that same cash buys, including the existing buyer fee.
    // The original terms remain unchanged until the buyer accepts this quote.
    usdtAmount = cardless
      ? calculateCardlessUsdtAmount(trade.fiatAmount, pricePerUsdt, includesBuyerFee)
      : canonicalizeTradeAmount(trade.usdtAmount);
  } else if (action === "propose_ils_amount") {
    usdtAmount = cardless ? calculateCardlessUsdtAmount(raw, pricePerUsdt, includesBuyerFee) : calculateUsdtForPaymentTotal(raw, pricePerUsdt, includesBuyerFee);
  } else {
    usdtAmount = raw;
    if (cardless) {
      const total = calculateTradePaymentTotal(raw, pricePerUsdt, includesBuyerFee);
      if (!total || calculateCardlessUsdtAmount(total, pricePerUsdt, includesBuyerFee) !== raw) return null;
    }
  }
  if (!usdtAmount) return null;
  const fiatAmount = calculateTradePaymentTotal(usdtAmount, pricePerUsdt, includesBuyerFee);
  if (!fiatAmount || fiatAmount === "0.00" || (cardless && !parseCardlessCashAmount(fiatAmount))) return null;
  return { usdtAmount, fiatAmount, pricePerUsdt };
}

/** Ordinary full-price purchases retain their separate pre-payment correction workflow. */
export function isNegotiatingQuantityFixed(trade: { status: string; priceMode?: string; usdtDemandId?: string; quantityFixed?: boolean }) {
  return trade.status === "pending" && (trade.priceMode === "buyer_offer" || Boolean(trade.usdtDemandId) || trade.quantityFixed === true);
}

/** Include the last persisted proposal for requests created by older clients. */
export function submittedCounterPrices(trade: {
  counterPrices?: readonly string[];
  termsProposal?: { kind: string; pricePerUsdt: string };
}) {
  const prices = new Set(trade.counterPrices ?? []);
  if (trade.termsProposal?.kind === "counter_offer") prices.add(trade.termsProposal.pricePerUsdt);
  return [...prices];
}

export function tradeCounterPriceIssue(trade: {
  paymentMethod?: string; pricePerUsdt?: string; listingPriceAtRequest?: string; counterPrices?: readonly string[];
  termsProposal?: { kind: string; pricePerUsdt: string };
}, value: string, liveListingPrice?: string, locale = "en") {
  const ceiling = normalizeListingPrice(liveListingPrice ?? trade.listingPriceAtRequest) ?? "";
  const quotedCeiling = normalizeListingPrice(trade.listingPriceAtRequest ?? ceiling) ?? "";
  const max = Number(ceiling) < Number(quotedCeiling) ? ceiling : quotedCeiling;
  const raw = canonicalizeTradeAmount(value) || "";
  if (!isSellerCounterPrice(trade.pricePerUsdt, quotedCeiling, raw, ceiling)) {
    const cardless = trade.paymentMethod === "Cardless ATM Withdrawal";
    return locale === "ar" ? `السعر لازم يكون أعلى من ₪${trade.pricePerUsdt} ولحدّ ₪${max}.${cardless ? "" : " كمية USDT ثابتة."}`
      : `Enter a rate above ₪${trade.pricePerUsdt} and up to ₪${max}.${cardless ? "" : " The USDT quantity is fixed."}`;
  }
  if (submittedCounterPrices(trade).some(previous => Number(previous) === Number(raw))) {
    return locale === "ar" ? "سبق وأرسلت هذا السعر." : "You already proposed this rate.";
  }
  return null;
}

export const MAX_TRADE_AMOUNT_ADJUSTMENTS = 2;

/** Submitted financial proposals consume a turn, even if declined or withdrawn. */
export function getTradeAmountAdjustmentCount(trade: {
  amountAdjustmentCount?: number;
  termsProposal?: { id: string };
  messages?: Array<{ kind?: string; message: string }>;
}) {
  const stored = trade.amountAdjustmentCount;
  // Legacy trades retain proposal history in server-authored system messages.
  const history = trade.messages?.filter(entry => entry.kind === "system"
    && /^Seller proposed .+ Buyer confirmation required\.$/.test(entry.message)).length ?? 0;
  const count = stored === undefined ? 0
    : Number.isSafeInteger(stored) && stored >= 0 ? stored : MAX_TRADE_AMOUNT_ADJUSTMENTS;
  return Math.min(MAX_TRADE_AMOUNT_ADJUSTMENTS, Math.max(count, history, trade.termsProposal ? 1 : 0));
}
