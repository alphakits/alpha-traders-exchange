import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getLocales } from "expo-localization";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import type {
  FileDownloadEvent,
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigation,
  WebViewNavigationEvent,
  WebViewMessageEvent,
  WebViewOpenWindowEvent,
} from "react-native-webview/lib/WebViewTypes";
import {
  MOBILE_CURRENT_APP_VERSION,
  parseWebToNativeBridgeMessage,
  type MobileAuthTokens,
  type MobileLocale,
  type NativeToWebBridgeMessage,
} from "@alpha-traders/contracts";
import { MobileApiError, refreshMobile } from "../api/mobile-api";
import {
  clearStoredTokens,
  getOrCreateDeviceId,
  loadStoredTokens,
  saveStoredTokens,
} from "../auth/session-storage";
import {
  ALPHA_TRADERS_WEB_ORIGIN,
  trustedWebsiteResumeUrl,
  trustedWebsiteReturnPath,
  websiteNavigationDecision,
} from "../web/website-navigation";
import {
  registerForNativePushNotifications,
  requestAppReviewAfterCompletedTrade,
  reviewReferenceFromPushData,
  trustedPushWebsiteUrl,
} from "../notifications/native-notifications";

const LEGACY_LOCALE_KEY = "alpha.mobile.locale.v1";
const RESUME_URL_KEY = "alpha.mobile.website.resume-url.v1";
const SESSION_MIGRATED_KEY = "alpha.mobile.website.session-migrated.v1";

type WebSource = {
  uri: string;
  headers?: Record<string, string>;
};

type WebsiteAppShellProps = {
  onNativeReady?: () => void;
};

function inferredLocale(): MobileLocale {
  return getLocales()[0]?.languageCode === "ar" ? "ar" : "en";
}

function clientPlatform() {
  return Platform.OS === "ios" ? "ios" : "android";
}

function appVersion() {
  return Constants.expoConfig?.version ?? MOBILE_CURRENT_APP_VERSION;
}

async function resolvedLocale() {
  const stored = await AsyncStorage.getItem(LEGACY_LOCALE_KEY);
  return stored === "ar" || stored === "en" ? stored : inferredLocale();
}

async function currentNativeTokens(locale: MobileLocale): Promise<MobileAuthTokens | null> {
  let tokens = await loadStoredTokens();
  if (!tokens) return null;
  if (new Date(tokens.accessTokenExpiresAt).getTime() > Date.now() + 60_000) return tokens;

  try {
    const refreshed = await refreshMobile(tokens, locale);
    tokens = refreshed.tokens;
    await saveStoredTokens(tokens);
    return tokens;
  } catch (error) {
    if (
      error instanceof MobileApiError
      && ["UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "REFRESH_TOKEN_REUSED"].includes(error.code)
    ) {
      await clearStoredTokens();
    }
    return null;
  }
}

async function createInitialSource(): Promise<{ locale: MobileLocale; source: WebSource }> {
  const locale = await resolvedLocale();
  const savedUrl = trustedWebsiteResumeUrl(await AsyncStorage.getItem(RESUME_URL_KEY), locale);
  const migrationComplete = await AsyncStorage.getItem(SESSION_MIGRATED_KEY) === "1";
  if (migrationComplete) return { locale, source: { uri: savedUrl } };

  const tokens = await currentNativeTokens(locale);
  if (!tokens) return { locale, source: { uri: savedUrl } };

  const deviceId = await getOrCreateDeviceId();
  const returnPath = trustedWebsiteReturnPath(savedUrl) ?? `/${locale}`;
  const migrationUrl = new URL("/api/mobile/v1/auth/web-session", ALPHA_TRADERS_WEB_ORIGIN);
  migrationUrl.searchParams.set("locale", locale);
  migrationUrl.searchParams.set("returnTo", returnPath);
  return {
    locale,
    source: {
      uri: migrationUrl.toString(),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": locale,
        Authorization: `Bearer ${tokens.accessToken}`,
        "X-App-Version": appVersion(),
        "X-Device-Id": deviceId,
        "X-Locale": locale,
        "X-Platform": clientPlatform(),
      },
    },
  };
}

