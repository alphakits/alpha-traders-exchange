// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceNetworkAccess, parseNetworkVerdict } from "./network-access";

let configuration = 0;
const fetchMock = vi.fn<typeof fetch>();
const defaultIp = "8.8.8.8";
function result(flags: Record<string, unknown> = {}, ip = defaultIp) {
  return { status: "ok", [ip]: { detections: { vpn: false, proxy: false, tor: false, ...flags } } };
}
function request(path = "/en", headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(`https://www.alphatraders.co.il${path}`, { method, headers: { "x-vercel-forwarded-for": defaultIp, ...headers } });
}
beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "enforce");
  vi.stubEnv("PROXYCHECK_API_KEY", `synthetic-provider-key-${++configuration}`);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("network access verdicts", () => {
  it.each(["vpn", "proxy", "tor"])("blocks an explicit %s classification", (flag) => {
    expect(parseNetworkVerdict(result({ [flag]: true }), defaultIp)).toBe("restricted");
  });
  it("does not classify hosting or risk score alone as a VPN", () => {
    expect(parseNetworkVerdict(result({ hosting: true, risk: 100 }), defaultIp)).toBe("clear");
  });
  it.each([null, {}, { status: "denied" }, { status: "ok", [defaultIp]: {} }, { status: "ok", [defaultIp]: { detections: { vpn: false } } }, result({ vpn: "false" }), result({ tor: null }), result({}, "1.1.1.1")])("treats missing, malformed or mismatched results as unchecked", (payload) => {
    expect(parseNetworkVerdict(payload, defaultIp)).toBe("unavailable");
  });
  it("accepts a complete warning response", () => expect(parseNetworkVerdict({ ...result(), status: "warning" }, defaultIp)).toBe("clear"));
});

describe("server-side network access", () => {
  it("does no external work until explicitly enabled", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "off");
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("observes without blocking in monitor mode", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "monitor");
    fetchMock.mockResolvedValue(Response.json(result({ vpn: true })));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
  it("allows a checked direct connection", async () => {
    fetchMock.mockResolvedValue(Response.json(result()));
    expect(await enforceNetworkAccess(request())).toBeNull();
  });
  it("returns a private, self-contained 403 page without leaking request contents", async () => {
    fetchMock.mockResolvedValue(Response.json(result({ vpn: true })));
    const response = (await enforceNetworkAccess(request('/en?returnTo=%3Cscript%3E&token=private-test-value')))!;
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("Turn off your VPN");
    expect(html).not.toMatch(/<script|private-test-value|8\.8\.8\.8|synthetic-provider-key/);
    expect(html).toContain('href="/en"');
  });
  it("returns Arabic for Arabic pages", async () => {
    fetchMock.mockResolvedValue(Response.json(result({ proxy: true })));
    const response = (await enforceNetworkAccess(request("/ar/login")))!;
    expect(await response.text()).toContain('lang="ar" dir="rtl"');
  });
  it("protects ordinary APIs even with forged bypass and device headers", async () => {
    fetchMock.mockResolvedValue(Response.json(result({ tor: true })));
    const response = (await enforceNetworkAccess(request("/api/alpha-exchange/listings", { "cf-connecting-ip": "1.1.1.1", "x-network-verified": "1", "x-platform": "ios", cookie: "alpha-session=forged", "user-agent": "Googlebot" })))!;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "NETWORK_RESTRICTED", error: expect.any(String) });
  });
  it("uses the existing native API error envelope without revoking sessions", async () => {
    fetchMock.mockResolvedValue(Response.json(result({ vpn: true })));
    const response = (await enforceNetworkAccess(request("/api/mobile/v1/auth/refresh", { "x-locale": "ar" }, "POST")))!;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "NETWORK_RESTRICTED", message: expect.stringContaining("أوقف") }, requestId: expect.any(String) });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["", "invalid"])("fails closed for absent key or unknown mode (%s)", async (value) => {
    if (value) vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", value);
    else vi.stubEnv("PROXYCHECK_API_KEY", "");
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["", "127.0.0.1", "8.8.8.8, 1.1.1.1", "not-an-ip"])("refuses unverified network input (%s)", async (ip) => {
    expect((await enforceNetworkAccess(request("/en", { "x-vercel-forwarded-for": ip })))?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500, 503])("does not allow requests when the provider returns %i", async (status) => {
    fetchMock.mockResolvedValue(new Response("provider failure", { status }));
    const response = (await enforceNetworkAccess(request("/api/alpha-exchange/listings")))!;
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toMatchObject({ code: "NETWORK_CHECK_UNAVAILABLE" });
  });
  it("handles network failures without logging keys, IPs or provider errors", async () => {
    fetchMock.mockRejectedValue(new Error("https://provider.example/?key=do-not-log-this"));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/8\.8\.8\.8|do-not-log-this|synthetic-provider-key/);
  });
  it("aborts a stalled provider lookup", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const response = enforceNetworkAccess(request());
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await response)?.status).toBe(503);
  });
  it("shares concurrent lookups and expires cached results", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json(result()));
    expect(await Promise.all([enforceNetworkAccess(request()), enforceNetworkAccess(request())])).toEqual([null, null]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await enforceNetworkAccess(request());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    fetchMock.mockResolvedValue(Response.json(result({ vpn: true })));
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("checks a changed IP instead of reusing an account's previous connection", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(result()));
    fetchMock.mockResolvedValueOnce(Response.json(result({ vpn: true }, "1.1.1.1")));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect((await enforceNetworkAccess(request("/en", { "x-vercel-forwarded-for": "1.1.1.1" })))?.status).toBe(403);
  });
  it("sends only an IP to a fixed HTTPS provider, with logging and redirects disabled", async () => {
    fetchMock.mockResolvedValue(Response.json(result()));
    await enforceNetworkAccess(request("/en?email=private@example.test", { authorization: "Bearer private-session", cookie: "private-cookie" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect((url as URL).origin).toBe("https://proxycheck.io");
    expect((url as URL).searchParams.get("tag")).toBe("0");
    expect(init?.body?.toString()).toBe("ips=8.8.8.8");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization|cookie|private/i);
  });
  it.each([
    ["/api/health", "GET"], ["/api/cron/commission-payment-verification", "GET"],
    ["/api/cron/marketplace-email-delivery", "GET"], ["/api/twilio/status", "POST"],
    ["/api/discord/marketplace-events", "POST"], ["/api/meta/whatsapp/webhook", "POST"],
  ])("preserves separately authenticated machine endpoint %s", async (path, method) => {
    expect(await enforceNetworkAccess(request(path, {}, method))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["/api/health/admin", "/api/cron/new-unreviewed-job", "/api/twilio/status/extra", "/en/login", "/api/mobile/v1/auth/login"])("never exempts nearby path %s", async (path) => {
    fetchMock.mockResolvedValue(Response.json(result({ vpn: true })));
    expect((await enforceNetworkAccess(request(path)))?.status).toBe(403);
  });
});
