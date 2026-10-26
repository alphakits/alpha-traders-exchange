// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { changeDemand, createDemand, readDemandWorkspace, respondToDemand } from "@/lib/usdt-demand-engine";
import { DEMAND_COOLDOWN_MS, DEMAND_TTL_MS, DEMAND_PUBLICATION_WINDOW_MS, validateDemandMatch } from "@/lib/usdt-demand-policy";
import { demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";

let db = demandTestDb();
const publish = (userId = "buyer") => createDemand(db, userId, { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
const workspace = (userId = "buyer", id?: string) => readDemandWorkspace(db, userId, demandTestMarket(), { id });
beforeEach(() => {
  db = demandTestDb();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("request workspace action metadata", () => {
  it("reports only the signed-in requester's publication allowance", () => {
    const d = publish();
    expect(workspace().publishing).toEqual({ remaining: 1, nextAllowedAt: new Date(Date.now() + DEMAND_COOLDOWN_MS).toISOString(), openRequestId: d.id });
    expect(workspace("seller", d.id).publishing).toEqual({ remaining: 2, nextAllowedAt: null, openRequestId: null });
    expect(workspace("buyer-two").publishing).toEqual({ remaining: 2, nextAllowedAt: null, openRequestId: null });
  });

  it("clears the cooldown exactly when a renewal becomes allowed", () => {
    const d = publish();
    const firstAt = Date.now();
    changeDemand(db, "buyer", d.id, { action: "cancel", revision: d.revision });
    vi.setSystemTime(Date.now() + DEMAND_COOLDOWN_MS - 1);
    expect(workspace().publishing?.nextAllowedAt).not.toBeNull();
    expect(() => changeDemand(db, "buyer", d.id, { action: "renew", revision: d.revision, terms: demandTestTerms() }, demandTestMarket())).toThrow(/five minutes/);
    vi.setSystemTime(Date.now() + 1);
    expect(workspace().publishing).toMatchObject({ remaining: 1, nextAllowedAt: null });
    changeDemand(db, "buyer", d.id, { action: "renew", revision: d.revision, terms: demandTestTerms() }, demandTestMarket());
    expect(workspace().publishing).toMatchObject({ remaining: 0, nextAllowedAt: new Date(firstAt + DEMAND_PUBLICATION_WINDOW_MS).toISOString() });
  });

  it("reports the rolling daily reset after the second publication, including cancellation", () => {
    const d = publish();
    const firstAt = Date.now();
    changeDemand(db, "buyer", d.id, { action: "cancel", revision: d.revision });
    vi.setSystemTime(Date.now() + DEMAND_COOLDOWN_MS);
    changeDemand(db, "buyer", d.id, { action: "renew", revision: d.revision, terms: demandTestTerms() }, demandTestMarket());
    changeDemand(db, "buyer", d.id, { action: "cancel", revision: d.revision }, demandTestMarket());
    expect(workspace().publishing).toEqual({ remaining: 0, nextAllowedAt: new Date(firstAt + DEMAND_PUBLICATION_WINDOW_MS).toISOString(), openRequestId: null });
    vi.setSystemTime(firstAt + DEMAND_PUBLICATION_WINDOW_MS - 1);
    expect(() => publish()).toThrow(/two requests in any 24 hours/);
    vi.setSystemTime(Date.now() + 1);
    expect(workspace().publishing).toEqual({ remaining: 1, nextAllowedAt: null, openRequestId: null });
    expect(publish().state).toBe("open");
  });

  it("finds a renewed open request outside the first history page and excludes expired requests", () => {
    const d = publish();
    d.createdAt = new Date(Date.now() - 50 * DEMAND_TTL_MS).toISOString();
    d.history[0].at = d.createdAt;
    d.history.push({ action: "renewed", actorId: "buyer", at: new Date().toISOString(), revision: 2 });
    d.revision = 2;
    for (let i = 1; i <= 35; i += 1) db.usdtDemands!.push({ ...structuredClone(d), id: `old-${i}`, operationId: randomUUID(), state: "cancelled",
      createdAt: new Date(Date.now() - i * DEMAND_TTL_MS).toISOString(), history: [] });
    const current = workspace();
    expect(current.requests).toHaveLength(30);
    expect(current.requests.some(request => request.id === d.id)).toBe(false);
    expect(current.publishing?.openRequestId).toBe(d.id);
    d.expiresAt = new Date(Date.now()).toISOString();
    expect(workspace().publishing?.openRequestId).toBeNull();
  });

  it("keeps a price-paused request as the one open request", () => {
    const d = publish();
    const view = readDemandWorkspace(db, "buyer", demandTestMarket(4));
    expect(view.requests[0].state).toBe("paused");
    expect(view.publishing?.openRequestId).toBe(d.id);
  });

  it("includes timestamps only with already visible responses", () => {
    const d = publish();
    const own = respondToDemand(db, "seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.20", operationId: randomUUID() }, demandTestMarket());
    respondToDemand(db, "seller-two", d.id, { listingId: "listing-seller-two", revision: 1, price: "3.20", operationId: randomUUID() }, demandTestMarket());
    expect(workspace("seller", d.id).requests[0].offers).toEqual([expect.objectContaining({ id: own.id, createdAt: own.createdAt })]);
    expect(workspace("buyer", d.id).requests[0].offers).toHaveLength(2);
  });

  it("shows exact unreserved stock and ignores cancelled or ordinary pending requests", () => {
    const d = publish();
    db.purchaseRequests = [
      { id: "reserved", sellerId: "seller", listingId: "listing-seller", status: "pending", usdtDemandId: "other-demand", usdtAmount: "8999.123456" },
      { id: "ordinary", sellerId: "seller", listingId: "listing-seller", status: "pending", usdtAmount: "4000" },
      { id: "cancelled", sellerId: "seller", listingId: "listing-seller", status: "cancelled", usdtDemandId: "cancelled-demand", usdtAmount: "5000" },
    ] as PurchaseRequest[];
    expect(workspace("seller", d.id).listings).toEqual([{ id: "listing-seller", price: "3.20", amount: "1000.876544" }]);
    expect(db.marketplaceListings[0].availableAmount).toBe("10000");
    db.purchaseRequests[0].usdtAmount = "9000.000001";
    expect(workspace("seller", d.id).listings).toHaveLength(0);
  });

  it.each(["pending", "rejected", "changes_requested"] as const)("rejects an explicitly %s listing even if its operational status is active", approvalStatus => {
    const d = publish();
    const o = respondToDemand(db, "seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.20", operationId: randomUUID() }, demandTestMarket());
    db.marketplaceListings[0].approvalStatus = approvalStatus;
    expect(workspace("seller", d.id).listings).toHaveLength(0);
    expect(workspace("buyer", d.id).requests[0].offers[0].available).toBe(false);
    expect(() => respondToDemand(db, "seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.20", operationId: randomUUID() }, demandTestMarket())).toThrow(/approved/);
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
    try {
      expect(() => validateDemandMatch(db, { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: 1, listingId: o.listingId,
        amount: d.amount, paymentMethod: d.paymentMethod, network: d.network }, demandTestMarket())).toThrow(/approved/);
    } finally { vi.unstubAllEnvs(); }
  });

  it("preserves eligible legacy listings without an explicit approval status", () => {
    const d = publish();
    delete db.marketplaceListings[0].approvalStatus;
    expect(workspace("seller", d.id).listings).toHaveLength(1);
    expect(() => respondToDemand(db, "seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.20", operationId: randomUUID() }, demandTestMarket())).not.toThrow();
  });

  it("groups notification amounts without changing canonical request terms", () => {
    const d = publish();
    expect(d.amount).toBe("1000");
    expect(db.notifications[0].messageEn).toContain("1,000 USDT requested at ₪3.20");
    expect(db.notifications[0].messageAr).toContain("1,000 USDT");
  });

  it("shows the seller's actual counterprice in the response notification", () => {
    const d = publish();
    respondToDemand(db, "seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.10", operationId: randomUUID() }, demandTestMarket());
    const response = db.notifications.find(n => n.userId === "buyer")!;
    expect(response.messageEn).toContain("1,000 USDT offered at ₪3.10");
    expect(response.messageAr).toContain("₪3.10");
    expect(d.price).toBe("3.20");
  });
});
