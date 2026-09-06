import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { MobileAuthTokens, MobileLocale, MobileSessionUser } from "@alpha-traders/contracts";
import {
  MobileApiError,
  getMobileMe,
  loginMobile,
  logoutMobile,
  refreshMobile,
} from "../api/mobile-api";
import {
  clearStoredTokens,
  initializeSecureStorageForInstall,
  loadStoredTokens,
  saveStoredTokens,
} from "./session-storage";
import { useLocale } from "../i18n/locale-context";

type AuthStatus = "booting" | "anonymous" | "authenticated" | "unavailable";
type AuthenticatedRequest = <T>(operation: (tokens: MobileAuthTokens, locale: MobileLocale) => Promise<T>) => Promise<T>;

type AuthContextValue = {
  status: AuthStatus;
  user: MobileSessionUser | null;
  isBusy: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: (scope?: "device" | "all") => Promise<void>;
  refreshSession: () => Promise<MobileAuthTokens | null>;
  retryBootstrap: () => Promise<void>;
  requestWithSession: AuthenticatedRequest;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function canRefresh(error: unknown) {
  return error instanceof MobileApiError
    && (error.code === "SESSION_EXPIRED" || error.code === "UNAUTHORIZED");
}

function shouldDiscardSession(error: unknown) {
  return error instanceof MobileApiError
    && (
      error.code === "UNAUTHORIZED"
      || error.code === "SESSION_EXPIRED"
      || error.code === "SESSION_REVOKED"
      || error.code === "REFRESH_TOKEN_REUSED"
      || error.code === "ACCOUNT_DISABLED"
    );
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { locale, isHydrated } = useLocale();
  const localeRef = useRef(locale);
  const tokensRef = useRef<MobileAuthTokens | null>(null);
  const bootStarted = useRef(false);
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [user, setUser] = useState<MobileSessionUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const storeTokens = useCallback(async (tokens: MobileAuthTokens | null) => {
    tokensRef.current = tokens;
    if (tokens) await saveStoredTokens(tokens);
    else await clearStoredTokens();
  }, []);

  const discardSession = useCallback(async () => {
    try {
      await storeTokens(null);
    } catch {
      tokensRef.current = null;
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }, [storeTokens]);

  const refreshSession = useCallback(async () => {
    const current = tokensRef.current;
    if (!current) return null;
    try {
      const refreshed = await refreshMobile(current, localeRef.current);
      await storeTokens(refreshed.tokens);
      return refreshed.tokens;
    } catch (error) {
      if (shouldDiscardSession(error)) {
        await discardSession();
        return null;
      }
      throw error;
    }
  }, [discardSession, storeTokens]);

  const requestWithSession = useCallback<AuthenticatedRequest>(async (operation) => {
    const current = tokensRef.current;
    if (!current) {
      throw new MobileApiError("Please sign in to continue.", "UNAUTHORIZED", 401);
    }
    try {
      return await operation(current, localeRef.current);
    } catch (error) {
      if (shouldDiscardSession(error) && !canRefresh(error)) {
        await discardSession();
        throw error;
      }
      if (!canRefresh(error)) throw error;
    }

    try {
      const refreshed = await refreshMobile(current, localeRef.current);
      await storeTokens(refreshed.tokens);
      return await operation(refreshed.tokens, localeRef.current);
    } catch (error) {
      if (shouldDiscardSession(error)) await discardSession();
      throw error;
    }
  }, [discardSession, storeTokens]);

  const bootstrapSession = useCallback(async () => {
    setStatus("booting");
    try {
      await initializeSecureStorageForInstall();
      let tokens = await loadStoredTokens();
      if (!tokens) {
        tokensRef.current = null;
        setUser(null);
        setStatus("anonymous");
        return;
      }
      tokensRef.current = tokens;
      try {
        const response = await getMobileMe(tokens, localeRef.current);
        setUser(response.user);
        setStatus("authenticated");
        return;
      } catch (error) {
        if (!canRefresh(error)) throw error;
      }
      const refreshed = await refreshMobile(tokens, localeRef.current);
      tokens = refreshed.tokens;
      await storeTokens(tokens);
      const response = await getMobileMe(tokens, localeRef.current);
      setUser(response.user);
      setStatus("authenticated");
    } catch (error) {
      setUser(null);
      if (shouldDiscardSession(error)) {
        await discardSession();
        return;
      }
      // A transient API or secure-storage outage must not destroy a valid
      // device session. The recovery screen lets the user retry in place.
      setStatus("unavailable");
    }
  }, [discardSession, storeTokens]);

  useEffect(() => {
    if (!isHydrated || bootStarted.current) return;
    bootStarted.current = true;
    void bootstrapSession();
  }, [bootstrapSession, isHydrated]);

  const login = useCallback(async (email: string, password: string) => {
    setIsBusy(true);
    try {
      const response = await loginMobile(email.trim().toLowerCase(), password, localeRef.current);
      await storeTokens(response.tokens);
      setUser(response.user);
      setStatus("authenticated");
    } finally {
      setIsBusy(false);
    }
  }, [storeTokens]);

  const logout = useCallback(async (scope: "device" | "all" = "device") => {
    setIsBusy(true);
    const current = tokensRef.current;
    try {
      if (current) {
        try {
          await logoutMobile(current, localeRef.current, scope);
        } catch (error) {
          if (canRefresh(error)) {
            const refreshed = await refreshMobile(current, localeRef.current);
            await logoutMobile(refreshed.tokens, localeRef.current, scope);
          }
        }
      }
    } finally {
      await discardSession();
      setIsBusy(false);
    }
  }, [discardSession]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    isBusy,
    login,
    logout,
    refreshSession,
    retryBootstrap: bootstrapSession,
    requestWithSession,
  }), [bootstrapSession, isBusy, login, logout, refreshSession, requestWithSession, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
