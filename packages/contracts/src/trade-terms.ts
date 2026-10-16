import { calculateCardlessUsdtAmount } from "./cardless-withdrawal";
import { calculateTradePaymentTotal, calculateUsdtForPaymentTotal, MARKETPLACE_FEE_POLICY } from "./marketplace-fees";
import { canonicalizeTradeAmount } from "./trade-amount";

export type TradeTermsCalculationAction = "counter_offer" | "propose_amount" | "propose_ils_amount";

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
    usdtAmount = cardless ? calculateCardlessUsdtAmount(trade.fiatAmount, pricePerUsdt, includesBuyerFee) : canonicalizeTradeAmount(trade.usdtAmount);
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
  if (!fiatAmount || fiatAmount === "0.00") return null;
  return { usdtAmount, fiatAmount, pricePerUsdt };
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
