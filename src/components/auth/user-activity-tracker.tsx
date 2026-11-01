"use client";
import { useEffect } from "react";
import { PRESENCE_HEARTBEAT_MS, PRESENCE_IDLE_MS, type PresenceUpdate } from "@alpha-traders/contracts";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";

export function startUserActivityTracking() {
  const clientId = crypto.randomUUID();
  let sequence = 0;
  let lastInput = Date.now();
  let lastSentInput = 0;
  let lastSent = 0;
  let lastActive = false;
  let nativeActive = true;
  let signedOut = false;
  const send = (force = false, leaving = false) => {
    const active = !leaving && !signedOut && nativeActive && document.visibilityState !== "hidden"
      && navigator.onLine !== false && Date.now() - lastInput < PRESENCE_IDLE_MS;
    if (!force && active === lastActive && (!active || Date.now() - lastSent < PRESENCE_HEARTBEAT_MS)) return;
    const inputAtSend = lastInput;
    const update: PresenceUpdate = { clientId, sequence: ++sequence, active, activity: active && lastInput > lastSentInput };
    lastSent = Date.now(); lastActive = active;
    const body = JSON.stringify(update);
    if (leaving && navigator.sendBeacon?.("/api/alpha-exchange/presence", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/alpha-exchange/presence", { method: "POST", credentials: "include", cache: "no-store", keepalive: true, headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10_000) })
      .then(response => {
        if (!response.ok) return;
        if (update.activity) lastSentInput = Math.max(lastSentInput, inputAtSend);
        window.dispatchEvent(new Event("alpha-presence-updated"));
      })
      .catch(() => undefined);
  };
  const activity = () => { lastInput = Date.now(); send(); };
  const visibility = () => { if (document.visibilityState !== "hidden") lastInput = Date.now(); send(true, document.visibilityState === "hidden"); };
  const nativeState = (event: Event) => {
    nativeActive = (event as CustomEvent<{ active: boolean }>).detail?.active === true;
    if (nativeActive) lastInput = Date.now();
    send(true, !nativeActive);
  };
  const leave = () => send(true, true);
  const signOut = () => { signedOut = true; leave(); };
  const resume = () => { lastInput = Date.now(); send(true); };
  const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
  events.forEach(name => window.addEventListener(name, activity, { passive: true }));
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("alpha-native-app-state", nativeState);
  window.addEventListener("alpha-auth-signed-out", signOut);
  window.addEventListener("pagehide", leave);
  window.addEventListener("offline", leave);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", resume);
  window.addEventListener("focus", resume);
  send(true);
  const timer = setInterval(() => send(), PRESENCE_HEARTBEAT_MS);
  return () => {
    leave(); clearInterval(timer);
    events.forEach(name => window.removeEventListener(name, activity));
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("alpha-native-app-state", nativeState);
    window.removeEventListener("alpha-auth-signed-out", signOut);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("offline", leave);
    window.removeEventListener("online", resume);
    window.removeEventListener("pageshow", resume);
    window.removeEventListener("focus", resume);
  };
}

export function UserActivityTracker() {
  const { user } = useCanonicalSession();
  useEffect(() => user?.id ? startUserActivityTracking() : undefined, [user?.id]);
  return null;
}
