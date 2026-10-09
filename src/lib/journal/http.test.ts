// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  account: "buyer" as string | null,
  disabled: false,
  authUnavailable: false,
  dbUnavailable: false,
  rateAllowed: true,
  uploadFailure: false,
  removeFailure: false,
  downloads: 0,
  blobs: new Map<string, Buffer>(),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUserForAuthorization: async () => {
    if (state.authUnavailable) throw new Error("Fixture session unavailable");
    return state.account ? { id: state.account, role: state.account, disabled: state.disabled } : null;
  },
  getCurrentSessionToken: async () => null,
  clearUserSession: vi.fn(),
  AUTH_COOKIE_NAME: "alpha_exchange_session",
  AUTH_VERIFIED_COOKIE_NAME: "alpha_exchange_verified",
  AUTH_PHONE_VERIFIED_COOKIE_NAME: "alpha_exchange_phone_verified",
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: async () => ({ allowed: state.rateAllowed, retryAfterSeconds: 30 }),
  createRateLimitResponse: (seconds: number) => NextResponse.json({ error: "Too many requests" }, {
    status: 429, headers: { "Retry-After": String(seconds), "Cache-Control": "no-store" },
  }),
}));
vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => {
    if (state.dbUnavailable) throw new Error("Fixture database unavailable");
    const query = async (sql: string, args?: unknown[]) => {
      const result = await state.db!.query(sql, args);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    };
    return { query, connect: async () => ({ query, release() {} }) };
  },
}));
// Hosted storage is the only image boundary replaced here. The HTTP handlers,
// ownership queries, RLS, image decoding/re-encoding, and cleanup SQL are real.
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from: (bucket: string) => {
    if (bucket !== "journal-charts") throw new Error("Unexpected storage bucket");
    return {
      upload: async (key: string, bytes: Buffer) => {
        state.blobs.set(key, Buffer.from(bytes));
        return { error: state.uploadFailure ? new Error("Fixture upload response lost") : null };
      },
      download: async (key: string) => {
        state.downloads++;
        const bytes = state.blobs.get(key);
        return { data: bytes ? new Blob([new Uint8Array(bytes)]) : null, error: null };
      },
      remove: async (keys: string[]) => {
        if (state.removeFailure) return { error: new Error("Fixture storage unavailable") };
        for (const key of keys) state.blobs.delete(key);
        return { error: null };
      },
    };
  } } }),
}));

import { GET as snapshot } from "@/app/api/journal/route";
import { POST as saveTrade } from "@/app/api/journal/trades/route";
import { DELETE as removeTrade } from "@/app/api/journal/trades/[id]/route";
import { GET as listCharts, POST as uploadChart } from "@/app/api/journal/trades/[id]/charts/route";
import { GET as readChart, DELETE as removeChart } from "@/app/api/journal/charts/[id]/route";
import { GET as cleanCharts } from "@/app/api/cron/journal-cleanup/route";
import { PUT as saveReview } from "@/app/api/journal/reviews/route";
import { PUT as saveSettings } from "@/app/api/journal/settings/route";
import { DEFAULT_SETTINGS, emptyReview, emptyTrade } from "./model";
import { journalApi, JournalClientError } from "./client";

