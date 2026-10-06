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
  it.each(["is_vpn", "is_proxy", "is_tor", "is_relay"])("retains explicit %s detection before applying policy", (flag) => {
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

describe("Apple Private Relay compatibility under enforcement", () => {
  it.each([
    [false, false, false, 200],
    [true, false, false, 403], [false, true, false, 403], [false, false, true, 403],
    [true, true, false, 403], [true, false, true, 403], [false, true, true, 403],
    [true, true, true, 403],
  ])("allows relay-only traffic but preserves VPN=%s proxy=%s Tor=%s denial", async (is_vpn, is_proxy, is_tor, status) => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true, is_vpn, is_proxy, is_tor })));
    for (const path of ["/en/login", "/ar/login", "/api/auth/me", "/api/mobile/v1/app-config"]) {
      const response = await enforceNetworkAccess(request(path));
      expect(response?.status ?? 200).toBe(status);
      expect(response?.headers.get("set-cookie") ?? null).toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["is_vpn", "is_proxy", "is_tor"])("requires a validated false %s before admitting a relay", async (flag) => {
    for (const value of [undefined, null, "false"]) {
      vi.stubEnv("IPREGISTRY_API_KEY", `synthetic-ipregistry-${++generation}`);
      fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true, [flag]: value })));
      const response = (await enforceNetworkAccess(request("/en/login")))!;
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(await response.text()).not.toContain("Show IP Address");
    }
  });

  it.each(["is_vpn", "is_proxy", "is_tor"])("does not trust Safari or forged relay headers over %s", async (flag) => {
    fetchMock.mockResolvedValue(Response.json(payload({ [flag]: true })));
    const req = request("/en/login");
    req.headers.set("user-agent", "Mozilla/5.0 (iPhone) Version/26.0 Mobile Safari/605.1.15");
    req.headers.set("x-platform", "ios");
    req.headers.set("x-apple-private-relay", "true");
    req.headers.set("x-network-verified", "true");
    expect((await enforceNetworkAccess(req))?.status).toBe(403);
  });

  it("allows a validated IPv6 relay without requiring a Safari user-agent", async () => {
    const req = request("/en/login");
    req.headers.set("x-vercel-forwarded-for", "2606:4700:4700::1111");
    fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true }, "2606:4700:4700:0:0:0:0:1111")));
    expect(await enforceNetworkAccess(req)).toBeNull();
  });
});

describe("Tor-only incident recovery", () => {
  it.each(["/en/login", "/ar/login", "/api/mobile/v1/app-config", "/api/auth/me"])("denies actual Tor classification on %s", async (path) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "tor-only");
    fetchMock.mockResolvedValue(Response.json(payload({ is_tor: true })));
    const response = (await enforceNetworkAccess(request(path)))!;
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toContain("Tor");
    expect(console.warn).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_classification", outcome: "denied",
      metadata: { provider: "ipregistry", mode: "tor-only", detectedTypes: ["tor"] },
    }));
  });

  it.each(["is_vpn", "is_proxy", "is_relay"])("monitors %s while allowing a validated non-Tor connection", async (flag) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "tor-only");
    fetchMock.mockResolvedValue(Response.json(payload({ [flag]: true })));
    expect(await enforceNetworkAccess(request("/en/login"))).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_classification", outcome: "success",
    }));
  });

  it.each([undefined, null, "false"])("does not admit an unchecked Tor status (%s)", async (is_tor) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "tor-only");
    fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true, is_tor })));
    const response = (await enforceNetworkAccess(request()))!;
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
  });

  it("preserves the Tor flag across cached mode transitions", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "monitor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_tor: true })));
    expect(await enforceNetworkAccess(request())).toBeNull();
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "tor-only");
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a provider outage in Tor-only mode", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "tor-only");
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
  });
});

describe("VPN and Tor recovery policy", () => {
  it.each([
    [false, false, 200], [true, false, 403], [false, true, 403], [true, true, 403],
    [null, false, 503], [false, null, 503], ["false", false, 503], [false, "false", 503],
    [undefined, false, 503], [false, undefined, 503], [true, null, 403], [null, true, 403],
  ])("evaluates VPN=%s and Tor=%s independently", async (is_vpn, is_tor, status) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn, is_tor, is_proxy: true })));
    const response = await enforceNetworkAccess(request("/en/login"));
    expect(response?.status ?? 200).toBe(status);
  });

  it.each(["is_proxy", "is_relay"])("keeps unresolved %s classifications monitored", async (flag) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    fetchMock.mockResolvedValue(Response.json(payload({ [flag]: true })));
    expect(await enforceNetworkAccess(request("/en/login"))).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_classification", outcome: "success", resourceId: expect.any(String),
    }));
  });

  it.each(["/en/login", "/ar/login", "/api/auth/me", "/api/mobile/v1/app-config"])("blocks a VPN without Tor on %s", async (path) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true })));
    const response = (await enforceNetworkAccess(request(path)))!;
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("VPN");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not grant a Safari or device-header exemption", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true })));
    const req = request("/en/login");
    req.headers.set("user-agent", "Mozilla/5.0 (iPhone) Version/26.0 Mobile Safari/605.1.15");
    req.headers.set("x-platform", "ios");
    req.headers.set("x-network-verified", "true");
    expect((await enforceNetworkAccess(req))?.status).toBe(403);
  });

  it("preserves VPN detection in the cache when switching recovery modes", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "tor-only");
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true })));
    expect(await enforceNetworkAccess(request())).toBeNull();
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks cached proxy classifications when full enforcement is selected", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_proxy: true })));
    expect(await enforceNetworkAccess(request())).toBeNull();
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "enforce");
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat a missing, mismatched or unavailable lookup as a direct connection", async () => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "vpn-tor");
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: false, is_tor: false }, "1.1.1.1")));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
  });
});

