"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientSessionUser } from "@/lib/client-session-user";
import type { AppLocale } from "@/i18n/routing";

export type CanonicalSessionRefreshResult = "authenticated" | "anonymous" | "unavailable";

type CanonicalSessionContextValue = {
  user: ClientSessionUser | null;
  isResolving: boolean;
  error: boolean;
  refresh: (options?: { force?: boolean }) => Promise<CanonicalSessionRefreshResult>;
};

const CanonicalSessionContext = createContext<CanonicalSessionContextValue | null>(null);

export function getSessionExpiryLoginDestination(location: Pick<Location, "pathname" | "search" | "hash">) {
  const pathname = location.pathname || "/";
  const locale = pathname.match(/^\/(ar|en)(?:\/|$)/)?.[1] ?? "en";
  if (new RegExp(`^/${locale}/(?:login|register)(?:/|$)`).test(pathname)) return null;
  const intendedDestination = `${pathname}${location.search ?? ""}${location.hash ?? ""}`;
  return `/${locale}/login?sessionExpired=1&redirectTo=${encodeURIComponent(intendedDestination)}`;
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
  const [isResolving, setIsResolving] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef<Promise<CanonicalSessionRefreshResult> | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const hadAuthenticatedSessionRef = useRef(Boolean(initialSessionUser));
  const expiryRedirectStartedRef = useRef(false);
  const localeSyncRef = useRef<string | null>(null);
  const canonicalUserId = user?.id;
  const canonicalPreferredLocale = user?.preferredLocale;

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (force) {
      // An auth boundary changed while a request may still be in flight. Its
      // result is no longer authoritative, so sequence a fresh canonical read.
      requestIdRef.current += 1;
      requestRef.current = null;
    }
    if (requestRef.current) return requestRef.current;
    const requestId = ++requestIdRef.current;
    const request = (async () => {
      setIsResolving(true);
      setError(false);
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        const payload = (await response.json().catch(() => null)) as { user?: ClientSessionUser | null } | null;
        if (!response.ok) {
          const result: CanonicalSessionRefreshResult = response.status === 401 || response.status === 403 ? "anonymous" : "unavailable";
          if (mountedRef.current && requestId === requestIdRef.current) {
            setUser(null);
            setError(result === "unavailable");
          }
          return result;
        }
        if (!payload || !("user" in payload)) throw new Error("Unable to refresh account status.");
        const result: CanonicalSessionRefreshResult = payload.user ? "authenticated" : "anonymous";
        if (mountedRef.current && requestId === requestIdRef.current) {
          setUser(payload.user ?? null);
          setError(false);
        }
        return result;
      } catch {
        if (mountedRef.current && requestId === requestIdRef.current) {
          // A bootstrap snapshot is never authoritative after the canonical
          // read fails. Hide privileged UI until the server can confirm it.
          setUser(null);
          setError(true);
        }
        return "unavailable" as const;
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) setIsResolving(false);
      }
    })();
    requestRef.current = request;
    try {
      return await request;
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const handleAuthChange = () => void refresh({ force: true });
    const handleSignedOut = () => {
      hadAuthenticatedSessionRef.current = false;
      expiryRedirectStartedRef.current = true;
      requestIdRef.current += 1;
      requestRef.current = null;
      setUser(null);
      setError(false);
      setIsResolving(false);
    };
    window.addEventListener("alpha-auth-changed", handleAuthChange);
    window.addEventListener("alpha-auth-signed-out", handleSignedOut);
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      window.removeEventListener("alpha-auth-changed", handleAuthChange);
      window.removeEventListener("alpha-auth-signed-out", handleSignedOut);
    };
  }, [refresh]);

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
    if (user) {
      hadAuthenticatedSessionRef.current = true;
      expiryRedirectStartedRef.current = false;
      return;
    }
    if (isResolving || error || !hadAuthenticatedSessionRef.current || expiryRedirectStartedRef.current) return;
    const destination = getSessionExpiryLoginDestination(window.location);
    if (!destination) return;
    expiryRedirectStartedRef.current = true;
    window.location.replace(destination);
  }, [error, isResolving, user]);

  return <CanonicalSessionContext.Provider value={{ user, isResolving, error, refresh }}>{children}</CanonicalSessionContext.Provider>;
}

export function useCanonicalSession() {
  const value = useContext(CanonicalSessionContext);
  if (!value) throw new Error("useCanonicalSession must be used within CanonicalSessionProvider.");
  return value;
}

export function useOptionalCanonicalSession() {
  return useContext(CanonicalSessionContext);
}
