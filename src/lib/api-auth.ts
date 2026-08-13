import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";
import { isVerified } from "@/lib/verification-bypass";

export async function requireApiUser() {
  const user = await getCurrentSessionUser();
  if (!user) {
    const token = await getCurrentSessionToken();
    if (token) {
      await clearUserSession(token);
    }
    logEvent("warn", {
      event: "permission_denied",
      outcome: "denied",
      reason: "Unauthenticated request",
    });
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (token) {
      unauthorized.cookies.delete(AUTH_COOKIE_NAME);
      unauthorized.cookies.delete(AUTH_VERIFIED_COOKIE_NAME);
      unauthorized.cookies.delete(AUTH_PHONE_VERIFIED_COOKIE_NAME);
    }
    return {
      user: null,
      unauthorized,
    };
  }
  return { user, unauthorized: null };
}

export function hasPhoneVerification(user: { email?: string; verifiedPhone?: string; phoneVerifiedAt?: string }) {
  return isVerified(user);
}

/**
 * Returns null (bypass) when:
 *   - User is admin or owner (always bypass)
 *   - ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION=1 env var is set (pre-Twilio operation)
 *   - User has an already-verified phone number
 * Otherwise returns a 403 response requiring phone verification.
 */
export function requirePhoneVerificationForTrading(user: { id: string; role: string; roles?: string[]; email?: string; verifiedPhone?: string; phoneVerifiedAt?: string }) {
  // Admin and owner always bypass phone verification.
  const isAdminOrOwner = user.role === "admin" || user.role === "owner" || (user.roles ?? []).includes("admin") || (user.roles ?? []).includes("owner");
  if (isAdminOrOwner) return null;
  // Platform-level bypass for pre-Twilio operation (set ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION=1 in Vercel env).
  if (isMarketplacePhoneVerificationDisabled()) return null;
  if (hasPhoneVerification(user)) return null;
  logEvent("warn", {
    event: "permission_denied",
    actorUserId: user.id,
    actorRole: user.role,
    outcome: "denied",
    reason: "Phone verification required for marketplace action",
  });
  return NextResponse.json(
    {
      error: "Phone verification is required before marketplace actions.",
      code: "PHONE_VERIFICATION_REQUIRED",
    },
    { status: 403 },
  );
}

export async function requireApiAdmin() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) {
    return { user: null, unauthorized };
  }
  if (!hasRole(user, "admin")) {
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Admin access required",
    });
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Admin access required." }, { status: 403 }),
    };
  }
  return { user, unauthorized: null };
}

export async function requireApiOwner() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return { user: null, unauthorized };
  if (!hasRole(user, "owner")) {
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Owner access required",
    });
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Owner access required." }, { status: 403 }),
    };
  }
  return { user, unauthorized: null };
}

export async function requireApiBuyer() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return { user: null, unauthorized };
  if (!hasRole(user, "buyer")) {
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Buyer access required",
    });
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Buyer verification required." }, { status: 403 }),
    };
  }
  return { user, unauthorized: null };
}

export async function requireApiStudent() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return { user: null, unauthorized };
  if (!hasRole(user, "student")) {
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Student access required",
    });
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Student access required." }, { status: 403 }),
    };
  }
  return { user, unauthorized: null };
}

export async function requireApiSeller() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return { user: null, unauthorized };
  if (!hasRole(user, "approved_seller")) {
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Approved seller access required",
    });
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Approved seller access required." }, { status: 403 }),
    };
  }
  return { user, unauthorized: null };
}

export async function requireApiSellerWorkspaceActor() {
  const result = await requireApiUser();
  if (!result.user) return result;
  const user = result.user;
  const isSellerWorkspaceUser =
    hasRole(user, "approved_seller") ||
    hasRole(user, "pending_seller_approval") ||
    user.sellerStatus === "suspended";

  if (!isSellerWorkspaceUser) {
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Seller workspace access required",
    });
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Seller account required." }, { status: 403 }),
    };
  }

  return result;
}
