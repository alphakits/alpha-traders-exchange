import { hasIrreversibleRequestProgress } from "@/lib/trade-cancellation";
import type { PurchaseRequest } from "@/types/alpha-exchange";

export function isFinishedTrade(request: PurchaseRequest) {
  return Boolean(request.completedAt) || ["completed", "review_open", "locked"].includes(request.status);
}

/** UI availability only; mutations recheck the canonical record on the server. */
export function adminTradeActions(request: PurchaseRequest, hasOpenDispute: boolean, isOwner: boolean) {
  const completed = isFinishedTrade(request);
  const cancelled = request.status === "cancelled" || request.status === "declined";
  return {
    completed,
    cancelled,
    canComplete: !completed && (isOwner || (!hasOpenDispute && !cancelled && request.status !== "pending" && request.termsProposal?.status !== "pending")),
    canClose: !cancelled && (isOwner
      ? !completed || !request.closedAt
      : !hasOpenDispute && !request.closedAt && !completed && !hasIrreversibleRequestProgress(request)),
    canUnlockReview: completed && (isOwner || !hasOpenDispute),
  };
}
