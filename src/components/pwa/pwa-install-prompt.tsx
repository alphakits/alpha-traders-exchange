"use client";

import { brandText } from "@/components/ui/currency-text";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppLocale } from "@/i18n/routing";

const DISMISS_KEY = "alpha.pwa.install.dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallPrompt({ locale }: { locale: AppLocale }) {
  const isAr = locale === "ar";
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const dismissedRef = useRef(false);
  const activeInstallRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (dismissedRef.current || activeInstallRef.current) return;
      try {
        if (window.localStorage.getItem(DISMISS_KEY) === "1") {
          dismissedRef.current = true;
          return;
        }
      } catch {
        return;
      }
      setPromptEvent(event as BeforeInstallPromptEvent);
      setInstallFailed(false);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      activeInstallRef.current = null;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  async function install() {
    if (!promptEvent || activeInstallRef.current) return;
    const attempt = promptEvent;
    activeInstallRef.current = attempt;
    setInstalling(true);
    setInstallFailed(false);
    // A browser installation event can only be used once.
    setPromptEvent(null);
    const failed = () => {
      if (activeInstallRef.current === attempt && !dismissedRef.current) setInstallFailed(true);
    };
    // Observe the browser decision immediately, including when prompt()
    // fails before that promise settles.
    const choice = attempt.userChoice.then(() => true, () => false);
    try {
      await attempt.prompt();
      if (await choice) {
        if (activeInstallRef.current === attempt) setVisible(false);
      } else failed();
    } catch {
      failed();
    } finally {
      if (activeInstallRef.current === attempt) {
        activeInstallRef.current = null;
        setInstalling(false);
      }
    }
  }

  function dismiss() {
    dismissedRef.current = true;
    setVisible(false);
    setPromptEvent(null);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore storage failures
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] max-w-sm rounded-2xl border border-white/15 bg-[#0B0B0B]/95 p-4 text-sm text-[#E5E7EB] shadow-2xl sm:end-auto lg:bottom-4" dir={isAr ? "rtl" : "ltr"}>
      <p className="font-semibold text-white">{brandText(isAr ? "ثبّت Alpha Traders" : "Install Alpha Traders")}</p>
      <p className="mt-1 text-xs text-[#C9A227]">{isAr ? "افتح المنصة كتطبيق مباشرة من شاشتك الرئيسية." : "Open it like a native app from your home screen."}</p>
      {installFailed && <p role="alert" className="mt-2 text-sm text-rose-200">{isAr ? "تعذر بدء التثبيت. افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية." : "Installation could not start. Open your browser menu and choose Add to Home Screen."}</p>}
      <div className="mt-3 flex gap-2">
        {(promptEvent || installing) && <Button type="button" size="sm" disabled={installing} onClick={() => void install()}>{installing ? (isAr ? "جارٍ التثبيت…" : "Installing…") : (isAr ? "تثبيت" : "Install")}</Button>}
        <Button type="button" size="sm" variant="secondary" onClick={dismiss}>{isAr ? "لاحقاً" : "Later"}</Button>
      </div>
    </div>
  );
}
