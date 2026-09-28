// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MobileAuthService,
  hashMobileDeviceId,
  hashMobileSecret,
} from "@/lib/mobile-auth";
import type {
  MobileDeviceSessionRecord,
  MobileDeviceSessionStore,
  MobileRefreshRotationResult,
} from "@/lib/mobile-auth-store";

const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_DEVICE_ID = "550e8400-e29b-41d4-a716-446655440001";

class MemoryMobileSessionStore implements MobileDeviceSessionStore {
  session: MobileDeviceSessionRecord | null = null;
  usedRefreshHashes = new Set<string>();

  async createOrReplace(session: MobileDeviceSessionRecord) {
    this.session = { ...session };
    this.usedRefreshHashes.clear();
    return { ...this.session };
  }

  async findByAccessTokenHash(accessTokenHash: string) {
    return this.session?.accessTokenHash === accessTokenHash ? { ...this.session } : null;
  }

  async rotateByRefreshToken(input: {
    refreshTokenHash: string;
    deviceIdHash: string;
    nextAccessTokenHash: string;
    nextRefreshTokenHash: string;
    nextAccessExpiresAt: string;
    nextRefreshExpiresAt: string;
    platform: "ios" | "android";
    appVersion: string;
    locale: "ar" | "en";
    now: string;
  }): Promise<MobileRefreshRotationResult> {
    if (!this.session) return { status: "invalid" };
    if (this.usedRefreshHashes.has(input.refreshTokenHash)) {
      this.session.revokedAt = input.now;
      this.session.revokeReason = "refresh_token_reuse";
      return { status: "reused" };
    }
    if (this.session.refreshTokenHash !== input.refreshTokenHash) return { status: "invalid" };
    if (this.session.revokedAt) return { status: "revoked" };
    if (this.session.deviceIdHash !== input.deviceIdHash) return { status: "device_mismatch" };
    if (new Date(this.session.refreshExpiresAt).getTime() <= new Date(input.now).getTime()) {
      return { status: "expired" };
    }
    this.usedRefreshHashes.add(this.session.refreshTokenHash);
    this.session = {
      ...this.session,
      accessTokenHash: input.nextAccessTokenHash,
      refreshTokenHash: input.nextRefreshTokenHash,
      refreshGeneration: this.session.refreshGeneration + 1,
      accessExpiresAt: input.nextAccessExpiresAt,
      refreshExpiresAt: new Date(this.session.refreshExpiresAt).getTime() < new Date(input.nextRefreshExpiresAt).getTime()
        ? this.session.refreshExpiresAt
        : input.nextRefreshExpiresAt,
      platform: input.platform,
      appVersion: input.appVersion,
      locale: input.locale,
      lastSeenAt: input.now,
      updatedAt: input.now,
    };
    return { status: "rotated", session: { ...this.session } };
  }

  async revokeByAccessTokenHash(accessTokenHash: string, reason: string, now: string) {
    if (!this.session || this.session.accessTokenHash !== accessTokenHash) return false;
    this.session.revokedAt = this.session.revokedAt ?? now;
    this.session.revokeReason = reason;
    return true;
  }

  async revokeAllForUser(userId: string, reason: string, now: string) {
    if (!this.session || this.session.userId !== userId || this.session.revokedAt) return 0;
    this.session.revokedAt = now;
    this.session.revokeReason = reason;
    return 1;
  }
}

function tokenFactory() {
  const tokens = [
    `atr_at_v1.${"a".repeat(44)}`,
    `atr_rt_v1.${"b".repeat(66)}`,
    `atr_at_v1.${"c".repeat(44)}`,
    `atr_rt_v1.${"d".repeat(66)}`,
    `atr_at_v1.${"e".repeat(44)}`,
    `atr_rt_v1.${"f".repeat(66)}`,
  ];
  return () => {
    const token = tokens.shift();
    if (!token) throw new Error("No test token remaining");
    return token;
  };
}

function metadata(deviceId = DEVICE_ID) {
  return {
    deviceId,
    platform: "ios" as const,
    appVersion: "1.0.0",
    locale: "ar" as const,
  };
}

