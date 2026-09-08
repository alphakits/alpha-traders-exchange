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

  useEffect(() => {
    let stopped = false;
    const wait = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

    const persistRegistration = async (
      message: Extract<ReturnType<typeof parseNativeToWebBridgeMessage>, { status: "registered" }>,
      userId: string,
      registrationKey: string,
    ) => {
      if (!message) return;
      const retryDelays = [0, 1_000, 3_000];
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (retryDelays[attempt] > 0) await wait(retryDelays[attempt]);
        if (stopped || currentUserIdRef.current !== userId) return;
        try {
          const response = await fetch("/api/mobile/v1/push-subscriptions", {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              "X-App-Version": message.appVersion,
              "X-Device-Id": message.installationId,
              "X-Locale": message.locale,
              "X-Platform": message.platform,
            },
            body: JSON.stringify({
              expoPushToken: message.expoPushToken,
              installationId: message.installationId,
              platform: message.platform,
              locale: message.locale,
              appVersion: message.appVersion,
            }),
          });
          if (response.ok) {
            if (!stopped && currentUserIdRef.current === userId) {
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
      if (lastRegistrationRef.current === registrationKey) {
        // A foreground/session signal from the native shell resends its cached
        // token, while the server upsert keeps that retry idempotent.
        lastRegistrationRef.current = null;
      }
      if (!stopped && currentUserIdRef.current === userId) {
        postToNativeApp({
          type: "alpha.web.push-registration",
          version: NATIVE_WEB_BRIDGE_VERSION,
          userId,
          status: "failed",
          locale: message.locale,
        });
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const message = parseNativeToWebBridgeMessage(event.data);
      if (!message || message.status !== "registered") return;
      const userId = currentUserIdRef.current;
      if (!userId) return;
      const registrationKey = [
        userId,
        message.installationId,
        message.expoPushToken,
        message.locale,
        message.appVersion,
      ].join(":");
      if (lastRegistrationRef.current === registrationKey) return;
      lastRegistrationRef.current = registrationKey;
      void persistRegistration(message, userId, registrationKey);
    };

    window.addEventListener("message", handleMessage);
    document.addEventListener("message", handleMessage as EventListener);
    return () => {
      stopped = true;
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("message", handleMessage as EventListener);
    };
  }, []);

  useEffect(() => {
    currentUserIdRef.current = user?.id ?? null;
    if (isResolving) return;
    if (!user) {
      lastRegistrationRef.current = null;
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
