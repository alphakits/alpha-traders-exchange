// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/mobile/v1/app-config/route";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/app-config", {
    headers: {
      "accept-language": "en",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-app-version": "1.2.0",
      "x-platform": "ios",
      "x-request-id": "app-config-request",
      ...headers,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/mobile/v1/app-config", () => {
  it("remains available to an old client and returns its platform policy", async () => {
    vi.stubEnv("MOBILE_MIN_IOS_VERSION", "2.0.0");
    vi.stubEnv("MOBILE_LATEST_IOS_VERSION", "2.1.0");

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Accept-Language, X-App-Version, X-Platform");
    expect(payload).toMatchObject({
      apiVersion: "v1",
      platform: "ios",
      currentVersion: "1.2.0",
      minimumSupportedVersion: "2.0.0",
      latestVersion: "2.1.0",
      updateRequired: true,
      updateRecommended: false,
      requestId: "app-config-request",
    });
    expect(Number.isNaN(Date.parse(payload.checkedAt))).toBe(false);
  });

  it("requires bounded native client metadata", async () => {
    const response = await GET(new NextRequest(
      "https://www.alphatraders.co.il/api/mobile/v1/app-config",
      { headers: { "accept-language": "ar" } },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEVICE_HEADERS_REQUIRED" },
    });
  });
});
