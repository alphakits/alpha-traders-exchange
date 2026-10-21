// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache, uploadTradeEvidence } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("@/lib/notification-platform", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/notification-platform")>(),
  isTwilioSendEnabled: () => true,
  sendTwilioMessageWithRetry: vi.fn(() => { throw new Error("Tests must never send SMS"); }),
}));

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=", "base64");
let database: PGlite;
let repository: AlphaExchangeRepository;
let beforeQuery: ((sql: string) => Promise<void> | void) | undefined;

function upload(side: "buyer" | "seller" = "seller") {
  return uploadTradeEvidence({ purchaseRequestId: "receipt-trade", actorUserId: side,
    actorRole: side === "buyer" ? "buyer" : "approved_seller", side,
    fileName: "synthetic-receipt.png", mimeType: "image/png", sizeBytes: png.length, contentBase64: png.toString("base64") });
}

async function status() {
  return (await database.query<{ status: string }>("select status from alpha_exchange.purchase_requests where id='receipt-trade'")).rows[0].status;
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  beforeQuery = undefined;
  database = new PGlite();
  await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
  await database.exec(await readFile("supabase/migrations/20260905223000_alpha_exchange_runtime_schema_parity.sql", "utf8"));
  const client = { query: async (sql: string, values?: unknown[]) => {
    await beforeQuery?.(sql);
    return database.query(sql, values);
  }, release() {} };
  repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  const now = new Date().toISOString();
  const fixture = {
    users: ["buyer", "seller"].map(id => ({ id, email: `${id}@example.test`, fullName: `Synthetic ${id}`, role: id === "buyer" ? "buyer" : "approved_seller",
      sellerStatus: id === "buyer" ? "buyer" : "approved_seller", availabilityStatus: "available", onlineStatus: "offline",
      createdAt: now, updatedAt: now, verifiedPhone: "+15551234567", phoneVerifiedAt: now,
      notificationPreferences: { inApp: true, email: false, sms: true } })),
    marketplaceListings: [{ id: "receipt-listing", sellerId: "seller", sellerDisplayName: "Synthetic seller", status: "in_trade", activeTradeRequestId: "receipt-trade",
      availableAmount: "500", originalAmount: "600", price: "3.2", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", createdAt: now, updatedAt: now }],
    purchaseRequests: [{ id: "receipt-trade", tradeId: "TR-RECEIPT", listingId: "receipt-listing", buyerId: "buyer", sellerId: "seller", buyerName: "Synthetic buyer",
      usdtAmount: "100", fiatAmount: "320", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", status: "usdt_release_pending", timeline: [], createdAt: now, updatedAt: now }],
    sellerApplications: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [],
    disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [], __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb;
  await repository.saveSnapshot(fixture, { selectedTables: ["users", "listings", "purchase_requests"] });
  globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
  invalidateAlphaExchangeStoreCache();
});

afterEach(async () => {
  invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await database.close();
});

describe("atomic seller receipt SMS persistence", () => {
  it("keeps buyer payment evidence independent from an unavailable SMS write path", async () => {
    const now = new Date().toISOString();
    const other = { id: "other-sms", eventKey: "trade:other:usdt-sent:buyer:buyer", eventType: "usdt_sent",
      recipientUserId: "buyer", recipientPhone: "+15551234567", body: "Synthetic queued intent", status: "queued",
      retryCount: 0, createdAt: now, updatedAt: now };
    await database.query(`insert into alpha_exchange.sms_deliveries
      (id,event_key,event_type,recipient_user_id,status,retry_count,created_at,updated_at,sort_index,payload)
      values ($1,$2,'usdt_sent','buyer','queued',0,$3,$3,0,$4)`, [other.id, other.eventKey, now, other]);
    await database.exec("alter table alpha_exchange.sms_deliveries add constraint injected_outbox_failure check (false) not valid; update alpha_exchange.purchase_requests set status='accepted',payload=jsonb_set(payload,'{status}','\"accepted\"')");
    await expect(upload("buyer")).resolves.toMatchObject({ request: { status: "payment_sent" } });
    expect((await database.query("select event_key from alpha_exchange.sms_deliveries")).rows)
      .toEqual([{ event_key: other.eventKey }]);
    const bytes = (await database.query<{ content: Uint8Array }>("select content from alpha_exchange.evidence")).rows[0].content;
    expect(Buffer.from(bytes)).toEqual(png);
  });

  it("commits the seller receipt and one buyer SMS intent together, including exact retries", async () => {
    const first = await upload();
    expect(await status()).toBe("usdt_sent");
    expect((await database.query("select event_key,status from alpha_exchange.sms_deliveries")).rows)
      .toEqual([{ event_key: "trade:receipt-trade:usdt-sent:buyer:buyer", status: "queued" }]);
    const bytes = (await database.query<{ content: Uint8Array }>("select content from alpha_exchange.evidence")).rows[0].content;
    expect(Buffer.from(bytes)).toEqual(png);
    const version = (await database.query("select version from alpha_exchange.runtime_meta")).rows;
    invalidateAlphaExchangeStoreCache();
    const retry = await upload();
    expect(retry.metrics.replayed).toBe(true);
    expect(retry.request.sellerEvidence?.id).toBe(first.request.sellerEvidence?.id);
    expect((await database.query("select version from alpha_exchange.runtime_meta")).rows).toEqual(version);
    expect((await database.query("select id from alpha_exchange.sms_deliveries")).rows).toHaveLength(1);
    expect(retry.request.timeline.filter(entry => entry.type === "seller_evidence_uploaded")).toHaveLength(1);
  });

  it("rolls back receipt bytes and lifecycle changes if the SMS intent cannot persist, then retries safely", async () => {
    await database.exec("alter table alpha_exchange.sms_deliveries add constraint injected_outbox_failure check (false)");
    await expect(upload()).rejects.toThrow();
    expect(await status()).toBe("usdt_release_pending");
    for (const table of ["evidence", "sms_deliveries", "audit_logs", "activity_logs", "notifications"]) {
      expect((await database.query(`select count(*)::int as count from alpha_exchange.${table}`)).rows).toEqual([{ count: 0 }]);
    }
    await database.exec("alter table alpha_exchange.sms_deliveries drop constraint injected_outbox_failure");
    await expect(upload()).resolves.toMatchObject({ request: { status: "usdt_sent" } });
    expect((await database.query("select id from alpha_exchange.sms_deliveries")).rows).toHaveLength(1);
  });

  it("rechecks a trade changed by another writer before persisting receipt bytes or SMS", async () => {
    beforeQuery = async sql => {
      // Commit the competing writer before the receipt transaction begins;
      // otherwise its update would be rolled back with the same connection.
      if (sql !== "begin") return;
      beforeQuery = undefined;
      await database.exec("update alpha_exchange.purchase_requests set status='cancelled',payload=jsonb_set(payload,'{status}','\"cancelled\"'); update alpha_exchange.runtime_meta set version=version+1");
    };
    await expect(upload()).rejects.toThrow("Seller USDT evidence can be uploaded only during the USDT release stage.");
    expect(await status()).toBe("cancelled");
    expect((await database.query("select id from alpha_exchange.evidence")).rows).toHaveLength(0);
    expect((await database.query("select id from alpha_exchange.sms_deliveries")).rows).toHaveLength(0);
  });

  it("preserves another writer's queued SMS when a stale receipt snapshot is merged", async () => {
    beforeQuery = async sql => {
      if (sql !== "begin") return;
      beforeQuery = undefined;
      const now = new Date().toISOString();
      const other = { id: "other-sms", eventKey: "trade:other:usdt-sent:buyer:buyer", eventType: "usdt_sent",
        recipientUserId: "buyer", recipientPhone: "+15551234567", body: "Synthetic queued intent", status: "queued",
        retryCount: 0, createdAt: now, updatedAt: now };
      await database.query(`insert into alpha_exchange.sms_deliveries
        (id,event_key,event_type,recipient_user_id,status,retry_count,created_at,updated_at,sort_index,payload)
        values ($1,$2,'usdt_sent','buyer','queued',0,$3,$3,0,$4)`, [other.id, other.eventKey, now, other]);
      await database.exec("update alpha_exchange.runtime_meta set version=version+1");
    };
    await expect(upload()).resolves.toMatchObject({ request: { status: "usdt_sent" } });
    expect((await database.query("select event_key from alpha_exchange.sms_deliveries order by event_key")).rows)
      .toEqual([{ event_key: "trade:other:usdt-sent:buyer:buyer" }, { event_key: "trade:receipt-trade:usdt-sent:buyer:buyer" }]);
  });
});
