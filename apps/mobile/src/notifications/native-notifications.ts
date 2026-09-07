import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as StoreReview from "expo-store-review";
import { AppState, Platform } from "react-native";
import {
  MOBILE_CURRENT_APP_VERSION,
  NATIVE_WEB_BRIDGE_VERSION,
  type MobileLocale,
  type NativeToWebBridgeMessage,
} from "@alpha-traders/contracts";
import { getOrCreateDeviceId } from "../auth/session-storage";
import { trustedWebsiteResumeUrl } from "../web/website-navigation";
import {
  REVIEW_COOLDOWN_MS,
  appReviewStateKey,
  completedTradeAppReviewDecision,
  parseAppReviewState,
  serializedAppReviewState,
  type AppReviewState,
} from "./app-review-policy";

const ANDROID_NOTIFICATION_CHANNEL = "alpha-trade-updates";
const REVIEW_INTERACTION_DELAY_MS = 1_800;

type PushNotificationData = {
  url?: unknown;
  reviewEligible?: unknown;
  tradeReference?: unknown;
};

type PermissionSnapshot = {
  granted?: boolean;
  canAskAgain?: boolean;
  status?: string;
  ios?: { status?: Notifications.IosAuthorizationStatus };
};

let reviewRequestInFlight: Promise<boolean> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function appVersion() {
  return Constants.expoConfig?.version ?? MOBILE_CURRENT_APP_VERSION;
}

function projectId() {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? null;
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL, {
    name: "Trade and account updates",
    description: "Important Alpha Traders trade-room, chat, and account updates.",
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: "default",
    vibrationPattern: [0, 250, 180, 250],
    lightColor: "#D4AF37",
  });
}

function hasNotificationPermission(value: Notifications.NotificationPermissionsStatus) {
  const permission = value as PermissionSnapshot;
  return permission.granted === true
    || permission.status === "granted"
    || permission.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED
    || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    || permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
}

function canRequestNotificationPermission(value: Notifications.NotificationPermissionsStatus) {
  const permission = value as PermissionSnapshot;
  return permission.canAskAgain === true
    || permission.status === "undetermined"
    || permission.ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED;
}

export async function registerForNativePushNotifications(
  locale: MobileLocale,
): Promise<NativeToWebBridgeMessage> {
  if (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    || !Device.isDevice
    || (Platform.OS !== "ios" && Platform.OS !== "android")
  ) {
    return {
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: "unavailable",
    };
  }

  try {
    await ensureAndroidNotificationChannel();
    let permissions = await Notifications.getPermissionsAsync();
    if (!hasNotificationPermission(permissions) && canRequestNotificationPermission(permissions)) {
      permissions = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    }
    if (!hasNotificationPermission(permissions)) {
      return {
        type: "alpha.native.push-registration",
        version: NATIVE_WEB_BRIDGE_VERSION,
        status: "denied",
      };
    }

    const easProjectId = projectId();
    if (!easProjectId) throw new Error("Missing EAS project ID.");
    const [token, installationId] = await Promise.all([
      Notifications.getExpoPushTokenAsync({ projectId: easProjectId }),
      getOrCreateDeviceId(),
    ]);
    return {
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: "registered",
      expoPushToken: token.data,
      installationId,
      platform: Platform.OS,
      appVersion: appVersion(),
      locale,
    };
  } catch {
    return {
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: "failed",
    };
  }
}

export function trustedPushWebsiteUrl(data: unknown, locale: MobileLocale) {
  if (!data || typeof data !== "object") return null;
  const url = (data as PushNotificationData).url;
  if (typeof url !== "string" || !url.trim()) return null;
  const trusted = trustedWebsiteResumeUrl(url, locale);
  return trusted === trustedWebsiteResumeUrl(null, locale) && url.trim() !== trusted
    ? null
    : trusted;
}

export function reviewReferenceFromPushData(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const payload = data as PushNotificationData;
  if (payload.reviewEligible !== true) return null;
  if (typeof payload.tradeReference !== "string") return null;
  const normalized = payload.tradeReference.trim();
  return normalized && normalized.length <= 180 ? normalized : null;
}

async function loadReviewState(userId: string): Promise<AppReviewState> {
  try {
    return parseAppReviewState(await AsyncStorage.getItem(appReviewStateKey(userId)));
  } catch {
    return { observedTradeReferences: [] };
  }
}

async function saveReviewState(userId: string, state: AppReviewState) {
  await AsyncStorage.setItem(appReviewStateKey(userId), serializedAppReviewState(state));
}

function waitForReviewMoment() {
  return new Promise<void>((resolve) => setTimeout(resolve, REVIEW_INTERACTION_DELAY_MS));
}

export function isAppReviewPresentationAllowed() {
  return AppState.currentState === "active"
    && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

/**
 * A completed trade is the signature interaction that makes either participant
 * eligible for an app-store rating prompt. The per-account cooldown respects
 * platform anti-spam guidance; Apple/Google still decide whether to show UI.
 */
export async function requestAppReviewAfterCompletedTrade(input: {
  userId: string;
  tradeReference: string;
  now?: number;
}) {
  if (reviewRequestInFlight) return reviewRequestInFlight;
  reviewRequestInFlight = (async () => {
    const userId = input.userId.trim();
    const tradeReference = input.tradeReference.trim();
    if (
      !userId
      || !tradeReference
      // Never ask someone to review Expo Go instead of Alpha Traders.
      || !isAppReviewPresentationAllowed()
    ) return false;
    const state = await loadReviewState(userId);
    const now = input.now ?? Date.now();
    const decision = completedTradeAppReviewDecision({ state, tradeReference, now });
    if (!decision.shouldRequest) {
      if (decision.shouldPersist) await saveReviewState(userId, decision.nextState);
      return false;
    }

    const [available, hasAction] = await Promise.all([
      StoreReview.isAvailableAsync(),
      StoreReview.hasAction(),
    ]);
    if (!available || !hasAction) return false;
    await waitForReviewMoment();
    if (!isAppReviewPresentationAllowed()) return false;
    // Persist the attempt before invoking native UI. If the OS accepts the
    // request but the process is suspended immediately, the user is still not
    // asked repeatedly on the next notification.
    await saveReviewState(userId, decision.nextState);
    await StoreReview.requestReview();
    return true;
  })();
  try {
    return await reviewRequestInFlight;
  } catch {
    return false;
  } finally {
    reviewRequestInFlight = null;
  }
}

export { ANDROID_NOTIFICATION_CHANNEL, REVIEW_COOLDOWN_MS };
