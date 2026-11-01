// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), limit: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionToken: mocks.token }));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.limit,
  createRateLimitResponse: (seconds: number) => NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(seconds) } }),
}));
vi.mock("@/lib/notification-push-test", () => ({
  sendNotificationPushTest: mocks.send,
  PushTestError: class extends Error { constructor(readonly code: string) { super(code); } },
}));
import { PushTestError } from "@/lib/notification-push-test";
import { POST } from "./route";

function request(body: unknown = { expectedUserId: "self", locale: "en" }, headers: Record<string, string> = {}) {
  return new NextRequest("https://alpha.example/api/alpha-exchange/notification-push-test", {
    method: "POST", headers: { origin: "https://alpha.example", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "self" } });
  mocks.token.mockResolvedValue("private-session-token");
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.send.mockResolvedValue({ notificationId: "push-test:fixed", status: "accepted", accepted: { browser: 1, native: 0 } });
});

describe("explicit authenticated push self-test", () => {
  it("uses only the authenticated user and returns provider acceptance with private cache headers", async () => {
    const response = await POST(request({ expectedUserId: "self", locale: "ar" }));
    expect(response.status).toBe(202);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ userId: "self", sessionToken: "private-session-token", locale: "ar" });
    expect(await response.json()).toEqual({ notificationId: "push-test:fixed", status: "accepted", accepted: { browser: 1, native: 0 } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(mocks.limit).toHaveBeenCalledWith(expect.objectContaining({ key: "notification-push-test", identifier: "self", maxRequests: 3, windowMs: 300_000 }));
  });

  it.each<Record<string, string>>([{ origin: "https://attacker.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }])("rejects foreign or missing origin before authentication: %j", async headers => {
    expect((await POST(request(undefined, headers))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects guests", async () => {
    mocks.auth.mockResolvedValue({ user: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([{ locale: "en" }, { expectedUserId: "other", locale: "en" }, { expectedUserId: 1, locale: "en" }])("requires the current account guard: %j", async body => {
    expect((await POST(request(body))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    { expectedUserId: "self", locale: "en", userId: "other" },
    { expectedUserId: "self", locale: "en", title: "arbitrary" },
    { expectedUserId: "self", locale: "en", payload: { destination: "/admin" } },
    { expectedUserId: "self", locale: "fr" }, [], null,
  ])("rejects recipient, copy, destination and invalid locale overrides: %j", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects oversized content with or without content-length", async () => {
    expect((await POST(request({ expectedUserId: "self", locale: "en" }, { "content-length": "1025" }))).status).toBe(400);
    expect((await POST(request({ expectedUserId: "x".repeat(1025), locale: "en" }))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("shares the per-account rate limit across devices without persisting or sending", async () => {
    mocks.limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 300 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("requires the current session token even after authentication resolves", async () => {
    mocks.token.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([ ["session_ended", 401], ["alerts_disabled", 409], ["storage_unavailable", 503] ] as const)("fails closed on %s", async (code, status) => {
    mocks.send.mockRejectedValue(new PushTestError(code));
    expect((await POST(request())).status).toBe(status);
  });

  it("does not expose provider errors or session data", async () => {
    mocks.send.mockRejectedValue(new Error("private-provider-token"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("private-provider-token");
    expect(body).not.toContain("private-session-token");
  });
});
