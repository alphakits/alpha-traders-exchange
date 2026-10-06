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
  for (const id of ["owner", "buyer-1", "buyer-2", "buyer-3", "seller-1", "seller-2", "unrelated"]) {
    await db.query("insert into alpha_exchange.users values ($1, 1, $2)", [id, { id }]);
  }
  for (const [id, buyer, seller, status, updatedAt] of [
    ["first", "buyer-1", "seller-1", "accepted", "2026-10-05T11:00:00Z"],
    ["second", "buyer-2", "seller-2", "payment_sent", "2026-10-05T11:01:00Z"],
    ["third", "buyer-2", "seller-1", "payment_sent", "2026-10-05T11:04:00Z"],
    ["fourth", "buyer-3", "seller-1", "accepted", "2026-10-05T11:05:00Z"],
    ["pending", "buyer-1", "seller-1", "pending", "2026-10-05T11:02:00Z"],
    ["completed", "buyer-2", "seller-2", "completed", "2026-10-05T11:03:00Z"],
  ]) {
    await db.query("insert into alpha_exchange.purchase_requests values ($1, $2, $3, $4, $5, $6, 1, $7)",
      [id, `listing-${id}`, buyer, seller, status, updatedAt, { id, buyerId: buyer, sellerId: seller, status, updatedAt }]);
    await db.query("insert into alpha_exchange.listings values ($1, 1, $2)", [`listing-${id}`, { id: `listing-${id}` }]);
  }
});
afterAll(async () => { await db.close(); });

describe("seller navigation SQL", () => {
  const input = { userId: "seller-1", includeAll: false, activeStatuses: ["accepted", "payment_sent"] as const, includeBuyerPending: true };
  it("returns all three owned active trades without exposing another seller's trade", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor({ ...input, allMatching: true });
    expect(result.purchaseRequests.map(trade => trade.id).sort()).toEqual(["first", "fourth", "third"]);
    expect(result.users.map(user => user.id).sort()).toEqual(["buyer-1", "buyer-2", "buyer-3", "seller-1"]);
    expect(result.marketplaceListings.map(listing => listing.id).sort()).toEqual(["listing-first", "listing-fourth", "listing-third"]);
  });
  it("preserves single-candidate behavior for existing callers", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor(input);
    expect(result.purchaseRequests.map(trade => trade.id)).toEqual(["fourth"]);
  });
  it("serves a buyer only their own active rooms", async () => {
    const result = await repository.loadPurchaseRequestCandidateSnapshotForActor({ ...input, userId: "buyer-1", allMatching: true });
    expect(result.purchaseRequests.map(trade => trade.id).sort()).toEqual(["first", "pending"]);
    expect(result.users.some(user => user.id === "buyer-2")).toBe(false);
  });
  it("only reads navigation data and never writes trades", async () => {
    const before = await db.query("select payload from alpha_exchange.purchase_requests order by id");
    await repository.loadPurchaseRequestCandidateSnapshotForActor({ ...input, allMatching: true });
    expect((await db.query("select payload from alpha_exchange.purchase_requests order by id")).rows).toEqual(before.rows);
  });
});
