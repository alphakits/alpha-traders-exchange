import type { CommissionRecord, TradeDisputeCase } from "@/types/alpha-exchange";
import type { MarketplaceOperationalIncident, MarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";

export type OwnerAttentionItem =
  | { kind: "incident"; id: string; incident: MarketplaceOperationalIncident; priority: number; timestamp: string }
  | { kind: "dispute"; id: string; dispute: TradeDisputeCase; priority: number; timestamp: string }
  | { kind: "commission"; id: string; commission: CommissionRecord; priority: number; timestamp: string };

/** Uses the existing operational policy; does not invent new trade deadlines. */
export function ownerAttentionQueue(operations: MarketplaceOperationalSnapshot | null, disputes: readonly TradeDisputeCase[], commissions: readonly CommissionRecord[]): OwnerAttentionItem[] {
  return [
    ...(operations?.incidents ?? []).map(incident => ({ kind: "incident" as const, id: incident.id, incident, priority: incident.severity === "critical" ? 0 : 3, timestamp: "" })),
    ...disputes.filter(dispute => dispute.status === "open").map(dispute => ({ kind: "dispute" as const, id: dispute.id, dispute, priority: 1, timestamp: dispute.createdAt })),
    ...commissions.filter(commission => commission.paymentStatus !== "paid" && (commission.paymentVerificationStatus === "failed" || commission.paymentVerificationStatus === "pending_verification")).map(commission => ({ kind: "commission" as const, id: commission.id, commission, priority: commission.paymentVerificationStatus === "failed" ? 2 : 4, timestamp: commission.paymentLastCheckedAt ?? commission.updatedAt })),
  ].sort((a, b) => a.priority - b.priority || a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}
