import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import type { MobileAuthTokens, MobileSessionUser } from "@alpha-traders/contracts";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  initialize: vi.fn(),
  loadTokens: vi.fn(),
  saveTokens: vi.fn(),
  clearTokens: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: mocks.getItem, setItem: mocks.setItem },
}));
vi.mock("./session-storage", () => ({
  initializeSecureStorageForInstall: mocks.initialize,
  loadStoredTokens: mocks.loadTokens,
  saveStoredTokens: mocks.saveTokens,
  clearStoredTokens: mocks.clearTokens,
}));
vi.mock("../api/mobile-api", () => ({
  MobileApiError: class MobileApiError extends Error {
    constructor(message: string, public code: string, public status: number) { super(message); }
  },
  getMobileMe: mocks.getMe,
  loginMobile: mocks.login,
  logoutMobile: mocks.logout,
  refreshMobile: mocks.refresh,
}));

import { AuthProvider, useAuth } from "./auth-context";
import { LocaleProvider, useLocale } from "../i18n/locale-context";
import { MobileApiError } from "../api/mobile-api";

const tokens: MobileAuthTokens = {
  tokenType: "Bearer",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  accessTokenExpiresAt: "2030-01-01T00:00:00Z",
  refreshTokenExpiresAt: "2030-02-01T00:00:00Z",
  expiresIn: 900,
};
const user = { id: "test-user", preferredLocale: "ar" } as MobileSessionUser;

function Wrapper({ children }: PropsWithChildren) {
  return <LocaleProvider><AuthProvider>{children}</AuthProvider></LocaleProvider>;
}
function useSession() { return { auth: useAuth(), language: useLocale() }; }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getItem.mockResolvedValue(null);
  mocks.setItem.mockResolvedValue(undefined);
  mocks.initialize.mockResolvedValue(undefined);
  mocks.loadTokens.mockResolvedValue(null);
  mocks.saveTokens.mockResolvedValue(undefined);
  mocks.clearTokens.mockResolvedValue(undefined);
  mocks.getMe.mockResolvedValue({ user });
  mocks.login.mockResolvedValue({ user, tokens });
  mocks.logout.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue({ user, tokens });
});
afterEach(cleanup);

describe("native session language", () => {
  it("starts in English and a new login resets an earlier Arabic selection immediately", async () => {
    const { result } = renderHook(useSession, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.auth.status).toBe("anonymous"));
    expect(result.current.language.locale).toBe("en");
    await act(() => result.current.language.setLocale("ar"));
    expect(result.current.language.locale).toBe("ar");
    // Locale persistence may be unavailable; it must not hold up sign-in.
    mocks.setItem.mockImplementation(() => new Promise(() => undefined));
    await act(() => result.current.auth.login("test@example.com", "not-a-real-password"));
    expect(result.current.auth.status).toBe("authenticated");
    expect(result.current.language.locale).toBe("en");
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.getMe).not.toHaveBeenCalled();
  });

  it("keeps Arabic across requests, token refresh, and reopening the same stored session", async () => {
    mocks.getItem.mockResolvedValue("ar");
    mocks.loadTokens.mockResolvedValue(tokens);
    const { result } = renderHook(useSession, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.auth.status).toBe("authenticated"));
    expect(result.current.language.locale).toBe("ar");
    const operation = vi.fn().mockResolvedValue("ok");
    await act(() => result.current.auth.requestWithSession(operation));
    expect(operation).toHaveBeenCalledWith(tokens, "ar");
    await act(() => result.current.auth.refreshSession());
    expect(result.current.language.locale).toBe("ar");
    expect(mocks.refresh).toHaveBeenCalledWith(tokens, "ar");
  });

  it("resets Arabic on logout even when the logout API is unavailable", async () => {
    mocks.getItem.mockResolvedValue("ar");
    mocks.loadTokens.mockResolvedValue(tokens);
    mocks.logout.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(useSession, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.auth.status).toBe("authenticated"));
    await act(() => result.current.auth.logout());
    expect(result.current.auth.status).toBe("anonymous");
    expect(result.current.language.locale).toBe("en");
    expect(mocks.clearTokens).toHaveBeenCalled();
    expect(mocks.setItem).toHaveBeenLastCalledWith("alpha.mobile.session-locale.v2", "en");
    await act(() => result.current.auth.login("test@example.com", "not-a-real-password"));
    expect(result.current.language.locale).toBe("en");
  });

  it("resets missing or revoked sessions but preserves language during a transient outage", async () => {
    mocks.getItem.mockResolvedValue("ar");
    const first = renderHook(useSession, { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.auth.status).toBe("anonymous"));
    expect(first.result.current.language.locale).toBe("en");
    first.unmount();

    mocks.loadTokens.mockResolvedValue(tokens);
    mocks.getMe.mockRejectedValue(new Error("temporary outage"));
    const second = renderHook(useSession, { wrapper: Wrapper });
    await waitFor(() => expect(second.result.current.auth.status).toBe("unavailable"));
    expect(second.result.current.language.locale).toBe("ar");
    mocks.getMe.mockRejectedValue(new MobileApiError("Revoked", "SESSION_REVOKED", 401));
    await act(() => second.result.current.auth.retryBootstrap());
    expect(second.result.current.auth.status).toBe("anonymous");
    expect(second.result.current.language.locale).toBe("en");
  });

  it.each(["NETWORK_RESTRICTED", "NETWORK_CHECK_UNAVAILABLE"] as const)("preserves the saved session and recovers after %s", async (code) => {
    mocks.getItem.mockResolvedValue("ar");
    mocks.loadTokens.mockResolvedValue(tokens);
    mocks.getMe.mockRejectedValueOnce(new MobileApiError("Check your connection", code, code === "NETWORK_RESTRICTED" ? 403 : 503));
    const { result } = renderHook(useSession, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.auth.status).toBe("unavailable"));
    expect(mocks.clearTokens).not.toHaveBeenCalled();
    expect(result.current.language.locale).toBe("ar");
    await act(() => result.current.auth.retryBootstrap());
    expect(result.current.auth.status).toBe("authenticated");
    expect(result.current.language.locale).toBe("ar");
  });
});
