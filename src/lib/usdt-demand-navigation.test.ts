// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toClientSessionUser } from "@/lib/client-session-user";
import { buyRequestsDestination } from "@/lib/usdt-demand-navigation";
import { demandTestUser } from "@/test-utils/usdt-demand-fixtures";

const now = Date.parse("2026-11-15T13:00:00.000Z");
const until = "2026-11-16T13:00:00.000Z";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_EMAIL_FALLBACK_UNTIL", until);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function unverifiedBuyer() {
  const user = demandTestUser("buyer");
  delete user.verifiedPhone;
  delete user.phoneVerifiedAt;
  return user;
}

describe("Buy Requests navigation during the SMS fallback", () => {
  it("uses the private server policy without fabricating phone verification", () => {
    const session = toClientSessionUser(unverifiedBuyer());
    expect(session).toMatchObject({ phoneVerificationEmailFallbackActive: true, isPhotoVerified: false });
    expect(session).not.toHaveProperty("verifiedPhone");
    expect(session).not.toHaveProperty("phoneVerifiedAt");
    expect(buyRequestsDestination(session, true)).toBe("/usdt-exchange/requests?scope=mine");
  });

  it("removes fallback access from the refreshed session at the deadline", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(until));
    const session = toClientSessionUser(unverifiedBuyer());
    expect(session?.phoneVerificationEmailFallbackActive).toBe(false);
    expect(buyRequestsDestination(session, true)).toBeNull();
  });

  it.each(["email", "age", "role", "feature"])("preserves the %s navigation gate", gate => {
    const user = unverifiedBuyer();
    if (gate === "email") user.emailVerified = false;
    if (gate === "age") delete user.ageEligibility;
    if (gate === "role") { user.role = "student"; user.roles = ["student"]; }
    expect(buyRequestsDestination(toClientSessionUser(user), gate !== "feature")).toBeNull();
  });

  it("fails closed for older sessions without a fallback policy", () => {
    const session = toClientSessionUser(unverifiedBuyer())!;
    delete session.phoneVerificationEmailFallbackActive;
    expect(buyRequestsDestination(session, true)).toBeNull();
  });
});
