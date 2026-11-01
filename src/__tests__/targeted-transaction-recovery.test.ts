// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const now = "2026-10-16T23:00:00Z";
const listingDelta = {
  newListing: { id: "recovery-listing", sellerId: "seller", status: "active", createdAt: now, updatedAt: now },
  newAuditLogs: [], newNotifications: [], newActivityLogs: [], newTrustHistoryEntries: [], updatedTrustSnapshots: [],
} as unknown as Parameters<AlphaExchangeRepository["saveListingCreationSnapshotTargeted"]>[0];
const requestDelta = {
  purchaseRequest: { id: "recovery-request", listingId: "recovery-listing", sellerId: "seller", buyerId: "buyer", status: "pending", createdAt: now, updatedAt: now },
  users: [], trustSnapshots: [], newAuditLogs: [], newNotifications: [], newActivityLogs: [], newTrustHistoryEntries: [],
} as unknown as Parameters<AlphaExchangeRepository["savePurchaseRequestCreationSnapshotTargeted"]>[0];
const paths = [
  { name: "listing", run: (repository: AlphaExchangeRepository) => repository.saveListingCreationSnapshotTargeted(listingDelta) },
  { name: "purchase request", run: (repository: AlphaExchangeRepository) => repository.savePurchaseRequestCreationSnapshotTargeted(requestDelta) },
  { name: "review and adjustment", run: (repository: AlphaExchangeRepository) => repository.mutateFocusedTrade("recovery-request", snapshot => snapshot) },
];

it.each(paths)("never continues the $name transaction after a real lock failure", async ({ run }) => {
  vi.stubEnv("NODE_ENV", "production");
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.includes("pg_advisory_xact_lock")) throw new Error("canceling statement due to statement timeout");
    return { rows: [] };
  }), release: vi.fn() };
  const repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Cache reload must not run after a failed transaction"));
  await expect(run(repository)).rejects.toThrow("statement timeout");
  expect(client.query.mock.calls.some(([sql]) => /^\s*(insert|update|delete|commit)\b/i.test(sql))).toBe(false);
  expect(client.query).toHaveBeenCalledWith("rollback");
});

it.each(paths)("destroys the $name socket after a read timeout without queuing rollback", async ({ run }) => {
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.includes("pg_advisory_xact_lock")) throw new Error("Query read timeout");
    return { rows: [] };
  }), release: vi.fn() };
  const repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Cache reload must not run after a failed transaction"));
  await expect(run(repository)).rejects.toThrow("Query read timeout");
  expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("rollback");
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
});

it.each(paths)("discards the $name connection when rollback fails", async ({ run }) => {
  const client = { query: vi.fn(async (sql: string) => {
    if (sql === "begin") throw new Error("transaction setup failed");
    if (sql === "rollback") throw new Error("connection closed during rollback");
    return { rows: [] };
  }), release: vi.fn() };
  const repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  await expect(run(repository)).rejects.toThrow("transaction setup failed");
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
});
