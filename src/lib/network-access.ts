import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isPublicClientIp, normalizeClientIp, resolveClientIp } from "@/lib/client-ip";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";
import { logEvent } from "@/lib/structured-logging";

type NetworkVerdict = "clear" | "restricted" | "unavailable";
type NetworkProvider = "proxycheck" | "ipregistry";
type NetworkRestriction = "vpn" | "proxy" | "tor" | "private_relay";
type NetworkAssessment = {
  verdict: NetworkVerdict;
  tor: boolean | null;
  vpn: boolean | null;
  proxy: boolean | null;
  detectedTypes: NetworkRestriction[];
  reference?: string;
};
type CachedVerdict = { assessment: NetworkAssessment; expiresAt: number };
const unavailableAssessment: NetworkAssessment = { verdict: "unavailable", tor: null, vpn: null, proxy: null, detectedTypes: [] };
const verdicts = new Map<string, CachedVerdict>();
const pending = new Map<string, Promise<NetworkAssessment>>();
const MAX_CACHE_ENTRIES = 2_048;
const MAX_PENDING_LOOKUPS = 128;
const LOOKUP_TIMEOUT_MS = 1_500;
const CAPACITY_LOG_INTERVAL_MS = 5 * 60_000;
let activeConfiguration = "";
let capacityLog: { level: "available" | "low" | "critical" | "empty"; at: number } | null = null;

function observeIpregistryCapacity(response: Response, configuration: string) {
  // Capacity is operational metadata. Never include the lookup URL, IP, key,
  // response body, or request headers in this event.
  if (activeConfiguration !== configuration) return;
  const raw = response.headers.get("Ipregistry-Credits-Remaining");
  const remaining = response.status === 402 ? 0
    : raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  if (remaining === null || !Number.isSafeInteger(remaining) || remaining < 0) return;
  const level = remaining === 0 ? "empty"
    : remaining <= 500 ? "critical" : remaining <= 2_000 ? "low" : "available";
  const now = Date.now();
  if (capacityLog?.level === level && now - capacityLog.at < CAPACITY_LOG_INTERVAL_MS) return;
  capacityLog = { level, at: now };
  logEvent(level === "empty" || level === "critical" ? "error" : level === "low" ? "warn" : "info", {
    event: "network_provider_capacity",
    outcome: level === "empty" ? "failed" : "success",
    reason: level,
    metadata: { provider: "ipregistry", creditsRemaining: remaining, mode: process.env.ALPHA_NETWORK_ACCESS_MODE },
  });
}

// These are machine endpoints, never interactive account/trade routes. Their
// own secret/signature checks remain authoritative; no header creates a bypass.
const MACHINE_METHODS: Record<string, readonly string[]> = {
  "/api/health": ["GET", "HEAD"],
  "/api/cron/economic-news": ["GET"],
  "/api/cron/trade-action-reminders": ["GET"],
  "/api/cron/commission-payment-verification": ["GET"],
  "/api/cron/commission-checkout": ["GET"],
  "/api/cron/whatsapp-delivery": ["GET"],
  "/api/cron/marketplace-email-delivery": ["GET"],
  "/api/discord/marketplace-events": ["POST"],
  "/api/twilio/status": ["POST"],
  "/api/twilio/whatsapp/webhook": ["POST"],
  "/api/meta/whatsapp/webhook": ["GET", "POST"],
  // Revocation never grants workspace access. Preserve it during a network
  // block or provider outage so users can still invalidate their sessions.
  "/api/auth/logout": ["POST"],
  "/api/mobile/v1/auth/session": ["DELETE"],
};

