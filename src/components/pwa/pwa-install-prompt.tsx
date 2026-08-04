"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "alpha.pwa.install.dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => ({ outcome: "dismissed", platform: "" }));
    setVisible(false);
    setPromptEvent(null);
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
    <div className="fixed bottom-4 left-4 z-[60] max-w-sm rounded-2xl border border-white/15 bg-[#0B0B0B]/95 p-4 text-sm text-[#E5E7EB] shadow-2xl">
      <p className="font-semibold text-white">Install Alpha Traders</p>
      <p className="mt-1 text-xs text-[#C9A227]">Open it like a native app from your home screen.</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={() => void install()}>Install</Button>
        <Button type="button" size="sm" variant="secondary" onClick={dismiss}>Later</Button>
      </div>
    </div>
  );
}
