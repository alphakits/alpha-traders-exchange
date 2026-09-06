import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => NextResponse.next(),
}));

import middleware from "@/middleware";

function apiRequest(
  pathname: string,
  method: string,
  headers: Record<string, string> = {},
) {
  return new NextRequest(`https://www.alphatraders.co.il${pathname}`, {
    method,
    headers,
  });
}

describe("API mutation origin protection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows same-origin authenticated write requests to continue", () => {
    const response = middleware(apiRequest(
      "/api/alpha-exchange/purchase-requests",
      "POST",
      {
        origin: "https://www.alphatraders.co.il",
        "sec-fetch-site": "same-origin",
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects cross-site write requests before they reach an API route", async () => {
    const response = middleware(apiRequest(
      "/api/alpha-exchange/purchase-requests",
      "POST",
      {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request origin." });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails closed when a protected API mutation has no Origin header", () => {
    const response = middleware(apiRequest(
      "/api/alpha-exchange/purchase-requests/request-1/messages",
      "POST",
    ));

    expect(response.status).toBe(403);
  });

  it("allows originless native mobile mutations only with required client headers", () => {
    const response = middleware(apiRequest(
      "/api/mobile/v1/auth/login",
      "POST",
      {
        "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
        "x-app-version": "1.0.0",
        "x-platform": "ios",
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects native-looking cross-site browser mutations", () => {
    const response = middleware(apiRequest(
      "/api/mobile/v1/auth/login",
      "POST",
      {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
        "x-app-version": "1.0.0",
        "x-platform": "android",
      },
    ));

    expect(response.status).toBe(403);
  });

  it("preserves loopback-only production E2E writes without weakening deployed production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");

    const localResponse = middleware(new NextRequest(
      "http://127.0.0.1:3000/api/testing/alpha-exchange-state",
      { method: "PUT" },
    ));
    expect(localResponse.status).toBe(200);
    expect(localResponse.headers.get("x-middleware-next")).toBe("1");

    const localCrossSiteResponse = middleware(new NextRequest(
      "http://127.0.0.1:3000/api/testing/alpha-exchange-state",
      {
        method: "PUT",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      },
    ));
    expect(localCrossSiteResponse.status).toBe(403);

    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const deployedResponse = middleware(new NextRequest(
      "https://www.alphatraders.co.il/api/testing/alpha-exchange-state",
      { method: "PUT" },
    ));
    expect(deployedResponse.status).toBe(403);
  });

  it.each([
    "/api/discord/marketplace-events",
    "/api/twilio/status",
  ])("preserves authenticated external callback delivery for %s", (pathname) => {
    const response = middleware(apiRequest(pathname, "POST"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not block read-only API requests without an Origin header", () => {
    const response = middleware(apiRequest("/api/health", "GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
