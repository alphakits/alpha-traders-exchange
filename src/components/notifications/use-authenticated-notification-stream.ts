"use client";

import { useEffect, useRef, useState } from "react";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";

const NOTIFICATION_STREAM_RECONNECT_BASE_MS = 1_000;
const NOTIFICATION_STREAM_RECONNECT_MAX_MS = 30_000;

type Options = {
  enabled?: boolean;
  onNotifications: (event: Event) => void;
};

export function getNotificationStreamReconnectDelayMs(attempt: number) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    NOTIFICATION_STREAM_RECONNECT_BASE_MS * (2 ** Math.min(safeAttempt - 1, 5)),
    NOTIFICATION_STREAM_RECONNECT_MAX_MS,
  );
}

/**
 * Opens the notification stream only for a canonically authenticated session.
 * An EventSource cannot expose a failed handshake status, so every connection
 * error is reconciled through `/api/auth/me` before a bounded-backoff reconnect.
 * A confirmed signed-out state therefore closes the stream instead of letting
 * the browser retry an unauthorized request indefinitely, while temporary
 * network or server failures can recover without a page reload.
 */
export function useAuthenticatedNotificationStream({ enabled = true, onNotifications }: Options) {
  const canonicalSession = useOptionalCanonicalSession();
  const hasCanonicalSession = Boolean(canonicalSession);
  const canonicalUserId = canonicalSession?.user?.id ?? null;
  const canonicalSessionResolving = canonicalSession?.isResolving ?? false;
  const refreshCanonicalSession = canonicalSession?.refresh;
  const onNotificationsRef = useRef(onNotifications);
  const reconnectAttemptsRef = useRef(0);
  const [streamCycle, setStreamCycle] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    onNotificationsRef.current = onNotifications;
  }, [onNotifications]);

  useEffect(() => {
    const syncVisibility = () => setDocumentVisible(document.visibilityState !== "hidden");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    // A hidden tab does not need an active five-second reconciliation loop.
    // Closing it here lets the server release its SSE timers; visibility restore
    // opens one fresh stream through this same canonical-auth gate.
    if (!enabled || !documentVisible || typeof EventSource === "undefined") return;
    if (hasCanonicalSession && (canonicalSessionResolving || !canonicalUserId)) return;

    let active = true;
    let disposed = false;
    let reconnectTimeout: number | null = null;
    const stream = new EventSource("/api/alpha-exchange/notifications/stream");
    const handleNotifications = (event: Event) => onNotificationsRef.current(event);
    const onOpen = () => {
      reconnectAttemptsRef.current = 0;
    };
    const onError = () => {
      if (!active) return;
      // A backgrounded or outgoing document can report an EventSource error
      // after its owning component has started to tear down. Close that stream
      // without treating it as a fresh server-auth boundary; the visible page
      // will establish its own canonical session and stream if appropriate.
      if (document.visibilityState === "hidden") {
        active = false;
        stream.close();
        return;
      }
      // Treat the first visible connection error as the only auth recovery
      // trigger for this EventSource. A queued second error after close must
      // not restart the canonical session read or create a recovery loop.
      active = false;
      stream.close();

      reconnectAttemptsRef.current += 1;
      const delayMs = getNotificationStreamReconnectDelayMs(reconnectAttemptsRef.current);
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        if (disposed || document.visibilityState === "hidden") return;

        // Components are rendered under the provider in production. The
        // fallback cycle keeps isolated component tests from relying on the
        // browser's uncontrolled native EventSource retry behavior.
        if (!refreshCanonicalSession) {
          setStreamCycle((value) => value + 1);
          return;
        }
        void refreshCanonicalSession({ force: true }).then((result) => {
          // Canonical provider state normally restarts this effect. If React
          // batches a very fast authenticated refresh back to the same visible
          // state, this explicit cycle still guarantees a fresh stream.
          if (!disposed && result === "authenticated" && document.visibilityState !== "hidden") {
            setStreamCycle((value) => value + 1);
          }
        });
      }, delayMs);
    };
    const handlePageExit = () => {
      // EventSource can dispatch its final error after `beforeunload` but
      // before React's cleanup. Mark this connection inactive first so that
      // late teardown noise cannot trigger an unnecessary `/api/auth/me`
      // refresh in the outgoing document.
      active = false;
      disposed = true;
      if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout);
      stream.close();
    };

    stream.addEventListener("notifications", handleNotifications);
    stream.addEventListener("open", onOpen as EventListener);
    stream.addEventListener("error", onError as EventListener);
    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);

    return () => {
      active = false;
      disposed = true;
      if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout);
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
      stream.removeEventListener("notifications", handleNotifications);
      stream.removeEventListener("open", onOpen as EventListener);
      stream.removeEventListener("error", onError as EventListener);
      stream.close();
    };
  }, [canonicalSessionResolving, canonicalUserId, documentVisible, enabled, hasCanonicalSession, refreshCanonicalSession, streamCycle]);
}
