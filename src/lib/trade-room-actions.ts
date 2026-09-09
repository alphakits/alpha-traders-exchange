import type { PurchaseRequest } from "@/types/alpha-exchange";

export type TradeRoomMutationLock = { current: string | null };

/**
 * React state disables the visible control after a render, but two different
 * controls can still fire in the same frame. This synchronous lock permits one
 * Trade Room mutation at a time, independent of render timing.
 */
export function acquireTradeRoomMutation(lock: TradeRoomMutationLock, mutationKey: string) {
  if (lock.current) return false;
  lock.current = mutationKey;
  return true;
}

/** Only the mutation that acquired the lock may release it. */
export function releaseTradeRoomMutation(lock: TradeRoomMutationLock, mutationKey: string) {
  if (lock.current === mutationKey) lock.current = null;
}

export function canBuyerCancelTrade(request: PurchaseRequest, actorUserId: string) {
  return request.buyerId === actorUserId
    && (request.status === "pending"
      || (request.status === "accepted" && !request.buyerEvidence && !request.paymentSentAt));
}

export function canSellerDeclineTrade(request: PurchaseRequest, actorUserId: string) {
  return request.sellerId === actorUserId && request.status === "pending";
}
