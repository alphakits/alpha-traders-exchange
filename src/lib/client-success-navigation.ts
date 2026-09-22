"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

const PENDING_RESULT_KEY = "alpha:pending-action-result";

export function navigateAfterSuccess(router: AppRouterInstance, destination?: string | null, message?: string) {
  if (!destination) return false;
  if (message && typeof window !== "undefined") {
    try {
      const target = new URL(destination, window.location.origin);
      if (target.origin === window.location.origin) {
        window.sessionStorage.setItem(PENDING_RESULT_KEY, JSON.stringify({ path: normalizePath(target.pathname), message, createdAt: Date.now() }));
      }
    } catch { /* Navigation still works when browser storage is unavailable. */ }
  }
  router.push(destination);
  return true;
}

function normalizePath(pathname: string) {
  return pathname.replace(/^\/(en|ar)(?=\/)/, "") || "/";
}

/** Consume a confirmed result once, only on its destination page. */
export function consumeActionResult(pathname: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_RESULT_KEY);
    if (!raw) return null;
    const result = JSON.parse(raw) as { path?: string; message?: string; createdAt?: number };
    if (typeof result.message !== "string" || typeof result.createdAt !== "number" || Date.now() - result.createdAt > 60_000) {
      window.sessionStorage.removeItem(PENDING_RESULT_KEY);
      return null;
    }
    if (result.path !== normalizePath(pathname)) return null;
    window.sessionStorage.removeItem(PENDING_RESULT_KEY);
    return result.message;
  } catch { return null; }
}

export function navigateOrRevealResult(
  router: AppRouterInstance,
  destination: string | null | undefined,
  resultId: string,
) {
  if (!destination || typeof window === "undefined") return false;
  const target = new URL(destination, window.location.origin);
  if (normalizePath(target.pathname) !== normalizePath(window.location.pathname)) {
    router.push(destination);
    return true;
  }

  window.history.replaceState(window.history.state, "", `${window.location.pathname}${target.search}${target.hash}`);
  const revealId = resultId;
  let frame = 0;
  const reveal = () => {
    const result = document.getElementById(revealId);
    if (!result) {
      frame = window.requestAnimationFrame(reveal);
      return;
    }
    // Shared feedback owns focus and scrolling, including dialog isolation.
    if (result.hasAttribute("data-action-feedback")) return;
    result.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    if (result instanceof HTMLElement) {
      result.focus({ preventScroll: true });
    }
  };
  frame = window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
  window.setTimeout(() => window.cancelAnimationFrame(frame), 5000);
  return true;
}
