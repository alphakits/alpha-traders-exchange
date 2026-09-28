import { describe, expect, it } from "vitest";
import type { MobileAuthTokens } from "@alpha-traders/contracts";
import {
  canCommitMobileSessionRefresh,
  resolveMobileSessionRecovery,
  type MobileSessionSnapshot,
} from "../../apps/mobile/src/auth/session-refresh-policy";

function tokens(label: string): MobileAuthTokens {
  return {
    accessToken: `access-${label}`,
    refreshToken: `refresh-${label}`,
    tokenType: "Bearer",
    expiresIn: 900,
    accessTokenExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshTokenExpiresAt: "2030-02-01T00:00:00.000Z",
  };
}

function snapshot(generation: number, label: string): MobileSessionSnapshot {
  return { generation, tokens: tokens(label) };
}

describe("native session refresh recovery", () => {
  it("refreshes only while the failed rotating-token generation is current", () => {
    const failed = snapshot(4, "old");
    expect(resolveMobileSessionRecovery(failed, snapshot(4, "old"))).toEqual({
      action: "refresh",
      tokens: failed.tokens,
    });
    expect(canCommitMobileSessionRefresh(failed, snapshot(4, "old"))).toBe(true);
  });

  it("retries with credentials already rotated by a concurrent request", () => {
    const failed = snapshot(4, "old");
    const current = snapshot(4, "new");
    expect(resolveMobileSessionRecovery(failed, current)).toEqual({
      action: "retry",
      tokens: current.tokens,
    });
    expect(canCommitMobileSessionRefresh(failed, current)).toBe(false);
  });

  it("never revives or acts through a signed-out or replacement account session", () => {
    const failed = snapshot(4, "old");
    expect(resolveMobileSessionRecovery(failed, null)).toEqual({ action: "superseded" });
    expect(resolveMobileSessionRecovery(failed, snapshot(5, "replacement"))).toEqual({
      action: "superseded",
    });
    expect(canCommitMobileSessionRefresh(failed, snapshot(5, "replacement"))).toBe(false);
  });
});
