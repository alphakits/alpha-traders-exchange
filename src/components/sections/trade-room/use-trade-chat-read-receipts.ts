"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { TradeChatMessage } from "@/types/alpha-exchange";

export type TradeChatReceipt = Pick<TradeChatMessage, "id" | "readByUserIds" | "seenAt" | "deliveredAt">;

/** Batch only messages actually shown in the foreground, never unseen new arrivals. */
export function observeTradeChatReadReceipts(container: HTMLElement, requestId: string, unreadIds: readonly string[], onReceipts: (receipts: TradeChatReceipt[]) => void, nativeActive = { current: true }) {
  const unread = new Set(unreadIds);
  const acknowledged = new Set<string>();
  let stopped = false;
  let pending: AbortController | null = null;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    if (stopped || pending || !nativeActive.current || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const bounds = container.getBoundingClientRect();
    const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
    const left = Math.max(0, bounds.left), right = Math.min(window.innerWidth, bounds.right);
    const messageIds = [...container.querySelectorAll<HTMLElement>("[data-trade-message-id]")].filter(node => {
      const id = node.dataset.tradeMessageId ?? "";
      if (!unread.has(id) || acknowledged.has(id)) return false;
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && Math.min(bottom, rect.bottom) - Math.max(top, rect.top) >= Math.min(48, rect.height)
        && Math.min(right, rect.right) > Math.max(left, rect.left);
    }).map(node => node.dataset.tradeMessageId!).slice(0, 100);
    if (!messageIds.length) return;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/alpha-exchange/trade-room/${encodeURIComponent(requestId)}/read`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ messageIds }), signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = await response.json() as { messages: TradeChatReceipt[] };
      if (stopped || !Array.isArray(payload.messages)) return;
      const receipts = payload.messages.filter(receipt => messageIds.includes(receipt.id));
      receipts.forEach(receipt => acknowledged.add(receipt.id));
      onReceipts(receipts);
    } catch { /* A later visible pass retries; reading never blocks the trade. */ }
    finally { clearTimeout(timeout); pending = null; }
  };
  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = setTimeout(() => { scheduled = undefined; void flush(); }, 150);
  };
  const nativeState = (event: Event) => {
    nativeActive.current = (event as CustomEvent<{ active: boolean }>).detail?.active !== false;
    schedule();
  };
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("focus", schedule);
  window.addEventListener("online", schedule);
  window.addEventListener("alpha-native-app-state", nativeState);
  document.addEventListener("visibilitychange", schedule);
  const retry = setInterval(schedule, 5000);
  schedule();
  return () => {
    stopped = true; pending?.abort(); clearTimeout(scheduled); clearInterval(retry);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("online", schedule);
    window.removeEventListener("alpha-native-app-state", nativeState);
    document.removeEventListener("visibilitychange", schedule);
  };
}

export function useTradeChatReadReceipts({ container, requestId, actorId, enabled, messages, onReceipts }: {
  container: RefObject<HTMLDivElement | null>; requestId: string; actorId: string; enabled: boolean;
  messages: readonly TradeChatMessage[]; onReceipts: (receipts: TradeChatReceipt[]) => void;
}) {
  const nativeActive = useRef(true);
  useEffect(() => {
    const rememberState = (event: Event) => { nativeActive.current = (event as CustomEvent<{ active: boolean }>).detail?.active !== false; };
    window.addEventListener("alpha-native-app-state", rememberState);
    return () => window.removeEventListener("alpha-native-app-state", rememberState);
  }, []);
  const unreadIds = JSON.stringify(messages.filter(message => message.kind === "user" && message.senderUserId !== actorId
    && !message.deletedAt && !message.readByUserIds.includes(actorId)).map(message => message.id));
  useEffect(() => {
    const ids = JSON.parse(unreadIds) as string[];
    if (!enabled || !ids.length || !container.current) return;
    return observeTradeChatReadReceipts(container.current, requestId, ids, onReceipts, nativeActive);
  }, [actorId, container, enabled, onReceipts, requestId, unreadIds]);
}
