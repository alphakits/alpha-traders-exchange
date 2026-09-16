import type { MobileTradeDetail, MobileTradeStatus } from "@alpha-traders/contracts";

export type MobileTradeGuidanceTarget = "hero" | "wallet" | "actions" | "review";

type TradeActionFlags = MobileTradeDetail["actions"];

const TERMINAL_STATUSES = new Set<MobileTradeStatus>(["declined", "cancelled", "completed", "review_open", "locked"]);

export function hasImmediateMobileTradeAction(actions: TradeActionFlags) {
  return Boolean(
    actions.canAccept
    || actions.canDecline
    || actions.canCancel
    || actions.canMarkPaymentSent
    || actions.canUploadPaymentEvidence
    || actions.canConfirmFunds
    || actions.canBeginRelease
    || actions.canMarkUsdtSent
    || actions.canUploadReleaseEvidence
    || actions.canConfirmReceived
    || actions.canCompleteFaceToFace,
  );
}

export function mobileTradeGuidanceTarget(trade: Pick<MobileTradeDetail, "actions" | "receivingWalletAddress" | "side" | "status">): MobileTradeGuidanceTarget {
  if (trade.actions.canSubmitReview || trade.actions.canRespondToReview) return "review";
  if (hasImmediateMobileTradeAction(trade.actions)) return "actions";
  if (trade.side === "seller" && trade.receivingWalletAddress && ["funds_received", "usdt_release_pending"].includes(trade.status)) return "wallet";
  return "hero";
}

export function shouldGuideMobileTradeStatus(previousStatus: MobileTradeStatus | null, nextStatus: MobileTradeStatus) {
  if (!previousStatus || previousStatus === nextStatus) return false;
  return !TERMINAL_STATUSES.has(previousStatus);
}
