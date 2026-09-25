"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { buildTrafficPageView, createTrafficRecorder } from "@/lib/traffic-analytics-client";

export function TrafficAnalyticsTracker() {
  const pathname = usePathname();
  const recorder = useRef<ReturnType<typeof createTrafficRecorder> | null>(null);

  useEffect(() => {
    if (!pathname) return;
    recorder.current ??= createTrafficRecorder((event) => fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify(event),
    }));
    const event = buildTrafficPageView(pathname, window, document);
    if (event) recorder.current(event);
  }, [pathname]);

  return null;
}
