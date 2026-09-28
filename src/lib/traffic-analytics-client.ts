export type TrafficPageView = {
  visitorId: string;
  sessionId: string;
  path: string;
  platform: "web" | "ios" | "android";
  deviceType: "mobile" | "desktop";
  referrerHost: string | null;
};

type TrafficBrowser = Pick<Window, "localStorage" | "sessionStorage" | "crypto" | "navigator" | "location"> & {
  ReactNativeWebView?: { postMessage: (message: string) => void };
  doNotTrack?: string;
};

const VISITOR_KEY = "alpha_analytics_visitor";
const SESSION_KEY = "alpha_analytics_session";
const VALID_ID = /^[A-Za-z0-9_-]{16,100}$/;

function randomId(crypto: Crypto): string | null {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : typeof crypto.getRandomValues === "function"
      ? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      : null;
}

function identity(storage: Storage, key: string, crypto: Crypto): string | null {
  const existing = storage.getItem(key);
  if (existing && VALID_ID.test(existing)) return existing;
  const next = randomId(crypto);
  if (!next || !VALID_ID.test(next)) return null;
  storage.setItem(key, next);
  return next;
}

function externalReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (normalize(url.hostname) === normalize(new URL(origin).hostname)) return null;
    return url.hostname.slice(0, 180);
  } catch {
    return null;
  }
}

/** Best-effort analytics only: never grants access or proves a device's identity. */
export function buildTrafficPageView(
  pathname: string,
  browser: TrafficBrowser,
  document: Pick<Document, "referrer">,
): TrafficPageView | null {
  try {
    const navigator = browser.navigator as Navigator & { globalPrivacyControl?: boolean };
    if (navigator.globalPrivacyControl === true
      || /^(1|yes)$/i.test(navigator.doNotTrack ?? "")
      || /^(1|yes)$/i.test(browser.doNotTrack ?? "")) {
      return null;
    }
    const path = pathname.split(/[?#]/, 1)[0];
    if (!path.startsWith("/") || path.startsWith("//") || path.length > 240 || /[\u0000-\u001f\u007f]/.test(path)) return null;

    const userAgent = navigator.userAgent ?? "";
    const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const nativeBridge = typeof browser.ReactNativeWebView?.postMessage === "function";
    let platform: TrafficPageView["platform"] = "web";
    if (nativeBridge) {
      if (/Android/i.test(userAgent)) platform = "android";
      else if (isAppleMobile) platform = "ios";
      else return null; // Do not guess an unsupported native platform.
    }

    const visitorId = identity(browser.localStorage, VISITOR_KEY, browser.crypto);
    const sessionId = identity(browser.sessionStorage, SESSION_KEY, browser.crypto);
    if (!visitorId || !sessionId) return null;
    return {
      visitorId,
      sessionId,
      path,
      platform,
      deviceType: platform !== "web" || isAppleMobile || /Android|Mobile|Tablet|Silk|Kindle/i.test(userAgent) ? "mobile" : "desktop",
      referrerHost: externalReferrer(document.referrer, browser.location.origin),
    };
  } catch {
    // Storage can be unavailable or explicitly blocked. Skip collection rather
    // than crash the page or manufacture a new visitor on every navigation.
    return null;
  }
}

/** Suppress repeated effects for one view, but count A -> B -> A navigation. */
export function createTrafficRecorder(send: (event: TrafficPageView) => Promise<unknown> | void) {
  let lastPath: string | null = null;
  return (event: TrafficPageView): boolean => {
    if (lastPath === event.path) return false;
    try {
      const result = send(event);
      lastPath = event.path;
      // A lost response might follow a successful insert. Do not blindly retry
      // and inflate totals; server-side idempotency is a separate requirement.
      void Promise.resolve(result).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  };
}