export const networkAccessMessages = {
  NETWORK_RESTRICTED: {
    en: "Your connection was flagged as a VPN, proxy, or Tor. This detection can be incorrect. If you use a normal connection, contact support with the reference below.",
    ar: "تم تصنيف اتصالك على أنه VPN أو بروكسي أو Tor. قد يكون هذا التصنيف غير صحيح. إذا كنت تستخدم اتصالًا عاديًا، تواصل مع الدعم وأرسل الرقم المرجعي أدناه.",
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

export function parseIpregistryVerdict(payload: unknown, ip: string): NetworkVerdict {
  const response = record(payload);
  if (!response || response.error || typeof response.ip !== "string"
      || normalizeClientIp(response.ip) !== ip) return "unavailable";
  const security = record(response.security);
  if (!security) return "unavailable";
  const flags = ["is_vpn", "is_proxy", "is_tor", "is_relay"].map((key) => security[key]);
  if (flags.some((flag) => flag === true)) return "restricted";
  return flags.every((flag) => flag === false) ? "clear" : "unavailable";
}

function appliedNetworkVerdict(mode: string, assessment: NetworkAssessment): NetworkVerdict {
  if (mode === "monitor") return "clear";
  if (mode === "tor-only") return assessment.tor === true ? "restricted"
    : assessment.tor === false ? "clear" : "unavailable";
  if (mode === "vpn-tor") return assessment.tor === true || assessment.vpn === true ? "restricted"
    : assessment.tor === false && assessment.vpn === false ? "clear" : "unavailable";
  if (mode === "enforce" && assessment.detectedTypes.includes("private_relay")) {
    // Ipregistry documents is_relay as Apple Private Relay, which normal
    // Safari can use. Admit it only after an IP-matched provider response
    // explicitly clears every blocked category. Browser/device claims never
    // create this exception; missing flags and overlapping threats still fail.
    // https://ipregistry.co/docs/proxy-tor-threat-detection
    const blockedFlags = [assessment.vpn, assessment.proxy, assessment.tor];
    if (blockedFlags.some((flag) => flag === true)) return "restricted";
    return blockedFlags.every((flag) => flag === false) ? "clear" : "unavailable";
  }
  return assessment.verdict;
}

function observeNetworkClassification(payload: unknown, ip: string, provider: NetworkProvider): NetworkAssessment {
  const verdict = provider === "ipregistry"
    ? parseIpregistryVerdict(payload, ip) : parseNetworkVerdict(payload, ip);
  if (verdict === "unavailable") return unavailableAssessment;
  const response = record(payload);
  const flags = provider === "ipregistry"
    ? record(response?.security) : record(record(response?.[ip])?.detections);
  const torFlag = flags?.[provider === "ipregistry" ? "is_tor" : "tor"];
  const vpnFlag = flags?.[provider === "ipregistry" ? "is_vpn" : "vpn"];
  const proxyFlag = flags?.[provider === "ipregistry" ? "is_proxy" : "proxy"];
  const fields: Partial<Record<NetworkRestriction, string>> = provider === "ipregistry"
    ? { vpn: "is_vpn", proxy: "is_proxy", tor: "is_tor", private_relay: "is_relay" }
    : { vpn: "vpn", proxy: "proxy", tor: "tor" };
  // Keep only fixed classification labels after validating the provider's IP.
  // Never log its body, visitor IP, account details, credentials or headers.
  const detectedTypes = Object.entries(fields)
    .filter(([, field]) => flags?.[field] === true)
    .map(([label]) => label as NetworkRestriction);
  return { verdict, tor: typeof torFlag === "boolean" ? torFlag : null,
    vpn: typeof vpnFlag === "boolean" ? vpnFlag : null,
    proxy: typeof proxyFlag === "boolean" ? proxyFlag : null, detectedTypes };
}

async function lookupNetwork(ip: string, apiKey: string, provider: NetworkProvider): Promise<NetworkAssessment> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    if (provider === "ipregistry") {
      const url = new URL(`https://api.ipregistry.co/${encodeURIComponent(ip)}`);
      url.searchParams.set("fields", "ip,security.is_vpn,security.is_proxy,security.is_tor,security.is_relay");
      const response = await fetch(url, {
        headers: { Authorization: `ApiKey ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      observeIpregistryCapacity(response, `${provider}\0${apiKey}`);
      if (!response.ok) return unavailableAssessment;
      return observeNetworkClassification(await response.json(), ip, provider);
    }
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
    if (!response.ok) return unavailableAssessment;
    return observeNetworkClassification(await response.json(), ip, provider);
  } catch {
    // Never log provider URLs, keys, raw responses, or a visitor's IP address.
    return unavailableAssessment;
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedNetworkVerdict(ip: string, apiKey: string, provider: NetworkProvider): Promise<NetworkAssessment> {
  const configuration = `${provider}\0${apiKey}`;
  if (activeConfiguration !== configuration) {
    verdicts.clear();
    pending.clear();
    capacityLog = null;
    activeConfiguration = configuration;
  }
  const cached = verdicts.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.assessment;
  const inFlight = pending.get(ip);
  if (inFlight) return inFlight;
  if (pending.size >= MAX_PENDING_LOOKUPS) return unavailableAssessment;

  const lookup = lookupNetwork(ip, apiKey, provider).then((providerAssessment) => {
    // One random reference per lookup, retained with its cached assessment.
    // It reveals no visitor identity and never authorizes a request.
    const assessment = { ...providerAssessment, reference: crypto.randomUUID() };
    const { verdict } = assessment;
    // Ignore old requests after a configuration change.
    if (activeConfiguration === configuration) {
      if (verdicts.size >= MAX_CACHE_ENTRIES) verdicts.delete(verdicts.keys().next().value!);
      verdicts.set(ip, { assessment, expiresAt: Date.now() + (verdict === "unavailable" ? 5_000 : 60_000) });
      if (verdict !== "clear") {
        const appliedVerdict = appliedNetworkVerdict(process.env.ALPHA_NETWORK_ACCESS_MODE?.trim() || "off", assessment);
        if (verdict === "restricted") {
          logEvent("warn", {
            event: "network_provider_classification",
            resourceId: assessment.reference,
            outcome: appliedVerdict === "restricted" ? "denied" : appliedVerdict === "unavailable" ? "failed" : "success",
            reason: "restricted",
            metadata: { provider, mode: process.env.ALPHA_NETWORK_ACCESS_MODE, detectedTypes: assessment.detectedTypes },
          });
        }
        logEvent("warn", {
          event: "network_access_check",
          resourceId: assessment.reference,
          outcome: appliedVerdict === "restricted" ? "denied" : appliedVerdict === "unavailable" ? "failed" : "success",
          reason: verdict,
          metadata: { mode: process.env.ALPHA_NETWORK_ACCESS_MODE },
        });
      }
    }
    return assessment;
  }).finally(() => {
    if (pending.get(ip) === lookup) pending.delete(ip);
  });
  pending.set(ip, lookup);
  return lookup;
}

function networkRejection(request: NextRequest, verdict: Exclude<NetworkVerdict, "clear">, assessment = unavailableAssessment) {
  const restricted = verdict === "restricted";
  const status = restricted ? 403 : 503;
  const code = restricted ? "NETWORK_RESTRICTED" : "NETWORK_CHECK_UNAVAILABLE";
  const pathLocale = /^\/(ar|en)(?:\/|$)/.exec(request.nextUrl.pathname)?.[1];
  const locale = pathLocale === "ar" || pathLocale === "en"
    ? pathLocale : resolveSupportedRequestLocale(request.headers);
  const reference = assessment.reference ?? crypto.randomUUID();
  if (!assessment.reference) {
    logEvent("warn", { event: "network_access_check", resourceId: reference,
      outcome: "failed", reason: "unavailable", metadata: { mode: process.env.ALPHA_NETWORK_ACCESS_MODE } });
  }
  const restriction = !restricted ? null : assessment.tor === true ? "tor"
    : assessment.vpn === true ? "vpn" : assessment.detectedTypes[0] ?? null;
  const torOnly = restriction === "tor";
  const message = torOnly
    ? (locale === "ar" ? "تم التعرف على اتصالك على أنه تابع لشبكة Tor. استخدم اتصالًا خارج شبكة Tor ثم حاول مجددًا."
      : "Your connection was identified as part of the Tor network. Use a connection outside Tor and try again.")
    : restriction === "vpn"
    ? (locale === "ar" ? "تم تصنيف اتصالك على أنه VPN. قد يكون هذا التصنيف غير صحيح. أوقف VPN إذا كنت تستخدمه، أو تواصل مع الدعم وأرسل الرقم المرجعي أدناه."
      : "Your connection was flagged as a VPN. This detection can be incorrect. Turn it off if you use one, or contact support with the reference below.")
    : restriction === "proxy"
    ? (locale === "ar" ? "تم تصنيف اتصالك على أنه بروكسي. قد يكون هذا التصنيف غير صحيح، ولا يعني أنك تستخدم تطبيق VPN. تواصل مع الدعم وأرسل الرقم المرجعي أدناه إذا كنت تستخدم اتصالًا عاديًا."
      : "Your connection was flagged as a proxy. This detection can be incorrect and does not mean you installed a VPN. If you use a normal connection, contact support with the reference below.")
    : networkAccessMessages[code][locale];
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Alpha-Connection-Reference": reference,
    ...(restricted ? {} : { "Retry-After": "5" }),
  };
  if (request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      request.nextUrl.pathname.startsWith("/api/mobile/v1/")
        ? { error: { code, message }, requestId: reference }
        : { error: message, code, requestId: reference },
      { status, headers },
    );
  }
  // Self-contained HTML works before sign-in, without JavaScript or redirects.
  // No request content, return URL, user identity or IP is rendered into it.
  const title = torOnly ? (locale === "ar" ? "اتصال Tor غير مسموح" : "Tor connections are not allowed") : restricted
    ? (locale === "ar" ? "تم تقييد الوصول من هذا الاتصال" : "Connection access restricted")
    : (locale === "ar" ? "التحقق من الاتصال غير متاح مؤقتًا" : "Connection check temporarily unavailable");
  const retry = locale === "ar" ? "حاول مجددًا" : "Try again";
  const support = torOnly
    ? (locale === "ar" ? "إذا كنت لا تستخدم Tor، تواصل مع الدعم للتحقق من التصنيف." : "If you are not using Tor, contact support to review the detection.")
    : locale === "ar"
    ? "إذا كنت لا تستخدم الخدمة المذكورة أعلاه، تواصل مع الدعم وأرسل الرقم المرجعي للتحقق من التصنيف."
    : "If you are not using the service described above, contact support with the reference to review the detection.";
  const referenceLabel = locale === "ar" ? "الرقم المرجعي للدعم" : "Support reference";
  return new NextResponse(`<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Alpha Traders</title><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#080d17;color:#f4f5f8;font:16px/1.65 system-ui,sans-serif}main{width:min(100%,480px);padding:32px;border:1px solid #344156;border-radius:24px;background:#111b2a}small{color:#ebc66a;font-weight:700;letter-spacing:.08em}h1{font-size:clamp(24px,5vw,32px);line-height:1.25}p{color:#c2ccda}a{display:inline-block;padding:12px 24px;border-radius:12px;background:#ebc66a;color:#080d17;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid white;outline-offset:4px}.help{font-size:14px}.reference{overflow-wrap:anywhere}</style></head><body><main><small>ALPHA TRADERS</small><h1>${title}</h1><p>${message}</p><a href="/${locale}">${retry}</a>${restricted ? `<p class="help">${support}</p>` : ""}<p class="help reference">${referenceLabel}: <bdi>${reference}</bdi></p></main></body></html>`, {
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
  if (mode !== "monitor" && mode !== "enforce" && mode !== "tor-only" && mode !== "vpn-tor") return networkRejection(request, "unavailable");
  const provider = process.env.ALPHA_NETWORK_ACCESS_PROVIDER?.trim() || "proxycheck";
  if (provider !== "proxycheck" && provider !== "ipregistry") return networkRejection(request, "unavailable");
  const apiKey = (provider === "ipregistry" ? process.env.IPREGISTRY_API_KEY : process.env.PROXYCHECK_API_KEY)?.trim();
  const ip = resolveClientIp(request.headers);
  const assessment = apiKey && isPublicClientIp(ip)
    ? await cachedNetworkVerdict(ip, apiKey, provider) : unavailableAssessment;
  const verdict = appliedNetworkVerdict(mode, assessment);
  if (verdict === "clear") return null;
  // Enforced mode never silently admits an unchecked connection, including
  // provider outage, quota exhaustion, missing configuration, or invalid IP.
  return networkRejection(request, verdict, assessment);
}
