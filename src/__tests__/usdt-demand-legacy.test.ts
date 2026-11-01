// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeDemand, createDemand, readDemandWorkspace, respondToDemand } from "@/lib/usdt-demand-engine";
import { demandState, validateDemandMatch } from "@/lib/usdt-demand-policy";
import { demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";
import type { UsdtDemand } from "@/types/usdt-demand";

const hour = 3_600_000;
const now = Date.parse("2026-10-25T12:00:00.000Z");
const iso = (at: number) => new Date(at).toISOString();
let db = demandTestDb();

function legacyRequest(publishedAt: number): UsdtDemand {
  const request: UsdtDemand = {
    ...demandTestTerms(), id: `demand-${randomUUID()}`, requesterId: "buyer", operationId: randomUUID(),
    createTerms: demandTestTerms(), revision: 1, state: "open", createdAt: iso(publishedAt),
    updatedAt: iso(publishedAt), expiresAt: iso(publishedAt + 24 * hour), offers: [],
    history: [{ action: "created", actorId: "buyer", at: iso(publishedAt), revision: 1 }],
  };
  db.usdtDemands!.push(request);
  return request;
}

function currentOffer(request: UsdtDemand) {
  const listing = db.marketplaceListings[0];
  const offer = {
    id: `offer-${randomUUID()}`, sellerId: "seller", listingId: listing.id, listingUpdatedAt: listing.updatedAt,
    operationId: randomUUID(), revision: request.revision, price: request.price, state: "open" as const,
    createdAt: iso(now - 2 * 60_000),
  };
  request.offers.push(offer);
  return offer;
}

const publish = () => createDemand(db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  db = demandTestDb();
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("stored Buy Requests policy compatibility", () => {
  it("expires stored 24-hour requests at 12 hours in buyer and seller reads", () => {
    const request = legacyRequest(now - 13 * hour);
    expect(demandState(db, request, demandTestMarket())).toBe("expired");
    const mine = readDemandWorkspace(db, "buyer", demandTestMarket(), { id: request.id });
    expect(mine.requests[0]).toMatchObject({ state: "expired", expiresAt: iso(now - hour) });
    expect(mine.publishing?.openRequestId).toBeNull();
    expect(readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available" }).requests).toHaveLength(0);
  });

  it("keeps the original effective deadline after editing a still-live legacy request", () => {
    const request = legacyRequest(now - 6 * hour);
    changeDemand(db, "buyer", request.id, { action: "edit", revision: 1, terms: { ...demandTestTerms(), amount: "2000" } }, demandTestMarket());
    const workspace = readDemandWorkspace(db, "buyer", demandTestMarket(), { id: request.id });
    expect(workspace.requests[0]).toMatchObject({ amount: "2000", state: "open", expiresAt: iso(now + 6 * hour) });
    expect(workspace.publishing?.remaining).toBe(1);
    vi.setSystemTime(now + 6 * hour);
    expect(demandState(db, request, demandTestMarket())).toBe("expired");
  });

  it("uses the last actual renewal rather than creation or later edits to derive the deadline", () => {
    const request = legacyRequest(now - 30 * hour);
    request.revision = 3; request.updatedAt = iso(now); request.expiresAt = iso(now + 21 * hour);
    request.history.push(
      { action: "renewed", actorId: "buyer", at: iso(now - 3 * hour), revision: 2 },
      { action: "edited", actorId: "buyer", at: iso(now), revision: 3 },
    );
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(), { id: request.id }).requests[0])
      .toMatchObject({ state: "open", expiresAt: iso(now + 9 * hour) });
    vi.setSystemTime(now + 9 * hour);
    expect(demandState(db, request, demandTestMarket())).toBe("expired");
  });

  it("rejects responses, matching and live edits exactly at the effective 12-hour boundary", () => {
    const request = legacyRequest(now - 12 * hour);
    const offer = currentOffer(request);
    expect(() => respondToDemand(db, "seller", request.id, {
      revision: 1, listingId: offer.listingId, price: "3.20", operationId: randomUUID(),
    }, demandTestMarket())).toThrow(/no longer open|changed|closed/i);
    expect(() => validateDemandMatch(db, {
      buyerId: "buyer", demandId: request.id, offerId: offer.id, revision: 1, listingId: offer.listingId,
      amount: request.amount, paymentMethod: request.paymentMethod, network: request.network,
    }, demandTestMarket())).toThrow(/changed|closed/i);
    expect(() => changeDemand(db, "buyer", request.id, {
      action: "edit", revision: 1, terms: { ...demandTestTerms(), amount: "2000" },
    }, demandTestMarket())).toThrow(/closed/i);
  });

  it("retires an effectively expired row before enforcing the single-open constraint", () => {
    const previous = legacyRequest(now - 13 * hour);
    const next = publish();
    expect(previous.state).toBe("expired");
    expect(next).toMatchObject({ state: "open", expiresAt: iso(now + 12 * hour) });
    expect(readDemandWorkspace(db, "buyer", demandTestMarket()).publishing?.remaining).toBe(0);
  });

  it("keeps five legacy publication events counted until only one remains in the rolling window", () => {
    const request = legacyRequest(now - 20 * hour);
    request.state = "cancelled"; request.revision = 5;
    request.history = [20, 15, 10, 5, 1].map((age, index) => ({
      action: index === 0 ? "created" : "renewed", actorId: "buyer", at: iso(now - age * hour), revision: index + 1,
    }));
    expect(readDemandWorkspace(db, "buyer", demandTestMarket()).publishing)
      .toMatchObject({ remaining: 0, nextAllowedAt: iso(now + 19 * hour) });
    vi.setSystemTime(now + 19 * hour - 1);
    expect(() => publish()).toThrow(/two requests/i);
    vi.setSystemTime(now + 19 * hour);
    expect(publish().state).toBe("open");
    expect(readDemandWorkspace(db, "buyer", demandTestMarket()).publishing?.remaining).toBe(0);
  });

  it("locks a legacy reopened record with accepted history and excludes it from seller matching", () => {
    const request = legacyRequest(now - 2 * hour);
    const offer = currentOffer(request);
    request.revision = 2; offer.revision = 2;
    request.history.push(
      { action: "matched", actorId: "buyer", at: iso(now - hour), revision: 1, purchaseRequestId: "legacy-trade", offerId: "legacy-offer" },
      { action: "renewed", actorId: "buyer", at: iso(now - 30 * 60_000), revision: 2, purchaseRequestId: "legacy-trade", offerId: "legacy-offer" },
    );
    const previousTerms = { amount: request.amount, price: request.price, revision: request.revision };
    for (const action of ["edit", "renew", "cancel"]) {
      expect(() => changeDemand(db, "buyer", request.id, {
        action, revision: 2, ...(action === "cancel" ? {} : { terms: { ...demandTestTerms(), amount: "2000" } }),
      }, demandTestMarket())).toThrow(/locked|Trade Room/i);
    }
    expect(request).toMatchObject(previousTerms);
    expect(readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available" }).requests).toHaveLength(0);
    expect(() => respondToDemand(db, "seller", request.id, {
      revision: 2, listingId: offer.listingId, price: "3.20", operationId: randomUUID(),
    }, demandTestMarket())).toThrow();
    expect(() => validateDemandMatch(db, {
      buyerId: "buyer", demandId: request.id, offerId: offer.id, revision: 2, listingId: offer.listingId,
      amount: request.amount, paymentMethod: request.paymentMethod, network: request.network,
    }, demandTestMarket())).toThrow();
  });
});
