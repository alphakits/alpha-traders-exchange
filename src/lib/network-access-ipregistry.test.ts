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
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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
  it.each([401, 402, 403, 429, 500, 503])("refuses unchecked access after provider HTTP %i without a fallback", async (status) => {
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

describe("Ipregistry capacity monitoring", () => {
  it.each([
    [19_000, "available", "info"],
    [2_000, "low", "warn"],
    [500, "critical", "error"],
    [0, "empty", "error"],
  ] as const)("reports %i remaining credits without exposing visitor or credential data", async (remaining, reason, method) => {
    fetchMock.mockResolvedValue(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": String(remaining) } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console[method]).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_capacity", reason,
      metadata: { provider: "ipregistry", creditsRemaining: remaining, mode: "enforce" },
    }));
    expect(JSON.stringify(vi.mocked(console[method]).mock.calls)).not.toMatch(/synthetic-ipregistry|8\.8\.8\.8|private-session|private-user-token/);
  });

  it("reports credit exhaustion and preserves fail-closed access", async () => {
    fetchMock.mockResolvedValue(new Response("provider error body with private values", { status: 402 }));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(console.error).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_capacity", reason: "empty", outcome: "failed",
      metadata: expect.objectContaining({ creditsRemaining: 0 }),
    }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private values");
  });

  it.each([undefined, "", "unknown", "-1", "12.5", "1e5", "9007199254740993"])("ignores invalid capacity header %s without changing access decisions", async (value) => {
    fetchMock.mockResolvedValue(Response.json(payload(), { headers: value === undefined ? {} : { "Ipregistry-Credits-Remaining": value } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("samples steady capacity but immediately reports a worsening threshold", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": "2100" } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    await vi.advanceTimersByTimeAsync(60_001);
    fetchMock.mockResolvedValueOnce(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": "2099" } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console.info).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    fetchMock.mockResolvedValueOnce(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": "2000" } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_001);
    fetchMock.mockResolvedValueOnce(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": "1999" } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh capacity sample after a provider-key change", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": "19000" } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    vi.stubEnv("IPREGISTRY_API_KEY", `synthetic-ipregistry-${++generation}`);
    fetchMock.mockResolvedValueOnce(Response.json(payload(), { headers: { "Ipregistry-Credits-Remaining": "18000" } }));
    expect(await enforceNetworkAccess(request())).toBeNull();
    expect(console.info).toHaveBeenCalledTimes(2);
  });
});
