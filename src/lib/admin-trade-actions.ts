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
    canComplete: !hasOpenDispute && !completed && !cancelled && request.status !== "pending" && request.termsProposal?.status !== "pending",
    canClose: !hasOpenDispute && !request.closedAt && !cancelled
      && (completed ? isOwner : !hasIrreversibleRequestProgress(request)),
    canUnlockReview: completed && !hasOpenDispute,
  };
}
