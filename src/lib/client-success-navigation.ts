"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export function navigateAfterSuccess(router: AppRouterInstance, destination?: string | null) {
  if (!destination) return false;
  router.push(destination);
  return true;
}

function normalizePath(pathname: string) {
  return pathname.replace(/^\/(en|ar)(?=\/)/, "") || "/";
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
  let frame = 0;
  const reveal = () => {
    const result = document.getElementById(resultId);
    if (!result) {
      frame = window.requestAnimationFrame(reveal);
      return;
    }
    result.scrollIntoView({ behavior: "smooth", block: "center" });
    if (result instanceof HTMLElement) {
      result.focus({ preventScroll: true });
    }
  };
  frame = window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
  window.setTimeout(() => window.cancelAnimationFrame(frame), 5000);
  return true;
}
