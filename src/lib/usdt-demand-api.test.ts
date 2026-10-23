// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { demandApi, demandBody } from "./usdt-demand-api";
import { DemandError } from "./usdt-demand-policy";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), verification: vi.fn(), rate: vi.fn(), after: vi.fn() }));
vi.mock("./api-auth", () => ({ requireApiUser: mocks.auth, requireMarketplaceVerificationForTrading: mocks.verification }));
vi.mock("./rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("./usdt-demand-email", () => ({ queueDemandEmails: vi.fn() }));
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
  it("fails closed before authentication when the feature is disabled", async () => {
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0"); const run = vi.fn();
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
