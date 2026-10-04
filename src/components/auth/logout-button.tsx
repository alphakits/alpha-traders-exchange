"use client";

import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@/i18n/routing";
import { Button, type ButtonProps } from "@/components/ui/button";
import { clearClientLocaleChoice } from "@/i18n/locale-preference";
import { ClientRequestTimeoutError, runClientRequest } from "@/lib/client-request-deadline";

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
  const [errorMessage, setErrorMessage, errorMessageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = requestRef.current;
      requestRef.current = null;
      current?.abort();
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  async function handleLogout() {
    if (!mountedRef.current || requestRef.current || isPending) return;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsPending(true);
    setErrorMessage(null);
    // Bound a stalled request, but never show a successful logout until the
    // server has revoked the session and returned the expired cookies.
    const controller = new AbortController();
    requestRef.current = controller;
    let navigationStarted = false;
    try {
      const { response, payload } = await runClientRequest(controller, 8_000, async signal => {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          signal,
        });
        const payload = response.ok ? null : await response.json().catch(() => null) as { error?: string } | null;
        return { response, payload };
      });
      if (!mountedRef.current || requestRef.current !== controller) return;
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" && payload.error.trim() ? payload.error : (locale === "ar" ? "تعذر تسجيل الخروج. حاول مرة أخرى." : "Failed to sign out. Please try again."));
      }
      clearClientLocaleChoice();
      onSignedOut?.();
      window.dispatchEvent(new Event("alpha-auth-signed-out"));
      window.dispatchEvent(new Event("alpha-auth-changed"));
      window.location.replace("/en");
      navigationStarted = true;
    } catch (error) {
      if (!mountedRef.current || requestRef.current !== controller) return;
      if (error instanceof ClientRequestTimeoutError || (error instanceof Error && error.name === "AbortError")) {
        setErrorMessage(locale === "ar"
          ? "استغرق تسجيل الخروج وقتًا أطول من المتوقع. حاول مرة أخرى."
          : "Signing out took longer than expected. Please try again.");
        return;
      }
      // Genuine failure — re-enable button and surface the error.
      const message = error instanceof Error && !(error instanceof TypeError)
        ? error.message
        : (locale === "ar" ? "تعذر تسجيل الخروج. حاول مرة أخرى." : "Failed to sign out. Please try again.");
      setErrorMessage(message);
      timeoutRef.current = window.setTimeout(() => {
        if (mountedRef.current) setErrorMessage(null);
        timeoutRef.current = null;
      }, 4000);
    } finally {
      if (!navigationStarted && mountedRef.current && requestRef.current === controller) {
        requestRef.current = null;
        setIsPending(false);
      }
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
        <ActionFeedback revealKey={errorMessageFeedbackKey} role="alert" className="fixed bottom-4 right-4 z-[120] max-w-sm rounded-2xl border border-red-500/35 bg-[#1a0909]/95 px-4 py-3 text-sm text-red-100 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {errorMessage}
        </ActionFeedback>
      ) : null}
    </>
  );
}
