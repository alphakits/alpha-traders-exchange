import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { promisify } from "util";
import { cookies } from "next/headers";
import { createAuthSession, deleteSessionByToken, findUserByEmail, findUserById, getSessionByToken } from "@/lib/alpha-exchange-store";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";

export { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME };

const scrypt = promisify(scryptCallback);

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

export async function authenticateLocalUser(email: string, password: string) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_LOCAL_AUTH_FALLBACK !== "1") {
    return null;
  }
  const cwd = process.cwd();
  const dbPath = path.join(cwd, "data", "alpha-exchange-db.json");
  try {
    const raw = readFileSync(dbPath, "utf8");
    const db = JSON.parse(raw) as { users?: Array<{ email?: string; passwordHash?: string; fullName?: string; whatsappNumber?: string }> };
    const user = db.users?.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (!user?.passwordHash) {
      return null;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    return {
      id: "",
      fullName: user.fullName ?? "",
      email,
      passwordHash: user.passwordHash,
      whatsappNumber: user.whatsappNumber ?? "",
      role: "buyer",
      roles: ["buyer"],
      sellerStatus: "buyer",
      emailVerified: true,
    };
  } catch {
    const user = await findUserByEmail(email);
    if (!user?.passwordHash) {
      return null;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    return user;
  }
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
