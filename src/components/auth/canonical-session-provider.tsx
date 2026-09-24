"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientSessionUser } from "@/lib/client-session-user";
import type { AppLocale } from "@/i18n/routing";
import { clearClientLocaleChoice } from "@/i18n/locale-preference";
import { getSignedOutPageDestination, isProtectedPage } from "@/lib/protected-page";

export type CanonicalSessionRefreshResult = "authenticated" | "anonymous" | "unavailable";

type CanonicalSessionContextValue = {
  user: ClientSessionUser | null;
  isResolving: boolean;
  isRestoring: boolean;
  error: boolean;
  refresh: (options?: { force?: boolean; background?: boolean }) => Promise<CanonicalSessionRefreshResult>;
};

const CanonicalSessionContext = createContext<CanonicalSessionContextValue | null>(null);

const CANONICAL_SESSION_RECOVERY_BASE_MS = 1_000;
const CANONICAL_SESSION_RECOVERY_MAX_MS = 30_000;
export const CANONICAL_SESSION_READ_TIMEOUT_MS = 30_000;
const CANONICAL_SESSION_RESUME_INTERVAL_MS = 15_000;

export function getCanonicalSessionRecoveryDelayMs(attempt: number) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    CANONICAL_SESSION_RECOVERY_BASE_MS * (2 ** Math.min(safeAttempt - 1, 5)),
    CANONICAL_SESSION_RECOVERY_MAX_MS,
  );
}

export function getSessionExpiryDestination(location: Pick<Location, "pathname"> & Partial<Pick<Location, "search" | "hash">>) {
  return isProtectedPage(location.pathname || "/")
    ? getSignedOutPageDestination(`${location.pathname}${location.search ?? ""}${location.hash ?? ""}`)
    : null;
}

