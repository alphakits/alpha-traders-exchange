import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isPublicClientIp, resolveClientIp } from "@/lib/client-ip";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";
import { logEvent } from "@/lib/structured-logging";

type NetworkVerdict = "clear" | "restricted" | "unavailable";
type CachedVerdict = { verdict: NetworkVerdict; expiresAt: number };
const verdicts = new Map<string, CachedVerdict>();
const pending = new Map<string, Promise<NetworkVerdict>>();
const MAX_CACHE_ENTRIES = 2_048;
const MAX_PENDING_LOOKUPS = 128;
const LOOKUP_TIMEOUT_MS = 1_500;
let activeApiKey = "";

// These are machine endpoints, never interactive account/trade routes. Their
// own secret/signature checks remain authoritative; no header creates a bypass.
const MACHINE_METHODS: Record<string, readonly string[]> = {
  "/api/health": ["GET", "HEAD"],
  "/api/cron/economic-news": ["GET"],
  "/api/cron/trade-action-reminders": ["GET"],
  "/api/cron/commission-payment-verification": ["GET"],
  "/api/cron/whatsapp-delivery": ["GET"],
  "/api/cron/marketplace-email-delivery": ["GET"],
  "/api/discord/marketplace-events": ["POST"],
  "/api/twilio/status": ["POST"],
  "/api/meta/whatsapp/webhook": ["GET", "POST"],
};

