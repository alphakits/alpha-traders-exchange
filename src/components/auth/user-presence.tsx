"use client";

import { useEffect } from "react";
import { useCanonicalSession } from "./canonical-session-provider";

export function UserPresence() {
  const { user } = useCanonicalSession();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let busy = false;
    let lastSent = 0;
    const heartbeat = async () => {
      if (busy || document.hidden || !navigator.onLine || Date.now() - lastSent < 55_000) return;
      busy = true;
      try {
        const response = await fetch("/api/auth/presence", { method: "POST", signal: controller.signal });
        if (response.ok) lastSent = Date.now();
      } catch { /* Presence never interrupts navigation or trading. */ }
      finally { busy = false; }
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 60_000);
    window.addEventListener("focus", heartbeat);
    window.addEventListener("online", heartbeat);
    document.addEventListener("visibilitychange", heartbeat);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", heartbeat); window.removeEventListener("online", heartbeat); document.removeEventListener("visibilitychange", heartbeat); };
  }, [userId]);
  return null;
}
