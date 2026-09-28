// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getCurrentSessionToken: vi.fn(),
  registerMobilePushSubscription: vi.fn(),
  checkSharedRateLimit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionToken: mocks.getCurrentSessionToken }));
vi.mock("@/lib/mobile-push", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/mobile-push")>();
  return { ...original, registerMobilePushSubscription: mocks.registerMobilePushSubscription };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...original, checkSharedRateLimit: mocks.checkSharedRateLimit };
});

import { POST } from "@/app/api/mobile/v1/push-subscriptions/route";

const validBody = {
  expoPushToken: "ExponentPushToken[abcdefghijklmnop]",
  installationId: "550e8400-e29b-41d4-a716-446655440000",
  platform: "ios",
  locale: "en",
  appVersion: "1.0.0",
};

function request(body: unknown = validBody, origin = "https://www.alphatraders.co.il") {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/push-subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-App-Version": validBody.appVersion,
      "X-Device-Id": validBody.installationId,
      "X-Locale": validBody.locale,
      "X-Platform": validBody.platform,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/v1/push-subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "user-1", role: "buyer" },
      unauthorized: null,
    });
    mocks.getCurrentSessionToken.mockResolvedValue("browser-session-token");
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.registerMobilePushSubscription.mockResolvedValue({ id: "push-1", registered: true });
  });

  it("binds a valid physical-device token to the authenticated browser session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ registered: true });
    expect(mocks.registerMobilePushSubscription).toHaveBeenCalledWith({
      userId: "user-1",
      sessionToken: "browser-session-token",
      ...validBody,
    });
  });

  it("rejects cross-origin token replacement", async () => {
    const response = await POST(request(validBody, "https://attacker.test"));
    expect(response.status).toBe(403);
    expect(mocks.registerMobilePushSubscription).not.toHaveBeenCalled();
  });

  it("requires the canonical signed-in website user", async () => {
    mocks.requireApiUser.mockResolvedValue({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.registerMobilePushSubscription).not.toHaveBeenCalled();
  });

  it("rejects mismatched device metadata before persistence", async () => {
    const response = await POST(request({ ...validBody, platform: "android" }));
    expect(response.status).toBe(400);
    expect(mocks.registerMobilePushSubscription).not.toHaveBeenCalled();
  });
});
