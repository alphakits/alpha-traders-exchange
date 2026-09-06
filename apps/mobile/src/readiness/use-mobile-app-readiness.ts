import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { MobileAppConfigResponse, MobileLocale } from "@alpha-traders/contracts";
import { getMobileAppConfig } from "../api/mobile-api";

const APP_CONFIG_RECHECK_MS = 5 * 60_000;

export type MobileAppReadiness =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "update_required"; config: MobileAppConfigResponse };

export function useMobileAppReadiness(locale: MobileLocale, isOnline: boolean | null) {
  const [readiness, setReadiness] = useState<MobileAppReadiness>({ status: "checking" });
  const activeController = useRef<AbortController | null>(null);
  const hasResolvedInitialCheck = useRef(false);
  const lastAttemptAt = useRef(0);

  const checkAppConfig = useCallback(async (force = false) => {
    if (isOnline === false) {
      activeController.current?.abort();
      hasResolvedInitialCheck.current = true;
      setReadiness((current) => current.status === "update_required"
        ? current
        : { status: "ready" });
      return;
    }
    if (!force && Date.now() - lastAttemptAt.current < APP_CONFIG_RECHECK_MS) return;

    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    if (!hasResolvedInitialCheck.current) setReadiness({ status: "checking" });

    try {
      const config = await getMobileAppConfig(locale, controller.signal);
      if (controller.signal.aborted) return;
      lastAttemptAt.current = Date.now();
      hasResolvedInitialCheck.current = true;
      setReadiness(config.updateRequired
        ? { status: "update_required", config }
        : { status: "ready" });
    } catch {
      if (controller.signal.aborted) return;
      lastAttemptAt.current = Date.now();
      hasResolvedInitialCheck.current = true;
      setReadiness((current) => current.status === "update_required"
        ? current
        : { status: "ready" });
    }
  }, [isOnline, locale]);

  useEffect(() => {
    void checkAppConfig(true);
    return () => activeController.current?.abort();
  }, [checkAppConfig]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void checkAppConfig();
    });
    return () => subscription.remove();
  }, [checkAppConfig]);

  return readiness;
}
