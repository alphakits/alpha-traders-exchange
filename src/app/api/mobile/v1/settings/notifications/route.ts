import { NextRequest } from "next/server";
import type { MobileNotificationPreferencesUpdateRequest } from "@alpha-traders/contracts";
import { updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import {
  CURRENT_WHATSAPP_CONSENT_VERSION,
  getWhatsAppChannelStatus,
  getWhatsAppConsentCopy,
  updateWhatsAppSubscription,
  WhatsAppPreferenceValidationError,
  type WhatsAppChannelStatus,
} from "@/lib/whatsapp-notifications";

type NotificationUser = {
  id: string;
  preferredLocale?: string;
  notificationPreferences?: { inApp?: boolean; email?: boolean; sms?: boolean };
  verifiedPhone?: string;
  phoneVerifiedAt?: string;
};

function whatsappPayload(channel: WhatsAppChannelStatus) {
  const active = channel.currentConsent && channel.active;
  const status = channel.available
    ? "ready" as const
    : channel.reason === "storage_unavailable"
      ? "storage_unavailable" as const
      : channel.providerState === "configuration_incomplete"
        ? "not_configured" as const
        : channel.providerState === "awaiting_policy_approval"
          ? "awaiting_meta_approval" as const
          : "feature_disabled" as const;
  return {
    tradeUpdates: active && channel.tradeUpdatesEnabled,
    chatMessages: active && channel.chatMessagesEnabled,
    consented: active,
    consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
    available: channel.available,
    sendingEnabled: channel.sendingEnabled,
    status,
  };
}

async function responsePayload(
  user: NotificationUser,
  preferences = user.notificationPreferences,
  channel?: WhatsAppChannelStatus,
) {
  return {
    preferences: {
      inApp: preferences?.inApp !== false,
      email: preferences?.email === true,
      sms: preferences?.sms === true,
    },
    whatsapp: {
      ...whatsappPayload(channel ?? await getWhatsAppChannelStatus(user.id)),
      consentText: getWhatsAppConsentCopy(user.preferredLocale),
    },
    phone: {
      verified: Boolean(user.verifiedPhone && user.phoneVerifiedAt),
      masked: user.verifiedPhone
        ? `${user.verifiedPhone.slice(0, 3)}•••${user.verifiedPhone.slice(-2)}`
        : null,
    },
  };
}

async function authenticate(request: NextRequest, requestId: string) {
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return { response: mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400) };
  const auth = await requireMobileApiUser(request, requestId, metadata);
  return auth.user ? { user: auth.user, locale } : { response: auth.unauthorized };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await authenticate(request, requestId);
    if (auth.response) return auth.response;
    return mobileJson(await responsePayload(auth.user), requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_notification_preferences_read",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await authenticate(request, requestId);
    if (auth.response) return auth.response;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      identifier: auth.user.id,
      key: "mobile:notification-preferences",
      maxRequests: 12,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }
    const body = await readMobileJsonBody(request);
    if (!body) return mobileError("INVALID_REQUEST", requestId, locale, 400);
    const allowedKeys = new Set([
      "inApp",
      "email",
      "sms",
      "whatsappTradeUpdates",
      "whatsappChatMessages",
      "whatsappConsentAccepted",
      "whatsappConsentVersion",
    ]);
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => !allowedKeys.has(key))) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const booleanKeys = keys.filter((key) => key !== "whatsappConsentVersion");
    if (
      booleanKeys.some((key) => typeof body[key] !== "boolean")
      || ("whatsappConsentVersion" in body && typeof body.whatsappConsentVersion !== "string")
    ) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    if (body.sms === true && (!auth.user.verifiedPhone || !auth.user.phoneVerifiedAt)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const input = body as MobileNotificationPreferencesUpdateRequest;
    const hasWhatsAppUpdate = keys.some((key) => key.startsWith("whatsapp"));
    let channel = await getWhatsAppChannelStatus(auth.user.id);
    if (hasWhatsAppUpdate) {
      if (!("whatsappTradeUpdates" in body) && !("whatsappChatMessages" in body)) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      const tradeUpdates = typeof input.whatsappTradeUpdates === "boolean"
        ? input.whatsappTradeUpdates
        : channel.currentConsent && channel.active && channel.tradeUpdatesEnabled;
      const chatMessages = typeof input.whatsappChatMessages === "boolean"
        ? input.whatsappChatMessages
        : channel.currentConsent && channel.active && channel.chatMessagesEnabled;
      const enabled = tradeUpdates || chatMessages;
      if (enabled && (!auth.user.verifiedPhone || !auth.user.phoneVerifiedAt)) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      channel = await updateWhatsAppSubscription({
        userId: auth.user.id,
        enabled,
        verifiedPhone: auth.user.verifiedPhone,
        phoneVerifiedAt: auth.user.phoneVerifiedAt,
        locale: auth.user.preferredLocale ?? locale,
        tradeUpdatesEnabled: tradeUpdates,
        chatMessagesEnabled: chatMessages,
        consentAccepted: input.whatsappConsentAccepted === true,
        consentVersion: input.whatsappConsentVersion ?? null,
      });
    }

    const traditionalInput = Object.fromEntries(
      (["inApp", "email", "sms"] as const)
        .filter((key) => typeof input[key] === "boolean")
        .map((key) => [key, input[key]]),
    ) as Partial<{ inApp: boolean; email: boolean; sms: boolean }>;
    const preferences = Object.keys(traditionalInput).length > 0
      ? await updateNotificationPreferences({ userId: auth.user.id, preferences: traditionalInput })
      : auth.user.notificationPreferences;
    return mobileJson(await responsePayload(auth.user, preferences, channel), requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_notification_preferences_update",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return error instanceof WhatsAppPreferenceValidationError
      ? mobileError("INVALID_REQUEST", requestId, locale, 400)
      : mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
