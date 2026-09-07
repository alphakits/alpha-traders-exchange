export const ALPHA_TRADERS_WEB_ORIGIN = "https://www.alphatraders.co.il";

const ALPHA_TRADERS_WEB_HOSTS = new Set([
  "alphatraders.co.il",
  "www.alphatraders.co.il",
]);

const EMBEDDED_AUTH_HOSTS = new Set([
  "discord.com",
  "www.discord.com",
]);

const EXTERNAL_SCHEMES = new Set([
  "mailto:",
  "sms:",
  "tel:",
  "whatsapp:",
]);

export type WebsiteNavigationDecision = "allow" | "external" | "block";

export function websiteNavigationDecision(rawUrl: string): WebsiteNavigationDecision {
  const value = rawUrl.trim();
  if (!value) return "block";
  if (value === "about:blank" || value.startsWith("blob:") || value.startsWith("data:")) {
    return "allow";
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "block";
  }

  if (EXTERNAL_SCHEMES.has(parsed.protocol)) return "external";
  if (parsed.protocol !== "https:") return "block";
  if (ALPHA_TRADERS_WEB_HOSTS.has(parsed.hostname)) return "allow";
  if (EMBEDDED_AUTH_HOSTS.has(parsed.hostname)) return "allow";
  return "external";
}

export function trustedWebsiteResumeUrl(rawUrl: string | null | undefined, locale: "ar" | "en") {
  const fallback = `${ALPHA_TRADERS_WEB_ORIGIN}/${locale}`;
  if (!rawUrl) return fallback;

  try {
    const parsed = new URL(rawUrl, ALPHA_TRADERS_WEB_ORIGIN);
    if (parsed.protocol !== "https:" || !ALPHA_TRADERS_WEB_HOSTS.has(parsed.hostname)) return fallback;
    if (!/^\/(?:ar|en)(?:\/|$)/.test(parsed.pathname)) return fallback;
    if (parsed.pathname.startsWith("/api/")) return fallback;
    return `${ALPHA_TRADERS_WEB_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function trustedWebsiteReturnPath(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || !ALPHA_TRADERS_WEB_HOSTS.has(parsed.hostname)) return null;
    if (!/^\/(?:ar|en)(?:\/|$)/.test(parsed.pathname) || parsed.pathname.startsWith("/api/")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