function copy(locale: MobileLocale) {
  return locale === "ar"
    ? {
        errorTitle: "تعذر فتح Alpha Traders",
        errorBody: "تحقق من اتصال الإنترنت ثم حاول مرة أخرى.",
        retry: "إعادة المحاولة",
        openWebsite: "فتح الموقع",
      }
    : {
        errorTitle: "Alpha Traders could not open",
        errorBody: "Check your internet connection and try again.",
        retry: "Try again",
        openWebsite: "Open website",
      };
}

export function WebsiteAppShell({ onNativeReady }: WebsiteAppShellProps) {
  const webViewRef = useRef<WebView>(null);
  const readyReported = useRef(false);
  const hasLoadedContentRef = useRef(false);
  const loadErrorRef = useRef(false);
  const localeRef = useRef<MobileLocale>(inferredLocale());
  const activeSessionRef = useRef<{ userId: string; locale: MobileLocale } | null>(null);
  const pendingBadgeRef = useRef<{ userId: string; unreadCount: number } | null>(null);
  const pendingReviewRef = useRef<string | null>(null);
  const pendingPushUrlRef = useRef<string | null>(null);
  const pushRegistrationKeyRef = useRef<string | null>(null);
  const pushRegistrationResultRef = useRef<NativeToWebBridgeMessage | null>(null);
  const pushRegistrationInFlightRef = useRef<Promise<void> | null>(null);
  const [source, setSource] = useState<WebSource | null>(null);
  const [locale, setLocale] = useState<MobileLocale>(inferredLocale);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const labels = useMemo(() => copy(locale), [locale]);

  const reportNativeReady = useCallback(() => {
    if (readyReported.current) return;
    readyReported.current = true;
    onNativeReady?.();
  }, [onNativeReady]);

  const prepare = useCallback(async () => {
    hasLoadedContentRef.current = false;
    loadErrorRef.current = false;
    setLoadFailed(false);
    setIsLoading(true);
    try {
      const initial = await createInitialSource();
      localeRef.current = initial.locale;
      setLocale(initial.locale);
      setSource(pendingPushUrlRef.current ? { uri: pendingPushUrlRef.current } : initial.source);
    } catch {
      const fallbackLocale = inferredLocale();
      localeRef.current = fallbackLocale;
      setLocale(fallbackLocale);
      setSource({ uri: pendingPushUrlRef.current ?? `${ALPHA_TRADERS_WEB_ORIGIN}/${fallbackLocale}` });
    }
  }, []);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  const sendMessageToWebsite = useCallback((message: unknown) => {
    try {
      webViewRef.current?.postMessage(JSON.stringify(message));
    } catch {
      // A navigation may replace the document while a native task is ending.
      // The next authenticated session signal safely retries registration.
    }
  }, []);

  const ensurePushRegistration = useCallback((userId: string, nextLocale: MobileLocale) => {
    const key = `${userId}:${nextLocale}`;
    if (pushRegistrationKeyRef.current === key) {
      if (pushRegistrationResultRef.current) {
        sendMessageToWebsite(pushRegistrationResultRef.current);
      }
      return;
    }
    if (pushRegistrationInFlightRef.current) return;
    const task = (async () => {
      const result = await registerForNativePushNotifications(nextLocale);
      if (activeSessionRef.current?.userId !== userId) return;
      if (result.status === "registered") {
        pushRegistrationKeyRef.current = key;
        pushRegistrationResultRef.current = result;
      }
      sendMessageToWebsite(result);
    })();
    pushRegistrationInFlightRef.current = task;
    void task.finally(() => {
      if (pushRegistrationInFlightRef.current === task) {
        pushRegistrationInFlightRef.current = null;
      }
    });
  }, [sendMessageToWebsite]);

  const attemptPendingReview = useCallback(() => {
    const session = activeSessionRef.current;
    const tradeReference = pendingReviewRef.current;
    if (!session || !tradeReference || AppState.currentState !== "active") return;
    pendingReviewRef.current = null;
    void requestAppReviewAfterCompletedTrade({
      userId: session.userId,
      tradeReference,
    });
  }, []);

  const openPushDestination = useCallback((data: unknown) => {
    const target = trustedPushWebsiteUrl(data, localeRef.current);
    if (target) {
      pendingPushUrlRef.current = target;
      loadErrorRef.current = false;
      setLoadFailed(false);
      setIsLoading(!hasLoadedContentRef.current);
      setSource({ uri: target });
    }
    const reviewReference = reviewReferenceFromPushData(data);
    if (reviewReference) {
      pendingReviewRef.current = reviewReference;
      attemptPendingReview();
    }
  }, [attemptPendingReview]);

  useEffect(() => {
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse?.notification) {
      openPushDestination(lastResponse.notification.request.content.data);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openPushDestination(response.notification.request.content.data);
    });
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const reviewReference = reviewReferenceFromPushData(notification.request.content.data);
      if (!reviewReference) return;
      pendingReviewRef.current = reviewReference;
      attemptPendingReview();
    });
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      pushRegistrationKeyRef.current = null;
      pushRegistrationResultRef.current = null;
      const session = activeSessionRef.current;
      if (session) ensurePushRegistration(session.userId, session.locale);
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const session = activeSessionRef.current;
      if (session) ensurePushRegistration(session.userId, session.locale);
      attemptPendingReview();
    });
    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [attemptPendingReview, ensurePushRegistration, openPushDestination]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const openExternally = useCallback((url: string) => {
    void Linking.canOpenURL(url)
      .then((supported) => supported ? Linking.openURL(url) : undefined)
      .catch(() => undefined);
  }, []);

  const shouldStart = useCallback((request: ShouldStartLoadRequest) => {
    const decision = websiteNavigationDecision(request.url);
    if (!request.isTopFrame) return decision !== "block";
    if (decision === "allow") return true;
    if (decision === "external") openExternally(request.url);
    return false;
  }, [openExternally]);

  const rememberNavigation = useCallback((navigation: WebViewNavigation) => {
    const { url, canGoBack: nextCanGoBack } = navigation;
    setCanGoBack(nextCanGoBack);
    const resumeUrl = trustedWebsiteReturnPath(url);
    if (!resumeUrl) return;
    const nextLocale: MobileLocale = resumeUrl.startsWith("/ar") ? "ar" : "en";
    localeRef.current = nextLocale;
    setLocale(nextLocale);
    void Promise.all([
      AsyncStorage.setItem(RESUME_URL_KEY, `${ALPHA_TRADERS_WEB_ORIGIN}${resumeUrl}`),
      AsyncStorage.setItem(LEGACY_LOCALE_KEY, nextLocale),
      AsyncStorage.setItem(SESSION_MIGRATED_KEY, "1"),
    ]);
  }, []);

  const handleWebsiteMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseWebToNativeBridgeMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "alpha.web.session") {
      if (!message.authenticated) {
        activeSessionRef.current = null;
        pendingBadgeRef.current = null;
        pushRegistrationKeyRef.current = null;
        pushRegistrationResultRef.current = null;
        pendingReviewRef.current = null;
        void Notifications.setBadgeCountAsync(0).catch(() => undefined);
        return;
      }
      activeSessionRef.current = { userId: message.userId, locale: message.locale };
      if (pendingBadgeRef.current?.userId === message.userId) {
        void Notifications.setBadgeCountAsync(pendingBadgeRef.current.unreadCount).catch(() => undefined);
      }
      pendingBadgeRef.current = null;
      ensurePushRegistration(message.userId, message.locale);
      attemptPendingReview();
      return;
    }
    if (
      message.type === "alpha.web.notification-count"
      && activeSessionRef.current?.userId === message.userId
    ) {
      void Notifications.setBadgeCountAsync(message.unreadCount).catch(() => undefined);
      return;
    }
    if (message.type === "alpha.web.notification-count" && !activeSessionRef.current) {
      pendingBadgeRef.current = {
        userId: message.userId,
        unreadCount: message.unreadCount,
      };
      return;
    }
    if (
      message.type === "alpha.web.trade-completed"
      && activeSessionRef.current?.userId === message.userId
    ) {
      pendingReviewRef.current = message.tradeReference;
      attemptPendingReview();
    }
  }, [attemptPendingReview, ensurePushRegistration]);

  const completeLoad = useCallback((event: WebViewNavigationEvent | WebViewErrorEvent) => {
    if (loadErrorRef.current || "description" in event.nativeEvent) {
      hasLoadedContentRef.current = false;
      loadErrorRef.current = true;
      setLoadFailed(true);
      setIsLoading(false);
      reportNativeReady();
      return;
    }
    hasLoadedContentRef.current = true;
    rememberNavigation(event.nativeEvent);
    setLoadFailed(false);
    setIsLoading(false);
    reportNativeReady();
  }, [rememberNavigation, reportNativeReady]);

  const failLoad = useCallback(() => {
    hasLoadedContentRef.current = false;
    loadErrorRef.current = true;
    setIsLoading(false);
    setLoadFailed(true);
    reportNativeReady();
  }, [reportNativeReady]);

  const handleHttpError = useCallback((event: WebViewHttpErrorEvent) => {
    try {
      const failedUrl = new URL(event.nativeEvent.url);
      if (failedUrl.pathname !== "/api/mobile/v1/auth/web-session") return;
      loadErrorRef.current = true;
      hasLoadedContentRef.current = false;
      setLoadFailed(false);
      setIsLoading(true);
      setSource({ uri: `${ALPHA_TRADERS_WEB_ORIGIN}/${locale}` });
    } catch {
      // The website remains responsible for rendering ordinary HTTP errors.
    }
  }, [locale]);

  const openWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const targetUrl = event.nativeEvent.targetUrl;
    const decision = websiteNavigationDecision(targetUrl);
    if (decision === "allow") {
      loadErrorRef.current = false;
      setLoadFailed(false);
      setIsLoading(!hasLoadedContentRef.current);
      setSource({ uri: targetUrl });
      return;
    }
    if (decision === "external") openExternally(targetUrl);
  }, [openExternally]);

  const downloadFile = useCallback((event: FileDownloadEvent) => {
    openExternally(event.nativeEvent.downloadUrl);
  }, [openExternally]);

  const retry = useCallback(() => {
    hasLoadedContentRef.current = false;
    loadErrorRef.current = false;
    setLoadFailed(false);
    setIsLoading(true);
    if (webViewRef.current) webViewRef.current.reload();
    else void prepare();
  }, [prepare]);

  const recoverWebProcess = useCallback(() => {
    hasLoadedContentRef.current = false;
    loadErrorRef.current = false;
    setLoadFailed(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  }, []);

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      {source ? (
        <WebView
          ref={webViewRef}
          source={source}
          style={styles.webView}
          originWhitelist={["https://*", "about:*", "blob:*", "data:*"]}
          onShouldStartLoadWithRequest={shouldStart}
          onNavigationStateChange={rememberNavigation}
          onLoadStart={() => {
            loadErrorRef.current = false;
            setLoadFailed(false);
            if (!hasLoadedContentRef.current) setIsLoading(true);
          }}
          onLoadEnd={completeLoad}
          onError={failLoad}
          onHttpError={handleHttpError}
          onOpenWindow={openWindow}
          onFileDownload={downloadFile}
          onMessage={handleWebsiteMessage}
          onContentProcessDidTerminate={recoverWebProcess}
          onRenderProcessGone={() => {
            recoverWebProcess();
            return true;
          }}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          contentInsetAdjustmentBehavior="never"
          domStorageEnabled
          javaScriptCanOpenWindowsAutomatically
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
        />
      ) : null}

      {isLoading && !loadFailed ? (
        <View accessibilityLabel={locale === "ar" ? "جارٍ تحميل Alpha Traders" : "Loading Alpha Traders"} accessibilityRole="progressbar" style={styles.loadingOverlay}>
          <ActivityIndicator color="#D4AF37" size="large" />
        </View>
      ) : null}

      {loadFailed ? (
        <View accessibilityRole="alert" style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>{labels.errorTitle}</Text>
          <Text style={styles.errorBody}>{labels.errorBody}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{labels.retry}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => openExternally(`${ALPHA_TRADERS_WEB_ORIGIN}/${locale}`)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{labels.openWebsite}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#050505",
    flex: 1,
  },
  webView: {
    backgroundColor: "#050505",
    flex: 1,
  },
  loadingOverlay: {
    alignItems: "center",
    backgroundColor: "#050505",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  errorOverlay: {
    alignItems: "stretch",
    backgroundColor: "#050505",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: 28,
    position: "absolute",
    right: 0,
    top: 0,
  },
  errorTitle: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "800",
    textAlign: "center",
  },
  errorBody: {
    color: "#B4BDC9",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
    marginTop: 10,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#D4AF37",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: "#050505",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "rgba(201, 162, 39, 0.55)",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 20,
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
