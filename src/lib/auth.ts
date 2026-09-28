import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cache } from "react";
import { cookies } from "next/headers";
import { createAuthSession, deleteSessionByToken, findUserByEmail, getAuthenticatedUserBySessionToken } from "@/lib/alpha-exchange-store";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";

export { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME };

const scrypt = promisify(scryptCallback);

// A locale layout and its page can both need the same principal. React's
// request-scoped cache coalesces those reads without retaining authentication
// data between requests or weakening server-side authorization checks.
const getSessionUserForRequest = cache(async (token: string, includeDisabled: boolean) => (
  getAuthenticatedUserBySessionToken(
    token,
    includeDisabled ? { includeDisabled: true } : undefined,
  )
));

type AuthCookieMutator = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: true;
      secure: boolean;
      sameSite: "lax";
      path: "/";
      expires: Date;
    },
  ) => unknown;
};

export function expireAuthCookies(cookieStore: AuthCookieMutator, secure: boolean) {
  const expires = new Date(0);
  for (const name of [AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME]) {
    cookieStore.set(name, "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires,
    });
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, keyBuffer);
}

export async function createUserSession(userId: string, durationDays = 14) {
  const token = `${randomUUID()}-${randomBytes(24).toString("hex")}`;
  const session = await createAuthSession(userId, token, durationDays);
  return {
    token,
    expiresAt: session.expiresAt,
  };
}

export async function authenticateLocalUser(
  email: string,
  password: string,
  options?: { includeDisabled?: boolean },
) {
  const user = await findUserByEmail(email);
  if (!user?.passwordHash) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  if (user.disabled === true && options?.includeDisabled !== true) {
    return null;
  }

  return user;
}

export async function getCurrentSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function clearUserSession(token: string | null | undefined) {
  if (token) {
    await deleteSessionByToken(token);
  }
}

export async function getCurrentSessionUser() {
  const token = await getCurrentSessionToken();
  if (!token) {
    return null;
  }
  const user = await getSessionUserForRequest(token, false);
  if (!user || user.disabled === true) return null;
  // Email verification is enforced at login and at every buyer-facing trading
  // route. Silently deleting sessions here causes a race: if a DB write is
  // stale, the user is kicked out mid-session with no feedback.
  return user;
}

/**
 * Resolve the session principal for an API authorization decision, including a
 * disabled account long enough to revoke its session and return the correct
 * ACCOUNT_DISABLED response. Page/layout consumers keep using
 * getCurrentSessionUser(), which never exposes a disabled principal.
 */
export async function getCurrentSessionUserForAuthorization() {
  const token = await getCurrentSessionToken();
  if (!token) return null;
  return getSessionUserForRequest(token, true);
}
