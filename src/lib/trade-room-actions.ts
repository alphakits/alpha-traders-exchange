import type { PurchaseRequest } from "@/types/alpha-exchange";
import { hasIrreversibleRequestProgress, hasRevealedBankDetails } from "@/lib/trade-cancellation";

export type TradeRoomMutationLock = { current: string | null };

/** Consent belongs to the displayed trade terms, not to chat/read timestamps. */
export function tradeActionConfirmationKey(request: PurchaseRequest) {
  return JSON.stringify([
    request.id, request.status, request.listingId, request.buyerId, request.sellerId,
    request.usdtAmount, request.fiatAmount, request.pricePerUsdt, request.currency,
    request.network, request.paymentMethod, request.feePolicyVersion,
    request.buyerReceivingWalletAddress, request.bankName, request.sellerBankAccountId,
    request.bankTransferProvider, request.sellerWiseAccountId, request.buyerWiseAccountId,
    request.termsProposal ?? null,
    request.buyerEvidence?.id, request.sellerEvidence?.id,
    hasIrreversibleRequestProgress(request), hasRevealedBankDetails(request),
  ]);
}

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
  return request.buyerId === actorUserId && !hasRevealedBankDetails(request) && !hasIrreversibleRequestProgress(request);
}

export function canSellerCancelTrade(request: PurchaseRequest, actorUserId: string) {
  return request.sellerId === actorUserId && !hasIrreversibleRequestProgress(request);
}

export function canSellerDeclineTrade(request: PurchaseRequest, actorUserId: string) {
  return request.status === "pending" && canSellerCancelTrade(request, actorUserId);
}
