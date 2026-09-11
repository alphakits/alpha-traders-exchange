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
  Image,
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
import brandLogo from "../../../../public/images/brand/alpha-traders-app-icon-1024.png";
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
  isTrustedWebsiteDocumentUrl,
  trustedWebsiteResumeUrl,
  trustedWebsiteReturnPath,
  websiteNavigationDecision,
} from "../web/website-navigation";
import {
  pendingPushUrlAfterConsumption,
  resolvePreparedWebsiteSource,
  type WebsiteSource,
} from "../web/push-navigation-recovery";
import {
  registerForNativePushNotifications,
  requestAppReviewAfterCompletedTrade,
  reviewReferenceFromPushData,
  trustedPushWebsiteUrl,
} from "../notifications/native-notifications";
import {
  pushSetupIssueFromRegistrationStatus,
  pushSetupRecoveryCopy,
  type PushSetupIssue,
} from "../notifications/push-registration-recovery";
import { useNetworkStatus } from "../network/network-context";
import { useMobileAppReadiness } from "../readiness/use-mobile-app-readiness";

const LEGACY_LOCALE_KEY = "alpha.mobile.locale.v1";
const RESUME_URL_KEY = "alpha.mobile.website.resume-url.v1";
const SESSION_MIGRATED_KEY = "alpha.mobile.website.session-migrated.v1";

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

