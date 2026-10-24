// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { demandApi, demandBody } from "./usdt-demand-api";
import { DemandError } from "./usdt-demand-policy";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), verification: vi.fn(), rate: vi.fn(), after: vi.fn(), log: vi.fn(), queue: vi.fn() }));
vi.mock("./structured-logging", () => ({ logEvent: mocks.log }));
vi.mock("./api-auth", () => ({ requireApiUser: mocks.auth, requireMarketplaceVerificationForTrading: mocks.verification }));
vi.mock("./rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("./usdt-demand-email", () => ({ queueDemandEmails: mocks.queue }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
const url = "http://localhost:3217/api/alpha-exchange/usdt-requests";
const request = (headers: Record<string, string> = {}) => new NextRequest(url, { method: "POST", headers });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  mocks.auth.mockResolvedValue({ user: { id: "buyer" } });
  mocks.verification.mockReturnValue(null);
  mocks.rate.mockResolvedValue({ allowed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("USDT request API boundary", () => {
  it.each(["0", "", "true", "01", " 1"])("fails closed before authentication for a disabled or malformed flag %j", async flag => {
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", flag); const run = vi.fn();
    expect((await demandApi(request(), true, run)).status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it("denies an anonymous session without touching data", async () => {
    mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Sign in" }, { status: 401 }) });
    const run = vi.fn(); expect((await demandApi(request(), true, run)).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("applies existing verification restrictions to reads and writes", async () => {
    mocks.verification.mockReturnValue(NextResponse.json({ error: "Verify" }, { status: 403 }));
    const run = vi.fn();
    expect((await demandApi(request(), false, run)).status).toBe(403);
    expect((await demandApi(request(), true, run)).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://untrusted.example" }, { "sec-fetch-site": "cross-site" }])("rejects a cross-site write %j", async headers => {
    const run = vi.fn(); expect((await demandApi(request(headers), true, run)).status).toBe(403);
    expect(run).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("returns the shared rate limit and retry interval", async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 }); const run = vi.fn();
    const response = await demandApi(request(), true, run);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("42");
    expect(run).not.toHaveBeenCalled();
  });
  it("uses the session identity and prevents caching of private response data", async () => {
    const run = vi.fn().mockResolvedValue({ actorId: "buyer", requests: [] });
    const response = await demandApi(request({ origin: "http://localhost:3217" }), true, run);
    expect(response.status).toBe(200); expect(run).toHaveBeenCalledWith("buyer");
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(mocks.after).toHaveBeenCalledTimes(1);
  });
  it("does not queue notifications for a read or failed mutation", async () => {
    expect((await demandApi(request(), false, async () => ({}))).status).toBe(200);
    expect((await demandApi(request(), true, async () => { throw new DemandError("REQUEST_CHANGED", "Refresh"); })).status).toBe(409);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not expose internal failures", async () => {
    const response = await demandApi(request(), true, async () => { throw new Error("private database connection details"); });
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("database");
  });
  it("correlates a safe failure without logging private input or exception text", async () => {
    const sensitive = "private-person@example.com wallet-and-bank-secret";
    const input = new NextRequest(`${url}/private-request-id?secret=${encodeURIComponent(sensitive)}`, {
      method: "POST", headers: { "x-request-id": sensitive }, body: JSON.stringify({ withdrawalCode: sensitive }),
    });
    const response = await demandApi(input, true, async () => { throw new Error(sensitive); });
    expect(response.status).toBe(503);
    const correlationId = response.headers.get("X-Request-Id");
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith("error", {
      event: "usdt_demand_request", outcome: "failed", reason: "REQUEST_UNAVAILABLE",
      metadata: { correlationId, operation: "write", status: 503, durationMs: expect.any(Number) },
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private-person|private-request-id|withdrawalCode|wallet-and-bank/);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("separates quote rejection from server failure and measures one successful read", async () => {
    await demandApi(request(), true, async () => { throw new DemandError("QUOTE_UNAVAILABLE", "Refresh"); });
    expect(mocks.log).toHaveBeenLastCalledWith("warn", expect.objectContaining({ outcome: "denied", reason: "QUOTE_UNAVAILABLE" }));
    await demandApi(request(), false, async () => ({ requests: [] }));
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(mocks.log).toHaveBeenLastCalledWith("info", expect.objectContaining({ outcome: "success", metadata: expect.objectContaining({ operation: "read", status: 200 }) }));
  });
  it("keeps a committed mutation successful if telemetry is unavailable", async () => {
    mocks.log.mockImplementationOnce(() => { throw new Error("logger unavailable"); });
    const run = vi.fn().mockResolvedValue({ ok: true });
    const response = await demandApi(request(), true, run);
    expect(response.status).toBe(200); expect(run).toHaveBeenCalledTimes(1);
  });
  it("reports background queue failure without leaking delivery credentials", async () => {
    mocks.queue.mockRejectedValueOnce(new Error("smtp-private-password recipient@example.com"));
    const response = await demandApi(request(), true, async () => ({ ok: true }));
    expect(response.status).toBe(200);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.log).toHaveBeenLastCalledWith("error", {
      event: "usdt_demand_email_queue", outcome: "failed", reason: "PREPARATION_FAILED",
      metadata: { correlationId: response.headers.get("X-Request-Id") },
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/smtp-private|recipient@example/);
  });
});

describe("bounded request parsing", () => {
  it("reads a valid JSON object", async () => expect(await demandBody(new NextRequest(url, { method: "POST", body: '{"amount":"100"}' }))).toEqual({ amount: "100" }));
  it.each([undefined, "{broken"])('rejects missing or invalid JSON: %s', async body => {
    await expect(demandBody(new NextRequest(url, { method: "POST", body }))).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
  });
  it("counts UTF-8 bytes and rejects oversized bodies before parsing", async () => {
    await expect(demandBody(new NextRequest(url, { method: "POST", body: JSON.stringify({ text: "₪".repeat(6000) }) }))).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });
});