export function CanonicalSessionProvider({
  children,
  initialSessionUser,
  locale,
}: {
  children: ReactNode;
  initialSessionUser: ClientSessionUser | null;
  locale?: AppLocale;
}) {
  const [user, setUser] = useState<ClientSessionUser | null>(initialSessionUser);
  // A server-rendered authenticated principal is immediately usable. Verify
  // it in parallel instead of freezing the entire Exchange workspace behind a
  // second /api/auth/me round trip on every navigation.
  const [isResolving, setIsResolving] = useState(initialSessionUser === null);
  const [error, setError] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const requestRef = useRef<Promise<CanonicalSessionRefreshResult> | null>(null);
  const cancelReadRef = useRef<(() => void) | null>(null);
  const requestIdRef = useRef(0);
  const lastReadStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const hadAuthenticatedSessionRef = useRef(Boolean(initialSessionUser));
  const expiryRedirectStartedRef = useRef(false);
  const recoveryAttemptsRef = useRef(0);
  const recoveryTimeoutRef = useRef<number | null>(null);
  const recoveryNeededRef = useRef(false);
  const scheduleRecoveryRef = useRef<() => void>(() => undefined);
  const localeSyncRef = useRef<string | null>(null);
  const hasInitialSession = initialSessionUser !== null;
  const canonicalUserId = user?.id;
  const canonicalPreferredLocale = user?.preferredLocale;

  const refresh = useCallback(async ({
    force = false,
    background = false,
  }: { force?: boolean; background?: boolean } = {}) => {
    const shouldBlock = !background;
    if (force) {
      // An auth boundary changed while a request may still be in flight. Its
      // result is no longer authoritative, so sequence a fresh canonical read.
      requestIdRef.current += 1;
      requestRef.current = null;
      cancelReadRef.current?.();
    }
    if (requestRef.current) return requestRef.current;
    lastReadStartedAtRef.current = Date.now();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CANONICAL_SESSION_READ_TIMEOUT_MS);
    const cancelRead = () => {
      clearTimeout(timeout);
      controller.abort();
    };
    cancelReadRef.current = cancelRead;
    const request = (async () => {
      if (shouldBlock) setIsResolving(true);
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include", signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as { user?: ClientSessionUser | null } | null;
        if (!response.ok) {
          const result: CanonicalSessionRefreshResult = response.status === 401 || response.status === 403 ? "anonymous" : "unavailable";
          if (mountedRef.current && requestId === requestIdRef.current) {
            if (result === "anonymous") {
              setUser(null);
              setIsRestoring(false);
            }
            setError(result === "unavailable");
          }
          return result;
        }
        if (!payload || !("user" in payload)) throw new Error("Unable to refresh account status.");
        const result: CanonicalSessionRefreshResult = payload.user ? "authenticated" : "anonymous";
        if (mountedRef.current && requestId === requestIdRef.current) {
          const nextUser = payload.user ?? null;
          // Preserve identity for an unchanged account. Background checks must
          // not remount its streams or reload every workspace panel.
          setUser((current) => JSON.stringify(current) === JSON.stringify(nextUser) ? current : nextUser);
          setError(false);
          setIsRestoring(false);
        }
        return result;
      } catch {
        if (mountedRef.current && requestId === requestIdRef.current) {
          // A timeout is not a logout. Retain the last confirmed account and
          // its current screen while recovering; every server action still
          // verifies the session and permissions independently.
          setError(true);
        }
        return "unavailable" as const;
      } finally {
        clearTimeout(timeout);
        if (cancelReadRef.current === cancelRead) cancelReadRef.current = null;
        if (shouldBlock && mountedRef.current && requestId === requestIdRef.current) setIsResolving(false);
      }
    })();
    requestRef.current = request;
    try {
      return await request;
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, []);

  const clearSessionRecovery = useCallback(() => {
    if (recoveryTimeoutRef.current !== null) {
      window.clearTimeout(recoveryTimeoutRef.current);
      recoveryTimeoutRef.current = null;
    }
    recoveryAttemptsRef.current = 0;
  }, []);

  const scheduleSessionRecovery = useCallback(() => {
    if (
      !mountedRef.current
      || !recoveryNeededRef.current
      || expiryRedirectStartedRef.current
      || recoveryTimeoutRef.current !== null
      || document.visibilityState === "hidden"
      || navigator.onLine === false
    ) return;

    recoveryAttemptsRef.current += 1;
    recoveryTimeoutRef.current = window.setTimeout(() => {
      recoveryTimeoutRef.current = null;
      if (!mountedRef.current || !recoveryNeededRef.current) return;
      if (document.visibilityState === "hidden" || navigator.onLine === false) return;
      void refresh({ background: true }).then((result) => {
        if (!mountedRef.current) return;
        if (result === "unavailable") {
          scheduleRecoveryRef.current();
        } else {
          recoveryNeededRef.current = false;
          clearSessionRecovery();
        }
      });
    }, getCanonicalSessionRecoveryDelayMs(recoveryAttemptsRef.current));
  }, [clearSessionRecovery, refresh]);
  scheduleRecoveryRef.current = scheduleSessionRecovery;

  useEffect(() => {
    mountedRef.current = true;
    void refresh({ background: hasInitialSession });
    const handleAuthChange = () => void refresh({ force: true });
    const sessionChannel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel("alpha.auth.session.v1") : null;
    const clearSignedOutSession = () => {
      clearClientLocaleChoice();
      hadAuthenticatedSessionRef.current = false;
      expiryRedirectStartedRef.current = true;
      recoveryNeededRef.current = false;
      clearSessionRecovery();
      requestIdRef.current += 1;
      requestRef.current = null;
      cancelReadRef.current?.();
      cancelReadRef.current = null;
      setUser(null);
      setError(false);
      setIsResolving(false);
      setIsRestoring(false);
    };
    const handleSignedOut = () => {
      clearSignedOutSession();
      sessionChannel?.postMessage("signed-out");
    };
    if (sessionChannel) sessionChannel.onmessage = (event) => {
      if (event.data === "signed-out") clearSignedOutSession();
    };
    const resumeSessionRecovery = () => {
      if (document.visibilityState === "hidden" || navigator.onLine === false || expiryRedirectStartedRef.current) return;
      if (recoveryNeededRef.current) {
        scheduleRecoveryRef.current();
      } else if (Date.now() - lastReadStartedAtRef.current >= CANONICAL_SESSION_RESUME_INTERVAL_MS) {
        // iOS can restore a suspended web app without remounting React. Check
        // the cookie on resume, coalescing pageshow/focus/visibility events.
        void refresh({ background: true });
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      // Back/forward cache can restore a page immediately after logout. Do not
      // let the normal resume throttle skip verification of that saved page.
      if (event.persisted) {
        setIsRestoring(true);
        void refresh({ force: true });
      } else resumeSessionRecovery();
    };
    window.addEventListener("alpha-auth-changed", handleAuthChange);
    window.addEventListener("alpha-auth-signed-out", handleSignedOut);
    window.addEventListener("online", resumeSessionRecovery);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", resumeSessionRecovery);
    document.addEventListener("visibilitychange", resumeSessionRecovery);
    return () => {
      sessionChannel?.close();
      mountedRef.current = false;
      recoveryNeededRef.current = false;
      clearSessionRecovery();
      requestIdRef.current += 1;
      requestRef.current = null;
      cancelReadRef.current?.();
      cancelReadRef.current = null;
      window.removeEventListener("alpha-auth-changed", handleAuthChange);
      window.removeEventListener("alpha-auth-signed-out", handleSignedOut);
      window.removeEventListener("online", resumeSessionRecovery);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", resumeSessionRecovery);
      document.removeEventListener("visibilitychange", resumeSessionRecovery);
    };
  }, [clearSessionRecovery, hasInitialSession, refresh]);

  useEffect(() => {
    if (!locale || !canonicalUserId || canonicalPreferredLocale === locale) return;
    const syncKey = `${canonicalUserId}:${locale}`;
    if (localeSyncRef.current === syncKey) return;
    localeSyncRef.current = syncKey;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/auth/preferred-locale", {
          method: "PATCH",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Locale": locale },
          body: JSON.stringify({ preferredLocale: locale }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        if (mountedRef.current) {
          setUser((current) => current?.id === canonicalUserId
            ? { ...current, preferredLocale: locale }
            : current);
        }
      } catch {
        // Locale persistence is best-effort and must never interrupt navigation.
      } finally {
        if (localeSyncRef.current === syncKey) localeSyncRef.current = null;
      }
    })();
    return () => controller.abort();
  }, [canonicalPreferredLocale, canonicalUserId, locale]);

  useEffect(() => {
    if (!error) {
      recoveryNeededRef.current = false;
      clearSessionRecovery();
      return;
    }
    if (isResolving || expiryRedirectStartedRef.current) return;
    recoveryNeededRef.current = true;
    scheduleRecoveryRef.current();
  }, [clearSessionRecovery, error, isResolving, user]);

  useEffect(() => {
    if (user) {
      hadAuthenticatedSessionRef.current = true;
      expiryRedirectStartedRef.current = false;
      return;
    }
    if (isResolving || error || !hadAuthenticatedSessionRef.current || expiryRedirectStartedRef.current) return;
    const destination = getSessionExpiryDestination(window.location);
    if (!destination) return;
    expiryRedirectStartedRef.current = true;
    clearClientLocaleChoice();
    window.location.replace(destination);
  }, [error, isResolving, user]);

  return <CanonicalSessionContext.Provider value={{ user, isResolving, isRestoring, error, refresh }}>{children}</CanonicalSessionContext.Provider>;
}

export function useCanonicalSession() {
  const value = useContext(CanonicalSessionContext);
  if (!value) throw new Error("useCanonicalSession must be used within CanonicalSessionProvider.");
  return value;
}

export function useOptionalCanonicalSession() {
  return useContext(CanonicalSessionContext);
}
