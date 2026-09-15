// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  confirm: vi.fn(),
  deliver: vi.fn(),
  rate: vi.fn(),
  requireUser: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  beginProfilePhoneVerification: mocks.begin,
  confirmProfilePhoneVerification: mocks.confirm,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireUser }));
vi.mock("@/lib/phone-verification-delivery", () => ({ sendPhoneVerificationCode: mocks.deliver }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/mobile-session-user", () => ({
  toMobileSessionUser: (user: { id: string }) => ({
    id: user.id,
    fullName: "Mobile User",
    email: "mobile@example.test",
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    preferredLocale: "en",
    profilePhotoUrl: "",
    emailVerified: true,
    isFoundingMember: false,
    isFoundingSeller: false,
  }),
}));

import { POST as sendCode } from "@/app/api/mobile/v1/settings/phone/send-code/route";
import { POST as verifyCode } from "@/app/api/mobile/v1/settings/phone/verify-code/route";

const user = { id: "mobile-phone-user" };

function request(path: "send-code" | "verify-code", body: Record<string, unknown>) {
  return new NextRequest(`https://www.alphatraders.co.il/api/mobile/v1/settings/phone/${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer mobile-token",
      "content-type": "application/json",
      "accept-language": "en",
      "x-app-version": "1.0.0",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-platform": "ios",
      "x-request-id": `phone-${path}-request`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  mocks.requireUser.mockResolvedValue({ user, accessToken: "mobile-token", unauthorized: null });
  mocks.rate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.begin.mockResolvedValue({ phone: "+972501234567", code: "482901" });
  mocks.deliver.mockResolvedValue({ ok: true, provider: "whatsapp", channel: "whatsapp" });
  mocks.confirm.mockResolvedValue({ id: user.id, verifiedPhone: "+972501234567" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mobile phone verification routes", () => {
  it("rejects sends without creating or delivering a code when phone verification is disabled", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");

    const response = await sendCode(request("send-code", { phone: "+972501234567" }));

    expect(response.status).toBe(503);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("rejects confirmations without reading a code when phone verification is disabled", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");

    const response = await verifyCode(request("verify-code", {
      phone: "+972501234567",
      code: "482901",
    }));

    expect(response.status).toBe(503);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("sends the persisted OTP through the selected provider without returning it", async () => {
    const response = await sendCode(request("send-code", { phone: "+972501234567" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.begin).toHaveBeenCalledWith({ userId: user.id, phone: "+972501234567" });
    expect(mocks.deliver).toHaveBeenCalledWith({ phone: "+972501234567", code: "482901", locale: "en" });
    expect(payload).toMatchObject({ ok: true, channel: "whatsapp" });
    expect(JSON.stringify(payload)).not.toContain("482901");
  });

  it("confirms a six-digit code and returns only a masked phone", async () => {
    const response = await verifyCode(request("verify-code", { phone: "+972501234567", code: "482901" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith({ userId: user.id, phone: "+972501234567", code: "482901" });
    expect(payload).toMatchObject({ ok: true, phone: { verified: true, masked: "+97•••67" } });
    expect(JSON.stringify(payload)).not.toContain("+972501234567");
    expect(JSON.stringify(payload)).not.toContain("482901");
  });

  it("enforces the authenticated send rate limit before creating a code", async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });

    const response = await sendCode(request("send-code", { phone: "+972501234567" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
