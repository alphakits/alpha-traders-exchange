// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemand, readDemandWorkspace } from "@/lib/usdt-demand-engine";
import { demandTestDb, demandTestMarket, demandTestTerms, demandTestUser } from "@/test-utils/usdt-demand-fixtures";

let db = demandTestDb();
beforeEach(() => {
  db = demandTestDb();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
  for (let i = 0; i < 35; i += 1) {
    const userId = `requester-${i}`;
    db.users.push(demandTestUser(userId));
    createDemand(db, userId, { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
    vi.setSystemTime(Date.now() + 1_000);
  }
});
afterEach(() => vi.useRealTimers());

describe("request feed pagination", () => {
  it.each(["cancelled", "expired", "matched", "blocked"] as const)("keeps the next-page position when its anchor becomes %s", state => {
    const first = readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available" });
    const expectedRemaining = db.usdtDemands!.slice(0, 5).reverse().map(d => d.id);
    expect(first.requests).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    const anchor = db.usdtDemands!.find(d => d.id === first.nextCursor)!;
    if (state === "expired") anchor.expiresAt = new Date(Date.now() - 1).toISOString();
    else if (state === "blocked") db.users.find(u => u.id === anchor.requesterId)!.blockedUserIds = ["seller"];
    else anchor.state = state;

    const next = readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available", cursor: first.nextCursor! });
    expect(next.requests.map(d => d.id)).toEqual(expectedRemaining);
    expect(next.nextCursor).toBeNull();
    expect(next.requests.some(d => first.requests.some(previous => previous.id === d.id))).toBe(false);
  });

  it("does not shift the next page when a newer request is published", () => {
    const first = readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available" });
    const expectedRemaining = db.usdtDemands!.slice(0, 5).reverse().map(d => d.id);
    createDemand(db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
    const next = readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available", cursor: first.nextCursor! });
    expect(next.requests.map(d => d.id)).toEqual(expectedRemaining);
    expect(next.nextCursor).toBeNull();
  });

  it("rejects an unknown cursor instead of silently returning duplicate first-page rows", () => {
    expect(() => readDemandWorkspace(db, "seller", demandTestMarket(), { scope: "available", cursor: "missing-request" }))
      .toThrow(expect.objectContaining({ code: "CURSOR_INVALID", status: 400 }));
  });
});
