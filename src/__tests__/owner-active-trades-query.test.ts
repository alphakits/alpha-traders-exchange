// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const db = new PGlite();
const repository = new AlphaExchangeRepository({ query: (sql: string, values: unknown[]) => db.query(sql, values) } as unknown as Pool);
// This test runs the production SELECT against a real embedded PostgreSQL
// engine, with only the four tables that navigation is allowed to read.
vi.spyOn(repository, "ensureReady").mockResolvedValue(undefined);
beforeAll(async () => {
  await db.exec(`
    create schema alpha_exchange;
    create table alpha_exchange.runtime_meta (singleton boolean, version bigint);
    insert into alpha_exchange.runtime_meta values (true, 1);
    create table alpha_exchange.users (id text, sort_index int, payload jsonb);
    create table alpha_exchange.listings (id text, sort_index int, payload jsonb);
    create table alpha_exchange.purchase_requests (
      id text, listing_id text, buyer_id text, seller_id text, status text,
      updated_at timestamptz, sort_index int, payload jsonb
    );
  `);
  for (const id of ["owner", "buyer-1", "buyer-2", "seller-1", "seller-2", "unrelated"]) {
    await db.query("insert into alpha_exchange.users values ($1, 1, $2)", [id, { id }]);
  }
  for (const [id, buyer, seller, status, updatedAt] of [
    ["first", "buyer-1", "seller-1", "accepted", "2026-10-05T11:00:00Z"],
    ["second", "buyer-2", "seller-2", "payment_sent", "2026-10-05T11:01:00Z"],
    ["pending", "buyer-1", "seller-1", "pending", "2026-10-05T11:02:00Z"],
    ["completed", "buyer-2", "seller-2", "completed", "2026-10-05T11:03:00Z"],
  ]) {
    await db.query("insert into alpha_exchange.purchase_requests values ($1, $2, $3, $4, $5, $6, 1, $7)",
      [id, `listing-${id}`, buyer, seller, status, updatedAt, { id, buyerId: buyer, sellerId: seller, status, updatedAt }]);
    await db.query("insert into alpha_exchange.listings values ($1, 1, $2)", [`listing-${id}`, { id: `listing-${id}` }]);
  }
});
afterAll(async () => { await db.close(); });

describe("active owner navigation SQL", () => {
  const input = { userId: "owner", includeAll: true, activeStatuses: ["accepted", "payment_sent"] as const, includeBuyerPending: false };
  it("returns both live trades and their participants, excluding pending and finished rooms", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor({ ...input, allMatching: true });
    expect(result.purchaseRequests.map(trade => trade.id).sort()).toEqual(["first", "second"]);
    expect(result.users.map(user => user.id).sort()).toEqual(["buyer-1", "buyer-2", "owner", "seller-1", "seller-2"]);
    expect(result.marketplaceListings.map(listing => listing.id).sort()).toEqual(["listing-first", "listing-second"]);
  });
  it("preserves the single newest candidate for existing navigation callers", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor(input);
    expect(result.purchaseRequests.map(trade => trade.id)).toEqual(["second"]);
  });
  it("retains participant scoping even if a caller supplies allMatching", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor({ ...input, userId: "buyer-1", includeAll: false, allMatching: true });
    expect(result.purchaseRequests.map(trade => trade.id)).toEqual(["first"]);
    expect(result.users.some(user => user.id === "buyer-2")).toBe(false);
  });
  it("preserves buyer pending navigation without leaking another buyer's request", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor({ ...input, userId: "buyer-1", includeAll: false, includeBuyerPending: true });
    expect(result.purchaseRequests.map(trade => trade.id)).toEqual(["pending"]);
  });
});
