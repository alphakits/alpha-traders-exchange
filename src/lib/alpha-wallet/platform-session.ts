import "server-only";

import type { NextRequest } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { getCurrentSessionForAuthorization } from "@/lib/auth";
import { requireMobileApiSession, type MobileAccountLoader } from "@/lib/mobile-api-auth";
import type { MobileClientMetadata } from "@/lib/mobile-api";
import { mobileAuthService, type MobileAuthService } from "@/lib/mobile-auth";
import { hasVerifiedPhone } from "@/lib/verification-bypass";
import { isAccountPhoneVerificationExempt } from "@/lib/phone-verification-exemptions";
import { hasAdultConfirmation } from "@/lib/age-eligibility";
import type { ResolvedWalletUser } from "./access";
import { assertSimulationRuntime } from "./runtime";

type DevelopmentSessionOptions = { mode: "simulation-only" };

function walletUser(user: AlphaExchangeUser, sessionExpiresAtMs: number): ResolvedWalletUser | null {
  if (!Number.isSafeInteger(sessionExpiresAtMs) || sessionExpiresAtMs <= Date.now()) return null;
  return {
    id: user.id,
    role: user.role,
    roles: user.roles ? [...user.roles] : undefined,
    sellerStatus: user.sellerStatus,
    // A missing legacy flag means enabled; malformed retained values fail closed.
    disabled: user.disabled !== undefined && user.disabled !== false,
    emailVerified: user.emailVerified === true,
    phoneAccessAllowed: hasVerifiedPhone(user) || isAccountPhoneVerificationExempt(user),
    adultConfirmed: hasAdultConfirmation(user),
    sessionExpiresAtMs,
  };
}

/**
 * Server cookie -> coherent canonical account/session -> development wallet.
 * Every resolution re-reads the cookie and uncached authentication metadata.
 * No route is installed and no authentication result is retained in this closure.
 */
export function createDevelopmentWebWalletResolver(options: DevelopmentSessionOptions) {
  const { mode } = options;
  assertSimulationRuntime(mode);
  return async (): Promise<ResolvedWalletUser | null> => {
    assertSimulationRuntime(mode);
    const resolved = await getCurrentSessionForAuthorization();
    assertSimulationRuntime(mode);
    return resolved ? walletUser(resolved.user, resolved.sessionExpiresAtMs) : null;
  };
}

/**
 * Uses the existing bearer/device/version validator and canonical account lookup.
 * Tests must supply both isolated dependencies; production defaults are not test
 * fixtures. Token/account reads remain separate from each other and wallet commit.
 */
export function createDevelopmentMobileWalletResolver(options: DevelopmentSessionOptions & {
  request: NextRequest;
  requestId: string;
  metadata: MobileClientMetadata;
  authentication?: { service: MobileAuthService; loadUser: MobileAccountLoader };
}) {
  const { mode, request, requestId, authentication } = options;
  const metadata = { ...options.metadata };
  const service = authentication?.service ?? mobileAuthService;
  const loadUser = authentication?.loadUser;
  assertSimulationRuntime(mode);
  return async (): Promise<ResolvedWalletUser | null> => {
    assertSimulationRuntime(mode);
    const resolved = await requireMobileApiSession(request, requestId, metadata, service, loadUser);
    assertSimulationRuntime(mode);
    if (!resolved.user || resolved.user.id !== resolved.session.userId) return null;
    // Account loading can be slow. Revoke/rotate/expiry during that await must
    // invalidate this resolution, even on the gateway's final authorization read.
    const validation = await service.validateAccessToken(resolved.accessToken, metadata.deviceId);
    assertSimulationRuntime(mode);
    if (validation.status !== "valid" || validation.session.id !== resolved.session.id
      || validation.session.userId !== resolved.user.id
      || validation.session.accessExpiresAt !== resolved.session.accessExpiresAt) return null;
    const expiresAt = validation.session.accessExpiresAt;
    return walletUser(resolved.user, typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN);
  };
}
