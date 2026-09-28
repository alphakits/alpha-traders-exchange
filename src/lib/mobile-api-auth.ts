import type { NextRequest, NextResponse } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { findUserById } from "@/lib/alpha-exchange-store";
import { mobileAuthService, type MobileAuthService } from "@/lib/mobile-auth";
import {
  mobileClientVersionError,
  mobileError,
  readMobileBearerToken,
  type MobileClientMetadata,
} from "@/lib/mobile-api";

export type MobileApiAuthResult =
  | {
      user: AlphaExchangeUser;
      accessToken: string;
      unauthorized: null;
    }
  | {
      user: null;
      accessToken: null;
      unauthorized: NextResponse;
    };

export async function requireMobileApiUser(
  request: NextRequest,
  requestId: string,
  metadata: MobileClientMetadata,
  service: MobileAuthService = mobileAuthService,
): Promise<MobileApiAuthResult> {
  const versionError = mobileClientVersionError(metadata, requestId, metadata.locale);
  if (versionError) {
    return { user: null, accessToken: null, unauthorized: versionError };
  }
  const accessToken = readMobileBearerToken(request);
  if (!accessToken) {
    return {
      user: null,
      accessToken: null,
      unauthorized: mobileError("UNAUTHORIZED", requestId, metadata.locale, 401),
    };
  }
  const validation = await service.validateAccessToken(accessToken, metadata.deviceId);
  if (validation.status !== "valid") {
    const code = validation.status === "expired"
      ? "SESSION_EXPIRED"
      : validation.status === "revoked"
        ? "SESSION_REVOKED"
        : "UNAUTHORIZED";
    return {
      user: null,
      accessToken: null,
      unauthorized: mobileError(code, requestId, metadata.locale, 401),
    };
  }
  const user = await findUserById(validation.session.userId);
  if (!user || user.disabled || user.emailVerified !== true) {
    await service.revokeDevice(accessToken, user?.disabled ? "account_disabled" : "account_unavailable");
    return {
      user: null,
      accessToken: null,
      unauthorized: mobileError(
        user?.disabled ? "ACCOUNT_DISABLED" : "SESSION_REVOKED",
        requestId,
        metadata.locale,
        user?.disabled ? 403 : 401,
      ),
    };
  }
  return { user, accessToken, unauthorized: null };
}
