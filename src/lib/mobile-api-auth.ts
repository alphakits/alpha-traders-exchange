import type { NextRequest, NextResponse } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { findUserById, findUserByIdForAuthorization } from "@/lib/alpha-exchange-store";
import { needsMarketplacePhoneVerification } from "@/lib/phone-verification";
import { needsAdultConfirmation } from "@/lib/age-eligibility";
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

export type MobileApiSessionAuthResult =
  | (Extract<MobileApiAuthResult, { unauthorized: null }> & {
      /** Server metadata from the validated access session, not a client TTL. */
      session: { id: string; userId: string; accessExpiresAt: string };
    })
  | Extract<MobileApiAuthResult, { user: null }>;

/** Trusted server account lookup; never a client-supplied profile. */
export type MobileAccountLoader = (userId: string) => Promise<AlphaExchangeUser | null>;

export async function requireMobileApiSession(
  request: NextRequest,
  requestId: string,
  metadata: MobileClientMetadata,
  service: MobileAuthService = mobileAuthService,
  loadUser: MobileAccountLoader = findUserByIdForAuthorization,
): Promise<MobileApiSessionAuthResult> {
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
  const user = await loadUser(validation.session.userId);
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
  if (/^\/api\/mobile\/v1\/(?:marketplace|trades|seller|admin)(?:\/|$)/.test(request.nextUrl.pathname)
    && needsAdultConfirmation(user)) {
    return { user: null, accessToken: null,
      unauthorized: mobileError("AGE_CONFIRMATION_REQUIRED", requestId, metadata.locale, 403) };
  }
  if (/^\/api\/mobile\/v1\/(?:marketplace|trades|seller|admin)(?:\/|$)/.test(request.nextUrl.pathname)
    && needsMarketplacePhoneVerification(user)) {
    return {
      user: null, accessToken: null,
      unauthorized: mobileError("PHONE_VERIFICATION_REQUIRED", requestId, metadata.locale, 403),
    };
  }
  return {
    user, accessToken, unauthorized: null,
    session: { id: validation.session.id, userId: validation.session.userId, accessExpiresAt: validation.session.accessExpiresAt },
  };
}

/** Preserve the existing gates, account loader, and exact route-facing shape. */
export async function requireMobileApiUser(
  request: NextRequest,
  requestId: string,
  metadata: MobileClientMetadata,
  service: MobileAuthService = mobileAuthService,
): Promise<MobileApiAuthResult> {
  const resolved = await requireMobileApiSession(request, requestId, metadata, service, findUserById);
  if (!resolved.user) return resolved;
  return { user: resolved.user, accessToken: resolved.accessToken, unauthorized: null };
}
