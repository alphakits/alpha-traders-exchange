// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceNetworkAccess, parseIpregistryVerdict } from "./network-access";

const ip = "8.8.8.8";
const fetchMock = vi.fn<typeof fetch>();
let generation = 0;
function payload(flags: Record<string, unknown> = {}, address = ip) {
  return { ip: address, security: { is_vpn: false, is_proxy: false, is_tor: false, is_relay: false, ...flags } };
}
function request(path = "/en") {
  return new NextRequest(`https://www.alphatraders.co.il${path}`, {
    headers: { "x-vercel-forwarded-for": ip, cookie: "private-session", authorization: "Bearer private-user-token" },
  });
}
beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "enforce");
  vi.stubEnv("ALPHA_NETWORK_ACCESS_PROVIDER", "ipregistry");
  vi.stubEnv("IPREGISTRY_API_KEY", `synthetic-ipregistry-${++generation}`);
  vi.stubEnv("PROXYCHECK_API_KEY", "synthetic-unused-provider");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Ipregistry response validation", () => {
  it.each(["is_vpn", "is_proxy", "is_tor", "is_relay"])("rejects explicit %s detection", (flag) => {
    expect(parseIpregistryVerdict(payload({ [flag]: true }), ip)).toBe("restricted");
  });
  it("allows a complete clear response without using cloud or risk classifications", () => {
    expect(parseIpregistryVerdict(payload({ is_cloud_provider: true, is_threat: true }), ip)).toBe("clear");
  });
  it.each([null, {}, { ip }, { ip, security: {} }, payload({}, "1.1.1.1"), payload({ is_vpn: "false" }), payload({ is_proxy: null }), payload({ is_relay: undefined }), { ...payload(), error: { code: "INVALID_API_KEY" } }])("refuses incomplete, malformed, mismatched or error responses", (body) => {
    expect(parseIpregistryVerdict(body, ip)).toBe("unavailable");
  });
  it("accepts equivalent IPv6 spellings without accepting a different address", () => {
    expect(parseIpregistryVerdict(payload({}, "2606:4700:4700:0:0:0:0:1111"), "2606:4700:4700::1111")).toBe("clear");
    expect(parseIpregistryVerdict(payload({}, "2606:4700:4700::1001"), "2606:4700:4700::1111")).toBe("unavailable");
  });
});

describe("Ipregistry enforcement", () => {
  it("uses only the selected HTTPS service, hides its key from the URL and minimizes returned data", async () => {
    fetchMock.mockResolvedValue(Response.json(payload()));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect((url as URL).origin).toBe("https://api.ipregistry.co");
    expect((url as URL).pathname).toBe(`/${ip}`);
    expect((url as URL).searchParams.get("fields")).toBe("ip,security.is_vpn,security.is_proxy,security.is_tor,security.is_relay");
    expect((url as URL).searchParams.has("key")).toBe(false);
    expect(init).toMatchObject({ headers: { Authorization: `ApiKey ${process.env.IPREGISTRY_API_KEY}` }, cache: "no-store", redirect: "error" });
    expect(JSON.stringify(init)).not.toMatch(/private-session|private-user-token|synthetic-unused-provider/);
  });
  it.each(["/en", "/ar/login", "/api/auth/me", "/api/mobile/v1/app-config"])("blocks detected VPN access on %s", async (path) => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true })));
    const response = (await enforceNetworkAccess(request(path)))!;
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["missing-key", "unknown-provider"])("never falls back to another provider for %s", async (scenario) => {
    if (scenario === "missing-key") vi.stubEnv("IPREGISTRY_API_KEY", "");
    else vi.stubEnv("ALPHA_NETWORK_ACCESS_PROVIDER", "ipregsitry");
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500, 503])("refuses unchecked access after provider HTTP %i without a fallback", async (status) => {
    fetchMock.mockResolvedValue(new Response("error", { status }));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("handles invalid JSON without exposing the provider key in logs", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/synthetic-ipregistry|8\.8\.8\.8/);
  });
  it("times out stalled requests", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const response = enforceNetworkAccess(request());
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await response)?.status).toBe(503);
  });
  it("does not reuse a previous provider's clear verdict even with the same credential text", async () => {
    vi.stubEnv("PROXYCHECK_API_KEY", process.env.IPREGISTRY_API_KEY!);
    fetchMock.mockResolvedValueOnce(Response.json(payload()));
    expect(await enforceNetworkAccess(request())).toBeNull();
    vi.stubEnv("ALPHA_NETWORK_ACCESS_PROVIDER", "proxycheck");
    fetchMock.mockResolvedValueOnce(Response.json({ status: "ok", [ip]: { detections: { vpn: true, proxy: false, tor: false } } }));
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][0] as URL).origin).toBe("https://proxycheck.io");
  });
  it("monitors without blocking and performs no work when off", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "monitor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true })));
    expect(await enforceNetworkAccess(request())).toBeNull();
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "off");
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
