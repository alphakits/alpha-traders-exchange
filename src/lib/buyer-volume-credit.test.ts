import { describe, expect, it } from "vitest";
import { prepareBuyerVolumeCredit, type BuyerVolumeCreditInput } from "@/lib/buyer-volume-credit";
import type { AlphaExchangeDb, PurchaseRequest } from "@/types/alpha-exchange";

const BEFORE = "2026-10-31T17:48:09.581Z";
const AFTER = "2026-11-01T15:00:00.000Z";
const input: BuyerVolumeCreditInput = {
  operationId: "owner-buyer-credit-fixture-v1", actorUserId: "owner", requestId: "purchase-target", buyerId: "buyer",
  expectedSettledUsdtAmount: "14672.940267", creditedUsdtAmount: "15000", reason: "Owner confirms this buyer purchased the full 15000 USDT externally.",
};
function seed() {
  return {
    users: [{ id: "owner", role: "owner", roles: ["owner"] }, { id: "buyer", role: "buyer" }, { id: "other-buyer", role: "buyer" }],
    purchaseRequests: [
      { id: "purchase-target", buyerId: "buyer", sellerId: "seller", listingId: "listing", status: "completed", usdtAmount: "14672.940267", fiatAmount: "49349.50", updatedAt: BEFORE, timeline: [], messages: [] },
      { id: "other-purchase", buyerId: "other-buyer", sellerId: "seller", listingId: "listing", status: "review_open", completedAt: BEFORE, usdtAmount: "327.059733", updatedAt: BEFORE },
      { id: "cancelled", buyerId: "buyer", sellerId: "seller", listingId: "listing", status: "cancelled", usdtAmount: "400", updatedAt: BEFORE },
    ],
    marketplaceListings: [{ id: "listing", originalAmount: "15000", availableAmount: "0", status: "closed" }],
    commissionRecords: [{ id: "commission", purchaseRequestId: "purchase-target", commissionAmount: 293.458806, paymentStatus: "paid" }],
    auditLogs: [], sellerReviews: [], notifications: [], trustSnapshots: [], trustScoreHistory: [],
  } as unknown as AlphaExchangeDb;
}

