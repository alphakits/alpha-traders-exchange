"use client";

import { useEffect, useRef } from "react";
import {
  NATIVE_WEB_BRIDGE_VERSION,
  parseNativeToWebBridgeMessage,
} from "@alpha-traders/contracts";
import type { AppLocale } from "@/i18n/routing";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { postToNativeApp } from "@/lib/native-app-bridge";

export function NativeAppBridge({ locale }: { locale: AppLocale }) {
  const { user, isResolving } = useCanonicalSession();
  const currentUserIdRef = useRef<string | null>(user?.id ?? null);
  const lastRegistrationRef = useRef<string | null>(null);
  const lastSuccessfulRegistrationRef = useRef<string | null>(null);
  const lastPushState = useRef<{ userId: string; state: "on" | "off" | "blocked" | "unavailable" } | null>(null);
  currentUserIdRef.current = isResolving ? null : user?.id ?? null;

  useEffect(() => {
    let stopped = false;
    let epoch = 0;
    let controller = new AbortController();
    let registrationQueue: Promise<void> = Promise.resolve();
    const emitState = (userId: string, state: "on" | "off" | "blocked" | "unavailable") => {
      lastPushState.current = { userId, state };
      window.dispatchEvent(new CustomEvent("alpha-notification-push-state", { detail: lastPushState.current }));
    };
    const wait = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

    const persistRegistration = async (
      message: Extract<ReturnType<typeof parseNativeToWebBridgeMessage>, { status: "registered" }>,
      userId: string,
      registrationKey: string,
      startedEpoch: number,
    ) => {
      if (!message) return;
      const signal = controller.signal;
      const isCurrent = () => !stopped && !signal.aborted && epoch === startedEpoch
        && currentUserIdRef.current === userId && lastRegistrationRef.current === registrationKey;
      const retryDelays = [0, 1_000, 3_000];
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (retryDelays[attempt] > 0) await wait(retryDelays[attempt]);
        if (!isCurrent()) return;
        try {
          const response = await fetch("/api/mobile/v1/push-subscriptions", {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            signal,
            headers: {
              "Content-Type": "application/json",
              "X-App-Version": message.appVersion,
              "X-Device-Id": message.installationId,
              "X-Locale": message.locale,
              "X-Platform": message.platform,
            },
            body: JSON.stringify({
              expectedUserId: userId,
              expoPushToken: message.expoPushToken,
              installationId: message.installationId,
              platform: message.platform,
              locale: message.locale,
              appVersion: message.appVersion,
            }),
          });
          if (response.ok) {
            if (isCurrent()) {
              lastSuccessfulRegistrationRef.current = registrationKey;
              emitState(userId, "on");
              postToNativeApp({
                type: "alpha.web.push-registration",
                version: NATIVE_WEB_BRIDGE_VERSION,
                userId,
                status: "registered",
                locale: message.locale,
              });
            }
            return;
          }
          if (response.status !== 429 && response.status < 500) break;
        } catch {
          // Retry bounded transient network failures below.
        }
      }
      if (!isCurrent()) return;
      // A foreground/session signal from the native shell resends its cached
      // token, while the server upsert keeps that retry idempotent.
      lastRegistrationRef.current = null;
      lastSuccessfulRegistrationRef.current = null;
      emitState(userId, "off");
      postToNativeApp({
        type: "alpha.web.push-registration",
        version: NATIVE_WEB_BRIDGE_VERSION,
        userId,
        status: "failed",
        locale: message.locale,
      });
    };

    const handleMessage = (event: MessageEvent) => {
      const message = parseNativeToWebBridgeMessage(event.data);
      if (!message) return;
      const userId = currentUserIdRef.current;
      if (!userId || (message.userId && message.userId !== userId)) return;
      if (message.status !== "registered") {
        epoch++;
        controller.abort(); controller = new AbortController();
        lastRegistrationRef.current = null; lastSuccessfulRegistrationRef.current = null;
        emitState(userId, message.status === "denied" ? "blocked" : message.status === "failed" ? "off" : "unavailable");
        return;
      }
      const registrationKey = [
        userId,
        message.installationId,
        message.expoPushToken,
        message.locale,
        message.appVersion,
      ].join(":");
      if (lastRegistrationRef.current === registrationKey) {
        if (lastSuccessfulRegistrationRef.current === registrationKey) emitState(userId, "on");
        return;
      }
      const registrationEpoch = ++epoch;
      lastRegistrationRef.current = registrationKey;
      // Token refresh and locale changes can arrive while persistence is still
      // in flight. Let that request settle before writing the newest state;
      // aborting it would not cancel a server upsert already in progress.
      // Superseded tasks cannot retry, acknowledge or reset the newest state.
      const persistLatest = async () => {
        if (stopped || epoch !== registrationEpoch || currentUserIdRef.current !== userId
          || lastRegistrationRef.current !== registrationKey) return;
        await persistRegistration(message, userId, registrationKey, registrationEpoch);
      };
      registrationQueue = registrationQueue.then(persistLatest, persistLatest);
    };

    const handleSignedOut = () => {
      // Logout immediately navigates to the public homepage. Notify
      // the shell synchronously so it cannot retain the old session's Arabic.
      currentUserIdRef.current = null;
      lastRegistrationRef.current = null;
      lastSuccessfulRegistrationRef.current = null; lastPushState.current = null;
      epoch++; controller.abort(); controller = new AbortController();
      postToNativeApp({
        type: "alpha.web.session",
        version: NATIVE_WEB_BRIDGE_VERSION,
        authenticated: false,
        locale: "en",
      });
    };

    const handleStateRequest = (event: Event) => {
      const requested = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      const state = lastPushState.current;
      if (state && requested === currentUserIdRef.current && state.userId === requested) emitState(state.userId, state.state);
    };

    window.addEventListener("alpha-auth-signed-out", handleSignedOut);
    window.addEventListener("alpha-notification-push-status-request", handleStateRequest);
    window.addEventListener("message", handleMessage);
    document.addEventListener("message", handleMessage as EventListener);
    return () => {
      stopped = true;
      controller.abort();
      window.removeEventListener("alpha-auth-signed-out", handleSignedOut);
      window.removeEventListener("alpha-notification-push-status-request", handleStateRequest);
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("message", handleMessage as EventListener);
    };
  }, []);

  useEffect(() => {
    currentUserIdRef.current = isResolving ? null : user?.id ?? null;
    if (isResolving) return;
    if (!user) {
      lastRegistrationRef.current = null;
      lastSuccessfulRegistrationRef.current = null; lastPushState.current = null;
      postToNativeApp({
        type: "alpha.web.session",
        version: NATIVE_WEB_BRIDGE_VERSION,
        authenticated: false,
        locale,
      });
      return;
    }
    postToNativeApp({
      type: "alpha.web.session",
      version: NATIVE_WEB_BRIDGE_VERSION,
      authenticated: true,
      userId: user.id,
      locale,
    });
  }, [isResolving, locale, user]);

  return null;
}
