import "server-only";

import {
  normalizeMarketSiteUrl,
} from "@/lib/discord/market-intelligence-publisher";
import type { EnvironmentValues } from "@/lib/env-validation";

const CONTACT_OWNER_URL_ENV = "DISCORD_CONTACT_OWNER_URL";

export function resolveDiscordContactOwnerUrl(
  siteUrl: string,
  env: EnvironmentValues = process.env,
): string {
  const fallback = `${normalizeMarketSiteUrl(siteUrl)}/en/contact`;
  const configured = env[CONTACT_OWNER_URL_ENV]?.trim();
  if (!configured) return fallback;

  try {
    const parsed = new URL(configured, fallback);
    if (parsed.protocol !== "https:") return fallback;
    if (parsed.username || parsed.password) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