describe("owner-attested buyer purchase credit", () => {
  it("awards 15000 / Silver with one completed trade and preserves all settlement and other buyer facts", () => {
    const source = seed();
    const original = structuredClone(source);
    const plan = prepareBuyerVolumeCredit(source, input, AFTER);
    expect(plan.summary).toMatchObject({ buyerRank: "silver", lifetimeCompletedVolumeUsdt: 15000, additionalVolumeUsdt: "327.059733", completedTrades: 1, activeTrades: 0 });
    expect(plan.credit).toMatchObject({ requestId: "purchase-target", buyerId: "buyer", settledUsdtAmount: "14672.940267", creditedUsdtAmount: "15000" });
    expect(plan.credit.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.snapshot.purchaseRequests[0]).toMatchObject({ status: "completed", usdtAmount: "14672.940267", fiatAmount: "49349.50", messages: [], timeline: [] });
    expect(plan.snapshot.purchaseRequests[0].completedAt).toBeUndefined();
    expect(plan.snapshot.purchaseRequests.slice(1)).toEqual(source.purchaseRequests.slice(1));
    for (const key of ["users", "marketplaceListings", "commissionRecords", "notifications", "trustSnapshots", "trustScoreHistory"] as const) expect(plan.snapshot[key]).toEqual(source[key]);
    expect(plan.snapshot.auditLogs).toHaveLength(1);
    expect(source).toEqual(original);
  });

  it("is idempotent and does not add duplicate credit or audit entries", () => {
    const first = prepareBuyerVolumeCredit(seed(), input, AFTER);
    const replay = prepareBuyerVolumeCredit(first.snapshot, input, "2026-11-01T16:00:00.000Z");
    expect(replay.changed).toBe(false);
    expect(replay.snapshot).toEqual(first.snapshot);
    expect(replay.summary).toEqual(first.summary);
  });

  it.each([
    { actorUserId: "buyer" }, { actorUserId: "missing" }, { buyerId: "other-buyer" }, { requestId: "cancelled" },
    { expectedSettledUsdtAmount: "14672" }, { creditedUsdtAmount: "14672.940267" }, { creditedUsdtAmount: "14000" },
    { creditedUsdtAmount: "-15000" }, { creditedUsdtAmount: "15000oops" }, { reason: " " }, { operationId: "bad" },
  ])("rejects unauthorized or mismatched input %j", patch => {
    expect(() => prepareBuyerVolumeCredit(seed(), { ...input, ...patch }, AFTER)).toThrow("Buyer purchase credit rejected:");
  });

  it("rejects a disabled owner and uncompleted purchase", () => {
    const source = seed();
    source.users[0].disabled = true;
    expect(() => prepareBuyerVolumeCredit(source, input, AFTER)).toThrow("enabled owner");
    source.users[0].disabled = false;
    source.purchaseRequests[0].status = "review_open";
    expect(() => prepareBuyerVolumeCredit(source, input, AFTER)).toThrow("completed purchase");
  });

  it.each([BEFORE, "invalid", "2026-11-01T15:00:00Z"])("rejects noncanonical or stale recording time %s", date => {
    expect(() => prepareBuyerVolumeCredit(seed(), input, date)).toThrow("recording time");
  });

  it("rejects a changed replay, missing audit trail and reused operation", () => {
    const first = prepareBuyerVolumeCredit(seed(), input, AFTER);
    expect(() => prepareBuyerVolumeCredit(first.snapshot, { ...input, reason: "Changed owner instruction" }, AFTER)).toThrow("different or incomplete");
    const missingAudit = structuredClone(first.snapshot);
    missingAudit.auditLogs = [];
    expect(() => prepareBuyerVolumeCredit(missingAudit, input, AFTER)).toThrow("different or incomplete");
    const reused = seed();
    reused.purchaseRequests[1].buyerVolumeCredit = first.credit;
    expect(() => prepareBuyerVolumeCredit(reused, input, AFTER)).toThrow("already used");
  });

  it.each(["marker-time", "marker-fingerprint", "audit-time", "audit-actor", "audit-listing", "audit-action", "audit-reason", "audit-before", "audit-after"])(
    "rejects corrupted replay provenance: %s", field => {
      const first = prepareBuyerVolumeCredit(seed(), input, AFTER);
      const changed = structuredClone(first.snapshot);
      const audit = changed.auditLogs[0];
      if (field === "marker-time") changed.purchaseRequests[0].buyerVolumeCredit!.recordedAt = "invalid";
      if (field === "marker-fingerprint") changed.purchaseRequests[0].buyerVolumeCredit!.inputFingerprint = "b".repeat(64);
      if (field === "audit-time") audit.createdAt = BEFORE;
      if (field === "audit-actor") audit.actorUserId = "buyer";
      if (field === "audit-listing") audit.listingId = "another-listing";
      if (field === "audit-action") audit.action = "user_updated" as typeof audit.action;
      if (field === "audit-reason") audit.reason = "A different instruction";
      if (field === "audit-before") audit.oldValue = { kind: "buyer_volume_credit", settledUsdtAmount: "1", creditedUsdtAmount: "1" };
      if (field === "audit-after") audit.newValue = { ...audit.newValue as object, creditedUsdtAmount: "500000" };
      expect(() => prepareBuyerVolumeCredit(changed, input, AFTER)).toThrow("different or incomplete");
    },
  );

  it("rejects a replay when the operation was duplicated onto another purchase", () => {
    const first = prepareBuyerVolumeCredit(seed(), input, AFTER);
    first.snapshot.purchaseRequests[1].buyerVolumeCredit = { ...first.credit, requestId: "other-purchase", buyerId: "other-buyer" };
    expect(() => prepareBuyerVolumeCredit(first.snapshot, input, AFTER)).toThrow("already used");
  });

  it("does not alias canonical provenance through an idempotent plan", () => {
    const first = prepareBuyerVolumeCredit(seed(), input, AFTER);
    const replay = prepareBuyerVolumeCredit(first.snapshot, input, AFTER);
    replay.credit.reason = "Changed only in the returned plan";
    expect(first.snapshot.purchaseRequests[0].buyerVolumeCredit?.reason).toBe(input.reason);
  });

  it("preserves a real review and recognizes a historical timestamp after later cancellation", () => {
    const source = seed();
    Object.assign(source.purchaseRequests[0], { status: "cancelled", completedAt: BEFORE, buyerReview: { reviewerUserId: "buyer", rating: 5, createdAt: BEFORE } } as Partial<PurchaseRequest>);
    const plan = prepareBuyerVolumeCredit(source, input, AFTER);
    expect(plan.summary.reviewsGiven).toBe(1);
    expect(plan.snapshot.purchaseRequests[0].buyerReview).toEqual(source.purchaseRequests[0].buyerReview);
  });
});
