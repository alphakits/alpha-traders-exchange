import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import type { WebViewProps } from "react-native-webview";
import type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  loadTokens: vi.fn(),
  props: null as WebViewProps | null,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: mocks.getItem, setItem: mocks.setItem },
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => children,
  ActivityIndicator: () => null,
  Image: () => null,
  Pressable: ({ children }: PropsWithChildren) => children,
  AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
  Linking: {},
  Platform: { OS: "ios" },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("./branded-text", () => ({ BrandedText: ({ children }: PropsWithChildren) => children }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: PropsWithChildren) => children }));
vi.mock("react-native-webview", () => ({ default: (props: WebViewProps) => { mocks.props = props; return null; } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.2.0" } } }));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("expo-notifications", () => ({
  getLastNotificationResponse: () => null,
  addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
  addPushTokenListener: () => ({ remove: vi.fn() }),
  setBadgeCountAsync: () => Promise.resolve(),
}));
vi.mock("../api/mobile-api", () => ({ MobileApiError: class extends Error {}, refreshMobile: vi.fn() }));
vi.mock("../auth/session-storage", () => ({
  loadStoredTokens: mocks.loadTokens,
  saveStoredTokens: vi.fn(), clearStoredTokens: vi.fn(), getOrCreateDeviceId: vi.fn(),
}));
vi.mock("../notifications/native-notifications", () => ({
  registerForNativePushNotifications: () => Promise.resolve({ status: "unavailable" }),
  requestAppReviewAfterCompletedTrade: vi.fn(),
  reviewReferenceFromPushData: () => null,
  trustedPushWebsiteUrl: () => null,
}));
vi.mock("../network/network-context", () => ({ useNetworkStatus: () => ({ isOnline: true }) }));
vi.mock("../readiness/use-mobile-app-readiness", () => ({ useMobileAppReadiness: () => ({ status: "ready" }) }));

import { WebsiteAppShell } from "./website-app-shell";
import { WEBSITE_SESSION_LOCALE_KEY } from "../web/website-session-language";

const origin = "https://www.alphatraders.co.il";
const resumeKey = "alpha.mobile.website.resume-url.v1";
function sessionEvent(authenticated: boolean, locale: "ar" | "en", url = `${origin}/${locale}`) {
  return { nativeEvent: { url, data: JSON.stringify({
    type: "alpha.web.session", version: 1, authenticated, locale,
    ...(authenticated ? { userId: "test-user" } : {}),
  }) } } as WebViewMessageEvent;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.values.clear();
  mocks.props = null;
  mocks.values.set("alpha.mobile.website.session-migrated.v1", "1");
  mocks.getItem.mockImplementation(async (key: string) => mocks.values.get(key) ?? null);
  mocks.setItem.mockImplementation(async (key: string, value: string) => { mocks.values.set(key, value); });
});
afterEach(cleanup);

describe("active mobile website shell language", () => {
  it("ignores the old Arabic device preference and resumes the destination in English", async () => {
    mocks.values.set("alpha.mobile.locale.v1", "ar");
    mocks.values.set(resumeKey, `${origin}/ar/trades?filter=completed#history`);
    render(<WebsiteAppShell />);
    await waitFor(() => expect(mocks.props?.source).toEqual({ uri: `${origin}/en/trades?filter=completed#history` }));
    expect(mocks.loadTokens).not.toHaveBeenCalled();
  });

  it("retains an authenticated Arabic choice on reopen, then resets it on logout", async () => {
    const first = render(<WebsiteAppShell />);
    await waitFor(() => expect(mocks.props).not.toBeNull());
    await act(async () => mocks.props?.onMessage?.(sessionEvent(true, "ar")));
    act(() => mocks.props?.onNavigationStateChange?.({
      url: `${origin}/ar/usdt-exchange#commission-status`, canGoBack: false,
    } as WebViewNavigation));
    expect(mocks.values.get(WEBSITE_SESSION_LOCALE_KEY)).toBe("ar");
    first.unmount();
    mocks.props = null;
    const second = render(<WebsiteAppShell />);
    await waitFor(() => expect(mocks.props?.source).toEqual({ uri: `${origin}/ar/usdt-exchange#commission-status` }));
    await act(async () => mocks.props?.onMessage?.(sessionEvent(false, "ar")));
    expect(mocks.values.get(WEBSITE_SESSION_LOCALE_KEY)).toBe("en");
    // A late navigation event from the old document must not restore Arabic.
    act(() => mocks.props?.onNavigationStateChange?.({
      url: `${origin}/ar/usdt-exchange`, canGoBack: true,
    } as WebViewNavigation));
    expect(mocks.values.get(WEBSITE_SESSION_LOCALE_KEY)).toBe("en");
    second.unmount();
    mocks.props = null;
    render(<WebsiteAppShell />);
    await waitFor(() => expect(mocks.props?.source).toEqual({ uri: `${origin}/en/usdt-exchange` }));
  });

  it("does not allow external documents or ordinary Arabic navigation to persist a session choice", async () => {
    render(<WebsiteAppShell />);
    await waitFor(() => expect(mocks.props).not.toBeNull());
    await act(async () => mocks.props?.onMessage?.(sessionEvent(true, "ar", "https://attacker.example/ar")));
    act(() => mocks.props?.onNavigationStateChange?.({
      url: `${origin}/ar/login`, canGoBack: false,
    } as WebViewNavigation));
    expect(mocks.values.has(WEBSITE_SESSION_LOCALE_KEY)).toBe(false);
  });
});
