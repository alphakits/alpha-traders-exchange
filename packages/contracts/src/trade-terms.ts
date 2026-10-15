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
