"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh server-computed trades, ratings and ranks while the profile stays open. */
export function ProfileLiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (pending) return;
    let lastRefresh = Date.now();
    const refresh = () => {
      if (document.visibilityState === "hidden" || navigator.onLine === false || Date.now() - lastRefresh < 15_000) return;
      lastRefresh = Date.now();
      startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pending, router]);
  return null;
}
