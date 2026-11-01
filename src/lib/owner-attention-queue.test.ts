import { describe, expect, it } from "vitest";
import { ownerAttentionQueue } from "@/lib/owner-attention-queue";
import type { CommissionRecord, TradeDisputeCase } from "@/types/alpha-exchange";
import type { MarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";
describe("owner follow-up priorities", () => {
  it("uses existing incident policy and excludes resolved cases and paid commissions", () => {
    const operations = { incidents: [{ id: "critical", kind: "overdue_usdt_release", severity: "critical", requestId: "request-1", ageMinutes: 30 }, { id: "warning", kind: "stalled_trade", severity: "warning", requestId: "request-2", ageMinutes: 40 }] } as MarketplaceOperationalSnapshot;
    const disputes = [{ id: "open", status: "open", createdAt: "2026-10-04T01:00:00Z" }, { id: "closed", status: "resolved", createdAt: "2026-10-04T00:00:00Z" }] as TradeDisputeCase[];
    const commissions = [{ id: "failed", paymentStatus: "pending", paymentVerificationStatus: "failed", updatedAt: "2026-10-04T02:00:00Z" }, { id: "paid", paymentStatus: "paid", paymentVerificationStatus: "verified" }, { id: "pending", paymentStatus: "pending", paymentVerificationStatus: "pending_verification", updatedAt: "2026-10-04T03:00:00Z" }, { id: "not-submitted", paymentStatus: "pending" }] as CommissionRecord[];
    const before = JSON.stringify({ operations, disputes, commissions });
    expect(ownerAttentionQueue(operations, disputes, commissions).map(item => item.id)).toEqual(["critical", "open", "failed", "warning", "pending"]);
    expect(JSON.stringify({ operations, disputes, commissions })).toBe(before);
  });
  it("keeps an unavailable operational snapshot distinct from no incidents", () => expect(ownerAttentionQueue(null, [], [])).toEqual([]));
});
