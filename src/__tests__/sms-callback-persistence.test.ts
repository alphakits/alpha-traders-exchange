// @vitest-environment node
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/twilio/status/route";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { getAuditLogsForAdmin, invalidateAlphaExchangeStoreCache, updateSmsDeliveryStatus } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb, SmsDeliveryRecord } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));

const now = "2026-10-24T00:00:00.000Z";
const siteUrl = "https://sms-callback.example.test";
const token = "synthetic-callback-test-token";
let database: PGlite;
let repository: AlphaExchangeRepository;
let beforeQuery: ((sql: string) => void) | undefined;

function delivery(id: string, overrides: Partial<SmsDeliveryRecord> = {}): SmsDeliveryRecord {
  return { id, eventKey: `trade:${id}:completed`, eventType: "trade_completed", recipientUserId: "recipient",
    recipientPhone: "+15551234567", body: "Synthetic callback fixture", status: "sent", retryCount: 0,
    twilioMessageSid: `SM-${id}`, providerStatus: "sent", createdAt: now, updatedAt: now, sentAt: now, ...overrides };
}

async function seed(rows: SmsDeliveryRecord[]) {
  const snapshot = await repository.loadSnapshot();
  snapshot.smsDeliveries = rows;
  await repository.saveSnapshot(snapshot, { selectedTables: ["sms_deliveries"] });
  invalidateAlphaExchangeStoreCache();
}

async function stored() {
  return (await database.query<{ payload: SmsDeliveryRecord }>("select payload from alpha_exchange.sms_deliveries order by id")).rows.map(row => row.payload);
}

async function version() {
  return (await database.query<{ version: string }>("select version::text as version from alpha_exchange.runtime_meta")).rows[0].version;
}

function callback(id: string | undefined, sid: string, status: string, signatureValid = true) {
  const url = `${siteUrl}/api/twilio/status${id === undefined ? "" : `?deliveryId=${encodeURIComponent(id)}`}`;
  const params = { MessageSid: sid, MessageStatus: status };
  const signed = url + Object.keys(params).sort().map(key => `${key}${params[key as keyof typeof params]}`).join("");
  const signature = createHmac("sha1", token).update(signed).digest("base64");
  return POST(new NextRequest(url, { method: "POST", body: new URLSearchParams(params),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signatureValid ? signature : "invalid" } }));
}

async function commitWhileWaiting(change: (snapshot: AlphaExchangeDb) => void) {
  const persist = repository.saveSnapshot.bind(repository);
  vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const latest = await repository.loadSnapshot();
    change(latest);
    await persist(latest, { selectedTables: ["sms_deliveries"] });
    await persist(incoming, options);
  });
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
  vi.stubEnv("TWILIO_AUTH_TOKEN", token);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Callback tests must never contact providers"); }));
  beforeQuery = undefined;
  database = new PGlite();
  await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
  await database.exec(await readFile("supabase/migrations/20260905223000_alpha_exchange_runtime_schema_parity.sql", "utf8"));
  const client = { query: async (sql: string, values?: unknown[]) => { beforeQuery?.(sql); return database.query(sql, values); }, release() {} };
  repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  const fixture = {
    users: [{ id: "recipient", email: "recipient@example.test", fullName: "Synthetic recipient", role: "buyer", sellerStatus: "buyer",
      availabilityStatus: "available", onlineStatus: "offline", createdAt: now, updatedAt: now }],
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [],
    sellerReviews: [], smsDeliveries: [delivery("one"), delivery("two")], __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb;
  await repository.saveSnapshot(fixture, { selectedTables: ["users", "sms_deliveries"] });
  globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
  invalidateAlphaExchangeStoreCache();
});

afterEach(async () => {
  invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await database.close();
});

