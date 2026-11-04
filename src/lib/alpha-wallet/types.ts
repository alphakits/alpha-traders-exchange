import type { AssetId } from "./amounts";

/** Fixture identities only. A production API must derive these from trusted auth, never a body. */
export type Actor = { kind: "seller" | "buyer" | "operator" | "verifier" | "dispatcher"; id: string };
export type DepositPurpose = "principal" | "commission";
export type DepositIntent = { id: string; sellerId: string; assetId: AssetId; destination: string; purpose: DepositPurpose };
export type DepositObservation = {
  intentId: string; assetId: AssetId; network: string; token: string; transactionId: string; eventIndex: number;
  destination: string; amountRaw: string; blockHash: string; finalized: boolean; successful: boolean;
};
export type DepositRecord = DepositObservation & { credited: boolean };
export type Listing = { id: string; sellerId: string; assetId: AssetId; amountRaw: bigint; price: string; currency: "ILS"; approved: boolean; funded: boolean; closed: boolean };
export type PaymentEvidence = { reference: string; amountMinor: string; currency: "ILS"; kind: "simulated-bank-credit" | "simulated-cash-receipt" };
export type Trade = {
  id: string; listingId: string; sellerId: string; buyerId: string; assetId: AssetId; destination: string;
  amountRaw: bigint; buyerFeeRaw: bigint; sellerFeeRaw: bigint; totalFeeRaw: bigint; fiatTotalMinor: bigint; currency: "ILS";
  status: "reserved" | "payment_reported" | "payment_verified" | "release_authorized" | "payout_pending" | "completed" | "cancelled";
  evidence?: PaymentEvidence; authorization?: { sellerId: string; destination: string; amountRaw: bigint; evidenceReference: string };
  disputed: boolean; payoutId?: string;
};
export type Payout = {
  id: string; assetId: AssetId; sellerId: string; kind: "trade" | "withdrawal"; tradeId?: string;
  amountRaw: bigint; destination: string; state: "queued" | "submitting" | "submission_unknown" | "broadcast" | "confirmed" | "failed_final";
  providerReference: string; transactionId?: string; dispatchCount: number;
};
export type PayoutReceipt = {
  payoutId: string; providerReference: string; assetId: AssetId; network: string; token: string;
  transactionId: string; eventIndex: number; destination: string; amountRaw: string; finalized: boolean; successful: boolean;
};
export type Commission = { tradeId: string; sellerId: string; assetId: AssetId; amountRaw: bigint; paid: boolean };
export type Journal = { id: string; operation: string; assetId: AssetId; entries: Array<{ account: string; delta: bigint }> };
export type State = {
  accounts: Map<string, bigint>; journal: Journal[]; depositIntents: Map<string, DepositIntent>; deposits: Map<string, DepositRecord>;
  listings: Map<string, Listing>; trades: Map<string, Trade>; payouts: Map<string, Payout>; commissions: Map<string, Commission>;
  receipts: Map<string, string>; evidenceOwners: Map<string, string>; idempotency: Map<string, { fingerprint: string; result: unknown }>;
  reconciliations: Map<AssetId, { expectedRaw: bigint; at: number }>; gasReady: Set<AssetId>; haltReason: string | null;
};
