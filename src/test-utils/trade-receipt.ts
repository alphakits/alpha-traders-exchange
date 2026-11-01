import type { CommissionRecord, PurchaseRequest } from "@/types/alpha-exchange";

export function receiptRequest(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: "receipt-trade", tradeId: "TR-RECEIPT", displayNumber: 12, listingId: "receipt-listing", buyerId: "buyer", sellerId: "seller",
    buyerName: "PRIVATE BUYER NAME", buyerWhatsapp: "+972500000123", buyerNotes: "PRIVATE NOTE",
    buyerReceivingWalletAddress: "PRIVATE WALLET", sellerBankAccountSnapshot: { accountHolderName: "PRIVATE HOLDER", bankName: "PRIVATE BANK", branchNumber: "999", accountNumber: "123456789", accountLast4: "6789" },
    usdtAmount: "123.456789", pricePerUsdt: "3.25", fiatAmount: "405.25", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
    status: "review_open", feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
    createdAt: "2026-10-30T10:00:00.000Z", completedAt: "2026-10-30T11:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z",
    timeline: [
      { id: "start", type: "request_submitted", actorUserId: "buyer", actorRole: "buyer", message: "PRIVATE NOTE +972500000123", createdAt: "2026-10-30T10:00:00.000Z" },
      { id: "finish", type: "trade_completed", actorUserId: "seller", actorRole: "approved_seller", message: "PRIVATE COMPLETION", createdAt: "2026-10-30T11:00:00.000Z" },
    ], ...overrides,
  };
}

export const receiptCommission = {
  id: "fee-1", purchaseRequestId: "receipt-trade", sellerId: "seller", buyerId: "buyer", rate: 0.02, grossAmount: 405.25,
  sellerFeeAmount: 1.234568, buyerFeeCollectedAmount: 1.234568, commissionAmount: 2.469136, paymentStatus: "pending",
} as CommissionRecord;
