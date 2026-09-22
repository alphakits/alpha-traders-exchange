"use client";

import { createElement, useCallback, useLayoutEffect, useRef, useState, type HTMLAttributes, type SetStateAction } from "react";
import { createPortal } from "react-dom";

export const ACTION_FEEDBACK_REVEALED = "alpha:action-feedback-revealed";

/** Every completed action has a new identity, even when its text is unchanged. */
export function useActionFeedbackState<T>(initialValue: T) {
  const [state, setState] = useState({ value: initialValue, revision: 0 });
  const setValue = useCallback((next: SetStateAction<T>) => {
    setState((previous) => ({
      value: typeof next === "function" ? (next as (value: T) => T)(previous.value) : next,
      revision: previous.revision + 1,
    }));
  }, []);
  return [state.value, setValue, state.revision] as const;
}

const pendingFeedback = new Set<HTMLElement>();
let pendingFrame: number | null = null;

function isVisible(element: HTMLElement) {
  if (!element.isConnected) return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  if (!element.getClientRects().length) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.visibility !== "collapse";
}

function activeDialog() {
  return [...document.querySelectorAll<HTMLElement>("[role='dialog'], [aria-modal='true'], dialog[open]")].filter(isVisible).at(-1) ?? null;
}

function flushFeedback() {
  pendingFrame = null;
  const candidates = [...pendingFeedback].filter((element) => isVisible(element) && element.textContent?.trim());
  pendingFeedback.clear();
  // A result behind a modal must never pull the page or focus out of that modal.
  const dialog = activeDialog();
  const eligible = dialog ? candidates.filter((element) => dialog.contains(element)) : candidates;
  const center = window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height / 2
    : window.innerHeight / 2;
  // The same result can appear in the dashboard portal and the full workspace.
  // Reveal the closest visible copy once, instead of starting competing scrolls.
  eligible.sort((a, b) => {
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    return Math.abs(aRect.top + aRect.height / 2 - center) - Math.abs(bRect.top + bRect.height / 2 - center);
  });
  const target = eligible[0];
  if (!target) return;
  window.dispatchEvent(new Event(ACTION_FEEDBACK_REVEALED));
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "center",
    inline: "nearest",
  });
}

function revealFeedback(element: HTMLElement) {
  pendingFeedback.add(element);
  if (pendingFrame === null) pendingFrame = window.requestAnimationFrame(flushFeedback);
}

type ActionFeedbackProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "p" | "section";
  /** Change this when an action returns the same message without clearing it. */
  revealKey?: unknown;
  /** Background loading/polling errors can remain readable without taking focus. */
  autoReveal?: boolean;
  /** Keep floating admin results inside an open dialog's focus boundary. */
  floating?: boolean;
};

/** Use for action results, not live prices, incoming chat, or polling status. */
export function ActionFeedback({
  as = "div", children, role = "status", revealKey, autoReveal = true, floating = false, style, ...props
}: ActionFeedbackProps) {
  const ref = useRef<HTMLElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const previous = useRef<{ text: string; key: unknown; host: HTMLElement | null } | null>(null);

  // Run after each parent commit: a dialog can close without changing this result.
  // The host identity guard makes this at most one additional render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!floating) return;
    // Resolve after commit so a dialog closed by the same action is not reused.
    const dialog = activeDialog();
    if (dialog !== portalHost) setPortalHost(dialog);
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const text = element.textContent?.trim() ?? "";
    const changed = previous.current?.text !== text || previous.current?.key !== revealKey || previous.current?.host !== portalHost;
    previous.current = { text, key: revealKey, host: portalHost };
    if (autoReveal && text && changed) revealFeedback(element);
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const scope = element.closest("form, [role='dialog'], [data-feedback-scope]");
    // Repeating an invalid submission can leave React's error string unchanged.
    // Follow that error again only for submissions, never for ordinary typing.
    const repeatSubmission = (event: Event) => {
      if (!autoReveal || role !== "alert") return;
      if (event.type === "click" && !(event.target instanceof Element && event.target.closest("[data-feedback-submit]"))) return;
      revealFeedback(element);
    };
    scope?.addEventListener("submit", repeatSubmission, true);
    scope?.addEventListener("click", repeatSubmission, true);
    return () => {
      scope?.removeEventListener("submit", repeatSubmission, true);
      scope?.removeEventListener("click", repeatSubmission, true);
      pendingFeedback.delete(element);
      if (!pendingFeedback.size && pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
    };
  }, [autoReveal, role, portalHost]);

  const feedback = createElement(as, {
    ...props,
    ref,
    role,
    "aria-live": props["aria-live"] ?? (role === "alert" ? "assertive" : "polite"),
    "aria-atomic": true,
    "data-action-feedback": "",
    tabIndex: -1,
    style: { scrollMarginBlockStart: "7rem", scrollMarginBlockEnd: "7rem", ...style },
  }, children);
  return portalHost ? createPortal(feedback, portalHost) : feedback;
}
