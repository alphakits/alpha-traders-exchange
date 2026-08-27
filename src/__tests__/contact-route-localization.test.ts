import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
  getRuntimePostgresPool: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: mocks.getRuntimePostgresPool,
}));

import { POST } from "@/app/api/contact/route";

describe("contact route validation localization boundary", () => {
  beforeEach(() => {
    mocks.checkSharedRateLimit.mockReset();
    mocks.logEvent.mockReset();
    mocks.getRuntimePostgresPool.mockReset();
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.getRuntimePostgresPool.mockReturnValue(null);
  });

  it("returns stable issue codes instead of raw Zod messages", async () => {
    const request = new NextRequest("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      body: JSON.stringify({
        name: "x",
        email: "not-an-email",
        subject: "s",
        message: "short",
        locale: "ar",
        website: "",
      }),
    });

    const response = await POST(request);
    const payload = await response.json() as { error?: string; issues?: Record<string, string[]> };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "validation_error",
      issues: {
        name: ["NAME_TOO_SHORT"],
        email: ["EMAIL_INVALID"],
        subject: ["SUBJECT_TOO_SHORT"],
        message: ["MESSAGE_TOO_SHORT"],
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/must contain|invalid email|expected string/i);
  });

  it("silently accepts a filled honeypot before field validation", async () => {
    const request = new NextRequest("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website: "https://spam.example", name: "x" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.getRuntimePostgresPool).not.toHaveBeenCalled();
  });
});
