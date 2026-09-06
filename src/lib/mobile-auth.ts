import { createHash, randomBytes, randomUUID } from "crypto";
import {
  MOBILE_ACCESS_TOKEN_TTL_SECONDS,
  MOBILE_REFRESH_TOKEN_TTL_SECONDS,
  type MobileAuthTokens,
  type MobileLocale,
  type MobilePlatform,
} from "@alpha-traders/contracts";
import {
  postgresMobileDeviceSessionStore,
  type MobileDeviceSessionRecord,
  type MobileDeviceSessionStore,
} from "@/lib/mobile-auth-store";

const ACCESS_TOKEN_PREFIX = "atr_at_v1.";
const REFRESH_TOKEN_PREFIX = "atr_rt_v1.";

type MobileClientMetadata = {
  deviceId: string;
  platform: MobilePlatform;
  appVersion: string;
  locale: MobileLocale;
};

type TokenKind = "access" | "refresh";
type TokenFactory = (kind: TokenKind) => string;

export type MobileAccessValidation =
  | { status: "valid"; session: MobileDeviceSessionRecord }
  | { status: "invalid" | "expired" | "revoked" | "device_mismatch" };

export type MobileRefreshResult =
  | { status: "rotated"; tokens: MobileAuthTokens; session: MobileDeviceSessionRecord }
  | { status: "invalid" | "expired" | "revoked" | "reused" | "device_mismatch" };

function createOpaqueToken(kind: TokenKind) {
  const prefix = kind === "access" ? ACCESS_TOKEN_PREFIX : REFRESH_TOKEN_PREFIX;
  const byteLength = kind === "access" ? 32 : 48;
  return `${prefix}${randomBytes(byteLength).toString("base64url")}`;
}

export function hashMobileSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashMobileDeviceId(deviceId: string) {
  return hashMobileSecret(`device:${deviceId}`);
}

export function isMobileAccessToken(value: string) {
  return value.startsWith(ACCESS_TOKEN_PREFIX) && value.length >= ACCESS_TOKEN_PREFIX.length + 40 && value.length <= 160;
}

export function isMobileRefreshToken(value: string) {
  return value.startsWith(REFRESH_TOKEN_PREFIX) && value.length >= REFRESH_TOKEN_PREFIX.length + 60 && value.length <= 220;
}

function tokensFromSession(
  accessToken: string,
  refreshToken: string,
  session: MobileDeviceSessionRecord,
  nowMs = Date.now(),
): MobileAuthTokens {
  const expiresIn = Math.max(
    0,
    Math.floor((new Date(session.accessExpiresAt).getTime() - nowMs) / 1000),
  );
  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn,
    accessTokenExpiresAt: session.accessExpiresAt,
    refreshTokenExpiresAt: session.refreshExpiresAt,
  };
}

export class MobileAuthService {
  constructor(
    private readonly store: MobileDeviceSessionStore = postgresMobileDeviceSessionStore,
    private readonly now: () => Date = () => new Date(),
    private readonly tokenFactory: TokenFactory = createOpaqueToken,
    private readonly idFactory: () => string = randomUUID,
  ) {}

  async issueSession(userId: string, metadata: MobileClientMetadata) {
    const now = this.now();
    const accessToken = this.tokenFactory("access");
    const refreshToken = this.tokenFactory("refresh");
    const accessExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
    const refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
    const timestamp = now.toISOString();
    const session = await this.store.createOrReplace({
      id: `mobile-session-${this.idFactory()}`,
      userId,
      deviceIdHash: hashMobileDeviceId(metadata.deviceId),
      accessTokenHash: hashMobileSecret(accessToken),
      refreshTokenHash: hashMobileSecret(refreshToken),
      tokenFamilyId: `mobile-family-${this.idFactory()}`,
      refreshGeneration: 0,
      platform: metadata.platform,
      appVersion: metadata.appVersion,
      locale: metadata.locale,
      accessExpiresAt,
      refreshExpiresAt,
      lastSeenAt: timestamp,
      revokedAt: null,
      revokeReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      session,
      tokens: tokensFromSession(accessToken, refreshToken, session, now.getTime()),
    };
  }

  async validateAccessToken(accessToken: string, deviceId: string): Promise<MobileAccessValidation> {
    if (!isMobileAccessToken(accessToken)) return { status: "invalid" };
    const session = await this.store.findByAccessTokenHash(hashMobileSecret(accessToken));
    if (!session) return { status: "invalid" };
    if (session.revokedAt) return { status: "revoked" };
    if (session.deviceIdHash !== hashMobileDeviceId(deviceId)) return { status: "device_mismatch" };
    if (new Date(session.accessExpiresAt).getTime() <= this.now().getTime()) return { status: "expired" };
    return { status: "valid", session };
  }

  async rotateRefreshToken(refreshToken: string, metadata: MobileClientMetadata): Promise<MobileRefreshResult> {
    if (!isMobileRefreshToken(refreshToken)) return { status: "invalid" };
    const now = this.now();
    const nextAccessToken = this.tokenFactory("access");
    const nextRefreshToken = this.tokenFactory("refresh");
    const rotation = await this.store.rotateByRefreshToken({
      refreshTokenHash: hashMobileSecret(refreshToken),
      deviceIdHash: hashMobileDeviceId(metadata.deviceId),
      nextAccessTokenHash: hashMobileSecret(nextAccessToken),
      nextRefreshTokenHash: hashMobileSecret(nextRefreshToken),
      nextAccessExpiresAt: new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      nextRefreshExpiresAt: new Date(now.getTime() + MOBILE_REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
      platform: metadata.platform,
      appVersion: metadata.appVersion,
      locale: metadata.locale,
      now: now.toISOString(),
    });
    if (rotation.status !== "rotated") return rotation;
    return {
      status: "rotated",
      session: rotation.session,
      tokens: tokensFromSession(nextAccessToken, nextRefreshToken, rotation.session, now.getTime()),
    };
  }

  async revokeDevice(accessToken: string, reason = "user_logout") {
    if (!isMobileAccessToken(accessToken)) return false;
    return this.store.revokeByAccessTokenHash(
      hashMobileSecret(accessToken),
      reason,
      this.now().toISOString(),
    );
  }

  async revokeAllUserSessions(userId: string, reason = "user_logout_all") {
    return this.store.revokeAllForUser(userId, reason, this.now().toISOString());
  }
}

export const mobileAuthService = new MobileAuthService();
