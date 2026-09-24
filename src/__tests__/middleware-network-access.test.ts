// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));
import middleware from "@/middleware";
import { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";

let key = 0;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "enforce");
  vi.stubEnv("PROXYCHECK_API_KEY", `middleware-synthetic-key-${++key}`);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => Response.json({ status: "ok", "8.8.8.8": { detections: { vpn: true, proxy: false, tor: false } } }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function request(path: string, method = "GET", headers: Record<string, string> = {}) {
  return new NextRequest(`https://www.alphatraders.co.il${path}`, { method, headers: { "x-vercel-forwarded-for": "8.8.8.8", ...headers } });
}

describe("VPN checks cannot be skipped through application entry points", () => {
  it.each(["/", "/en", "/ar/login", "/en/admin", "/en/trade-room/trade-1", "/api/auth/me", "/api/alpha-exchange/listings", "/api/mobile/v1/app-config"])("blocks %s before returning content or redirects", async (path) => {
    const response = await middleware(request(path, "GET", { cookie: `${AUTH_COOKIE_NAME}=forged; ${AUTH_VERIFIED_COOKIE_NAME}=1`, "x-middleware-subrequest": "middleware", "x-network-verified": "1" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });
  it("checks native login even when device metadata satisfies the origin policy", async () => {
    const response = await middleware(request("/api/mobile/v1/auth/login", "POST", { "x-device-id": "synthetic-device-id-001", "x-app-version": "1.0.0", "x-platform": "ios" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "NETWORK_RESTRICTED" } });
  });
  it("retains origin protection without making a lookup for a rejected mutation", async () => {
    const response = await middleware(request("/api/auth/login", "POST", { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }));
    expect(await response.json()).toEqual({ error: "Invalid request origin." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("still rejects signed-out account pages after the connection is checked", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "ok", "8.8.8.8": { detections: { vpn: false, proxy: false, tor: false } } }));
    const response = await middleware(request("/en/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.alphatraders.co.il/en");
  });
  it.each(["/api/twilio/status", "/api/discord/marketplace-events", "/api/meta/whatsapp/webhook"])("lets the signed callback handler authenticate %s", async (path) => {
    const response = await middleware(request(path, "POST"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