const origin = "https://www.alphatraders.co.il";
const schedulerSecret = "journal-local-test-scheduler-secret-32-characters";
const trade = { ...emptyTrade("2026-10-08"), id: "10000000-0000-4000-8000-000000000001", symbol: "NQ", grossPnlCents: 20050, feesCents: 50 };
const context = (id = trade.id) => ({ params: Promise.resolve({ id }) });
const request = (path = "", method = "GET", value?: unknown, requestOrigin = origin) => new NextRequest(`${origin}/api/journal${path}`, {
  method, headers: { origin: requestOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});
const imageRequest = (bytes: Buffer, mime = "image/png", extra: Record<string, string> = {}) => new NextRequest(`${origin}/api/journal/trades/${trade.id}/charts`, {
  method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": mime, ...extra }, body: new Blob([new Uint8Array(bytes)]),
});
const cleanupRequest = (secret = schedulerSecret) => new NextRequest(`${origin}/api/cron/journal-cleanup`, { headers: { authorization: `Bearer ${secret}` } });
let chartPng: Buffer;

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec("create role anon; create role authenticated; create schema alpha_exchange; create table alpha_exchange.users(id text primary key); insert into alpha_exchange.users values('buyer'),('seller'),('student'); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
  await state.db.exec(await readFile("supabase/migrations/20261008200530_private_trading_journal.sql", "utf8"));
  chartPng = await sharp({ create: { width: 2800, height: 1400, channels: 3, background: "#171717" } })
    .withMetadata({ exif: { IFD0: { Copyright: "Private journal test metadata" } } }).png().toBuffer();
  vi.stubEnv("CRON_SECRET", schedulerSecret);
});
beforeEach(async () => {
  state.account = "buyer"; state.disabled = false; state.authUnavailable = false; state.dbUnavailable = false;
  state.rateAllowed = true; state.uploadFailure = false; state.removeFailure = false; state.downloads = 0; state.blobs.clear();
  vi.stubEnv("ALPHA_JOURNAL_ENABLED", "1");
  vi.unstubAllGlobals();
  await state.db!.exec("truncate alpha_exchange.journal_trades, alpha_exchange.journal_reviews, alpha_exchange.journal_settings, alpha_exchange.journal_files, alpha_exchange.journal_file_cleanup;");
});
afterAll(async () => { await state.db?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.sequential("journal HTTP and account boundaries", () => {
  it.each(["buyer", "seller", "student"])("allows a signed-in %s to save and reopen their own journal", async role => {
    state.account = role;
    const saved = await saveTrade(request("/trades", "POST", { ...trade, notes: `Private ${role} note` }));
    expect(saved?.status).toBe(200);
    const response = await snapshot(request());
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("private, no-store");
    expect((await response!.json()).trades).toMatchObject([{ symbol: "NQ", version: 1, notes: `Private ${role} note` }]);
    state.account = role === "buyer" ? "seller" : "buyer";
    expect((await (await snapshot(request()))!.json()).trades).toEqual([]);
  });
  it("denies guests, disabled accounts, and unavailable sessions before returning data", async () => {
    state.account = null; expect((await snapshot(request()))?.status).toBe(401);
    state.account = "buyer"; state.disabled = true; expect((await saveTrade(request("/trades", "POST", trade)))?.status).toBe(403);
    state.disabled = false; state.authUnavailable = true;
    const unavailable = await snapshot(request()); expect(unavailable?.status).toBe(503);
    expect(unavailable?.headers.get("set-cookie")).toBeNull();
  });
  it("keeps disabled-feature and rate-limit responses closed", async () => {
    vi.stubEnv("ALPHA_JOURNAL_ENABLED", "0"); expect((await saveTrade(request("/trades", "POST", trade)))?.status).toBe(404);
    vi.stubEnv("ALPHA_JOURNAL_ENABLED", "1"); state.rateAllowed = false;
    const limited = await saveTrade(request("/trades", "POST", trade));
    expect(limited?.status).toBe(429); expect(limited?.headers.get("retry-after")).toBe("30");
    expect((await state.db!.query("select * from alpha_exchange.journal_trades")).rows).toHaveLength(0);
  });
  it("rejects cross-site writes, injected owner IDs, and invalid pagination", async () => {
    expect((await saveTrade(request("/trades", "POST", trade, "https://other.test")))?.status).toBe(403);
    expect((await saveTrade(request("/trades", "POST", { ...trade, userId: "seller" })))?.status).toBe(400);
    expect((await snapshot(request("?offset=1")))?.status).toBe(400);
  });
  it("round-trips daily and weekly notes and rules without cross-account access", async () => {
    for (const period of ["day", "week"] as const) {
      const review = { ...emptyReview("2026-10-05", period), improve: `Private ${period} review` };
      expect((await saveReview(request("/reviews", "PUT", review)))?.status).toBe(200);
      expect((await saveReview(request("/reviews", "PUT", review)))?.status).toBe(409);
    }
    const rules = { ...DEFAULT_SETTINGS, rules: "Wait for my setup" };
    expect((await saveSettings(request("/settings", "PUT", rules)))?.status).toBe(200);
    expect((await saveSettings(request("/settings", "PUT", rules)))?.status).toBe(409);
    const own = await (await snapshot(request()))!.json();
    expect(own.reviews).toHaveLength(2); expect(own.settings.rules).toBe("Wait for my setup");
    state.account = "student";
    const other = await (await snapshot(request()))!.json(); expect(other.reviews).toEqual([]); expect(other.settings.rules).toBe("");
  });
  it("returns a retryable failure without pretending a database write succeeded", async () => {
    state.dbUnavailable = true;
    expect((await saveTrade(request("/trades", "POST", trade)))?.status).toBe(503);
    state.dbUnavailable = false;
    expect((await (await snapshot(request()))!.json()).trades).toEqual([]);
    expect((await saveTrade(request("/trades", "POST", trade)))?.status).toBe(200);
  });
});

describe.sequential("private chart HTTP lifecycle", () => {
  beforeEach(async () => { await saveTrade(request("/trades", "POST", trade)); });
  it("keeps charts legible, strips metadata, and serves only owner-authorized WebP bytes", async () => {
    const uploaded = await uploadChart(imageRequest(chartPng), context()); expect(uploaded?.status).toBe(200);
    const { chart } = await uploaded!.json();
    const response = await readChart(request(`/charts/${chart.id}`), context(chart.id));
    expect(response?.status).toBe(200); expect(response?.headers.get("cache-control")).toContain("private, no-store");
    expect(response?.headers.get("content-type")).toBe("image/webp"); expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    const metadata = await sharp(Buffer.from(await response!.arrayBuffer())).metadata();
    expect(metadata.width).toBe(2048); expect(metadata.height).toBe(1024); expect(metadata.exif).toBeUndefined();
    expect((await (await listCharts(request(), context()))!.json()).charts).toHaveLength(1);
    state.account = "seller";
    expect((await readChart(request(), context(chart.id)))?.status).toBe(404);
    expect((await removeChart(request("", "DELETE"), context(chart.id)))?.status).toBe(404);
    expect(state.downloads).toBe(1);
    expect((await (await listCharts(request(), context()))!.json()).charts).toEqual([]);
  });
  it("refuses another account's chart upload and caps each trade at three images", async () => {
    state.account = "student"; expect((await uploadChart(imageRequest(chartPng), context()))?.status).toBe(404);
    expect(state.blobs.size).toBe(0); state.account = "buyer";
    for (let i = 0; i < 3; i++) expect((await uploadChart(imageRequest(chartPng), context()))?.status).toBe(200);
    expect((await uploadChart(imageRequest(chartPng), context()))?.status).toBe(400); expect(state.blobs.size).toBe(3);
  });
  it("rejects disguised, truncated, and oversized image bodies before storage", async () => {
    expect((await uploadChart(imageRequest(Buffer.from("<svg></svg>"), "image/svg+xml"), context()))?.status).toBe(400);
    expect((await uploadChart(imageRequest(chartPng.subarray(0, 20)), context()))?.status).toBe(400);
    expect((await uploadChart(imageRequest(Buffer.alloc(3 * 1024 * 1024 + 1), "image/png", { "content-length": "1" }), context()))?.status).toBe(413);
    expect(state.blobs.size).toBe(0);
  });
  it("retries durable cleanup after an ambiguous upload and storage failure", async () => {
    state.uploadFailure = true;
    expect((await uploadChart(imageRequest(chartPng), context()))?.status).toBe(503);
    expect((await (await listCharts(request(), context()))!.json()).charts).toEqual([]);
    expect(state.blobs.size).toBe(1);
    expect((await cleanCharts(cleanupRequest("incorrect-secret"))).status).toBe(401);
    state.removeFailure = true; expect((await cleanCharts(cleanupRequest())).status).toBe(503);
    expect((await state.db!.query("select * from alpha_exchange.journal_file_cleanup")).rows).toHaveLength(1);
    state.removeFailure = false;
    expect(await (await cleanCharts(cleanupRequest())).json()).toEqual({ removed: 1 }); expect(state.blobs.size).toBe(0);
  });
  it("makes deleted charts inaccessible immediately and later removes their bytes", async () => {
    const { chart } = await (await uploadChart(imageRequest(chartPng), context()))!.json();
    expect((await removeTrade(request("", "DELETE", { version: 1 }), context()))?.status).toBe(200);
    expect((await readChart(request(), context(chart.id)))?.status).toBe(404);
    expect(await (await cleanCharts(cleanupRequest())).json()).toEqual({ removed: 1 }); expect(state.blobs.size).toBe(0);
  });
});

describe.sequential("client pagination through HTTP handlers and SQL", () => {
  beforeEach(async () => {
    await state.db!.query("insert into alpha_exchange.journal_trades(user_id,id,trade_date,payload) select 'buyer',md5(i::text)::uuid,'2026-10-08',$1::jsonb || jsonb_build_object('id',md5(i::text),'notes','Trade '||i) from generate_series(1,501) i", [JSON.stringify(trade)]);
    vi.stubGlobal("fetch", async (url: string) => snapshot(request(url.replace("/api/journal", ""))));
  });
  it("loads all pages through the production adapter without dropping or duplicating trades", async () => {
    const result = await journalApi.load(); expect(result.trades).toHaveLength(501); expect(new Set(result.trades.map(t => t.id)).size).toBe(501);
  });
  it("refuses mixed results when another device changes trades between pages", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (++calls === 2) await state.db!.exec("update alpha_exchange.journal_trades set version=version+1 where user_id='buyer'");
      return snapshot(request(url.replace("/api/journal", "")));
    });
    await expect(journalApi.load()).rejects.toMatchObject({ constructor: JournalClientError, status: 409 });
  });
});
