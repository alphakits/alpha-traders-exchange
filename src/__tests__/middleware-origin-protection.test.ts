import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
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
