import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { createAuthSession, deleteSessionByToken, findUserById, getSessionByToken } from "@/lib/alpha-exchange-store";

const scrypt = promisify(scryptCallback);
export const AUTH_COOKIE_NAME = "alpha_exchange_session";
export const AUTH_VERIFIED_COOKIE_NAME = "alpha_exchange_verified";

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
  if (!token) return null;
  const session = await getSessionByToken(token);
  if (!session) {
    return null;
  }
  const user = await findUserById(session.userId);
  if (!user) {
    return null;
  }
  if (user.emailVerified !== true) {
    await deleteSessionByToken(token);
    return null;
  }
  return user;
}
