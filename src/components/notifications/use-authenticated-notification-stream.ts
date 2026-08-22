"use client";

import { useEffect, useRef } from "react";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";

const MAX_RECONNECT_ATTEMPTS = 3;

type Options = {
  enabled?: boolean;
  onNotifications: (event: Event) => void;
};

/**
 * Opens the notification stream only for a canonically authenticated session.
 * An EventSource cannot expose a failed handshake status, so every connection
 * error is reconciled once through `/api/auth/me` before a bounded reconnect.
 * A confirmed signed-out state therefore closes the stream instead of letting
 * the browser retry an unauthorized request indefinitely.
 */
export function useAuthenticatedNotificationStream({ enabled = true, onNotifications }: Options) {
  const canonicalSession = useOptionalCanonicalSession();
  const hasCanonicalSession = Boolean(canonicalSession);
  const canonicalUserId = canonicalSession?.user?.id ?? null;
  const canonicalSessionResolving = canonicalSession?.isResolving ?? false;
  const refreshCanonicalSession = canonicalSession?.refresh;
  const onNotificationsRef = useRef(onNotifications);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    onNotificationsRef.current = onNotifications;
  }, [onNotifications]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    if (hasCanonicalSession && (canonicalSessionResolving || !canonicalUserId)) return;
    if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) return;

    let active = true;
    const stream = new EventSource("/api/alpha-exchange/notifications/stream");
    const handleNotifications = (event: Event) => onNotificationsRef.current(event);
    const onOpen = () => {
      reconnectAttemptsRef.current = 0;
    };
    const onError = () => {
      if (!active) return;
      stream.close();

      // Components are always rendered under the provider in production. The
      // defensive fallback merely avoids an uncontrolled native retry when a
      // component is rendered in isolation.
      if (!refreshCanonicalSession) return;
      reconnectAttemptsRef.current += 1;
      void refreshCanonicalSession({ force: true });
    };
    const handleBeforeUnload = () => stream.close();

    stream.addEventListener("notifications", handleNotifications);
    stream.addEventListener("open", onOpen as EventListener);
    stream.addEventListener("error", onError as EventListener);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      active = false;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      stream.removeEventListener("notifications", handleNotifications);
      stream.removeEventListener("open", onOpen as EventListener);
      stream.removeEventListener("error", onError as EventListener);
      stream.close();
    };
  }, [canonicalSessionResolving, canonicalUserId, enabled, hasCanonicalSession, refreshCanonicalSession]);
}
