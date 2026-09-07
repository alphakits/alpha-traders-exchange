"use client";

import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@/i18n/routing";
import { Button, type ButtonProps } from "@/components/ui/button";

type LogoutButtonProps = Omit<ButtonProps, "onClick"> & {
  locale: AppLocale;
  idleLabel?: string;
  pendingLabel?: string;
  onSignedOut?: () => void;
};

export function LogoutButton({
  locale,
  idleLabel,
  pendingLabel,
  onSignedOut,
  children,
  ...buttonProps
}: LogoutButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function handleLogout() {
    if (isPending) return;
    setIsPending(true);
    setErrorMessage(null);
    // Bound a stalled request, but never show a successful logout until the
    // server has revoked the session and returned the expired cookies.
    const controller = new AbortController();
    const safetyTimeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      window.clearTimeout(safetyTimeout);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || (locale === "ar" ? "تعذر تسجيل الخروج. حاول مرة أخرى." : "Failed to sign out. Please try again."));
      }
      onSignedOut?.();
      window.dispatchEvent(new Event("alpha-auth-signed-out"));
      window.dispatchEvent(new Event("alpha-auth-changed"));
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      window.location.replace(`/${locale}/login`);
    } catch (error) {
      window.clearTimeout(safetyTimeout);
      if (error instanceof Error && error.name === "AbortError") {
        setIsPending(false);
        setErrorMessage(locale === "ar"
          ? "استغرق تسجيل الخروج وقتًا أطول من المتوقع. حاول مرة أخرى."
          : "Signing out took longer than expected. Please try again.");
        return;
      }
      // Genuine failure — re-enable button and surface the error.
      setIsPending(false);
      const message = error instanceof Error
        ? error.message
        : (locale === "ar" ? "تعذر تسجيل الخروج. حاول مرة أخرى." : "Failed to sign out. Please try again.");
      setErrorMessage(message);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => { setErrorMessage(null); timeoutRef.current = null; }, 4000);
    }
  }

  return (
    <>
      <Button
        {...buttonProps}
        loading={isPending}
        loadingLabel={pendingLabel ?? (locale === "ar" ? "جارٍ تسجيل الخروج..." : "Signing out...")}
        onClick={handleLogout}
      >
        {idleLabel ?? children}
      </Button>
      {errorMessage ? (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-[120] max-w-sm rounded-2xl border border-red-500/35 bg-[#1a0909]/95 px-4 py-3 text-sm text-red-100 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          {errorMessage}
        </div>
      ) : null}
    </>
  );
}
