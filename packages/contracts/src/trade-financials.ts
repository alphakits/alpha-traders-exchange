import {
  calculateBuyerCommissionAmount,
  calculateLegacySellerCommissionAmount,
  calculateLegacySellerTotalAlphaDue,
  calculateSellerCommissionAmount,
  calculateSellerTotalAlphaDue,
  commissionAmountInput,
  COMMISSION_CALCULATION_VERSION,
} from "./commission-amount";
import {
  calculateFiatAmount,
  calculateTradeBuyerFiatFee,
  calculateTradePaymentTotal,
  MARKETPLACE_FEE_POLICY,
} from "./marketplace-fees";

export type TradeFinancialBreakdown = {
  subtotal: string;
  buyerFiatFee: string;
  fiatAmount: string;
  sellerFeeUsdt: string;
  buyerFeeUsdt: string;
  totalCommissionUsdt: string;
};

/** Preview and settlement share the issued fee policy and commission precision. */
export function calculateTradeFinancialBreakdown(trade: {
  usdtAmount: string;
  pricePerUsdt: string;
  feePolicyVersion?: string;
  commissionCalculationVersion?: string;
}): TradeFinancialBreakdown | null {
  const includesBuyerFee = trade.feePolicyVersion === MARKETPLACE_FEE_POLICY;
  const preciseCommission = trade.commissionCalculationVersion === COMMISSION_CALCULATION_VERSION;
  const subtotal = calculateFiatAmount(trade.usdtAmount, trade.pricePerUsdt);
  const fiatAmount = calculateTradePaymentTotal(trade.usdtAmount, trade.pricePerUsdt, includesBuyerFee);
  const buyerFiatFee = includesBuyerFee
    ? calculateTradeBuyerFiatFee(trade.usdtAmount, trade.pricePerUsdt)
    : "0.00";
  const sellerFee = preciseCommission
    ? calculateSellerCommissionAmount(trade.usdtAmount)
    : calculateLegacySellerCommissionAmount(trade.usdtAmount);
  const buyerFee = !includesBuyerFee ? 0 : preciseCommission
    ? calculateBuyerCommissionAmount(trade.usdtAmount)
    : calculateLegacySellerCommissionAmount(trade.usdtAmount);
  const totalCommission = !includesBuyerFee ? sellerFee : preciseCommission
    ? calculateSellerTotalAlphaDue(trade.usdtAmount)
    : calculateLegacySellerTotalAlphaDue(trade.usdtAmount);
  if (subtotal === null || buyerFiatFee === null || fiatAmount === null || fiatAmount === "0.00"
    || sellerFee === null || buyerFee === null || totalCommission === null) return null;
  return {
    subtotal,
    buyerFiatFee,
    fiatAmount,
    sellerFeeUsdt: commissionAmountInput(sellerFee),
    buyerFeeUsdt: commissionAmountInput(buyerFee),
    totalCommissionUsdt: commissionAmountInput(totalCommission),
  };
}
