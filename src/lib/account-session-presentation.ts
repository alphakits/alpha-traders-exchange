import { createHash } from "crypto";
import type { AuthSession } from "@/types/alpha-exchange";

/** Stores a coarse device label, never the raw user-agent or IP address. */
export function sessionDeviceLabel(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";
  const ua = userAgent.slice(0, 1024);
  const device = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//i.test(ua) ? "Edge" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "App or browser";
  return `${device} · ${browser}`;
}

export function accountSessionId(session: AuthSession) {
  return createHash("sha256").update(JSON.stringify(["account-session", session.userId, session.token])).digest("hex").slice(0, 32);
}

export function presentAccountSession(session: AuthSession, currentTokenHash: string) {
  return { id: accountSessionId(session), deviceLabel: session.deviceLabel || "Unknown device", createdAt: session.createdAt, expiresAt: session.expiresAt, isCurrent: session.token === currentTokenHash };
}
