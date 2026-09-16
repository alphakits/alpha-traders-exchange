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

function destinationRevealId(target: URL, fallbackResultId: string) {
  const hashId = decodeURIComponent(target.hash.replace(/^#/, "")).trim();
  if (normalizePath(target.pathname).startsWith("/trade-room/") && hashId) {
    return hashId;
  }
  return fallbackResultId;
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
  const revealId = destinationRevealId(target, resultId);
  let frame = 0;
  const reveal = () => {
    const result = document.getElementById(revealId);
    if (!result) {
      frame = window.requestAnimationFrame(reveal);
      return;
    }
    result.scrollIntoView({ behavior: "smooth", block: revealId === resultId ? "center" : "start" });
    if (result instanceof HTMLElement) {
      result.focus({ preventScroll: true });
    }
  };
  frame = window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
  window.setTimeout(() => window.cancelAnimationFrame(frame), 5000);
  return true;
}
