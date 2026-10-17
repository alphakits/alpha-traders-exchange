// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));

it("updates existing trade rows without deleting unchanged records or cascading their references", async () => {
  const database = new PGlite();
  const client = { query: (sql: string, params?: unknown[]) => database.query(sql, params), release() {} };
  const repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  const ready = vi.spyOn(repository, "ensureReady").mockResolvedValue();
  const now = "2026-10-17T00:00:00Z";
  const snapshot = {
    users: [], sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [],
    authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [],
    trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb;
  try {
    await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
    await database.exec("insert into alpha_exchange.users(id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload) values('retention-user','retention@example.test','buyer','buyer','available','offline',now(),now(),0,'{}');");
    snapshot.purchaseRequests = [{ id: "request-kept", listingId: "listing", sellerId: "retention-user", buyerId: "buyer", status: "pending", createdAt: now, updatedAt: now }] as never;
    snapshot.notifications = [{ id: "notification-kept", userId: "retention-user", category: "trade", isRead: false, createdAt: now }] as never;
    snapshot.commissionRecords = [{ id: "commission-kept", purchaseRequestId: "request-kept", listingId: "listing", buyerId: "buyer", sellerId: "retention-user", paymentStatus: "unpaid", dueAt: now, createdAt: now, updatedAt: now }] as never;
    snapshot.auditLogs = [{ id: "audit-kept", actorUserId: "retention-user", action: "admin_override", createdAt: now }] as never;
    const selectedTables = ["purchase_requests", "notifications", "commissions", "audit_logs"] as const;
    await repository.saveSnapshot(snapshot, { selectedTables });
    // These synthetic references make transient DELETE+INSERT observable even
    // if the final parent rows look correct after a snapshot write.
    await database.exec("create table alpha_exchange.retention_probe(request_id text references alpha_exchange.purchase_requests(id) on delete cascade,notification_id text references alpha_exchange.notifications(id) on delete cascade,commission_id text references alpha_exchange.commissions(id) on delete cascade,audit_id text references alpha_exchange.audit_logs(id) on delete cascade); insert into alpha_exchange.retention_probe values('request-kept','notification-kept','commission-kept','audit-kept');");
    const before = (await database.query<{ id: string; tuple: string }>("select id,ctid::text as tuple from alpha_exchange.audit_logs")).rows;
    snapshot.purchaseRequests[0].status = "accepted";
    snapshot.notifications[0].isRead = true;
    await repository.saveSnapshot(snapshot, { selectedTables });
    expect((await database.query("select * from alpha_exchange.retention_probe")).rows).toHaveLength(1);
    expect((await database.query("select status from alpha_exchange.purchase_requests")).rows).toEqual([{ status: "accepted" }]);
    expect((await database.query("select is_read from alpha_exchange.notifications")).rows).toEqual([{ is_read: true }]);
    expect((await database.query("select id,ctid::text as tuple from alpha_exchange.audit_logs")).rows).toEqual(before);
    snapshot.purchaseRequests = [];
    await repository.saveSnapshot(snapshot, { selectedTables: ["purchase_requests"] });
    expect((await database.query("select * from alpha_exchange.purchase_requests")).rows).toHaveLength(0);
    expect((await database.query("select * from alpha_exchange.retention_probe")).rows).toHaveLength(0);
  } finally { ready.mockRestore(); await database.close(); }
}, 30_000);
