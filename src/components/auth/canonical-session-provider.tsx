"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientSessionUser } from "@/lib/client-session-user";

type CanonicalSessionContextValue = {
  user: ClientSessionUser | null;
  isResolving: boolean;
  error: boolean;
  refresh: (options?: { force?: boolean }) => Promise<void>;
};

const CanonicalSessionContext = createContext<CanonicalSessionContextValue | null>(null);
export function CanonicalSessionProvider({ children, initialSessionUser }: { children: ReactNode; initialSessionUser: ClientSessionUser | null }) {
  const [user, setUser] = useState<ClientSessionUser | null>(initialSessionUser);
  const [isResolving, setIsResolving] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef<Promise<void> | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

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
        if (!response.ok || !payload || !("user" in payload)) throw new Error("Unable to refresh account status.");
        if (mountedRef.current && requestId === requestIdRef.current) {
          setUser(payload.user ?? null);
          setError(false);
        }
      } catch {
        if (mountedRef.current && requestId === requestIdRef.current) setError(true);
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) setIsResolving(false);
      }
    })();
    requestRef.current = request;
    try {
      await request;
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const handleAuthChange = () => void refresh({ force: true });
    window.addEventListener("alpha-auth-changed", handleAuthChange);
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      window.removeEventListener("alpha-auth-changed", handleAuthChange);
    };
  }, [refresh]);

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
