import type { MobileLocale, MobilePlatform } from "./mobile-v1";

export const NATIVE_WEB_BRIDGE_VERSION = 1 as const;

export type WebToNativeBridgeMessage =
  | {
      type: "alpha.web.session";
      version: typeof NATIVE_WEB_BRIDGE_VERSION;
      authenticated: false;
      locale: MobileLocale;
    }
  | {
      type: "alpha.web.session";
      version: typeof NATIVE_WEB_BRIDGE_VERSION;
      authenticated: true;
      userId: string;
      locale: MobileLocale;
    }
  | {
      type: "alpha.web.trade-completed";
      version: typeof NATIVE_WEB_BRIDGE_VERSION;
      userId: string;
      notificationId: string;
      tradeReference: string;
      locale: MobileLocale;
    };

export type NativeToWebBridgeMessage =
  | {
      type: "alpha.native.push-registration";
      version: typeof NATIVE_WEB_BRIDGE_VERSION;
      status: "registered";
      expoPushToken: string;
      installationId: string;
      platform: MobilePlatform;
      appVersion: string;
      locale: MobileLocale;
    }
  | {
      type: "alpha.native.push-registration";
      version: typeof NATIVE_WEB_BRIDGE_VERSION;
      status: "denied" | "unavailable" | "failed";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLocale(value: unknown): value is MobileLocale {
  return value === "ar" || value === "en";
}

function isPlatform(value: unknown): value is MobilePlatform {
  return value === "ios" || value === "android";
}

function boundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function decodedRecord(raw: unknown) {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string" || raw.length > 8_192) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseWebToNativeBridgeMessage(raw: unknown): WebToNativeBridgeMessage | null {
  const value = decodedRecord(raw);
  if (!value || value.version !== NATIVE_WEB_BRIDGE_VERSION) return null;

  if (value.type === "alpha.web.session" && isLocale(value.locale)) {
    if (value.authenticated === false) {
      return {
        type: "alpha.web.session",
        version: NATIVE_WEB_BRIDGE_VERSION,
        authenticated: false,
        locale: value.locale,
      };
    }
    const userId = boundedString(value.userId, 160);
    if (value.authenticated === true && userId) {
      return {
        type: "alpha.web.session",
        version: NATIVE_WEB_BRIDGE_VERSION,
        authenticated: true,
        userId,
        locale: value.locale,
      };
    }
  }

  if (value.type === "alpha.web.trade-completed" && isLocale(value.locale)) {
    const userId = boundedString(value.userId, 160);
    const notificationId = boundedString(value.notificationId, 180);
    const tradeReference = boundedString(value.tradeReference, 180);
    if (userId && notificationId && tradeReference) {
      return {
        type: "alpha.web.trade-completed",
        version: NATIVE_WEB_BRIDGE_VERSION,
        userId,
        notificationId,
        tradeReference,
        locale: value.locale,
      };
    }
  }

  return null;
}

export function parseNativeToWebBridgeMessage(raw: unknown): NativeToWebBridgeMessage | null {
  const value = decodedRecord(raw);
  if (
    !value
    || value.type !== "alpha.native.push-registration"
    || value.version !== NATIVE_WEB_BRIDGE_VERSION
  ) return null;

  if (value.status === "denied" || value.status === "unavailable" || value.status === "failed") {
    return {
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: value.status,
    };
  }

  const expoPushToken = boundedString(value.expoPushToken, 256);
  const installationId = boundedString(value.installationId, 200);
  const appVersion = boundedString(value.appVersion, 40);
  if (
    value.status === "registered"
    && expoPushToken
    && installationId
    && appVersion
    && isPlatform(value.platform)
    && isLocale(value.locale)
  ) {
    return {
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: "registered",
      expoPushToken,
      installationId,
      platform: value.platform,
      appVersion,
      locale: value.locale,
    };
  }

  return null;
}
