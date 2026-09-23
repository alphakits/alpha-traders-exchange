import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUserForAuthorization } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { hasSellerOperationalAccess } from "@/lib/seller-approval-verification";
import { logEvent } from "@/lib/structured-logging";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { isVerified } from "@/lib/verification-bypass";

export async function requireApiUser() {
  let user: Awaited<ReturnType<typeof getCurrentSessionUserForAuthorization>>;
  try {
    user = await getCurrentSessionUserForAuthorization();
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", {
      event: "api_session_unavailable",
      outcome: "failed",
      reason: "session_read_failed",
      metadata: { errorName: error instanceof Error ? error.name : typeof error },
    });
    // Refuse the action without revoking a valid cookie during a database or
    // connection failure. Clients can retry the read instead of logging out.
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Account temporarily unavailable. Please try again.", code: "SESSION_TEMPORARILY_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0", "Retry-After": "3" },
      }),
    };
  }
  if (!user || user.disabled === true) {
    const token = await getCurrentSessionToken();
    if (token) {
      await clearUserSession(token);
    }
    const accountDisabled = user?.disabled === true;
    logEvent("warn", {
      event: "permission_denied",
      actorUserId: user?.id,
      actorRole: user?.role,
      outcome: "denied",
      reason: accountDisabled ? "Disabled account" : "Unauthenticated request",
    });
    const unauthorized = NextResponse.json(
      accountDisabled
        ? { error: "This account is disabled.", code: "ACCOUNT_DISABLED" }
        : { error: "Unauthorized" },
      { status: accountDisabled ? 403 : 401 },
    );
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
 * Buyer-facing marketplace actions require a verified email address. Phone
 * verification is deliberately not part of this rule: it remains an optional
 * account feature and any seller-only phone policy is enforced separately.
 *
 * This gate uses the server-resolved session user only. It has no cookie,
 * client-state, or environment-flag bypass.
 */
export function requireEmailVerificationForTrading(user: { id: string; role: string; emailVerified?: boolean }) {
  if (user.emailVerified === true) return null;
  logEvent("warn", {
    event: "permission_denied",
    actorUserId: user.id,
    actorRole: user.role,
    outcome: "denied",
    reason: "Email verification required for marketplace action",
  });
  return NextResponse.json(
    {
      error: "Email verification is required before marketplace actions.",
      code: "EMAIL_VERIFICATION_REQUIRED",
    },
    { status: 403 },
  );
}

/**
 * Returns null (bypass) when:
 *   - User is admin or owner (always bypass)
 *   - phone verification is not explicitly enabled (the default email-only mode)
 *   - User has an already-verified phone number
 * Otherwise returns a 403 response requiring phone verification.
 */
export function requirePhoneVerificationForTrading(user: { id: string; role: string; roles?: string[]; email?: string; verifiedPhone?: string; phoneVerifiedAt?: string }) {
  // Admin and owner always bypass phone verification.
  const isAdminOrOwner = user.role === "admin" || user.role === "owner" || (user.roles ?? []).includes("admin") || (user.roles ?? []).includes("owner");
  if (isAdminOrOwner) return null;
  // Email-only mode never requires a phone. Phone enforcement is opt-in.
  if (!isMarketplacePhoneVerificationEnabled()) return null;
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
  if (!hasRole(user, "admin") && !hasRole(user, "owner")) {
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
  if (!hasSellerOperationalAccess(user)) {
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
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) {
    return { user: null, unauthorized: emailVerificationRequired };
  }
  const isSellerWorkspaceUser =
    user.sellerStatus === "approved_seller" ||
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