async function createInitialSource(): Promise<{ locale: MobileLocale; source: WebsiteSource }> {
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
        offline: "أنت غير متصل. سيعرض Alpha Traders أي محتوى محفوظ مؤقتًا وسيعيد الاتصال تلقائيًا.",
        updateTitle: "يلزم تحديث آمن للتطبيق",
        updateBody: "لم يعد هذا الإصدار مدعومًا. حدّث Alpha Traders قبل تسجيل الدخول أو التداول.",
        currentVersion: "الإصدار الحالي",
        minimumVersion: "الحد الأدنى للإصدار",
        updateHelp: "الحصول على مساعدة للتحديث",
        privacyTitle: "Alpha Traders محمي",
        privacyBody: "تم إخفاء محتوى حسابك وصفقاتك بينما التطبيق غير نشط.",
      }
    : {
        errorTitle: "Alpha Traders could not open",
        errorBody: "Check your internet connection and try again.",
        retry: "Try again",
        openWebsite: "Open website",
        offline: "You are offline. Alpha Traders will show cached content when available and reconnect automatically.",
        updateTitle: "A secure update is required",
        updateBody: "This version is no longer supported. Update Alpha Traders before signing in or trading.",
        currentVersion: "Current version",
        minimumVersion: "Minimum version",
        updateHelp: "Get update help",
        privacyTitle: "Alpha Traders is protected",
        privacyBody: "Your account and trade content is hidden while the app is inactive.",
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
  const sourcePreparationInFlightRef = useRef(true);
  const pushRegistrationKeyRef = useRef<string | null>(null);
  const pushRegistrationResultRef = useRef<NativeToWebBridgeMessage | null>(null);
  const pendingPushRegistrationRef = useRef<{
    userId: string;
    locale: MobileLocale;
    forceRefresh: boolean;
  } | null>(null);
  const pushRegistrationInFlightRef = useRef<Promise<void> | null>(null);
  const [source, setSource] = useState<WebsiteSource | null>(null);
  const [locale, setLocale] = useState<MobileLocale>(inferredLocale);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPrivacyMasked, setIsPrivacyMasked] = useState(AppState.currentState !== "active");
  const [pushSetupIssue, setPushSetupIssue] = useState<PushSetupIssue | null>(null);
  const { isOnline } = useNetworkStatus();
  const readiness = useMobileAppReadiness(locale, isOnline);
  const labels = useMemo(() => copy(locale), [locale]);
  const pushRecoveryLabels = useMemo(
    () => pushSetupIssue ? pushSetupRecoveryCopy(locale, pushSetupIssue) : null,
    [locale, pushSetupIssue],
  );

  const reportNativeReady = useCallback(() => {
    if (readyReported.current) return;
    readyReported.current = true;
    onNativeReady?.();
  }, [onNativeReady]);

  const prepare = useCallback(async () => {
    sourcePreparationInFlightRef.current = true;
    hasLoadedContentRef.current = false;
    loadErrorRef.current = false;
    setLoadFailed(false);
    setIsLoading(true);
    try {
      const initial = await createInitialSource();
      localeRef.current = initial.locale;
      setLocale(initial.locale);
      const prepared = resolvePreparedWebsiteSource(initial.source, pendingPushUrlRef.current);
      pendingPushUrlRef.current = pendingPushUrlAfterConsumption(
        pendingPushUrlRef.current,
        prepared.consumedPushUrl,
      );
      sourcePreparationInFlightRef.current = false;
      setSource(prepared.source);
    } catch {
      const fallbackLocale = inferredLocale();
      localeRef.current = fallbackLocale;
      setLocale(fallbackLocale);
      const prepared = resolvePreparedWebsiteSource(
        { uri: `${ALPHA_TRADERS_WEB_ORIGIN}/${fallbackLocale}` },
        pendingPushUrlRef.current,
      );
      pendingPushUrlRef.current = pendingPushUrlAfterConsumption(
        pendingPushUrlRef.current,
        prepared.consumedPushUrl,
      );
      sourcePreparationInFlightRef.current = false;
      setSource(prepared.source);
    }
  }, []);

  useEffect(() => {
    if (readiness.status === "checking") return;
    if (readiness.status === "update_required") {
      setIsLoading(false);
      reportNativeReady();
      return;
    }
    void prepare();
  }, [prepare, readiness.status, reportNativeReady]);

  const sendMessageToWebsite = useCallback((message: unknown) => {
    try {
      webViewRef.current?.postMessage(JSON.stringify(message));
    } catch {
      // A navigation may replace the document while a native task is ending.
      // The next authenticated session signal safely retries registration.
    }
  }, []);

  const ensurePushRegistration = useCallback(function registerPush(
    userId: string,
    nextLocale: MobileLocale,
    forceRefresh = false,
  ) {
    const key = `${userId}:${nextLocale}`;
    if (forceRefresh) {
      // Permission may have changed while the user was in phone settings, and
      // a token may rotate while the app is backgrounded. Re-read both on the
      // next foreground instead of trusting a once-valid cached registration.
      pushRegistrationKeyRef.current = null;
      pushRegistrationResultRef.current = null;
    }
    if (pushRegistrationKeyRef.current === key) {
      if (pushRegistrationResultRef.current) {
        sendMessageToWebsite(pushRegistrationResultRef.current);
      }
      return;
    }
    if (pushRegistrationInFlightRef.current) {
      // A logout/login or locale change can arrive while the OS token request
      // is still open. Keep the latest authenticated target instead of losing
      // its registration until another app foreground event happens.
      const alreadyPending = pendingPushRegistrationRef.current;
      pendingPushRegistrationRef.current = {
        userId,
        locale: nextLocale,
        forceRefresh: forceRefresh || Boolean(
          alreadyPending
          && alreadyPending.userId === userId
          && alreadyPending.locale === nextLocale
          && alreadyPending.forceRefresh
        ),
      };
      return;
    }
    const task = (async () => {
      const result = await registerForNativePushNotifications(nextLocale);
      if (activeSessionRef.current?.userId !== userId) return;
      setPushSetupIssue(pushSetupIssueFromRegistrationStatus(result.status));
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
      const pending = pendingPushRegistrationRef.current;
      pendingPushRegistrationRef.current = null;
      if (pending && activeSessionRef.current?.userId === pending.userId) {
        registerPush(pending.userId, pending.locale, pending.forceRefresh);
      }
    });
  }, [sendMessageToWebsite]);

  const attemptPendingReview = useCallback(() => {
    const session = activeSessionRef.current;
    const tradeReference = pendingReviewRef.current;
    if (!session || !tradeReference || AppState.currentState !== "active") return;
    pendingReviewRef.current = null;
    const requestedUserId = session.userId;
    void requestAppReviewAfterCompletedTrade({
      userId: session.userId,
      tradeReference,
    }).then((requested) => {
      // If the user backgrounds the app during the short presentation delay,
      // retry when they return instead of silently losing the completed-trade
      // review opportunity. Never overwrite a newer completion signal.
      if (
        !requested
        && AppState.currentState !== "active"
        && activeSessionRef.current?.userId === requestedUserId
        && pendingReviewRef.current === null
      ) {
        pendingReviewRef.current = tradeReference;
      }
    });
  }, []);

  const openPushDestination = useCallback((data: unknown) => {
    const target = trustedPushWebsiteUrl(data, localeRef.current);
    if (target) {
      // Queue only while startup/session migration can still overwrite the
      // WebView source. Once preparation ends, a tap is a direct one-time
      // navigation and must not become a future resume destination.
      pendingPushUrlRef.current = sourcePreparationInFlightRef.current ? target : null;
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
      setIsPrivacyMasked(state !== "active");
      if (state !== "active") return;
      const session = activeSessionRef.current;
      if (session) ensurePushRegistration(session.userId, session.locale, true);
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
    if (!request.isTopFrame) return decision === "allow";
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
    // The bridge can register push tokens and update native state. Only a
    // first-party top-level document may send privileged messages into it.
    if (!isTrustedWebsiteDocumentUrl(event.nativeEvent.url)) return;
    const message = parseWebToNativeBridgeMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "alpha.web.session") {
      if (!message.authenticated) {
        activeSessionRef.current = null;
        pendingBadgeRef.current = null;
        pendingPushRegistrationRef.current = null;
        pushRegistrationKeyRef.current = null;
        pushRegistrationResultRef.current = null;
        pendingReviewRef.current = null;
        setPushSetupIssue(null);
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
      message.type === "alpha.web.push-registration"
      && activeSessionRef.current?.userId === message.userId
    ) {
      setPushSetupIssue(message.status === "failed" ? "failed" : null);
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

  const recoverPushSetup = useCallback(() => {
    if (pushSetupIssue === "denied") {
      void Linking.openSettings().catch(() => undefined);
      return;
    }
    const session = activeSessionRef.current;
    if (!session) return;
    setPushSetupIssue(null);
    ensurePushRegistration(session.userId, session.locale, true);
  }, [ensurePushRegistration, pushSetupIssue]);

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

  if (readiness.status === "update_required") {
    return (
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
        <StatusBar style="light" />
        <View accessibilityRole="alert" style={styles.updateOverlay}>
          <Image accessibilityLabel="Alpha Traders Academy & Exchange" alt="Alpha Traders Academy & Exchange" source={brandLogo} style={styles.updateLogo} />
          <Text style={[styles.updateTitle, locale === "ar" && styles.rtlText]}>{labels.updateTitle}</Text>
          <Text style={[styles.updateBody, locale === "ar" && styles.rtlText]}>{labels.updateBody}</Text>
          <View style={styles.updateVersions}>
            <View style={[styles.updateVersionRow, locale === "ar" && styles.reverseRow]}>
              <Text style={styles.updateVersionLabel}>{labels.currentVersion}</Text>
              <Text style={styles.updateVersionValue}>{readiness.config.currentVersion}</Text>
            </View>
            <View style={[styles.updateVersionRow, locale === "ar" && styles.reverseRow]}>
              <Text style={styles.updateVersionLabel}>{labels.minimumVersion}</Text>
              <Text style={styles.updateVersionValue}>{readiness.config.minimumSupportedVersion}</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="link"
            onPress={() => openExternally(`${ALPHA_TRADERS_WEB_ORIGIN}/${locale}/support`)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{labels.updateHelp}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      {isOnline === false ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.offlineBanner}>
          <Text style={[styles.offlineText, locale === "ar" && styles.rtlText]}>{labels.offline}</Text>
        </View>
      ) : null}
      {source ? (
        <WebView
          ref={webViewRef}
          source={source}
          style={styles.webView}
          originWhitelist={[
            "https://alphatraders.co.il",
            "https://www.alphatraders.co.il",
            "https://discord.com",
            "https://www.discord.com",
            "about:blank",
            "blob:*",
          ]}
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
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          contentInsetAdjustmentBehavior="never"
          domStorageEnabled
          javaScriptCanOpenWindowsAutomatically
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="never"
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
        />
      ) : null}

      {pushSetupIssue && pushRecoveryLabels && !isLoading && !loadFailed ? (
        <View accessibilityRole="alert" style={styles.pushRecoveryBanner}>
          <Text style={[styles.pushRecoveryTitle, locale === "ar" && styles.rtlText]}>
            {pushRecoveryLabels.title}
          </Text>
          <Text style={[styles.pushRecoveryBody, locale === "ar" && styles.rtlText]}>
            {pushRecoveryLabels.body}
          </Text>
          <View style={[styles.pushRecoveryActions, locale === "ar" && styles.reverseRow]}>
            <Pressable
              accessibilityLabel={pushRecoveryLabels.action}
              accessibilityRole="button"
              onPress={recoverPushSetup}
              style={styles.pushRecoveryPrimary}
            >
              <Text style={styles.pushRecoveryPrimaryText}>{pushRecoveryLabels.action}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={pushRecoveryLabels.dismiss}
              accessibilityRole="button"
              onPress={() => setPushSetupIssue(null)}
              style={styles.pushRecoverySecondary}
            >
              <Text style={styles.pushRecoverySecondaryText}>{pushRecoveryLabels.dismiss}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {isLoading && !loadFailed ? (
        <View accessibilityLabel={locale === "ar" ? "جارٍ تحميل Alpha Traders" : "Loading Alpha Traders"} accessibilityRole="progressbar" style={styles.loadingOverlay}>
          <Image accessible={false} alt="" source={brandLogo} style={styles.loadingLogo} />
          <ActivityIndicator color="#D4AF37" size="large" />
        </View>
      ) : null}

      {loadFailed ? (
        <View accessibilityRole="alert" style={styles.errorOverlay}>
          <Image accessibilityLabel="Alpha Traders Academy & Exchange" alt="Alpha Traders Academy & Exchange" source={brandLogo} style={styles.errorLogo} />
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

      {isPrivacyMasked ? (
        <View
          accessibilityRole="summary"
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={styles.privacyMask}
        >
          <Image accessibilityLabel="Alpha Traders Academy & Exchange" alt="Alpha Traders Academy & Exchange" source={brandLogo} style={styles.privacyLogo} />
          <Text style={[styles.privacyTitle, locale === "ar" && styles.rtlText]}>
            {labels.privacyTitle}
          </Text>
          <Text style={[styles.privacyBody, locale === "ar" && styles.rtlText]}>
            {labels.privacyBody}
          </Text>
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
  offlineBanner: {
    backgroundColor: "#17130A",
    borderBottomColor: "rgba(212, 175, 55, 0.72)",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  offlineText: {
    color: "#F4D978",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
  },
  pushRecoveryBanner: {
    backgroundColor: "#17130A",
    borderColor: "rgba(212, 175, 55, 0.72)",
    borderRadius: 16,
    borderWidth: 1,
    bottom: 14,
    elevation: 8,
    left: 12,
    padding: 16,
    position: "absolute",
    right: 12,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    zIndex: 8,
  },
  pushRecoveryTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  pushRecoveryBody: {
    color: "#D6D9DE",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 5,
  },
  pushRecoveryActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 13,
  },
  reverseRow: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  pushRecoveryPrimary: {
    alignItems: "center",
    backgroundColor: "#D4AF37",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  pushRecoveryPrimaryText: {
    color: "#050505",
    fontSize: 14,
    fontWeight: "800",
  },
  pushRecoverySecondary: {
    alignItems: "center",
    borderColor: "rgba(255, 255, 255, 0.28)",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  pushRecoverySecondaryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
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
  loadingLogo: {
    borderColor: "rgba(212, 175, 55, 0.62)",
    borderRadius: 30,
    borderWidth: 1,
    height: 132,
    marginBottom: 22,
    width: 132,
  },
  privacyMask: {
    alignItems: "center",
    backgroundColor: "#050505",
    bottom: 0,
    elevation: 30,
    justifyContent: "center",
    left: 0,
    padding: 28,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 30,
  },
  privacyLogo: {
    borderColor: "rgba(212, 175, 55, 0.62)",
    borderRadius: 24,
    borderWidth: 1,
    height: 88,
    width: 88,
  },
  privacyTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 20,
    textAlign: "center",
  },
  privacyBody: {
    color: "#BFC6D2",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 360,
    textAlign: "center",
  },
  updateOverlay: {
    alignSelf: "center",
    backgroundColor: "#101114",
    borderColor: "rgba(212, 175, 55, 0.58)",
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    justifyContent: "center",
    margin: 24,
    maxWidth: 520,
    padding: 24,
  },
  updateLogo: {
    alignSelf: "center",
    borderColor: "rgba(212, 175, 55, 0.58)",
    borderRadius: 24,
    borderWidth: 1,
    height: 96,
    width: 96,
  },
  updateTitle: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "900",
    lineHeight: 31,
  },
  updateBody: {
    color: "#B4BDC9",
    fontSize: 16,
    lineHeight: 24,
  },
  updateVersions: {
    backgroundColor: "#191B20",
    borderRadius: 14,
    gap: 12,
    padding: 16,
  },
  updateVersionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  updateVersionLabel: {
    color: "#B4BDC9",
    fontSize: 13,
  },
  updateVersionValue: {
    color: "#F4D978",
    fontSize: 13,
    fontWeight: "900",
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
  errorLogo: {
    alignSelf: "center",
    borderColor: "rgba(212, 175, 55, 0.58)",
    borderRadius: 26,
    borderWidth: 1,
    height: 108,
    marginBottom: 24,
    width: 108,
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
