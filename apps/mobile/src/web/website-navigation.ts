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

export function isTrustedWebsiteDocumentUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:"
      && parsed.port === ""
      && parsed.username === ""
      && parsed.password === ""
      && ALPHA_TRADERS_WEB_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isTrustedWebsiteBlobUrl(rawUrl: string) {
  if (!rawUrl.startsWith("blob:")) return false;
  return isTrustedWebsiteDocumentUrl(rawUrl.slice("blob:".length));
}

export function websiteNavigationDecision(rawUrl: string): WebsiteNavigationDecision {
  const value = rawUrl.trim();
  if (!value) return "block";
  if (value === "about:blank") return "allow";
  if (value.startsWith("blob:")) return isTrustedWebsiteBlobUrl(value) ? "allow" : "block";
  // A data document has no trustworthy origin and could impersonate the
  // first-party native bridge. Inline images are not navigation requests.
  if (value.startsWith("data:")) return "block";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "block";
  }

  if (EXTERNAL_SCHEMES.has(parsed.protocol)) return "external";
  if (parsed.protocol !== "https:") return "block";
  if (parsed.username || parsed.password || parsed.port) return "block";
  if (isTrustedWebsiteDocumentUrl(value)) return "allow";
  if (EMBEDDED_AUTH_HOSTS.has(parsed.hostname)) return "allow";
  return "external";
}

export function trustedWebsiteResumeUrl(rawUrl: string | null | undefined, locale: "ar" | "en") {
  const fallback = `${ALPHA_TRADERS_WEB_ORIGIN}/${locale}`;
  if (!rawUrl) return fallback;

  try {
    const parsed = new URL(rawUrl, ALPHA_TRADERS_WEB_ORIGIN);
    if (!isTrustedWebsiteDocumentUrl(parsed.toString())) return fallback;
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
    if (!isTrustedWebsiteDocumentUrl(parsed.toString())) return null;
    if (!/^\/(?:ar|en)(?:\/|$)/.test(parsed.pathname) || parsed.pathname.startsWith("/api/")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
