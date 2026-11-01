// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));

it.each(["audit_logs", "notifications", "activity_logs", "trust_score_history"])(
  "rolls back listing creation when %s cannot be persisted, then safely retries the whole operation",
  async (failingTable) => {
    const database = new PGlite();
    const client = { query: (sql: string, params?: unknown[]) => database.query(sql, params), release() {} };
    const repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    // Cache mirroring must not add a second database operation to this isolation test.
    vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("No background cache mirror in this test"));
    const now = "2026-10-16T23:00:00Z";
    const delta = {
      newListing: { id: "atomic-listing", sellerId: "atomic-seller", status: "active", createdAt: now, updatedAt: now },
      newAuditLogs: [{ id: "atomic-audit", action: "listing_created", actorUserId: "atomic-seller", listingId: "atomic-listing", createdAt: now }],
      newNotifications: [{ id: "atomic-notice", userId: "atomic-seller", category: "trade", isRead: false, createdAt: now }],
      newActivityLogs: [{ id: "atomic-activity", userId: "atomic-seller", category: "trade", createdAt: now }],
      newTrustHistoryEntries: [{ id: "atomic-history", sellerId: "atomic-seller", createdAt: now }],
      updatedTrustSnapshots: [{ sellerId: "atomic-seller", updatedAt: now }],
    } as unknown as Parameters<AlphaExchangeRepository["saveListingCreationSnapshotTargeted"]>[0];
    const tables = ["listings", "audit_logs", "notifications", "activity_logs", "trust_score_history", "trust_snapshots"];
    const rowCounts = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table,
      Number((await database.query<{ count: string }>(`select count(*)::text as count from alpha_exchange.${table}`)).rows[0].count),
    ])));
    try {
      await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
      await database.exec("insert into alpha_exchange.users(id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload) values('atomic-seller','atomic@example.test','seller','approved','available','offline',now(),now(),0,'{}');");
      await database.exec(`alter table alpha_exchange.${failingTable} add constraint injected_storage_failure check (false)`);
      const outcome = await repository.saveListingCreationSnapshotTargeted(delta).then(() => "success", () => "rejected");
      expect({ outcome, counts: await rowCounts() }).toEqual({ outcome: "rejected", counts: Object.fromEntries(tables.map(table => [table, 0])) });
      expect((await database.query("select version::text as version from alpha_exchange.runtime_meta")).rows).toEqual([{ version: "0" }]);
      await database.exec(`alter table alpha_exchange.${failingTable} drop constraint injected_storage_failure`);
      await repository.saveListingCreationSnapshotTargeted(delta);
      expect(await rowCounts()).toEqual(Object.fromEntries(tables.map(table => [table, 1])));
      expect((await database.query("select version::text as version from alpha_exchange.runtime_meta")).rows).toEqual([{ version: "1" }]);
    } finally { await database.close(); }
  }, 30_000,
);
