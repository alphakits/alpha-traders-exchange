import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { shouldLockForAppState } from "./biometric-lock-policy";
import {
  canUseBiometricLock,
  clearInvalidatedBiometricLock,
  disableBiometricLock,
  enableBiometricLock,
  isBiometricLockEnabled,
  unlockBiometricLock,
  type BiometricOperationResult,
} from "./biometric-lock-storage";

type BiometricLockError = Exclude<BiometricOperationResult, "success"> | null;

type BiometricLockContextValue = {
  isAppActive: boolean;
  isAuthenticating: boolean;
  isChecking: boolean;
  isEnabled: boolean;
  isLocked: boolean;
  isSupported: boolean;
  lastError: BiometricLockError;
  enable: () => Promise<BiometricOperationResult>;
  disable: () => Promise<BiometricOperationResult>;
  reset: () => Promise<void>;
  unlock: () => Promise<BiometricOperationResult>;
};

type LockState = {
  userId: string | null;
  enabled: boolean;
  locked: boolean;
  lastError: BiometricLockError;
};

const BiometricLockContext = createContext<BiometricLockContextValue | null>(null);

export function BiometricLockProvider({ children }: PropsWithChildren) {
  const { status, user } = useAuth();
  const { t } = useLocale();
  const userId = status === "authenticated" ? user?.id ?? null : null;
  const [state, setState] = useState<LockState>({ userId: null, enabled: false, locked: false, lastError: null });
  const [isSupported, setIsSupported] = useState(canUseBiometricLock);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
  const isCurrentUserLoaded = !userId || state.userId === userId;
  const isChecking = Boolean(userId) && !isCurrentUserLoaded;
  const isEnabled = Boolean(userId && isCurrentUserLoaded && state.enabled);
  const isLocked = Boolean(userId && isCurrentUserLoaded && state.locked);
  const lastError = isCurrentUserLoaded ? state.lastError : null;

  useEffect(() => {
    let active = true;
    if (!userId) {
      setState({ userId: null, enabled: false, locked: false, lastError: null });
      return () => { active = false; };
    }
    setState((current) => current.userId === userId
      ? current
      : { userId: null, enabled: false, locked: false, lastError: null });
    void isBiometricLockEnabled(userId)
      .then((enabled) => {
        if (!active) return;
        setState({ userId, enabled, locked: enabled, lastError: null });
      })
      .catch(() => {
        if (!active) return;
        setState({ userId, enabled: false, locked: false, lastError: "failed" });
      });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setIsAppActive(nextState === "active");
      if (nextState === "active") setIsSupported(canUseBiometricLock());
      if (shouldLockForAppState({
        enabled: isEnabled,
        authenticated: status === "authenticated",
        nextState,
      })) {
        setState((current) => current.userId === userId
          ? { ...current, locked: true, lastError: null }
          : current);
      }
    });
    return () => subscription.remove();
  }, [isEnabled, status, userId]);

  const enable = useCallback(async () => {
    if (!userId || isAuthenticating) return "failed" as const;
    setIsAuthenticating(true);
    let result: BiometricOperationResult = "failed";
    try {
      result = await enableBiometricLock(userId, t("biometricPrompt"));
      if (result === "success") {
        setState({ userId, enabled: true, locked: false, lastError: null });
      } else {
        setState((current) => current.userId === userId
          ? { ...current, lastError: result === "success" ? null : result }
          : current);
      }
      setIsSupported(canUseBiometricLock());
      return result;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, t, userId]);

  const disable = useCallback(async () => {
    if (!userId || isAuthenticating) return "failed" as const;
    setIsAuthenticating(true);
    let result: BiometricOperationResult = "failed";
    try {
      result = await disableBiometricLock(userId, t("biometricDisablePrompt"));
      if (result === "success") {
        setState({ userId, enabled: false, locked: false, lastError: null });
      } else {
        setState((current) => current.userId === userId
          ? { ...current, lastError: result === "success" ? null : result }
          : current);
      }
      setIsSupported(canUseBiometricLock());
      return result;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, t, userId]);

  const unlock = useCallback(async () => {
    if (!userId || !isEnabled || isAuthenticating) return "failed" as const;
    setIsAuthenticating(true);
    let result: BiometricOperationResult = "failed";
    try {
      result = await unlockBiometricLock(userId, t("biometricPrompt"));
      if (result === "success") {
        setState((current) => current.userId === userId
          ? { ...current, locked: false, lastError: null }
          : current);
      } else if (result === "invalidated") {
        try {
          await clearInvalidatedBiometricLock(userId);
        } catch {
          // The app remains masked until the user signs out even if cleanup fails.
        }
        setState({ userId, enabled: false, locked: true, lastError: "invalidated" });
      } else {
        setState((current) => current.userId === userId
          ? { ...current, lastError: result === "success" ? null : result }
          : current);
      }
      setIsSupported(canUseBiometricLock());
      return result;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, isEnabled, t, userId]);

  const reset = useCallback(async () => {
    if (!userId) return;
    try {
      await clearInvalidatedBiometricLock(userId);
    } finally {
      setState({ userId, enabled: false, locked: false, lastError: null });
    }
  }, [userId]);

  const value = useMemo<BiometricLockContextValue>(() => ({
    isAppActive,
    isAuthenticating,
    isChecking,
    isEnabled,
    isLocked,
    isSupported,
    lastError,
    enable,
    disable,
    reset,
    unlock,
  }), [
    disable,
    enable,
    isAppActive,
    isAuthenticating,
    isChecking,
    isEnabled,
    isLocked,
    isSupported,
    lastError,
    reset,
    unlock,
  ]);

  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock() {
  const context = useContext(BiometricLockContext);
  if (!context) throw new Error("useBiometricLock must be used inside BiometricLockProvider");
  return context;
}
