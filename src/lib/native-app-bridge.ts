"use client";

import {
  NATIVE_WEB_BRIDGE_VERSION,
  type MobileLocale,
  type WebToNativeBridgeMessage,
} from "@alpha-traders/contracts";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

const COMPLETED_TRADE_SIGNAL_MAX_AGE_MS = 48 * 60 * 60 * 1_000;

export function postToNativeApp(message: WebToNativeBridgeMessage) {
  if (typeof window === "undefined" || !window.ReactNativeWebView?.postMessage) return false;
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

export function isRecentCompletedTradeNotification(
  notification: AlphaExchangeNotification,
  now = Date.now(),
) {
  if (notification.category !== "trade") return false;
  if (notification.title.trim().toLowerCase() !== "trade completed") return false;
  const createdAt = new Date(notification.createdAt).getTime();
  return Number.isFinite(createdAt)
    && createdAt <= now + 60_000
    && now - createdAt <= COMPLETED_TRADE_SIGNAL_MAX_AGE_MS;
}

export function forwardCompletedTradesToNative(
  notifications: AlphaExchangeNotification[],
  userId: string | null | undefined,
  locale: MobileLocale,
  now = Date.now(),
) {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return 0;
  let sent = 0;
  for (const notification of notifications) {
    if (notification.userId !== normalizedUserId) continue;
    if (!isRecentCompletedTradeNotification(notification, now)) continue;
    const tradeReference = notification.relatedRequestId?.trim()
      || notification.relatedTradeId?.trim()
      || notification.id;
    if (postToNativeApp({
      type: "alpha.web.trade-completed",
      version: NATIVE_WEB_BRIDGE_VERSION,
      userId: normalizedUserId,
      notificationId: notification.id,
      tradeReference,
      locale,
    })) {
      sent += 1;
    }
  }
  return sent;
}

export function syncNotificationCountToNative(
  unreadCount: number,
  userId: string | null | undefined,
  locale: MobileLocale,
) {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId || !Number.isFinite(unreadCount)) return false;
  return postToNativeApp({
    type: "alpha.web.notification-count",
    version: NATIVE_WEB_BRIDGE_VERSION,
    userId: normalizedUserId,
    unreadCount: Math.min(9_999, Math.max(0, Math.trunc(unreadCount))),
    locale,
  });
}