export const networkAccessMessages = {
  NETWORK_RESTRICTED: {
    en: "Turn off your VPN, proxy, or IP-hiding service, then try again. Alpha Traders requires a direct internet connection.",
    ar: "أوقف الـVPN أو البروكسي أو خدمة إخفاء عنوان IP، ثم حاول مجددًا. تتطلب ألفا تريدرز اتصالًا مباشرًا بالإنترنت.",
  },
  NETWORK_CHECK_UNAVAILABLE: {
    en: "We could not verify your connection right now. Please try again shortly.",
    ar: "تعذّر التحقق من اتصالك حاليًا. يرجى المحاولة مجددًا بعد قليل.",
  },
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function parseNetworkVerdict(payload: unknown, ip: string): NetworkVerdict {
  const response = record(payload);
  if (!response || (response.status !== "ok" && response.status !== "warning")) return "unavailable";
  const detections = record(record(response[ip])?.detections);
  if (!detections) return "unavailable";
  // Inspect explicit classifications, not a risk score, ASN or hosting flag.
  // A missing/partial result is not evidence that an address is clear.
  const flags = ["vpn", "proxy", "tor"].map((key) => detections[key]);
  if (flags.some((flag) => flag === true)) return "restricted";
  return flags.every((flag) => flag === false) ? "clear" : "unavailable";
}

async function lookupNetwork(ip: string, apiKey: string): Promise<NetworkVerdict> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const url = new URL("https://proxycheck.io/v3/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("ver", "24-June-2026");
    url.searchParams.set("tag", "0");
    url.searchParams.set("p", "0");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ips: ip }),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return "unavailable";
    return parseNetworkVerdict(await response.json(), ip);
  } catch {
    // Never log provider URLs, keys, raw responses, or a visitor's IP address.
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedNetworkVerdict(ip: string, apiKey: string): Promise<NetworkVerdict> {
  if (activeApiKey !== apiKey) {
    verdicts.clear();
    pending.clear();
    activeApiKey = apiKey;
  }
  const cached = verdicts.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.verdict;
  const inFlight = pending.get(ip);
  if (inFlight) return inFlight;
  if (pending.size >= MAX_PENDING_LOOKUPS) return "unavailable";

  const lookup = lookupNetwork(ip, apiKey).then((verdict) => {
    // Ignore old requests after a configuration change.
    if (activeApiKey === apiKey) {
      if (verdicts.size >= MAX_CACHE_ENTRIES) verdicts.delete(verdicts.keys().next().value!);
      verdicts.set(ip, { verdict, expiresAt: Date.now() + (verdict === "unavailable" ? 5_000 : 60_000) });
      if (verdict !== "clear") {
        logEvent("warn", {
          event: "network_access_check",
          outcome: verdict === "restricted"
            ? (process.env.ALPHA_NETWORK_ACCESS_MODE === "enforce" ? "denied" : "success")
            : "failed",
          reason: verdict,
          metadata: { mode: process.env.ALPHA_NETWORK_ACCESS_MODE },
        });
      }
    }
    return verdict;
  }).finally(() => {
    if (pending.get(ip) === lookup) pending.delete(ip);
  });
  pending.set(ip, lookup);
  return lookup;
}

function networkRejection(request: NextRequest, verdict: Exclude<NetworkVerdict, "clear">) {
  const restricted = verdict === "restricted";
  const status = restricted ? 403 : 503;
  const code = restricted ? "NETWORK_RESTRICTED" : "NETWORK_CHECK_UNAVAILABLE";
  const pathLocale = /^\/(ar|en)(?:\/|$)/.exec(request.nextUrl.pathname)?.[1];
  const locale = pathLocale === "ar" || pathLocale === "en"
    ? pathLocale : resolveSupportedRequestLocale(request.headers);
  const message = networkAccessMessages[code][locale];
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    ...(restricted ? {} : { "Retry-After": "5" }),
  };
  if (request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      request.nextUrl.pathname.startsWith("/api/mobile/v1/")
        ? { error: { code, message }, requestId: crypto.randomUUID() }
        : { error: message, code },
      { status, headers },
    );
  }
  // Self-contained HTML works before sign-in, without JavaScript or redirects.
  // No request content, return URL, user identity or IP is rendered into it.
  const title = restricted
    ? (locale === "ar" ? "أوقف خدمة VPN للمتابعة" : "Turn off your VPN to continue")
    : (locale === "ar" ? "التحقق من الاتصال غير متاح مؤقتًا" : "Connection check temporarily unavailable");
  const retry = locale === "ar" ? "حاول مجددًا" : "Try again";
  const support = locale === "ar"
    ? "إذا كنت لا تستخدم VPN، جرّب الاتصال ببيانات الهاتف. قد تحتاج أيضًا إلى إيقاف iCloud Private Relay لهذا الموقع."
    : "If you are not using a VPN, try mobile data. You may also need to turn off iCloud Private Relay for this website.";
  return new NextResponse(`<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Alpha Traders</title><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#080d17;color:#f4f5f8;font:16px/1.65 system-ui,sans-serif}main{width:min(100%,480px);padding:32px;border:1px solid #344156;border-radius:24px;background:#111b2a}small{color:#ebc66a;font-weight:700;letter-spacing:.08em}h1{font-size:clamp(24px,5vw,32px);line-height:1.25}p{color:#c2ccda}a{display:inline-block;padding:12px 24px;border-radius:12px;background:#ebc66a;color:#080d17;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid white;outline-offset:4px}.help{font-size:14px}</style></head><body><main><small>ALPHA TRADERS</small><h1>${title}</h1><p>${message}</p><a href="/${locale}">${retry}</a>${restricted ? `<p class="help">${support}</p>` : ""}</main></body></html>`, {
    status,
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

export async function enforceNetworkAccess(request: NextRequest): Promise<NextResponse | null> {
  const mode = process.env.ALPHA_NETWORK_ACCESS_MODE?.trim() || "off";
  if (mode === "off") return null;
  const pathname = request.nextUrl.pathname.replace(/\/$/, "");
  if (Object.hasOwn(MACHINE_METHODS, pathname)
      && MACHINE_METHODS[pathname].includes(request.method.toUpperCase())) return null;
  if (mode !== "monitor" && mode !== "enforce") return networkRejection(request, "unavailable");
  const apiKey = process.env.PROXYCHECK_API_KEY?.trim();
  const ip = resolveClientIp(request.headers);
  const verdict = apiKey && isPublicClientIp(ip)
    ? await cachedNetworkVerdict(ip, apiKey) : "unavailable";
  if (mode === "monitor" || verdict === "clear") return null;
  // Enforced mode never silently admits an unchecked connection, including
  // provider outage, quota exhaustion, missing configuration, or invalid IP.
  return networkRejection(request, verdict);
}