describe("MobileAuthService", () => {
  it("stores only token and device hashes while issuing a 15-minute access token", async () => {
    const store = new MemoryMobileSessionStore();
    const now = new Date("2026-09-06T01:00:00.000Z");
    const service = new MobileAuthService(store, () => now, tokenFactory(), () => "fixed-id");

    const issued = await service.issueSession("user-1", metadata());

    expect(issued.tokens.expiresIn).toBe(900);
    expect(issued.tokens.accessTokenExpiresAt).toBe("2026-09-06T01:15:00.000Z");
    expect(issued.tokens.refreshTokenExpiresAt).toBe("2026-10-06T01:00:00.000Z");
    expect(store.session).toMatchObject({
      userId: "user-1",
      deviceIdHash: hashMobileDeviceId(DEVICE_ID),
      accessTokenHash: hashMobileSecret(issued.tokens.accessToken),
      refreshTokenHash: hashMobileSecret(issued.tokens.refreshToken),
      refreshGeneration: 0,
    });
    expect(JSON.stringify(store.session)).not.toContain(issued.tokens.accessToken);
    expect(JSON.stringify(store.session)).not.toContain(issued.tokens.refreshToken);
    expect(JSON.stringify(store.session)).not.toContain(DEVICE_ID);
  });

  it("binds access tokens to the installation and enforces their expiry", async () => {
    const store = new MemoryMobileSessionStore();
    let now = new Date("2026-09-06T01:00:00.000Z");
    const service = new MobileAuthService(store, () => now, tokenFactory(), () => "fixed-id");
    const issued = await service.issueSession("user-1", metadata());

    await expect(service.validateAccessToken(issued.tokens.accessToken, DEVICE_ID)).resolves.toMatchObject({ status: "valid" });
    await expect(service.validateAccessToken(issued.tokens.accessToken, OTHER_DEVICE_ID)).resolves.toEqual({ status: "device_mismatch" });

    now = new Date("2026-09-06T01:15:00.000Z");
    await expect(service.validateAccessToken(issued.tokens.accessToken, DEVICE_ID)).resolves.toEqual({ status: "expired" });
  });

  it("rotates both tokens and revokes the family when an old refresh token is replayed", async () => {
    const store = new MemoryMobileSessionStore();
    let now = new Date("2026-09-06T01:00:00.000Z");
    const service = new MobileAuthService(store, () => now, tokenFactory(), () => "fixed-id");
    const issued = await service.issueSession("user-1", metadata());

    now = new Date("2026-09-06T01:05:00.000Z");
    const rotated = await service.rotateRefreshToken(issued.tokens.refreshToken, metadata());
    expect(rotated.status).toBe("rotated");
    if (rotated.status !== "rotated") throw new Error("Expected rotation");
    expect(rotated.tokens.accessToken).not.toBe(issued.tokens.accessToken);
    expect(rotated.tokens.refreshToken).not.toBe(issued.tokens.refreshToken);
    expect(rotated.session.refreshGeneration).toBe(1);
    expect(rotated.tokens.refreshTokenExpiresAt).toBe(issued.tokens.refreshTokenExpiresAt);
    await expect(service.validateAccessToken(issued.tokens.accessToken, DEVICE_ID)).resolves.toEqual({ status: "invalid" });
    await expect(service.validateAccessToken(rotated.tokens.accessToken, DEVICE_ID)).resolves.toMatchObject({ status: "valid" });

    await expect(service.rotateRefreshToken(issued.tokens.refreshToken, metadata())).resolves.toEqual({ status: "reused" });
    await expect(service.validateAccessToken(rotated.tokens.accessToken, DEVICE_ID)).resolves.toEqual({ status: "revoked" });
  });

  it("supports device-only and account-wide revocation", async () => {
    const store = new MemoryMobileSessionStore();
    const service = new MobileAuthService(
      store,
      () => new Date("2026-09-06T01:00:00.000Z"),
      tokenFactory(),
      () => "fixed-id",
    );
    const issued = await service.issueSession("user-1", metadata());

    await expect(service.revokeDevice(issued.tokens.accessToken)).resolves.toBe(true);
    await expect(service.validateAccessToken(issued.tokens.accessToken, DEVICE_ID)).resolves.toEqual({ status: "revoked" });

    const next = await service.issueSession("user-1", metadata());
    await expect(service.revokeAllUserSessions("user-1")).resolves.toBe(1);
    await expect(service.validateAccessToken(next.tokens.accessToken, DEVICE_ID)).resolves.toEqual({ status: "revoked" });
  });
});
