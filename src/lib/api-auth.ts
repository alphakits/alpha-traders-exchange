import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";

export async function requireApiUser() {
  const user = await getCurrentSessionUser();
  if (!user) {
    const token = await getCurrentSessionToken();
    await clearUserSession(token);
    logEvent("warn", {
      event: "permission_denied",
      outcome: "denied",
      reason: "Unauthenticated request",
    });
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    unauthorized.cookies.delete(AUTH_COOKIE_NAME);
    unauthorized.cookies.delete(AUTH_VERIFIED_COOKIE_NAME);
    unauthorized.cookies.delete(AUTH_PHONE_VERIFIED_COOKIE_NAME);
    return {
      user: null,
      unauthorized,
    };
  }
  return { user, unauthorized: null };
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