describe("durable SMS status callbacks", () => {
  it("rejects disagreement between a delivery ID and an already bound provider message", async () => {
    const before = await stored();
    expect((await callback("one", "SM-two", "delivered")).status).toBe(404);
    expect(await stored()).toEqual(before);
  });

  it("does not fall back to a different row when an explicit delivery ID is unknown", async () => {
    const before = await stored();
    expect((await callback("missing", "SM-two", "delivered")).status).toBe(404);
    expect(await stored()).toEqual(before);
  });

  it("cannot bind an unbound delivery to a message already owned by another row", async () => {
    await seed([delivery("one", { status: "queued", twilioMessageSid: undefined }), delivery("two")]);
    const before = await stored();
    expect((await callback("one", "SM-two", "delivered")).status).toBe(404);
    expect(await stored()).toEqual(before);
  });

  it("acknowledges a late nonterminal callback without changing the delivered record", async () => {
    await seed([delivery("one", { status: "delivered", providerStatus: "delivered", deliveredAt: now })]);
    const before = await stored();
    const beforeVersion = await version();
    expect((await callback("one", "SM-one", "sent")).status).toBe(204);
    expect(await stored()).toEqual(before);
    expect(await version()).toBe(beforeVersion);
  });

  it("acknowledges an exact duplicate without rewriting timestamps or the database version", async () => {
    const before = await stored();
    const beforeVersion = await version();
    expect((await callback("one", "SM-one", "sent")).status).toBe(204);
    expect(await stored()).toEqual(before);
    expect(await version()).toBe(beforeVersion);
  });

  it("honors the existing terminal-state policy when another callback commits first", async () => {
    await commitWhileWaiting(snapshot => { snapshot.smsDeliveries![0] = delivery("one", { status: "failed", providerStatus: "undelivered", failedAt: now }); });
    expect((await callback("one", "SM-one", "delivered")).status).toBe(204);
    expect((await stored())[0]).toEqual(delivery("one", { status: "failed", providerStatus: "undelivered", failedAt: now }));
  });

  it("rechecks the message binding if a send response commits while the callback waits", async () => {
    await seed([delivery("one", { status: "queued", twilioMessageSid: undefined })]);
    await commitWhileWaiting(snapshot => { snapshot.smsDeliveries![0] = delivery("one", { twilioMessageSid: "SM-canonical" }); });
    expect((await callback("one", "SM-stale", "delivered")).status).toBe(404);
    expect((await stored())[0]).toEqual(delivery("one", { twilioMessageSid: "SM-canonical" }));
  });

  it("persists callbacks when unrelated account/history tables cannot be read", async () => {
    beforeQuery = sql => { if (sql.includes("alpha_exchange.password_reset_tokens")) throw new Error("Unrelated account table unavailable"); };
    expect((await callback("one", "SM-one", "delivered")).status).toBe(204);
    expect((await stored())[0].status).toBe("delivered");
  });

  it("accepts a callback that arrives before the sender has saved its SID", async () => {
    await seed([delivery("one", { status: "queued", twilioMessageSid: undefined, providerStatus: undefined })]);
    expect((await callback("one", "SM-first", "delivered")).status).toBe(204);
    expect((await stored())[0]).toMatchObject({ status: "delivered", twilioMessageSid: "SM-first", providerStatus: "delivered", deliveredAt: expect.any(String) });
  });

  it("supports SID-only callbacks when no local ID is supplied", async () => {
    expect((await callback(undefined, "SM-two", "delivered")).status).toBe(204);
    expect(await stored()).toEqual([delivery("one"), expect.objectContaining({ id: "two", status: "delivered", twilioMessageSid: "SM-two" })]);
  });

  it("rejects ambiguous legacy SID-only matches", async () => {
    await seed([delivery("one"), delivery("two", { twilioMessageSid: "SM-one" })]);
    const before = await stored();
    expect((await callback(undefined, "SM-one", "delivered")).status).toBe(404);
    expect(await stored()).toEqual(before);
  });

  it.each([undefined, "missing", ""])("rejects an unknown message with delivery ID %s", async id => {
    const before = await stored();
    expect((await callback(id, "SM-missing", "delivered")).status).toBe(404);
    expect(await stored()).toEqual(before);
  });

  it("rejects unsigned data before reaching storage", async () => {
    const read = vi.spyOn(repository, "loadSelectedSnapshot");
    const fullRead = vi.spyOn(repository, "loadSnapshot");
    expect((await callback("one", "SM-one", "delivered", false)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(fullRead).not.toHaveBeenCalled();
    expect(await stored()).toEqual([delivery("one"), delivery("two")]);
  });

  it("rejects missing message IDs before reaching storage", async () => {
    const read = vi.spyOn(repository, "loadSelectedSnapshot");
    expect((await callback("one", "", "delivered")).status).toBe(400);
    await expect(updateSmsDeliveryStatus({ deliveryId: "one", messageSid: "", status: "delivered", providerStatus: "delivered" })).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["delivered", "failed"] as const)("retains the first %s timestamp across an exact duplicate", async status => {
    const providerStatus = status === "failed" ? "undelivered" : "delivered";
    expect((await callback("one", "SM-one", providerStatus)).status).toBe(204);
    const before = await stored();
    const beforeVersion = await version();
    expect((await callback("one", "SM-one", providerStatus)).status).toBe(204);
    expect(await stored()).toEqual(before);
    expect(await version()).toBe(beforeVersion);
    expect(before[0][status === "failed" ? "failedAt" : "deliveredAt"]).toBeTruthy();
  });

  it("preserves another delivery committed while this callback waits", async () => {
    await commitWhileWaiting(snapshot => { snapshot.smsDeliveries![1] = delivery("two", { status: "failed", providerStatus: "undelivered", failedAt: now }); });
    expect((await callback("one", "SM-one", "delivered")).status).toBe(204);
    expect(await stored()).toEqual([expect.objectContaining({ id: "one", status: "delivered" }), delivery("two", { status: "failed", providerStatus: "undelivered", failedAt: now })]);
  });

  it("does not resurrect a delivery removed while its callback waits", async () => {
    await commitWhileWaiting(snapshot => { snapshot.smsDeliveries = snapshot.smsDeliveries!.filter(row => row.id !== "one"); });
    expect((await callback("one", "SM-one", "delivered")).status).toBe(404);
    expect(await stored()).toEqual([delivery("two")]);
  });

  it("does not acknowledge a write that rolls back", async () => {
    const before = await stored();
    const beforeVersion = await version();
    beforeQuery = sql => { if (/insert into alpha_exchange\.sms_deliveries/i.test(sql)) throw new Error("Synthetic write failure"); };
    await expect(callback("one", "SM-one", "delivered")).rejects.toThrow();
    expect(await stored()).toEqual(before);
    expect(await version()).toBe(beforeVersion);
  });

  it("keeps the scoped callback snapshot out of the full-store cache", async () => {
    expect((await callback("one", "SM-one", "delivered")).status).toBe(204);
    const fullRead = vi.spyOn(repository, "loadSnapshot");
    await getAuditLogsForAdmin();
    expect(fullRead).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
