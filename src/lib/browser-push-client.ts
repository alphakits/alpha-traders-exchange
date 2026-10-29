"use client";

export type DevicePushState = "on" | "off" | "blocked" | "install" | "unsupported" | "unavailable";
type PushScope = { signal?: AbortSignal; userId?: string; publicKey?: string };
export function canUseBrowserPush() {
  return typeof window !== "undefined" && window.isSecureContext
    && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
}

export function needsHomeScreenInstall() {
  if (typeof navigator === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !(navigator as Navigator & { standalone?: boolean }).standalone
    && !window.matchMedia?.("(display-mode: standalone)").matches;
}

function applicationKey(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}

function matchesApplicationKey(subscription: PushSubscription, key: Uint8Array) {
  const previous = subscription.options.applicationServerKey;
  if (!previous) return false;
  const bytes = new Uint8Array(previous);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

async function persist(subscription: PushSubscription, locale: "ar" | "en", action: "subscribe" | "refresh" | "unsubscribe", scope: PushScope) {
  scope.signal?.throwIfAborted();
  const response = await fetch("/api/alpha-exchange/browser-push", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: scope.signal,
    body: JSON.stringify({ action, subscription: subscription.toJSON(), locale, expectedUserId: scope.userId }),
  });
  scope.signal?.throwIfAborted();
  if (response.status === 409) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    scope.signal?.throwIfAborted();
    if (body?.code === "subscription_inactive") return false;
  }
  if (!response.ok) throw new Error("Push registration failed");
  return true;
}

export async function checkBrowserPush(locale: "ar" | "en", enabled: boolean, scope: PushScope = {}): Promise<DevicePushState> {
  scope.signal?.throwIfAborted();
  if (needsHomeScreenInstall()) return "install";
  if (!canUseBrowserPush()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription || !enabled) return "off";
  if (scope.publicKey && !matchesApplicationKey(subscription, applicationKey(scope.publicKey))) return "off";
  return await persist(subscription, locale, "refresh", scope) ? "on" : "off";
}

/** Called directly by a click handler; no await before the permission request. */
export async function enableBrowserPush(locale: "ar" | "en", publicKey: string, scope: PushScope = {}): Promise<DevicePushState> {
  scope.signal?.throwIfAborted();
  if (needsHomeScreenInstall()) return "install";
  if (!canUseBrowserPush()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  scope.signal?.throwIfAborted();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  await navigator.serviceWorker.register("/alpha-push-sw.js", { scope: "/", updateViaCache: "none" });
  scope.signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Service worker not ready")), 10_000); }),
  ]).finally(() => clearTimeout(timer));
  scope.signal?.throwIfAborted();
  const key = applicationKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  scope.signal?.throwIfAborted();
  if (subscription && !matchesApplicationKey(subscription, key)) {
    await persist(subscription, locale, "unsubscribe", scope);
    scope.signal?.throwIfAborted();
    await subscription.unsubscribe();
    scope.signal?.throwIfAborted();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  if (!await persist(subscription, locale, "subscribe", scope)) {
    // Only an explicit Enable action replaces a provider-retired subscription.
    // Permission may still be granted while getSubscription() returns it.
    scope.signal?.throwIfAborted();
    await subscription.unsubscribe();
    scope.signal?.throwIfAborted();
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (!await persist(subscription, locale, "subscribe", scope)) throw new Error("Push subscription is still inactive");
  }
  return "on";
}