describe("Connection support references", () => {
  it("connects a blocked page and native response to a redacted cached assessment without trusting input", async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true })));
    const req = request("/en/login?requestId=forged-reference");
    req.headers.set("x-alpha-connection-reference", "forged-reference");
    const page = (await enforceNetworkAccess(req))!;
    const reference = page.headers.get("x-alpha-connection-reference");
    expect(reference).toMatch(/^[0-9a-f-]{36}$/);
    const html = await page.text();
    expect(html).toContain(reference);
    expect(html).not.toContain("forged-reference");
    const api = (await enforceNetworkAccess(request("/api/mobile/v1/app-config")))!;
    expect((await api.json()).requestId).toBe(reference);
    expect(console.warn).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_classification", resourceId: reference,
      metadata: { provider: "ipregistry", mode: "enforce", detectedTypes: ["vpn"] },
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logs).not.toMatch(/8\.8\.8\.8|private-session|private-user-token|synthetic-ipregistry|forged-reference/);
  });

  it.each([
    ["is_proxy", "flagged as a proxy"],
    ["is_vpn", "flagged as a VPN"],
    ["is_tor", "part of the Tor network"],
  ])("describes the actual %s classification", async (flag, message) => {
    fetchMock.mockResolvedValue(Response.json(payload({ [flag]: true })));
    const response = (await enforceNetworkAccess(request("/en/login")))!;
    expect(await response.text()).toContain(message);
  });

  it.each([
    ["en", "flagged as a VPN"],
    ["ar", "تم تصنيف اتصالك على أنه VPN"],
  ])("explains the blocking VPN classification in %s when a relay flag is also present", async (locale, message) => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_proxy: true, is_vpn: true, is_relay: true })));
    const response = (await enforceNetworkAccess(request(`/${locale}/login`)))!;
    const html = await response.text();
    expect(response.status).toBe(403);
    expect(html).toContain(message);
    expect(html).not.toMatch(/iCloud Private Relay|Show IP Address|إظهار عنوان IP/);
  });

  it.each([
    ["is_proxy", "flagged as a proxy"], ["is_tor", "part of the Tor network"],
  ])("identifies overlapping %s instead of blaming a permitted relay", async (flag, message) => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true, [flag]: true })));
    const response = (await enforceNetworkAccess(request("/en/login")))!;
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(message);
  });

  it("includes a matching support reference on an unavailable lookup, without calling it a VPN", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const response = (await enforceNetworkAccess(request("/api/mobile/v1/app-config")))!;
    const result = await response.json();
    expect(response.status).toBe(503);
    expect(result.error.code).toBe("NETWORK_CHECK_UNAVAILABLE");
    expect(result.requestId).toBe(response.headers.get("x-alpha-connection-reference"));
    expect(console.warn).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_access_check", resourceId: result.requestId, reason: "unavailable",
    }));
  });
});

describe("network classification incident diagnostics", () => {
  it.each([
    ["is_vpn", "vpn"], ["is_proxy", "proxy"],
    ["is_tor", "tor"], ["is_relay", "private_relay"],
  ])("identifies %s in monitor mode without blocking or logging private data", async (flag, label) => {
    vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "monitor");
    fetchMock.mockResolvedValue(Response.json({ ...payload({ [flag]: true }), note: "private-provider-body", email: "private@example.test" }));
    expect(await enforceNetworkAccess(request("/en/login"))).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("[structured-log]", expect.objectContaining({
      event: "network_provider_classification", outcome: "success", reason: "restricted",
      metadata: { provider: "ipregistry", mode: "monitor", detectedTypes: [label] },
    }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/8\.8\.8\.8|private-session|private-user-token|synthetic-ipregistry|private-provider-body|private@example/);
  });

  it("preserves multiple positive flags and only observes a cached classification once", async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_vpn: true, is_relay: true })));
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect((await enforceNetworkAccess(request()))?.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const events = vi.mocked(console.warn).mock.calls.filter(([, event]) => event.event === "network_provider_classification");
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ outcome: "denied", metadata: { detectedTypes: ["vpn", "private_relay"] } });
  });

  it("does not report a classification for an unvalidated address", async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true }, "1.1.1.1")));
    expect((await enforceNetworkAccess(request()))?.status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("network_provider_classification");
  });

  it("records permitted relay classifications once without a block or private data", async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ is_relay: true })));
    expect(await enforceNetworkAccess(request("/en/login"))).toBeNull();
    expect(await enforceNetworkAccess(request("/en/login"))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const events = vi.mocked(console.warn).mock.calls.filter(([, event]) => event.event === "network_provider_classification");
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      outcome: "success", metadata: { provider: "ipregistry", mode: "enforce", detectedTypes: ["private_relay"] },
    });
    expect(JSON.stringify(events)).not.toMatch(/8\.8\.8\.8|private-session|private-user-token|synthetic-ipregistry/);
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
