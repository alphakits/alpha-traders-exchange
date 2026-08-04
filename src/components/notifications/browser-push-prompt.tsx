"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "alpha.browser-push.dismissed";

export function BrowserPushPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // ignore storage failures
    }
    const timer = window.setTimeout(() => setVisible(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  async function enable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission === "default") return;
      if (permission === "denied") {
        setVisible(false);
        try {
          window.localStorage.setItem(DISMISS_KEY, "1");
        } catch {
          // ignore storage failures
        }
        return;
      }
      setVisible(false);
    } catch {
      setVisible(false);
    }
  }

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore storage failures
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-2xl border border-white/15 bg-[#0B0B0B]/95 p-4 text-sm text-[#E5E7EB] shadow-2xl">
      <p className="font-semibold text-white">Turn on browser notifications</p>
      <p className="mt-1 text-xs text-[#C9A227]">Get important trade, chat, and listing updates instantly.</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={() => void enable()}>Enable</Button>
        <Button type="button" size="sm" variant="secondary" onClick={dismiss}>Not now</Button>
      </div>
    </div>
  );
}
