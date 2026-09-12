import { NextRequest, NextResponse } from "next/server";
import { updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import {
  CURRENT_WHATSAPP_CONSENT_VERSION,
  getWhatsAppChannelStatus,
  getWhatsAppConsentCopy,
  updateWhatsAppSubscription,
  WhatsAppPreferenceValidationError,
} from "@/lib/whatsapp-notifications";
import type { NotificationPreferences } from "@/types/alpha-exchange";
import { isTwilioSendEnabled } from "@/lib/notification-platform";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";

const traditionalPreferenceKeys = [
  "inApp",
  "email",
  "sms",
  "browserPush",
  "browserPushTradeUpdates",
  "browserPushChatMessages",
  "browserPushListings",
  "browserPushFeedback",
  "browserPushAdminAlerts",
] as const;

const whatsappPreferenceKeys = [
  "whatsappTradeUpdates",
  "whatsappChatMessages",
  "whatsappConsentAccepted",
  "whatsappConsentVersion",
] as const;

function phonePayload(user: { verifiedPhone?: string; phoneVerifiedAt?: string }) {
  return {
    verified: Boolean(user.verifiedPhone && user.phoneVerifiedAt),
    masked: user.verifiedPhone ? `${user.verifiedPhone.slice(0, 3)}•••${user.verifiedPhone.slice(-2)}` : null,
  };
}

function traditionalPayload(user: { notificationPreferences?: Partial<NotificationPreferences> }) {
  return {
    inApp: user.notificationPreferences?.inApp !== false,
    email: user.notificationPreferences?.email === true,
    sms: isTwilioSendEnabled() && user.notificationPreferences?.sms === true,
    browserPush: user.notificationPreferences?.browserPush === true,
    browserPushTradeUpdates: user.notificationPreferences?.browserPushTradeUpdates !== false,
    browserPushChatMessages: user.notificationPreferences?.browserPushChatMessages !== false,
    browserPushListings: user.notificationPreferences?.browserPushListings !== false,
    browserPushFeedback: user.notificationPreferences?.browserPushFeedback !== false,
    browserPushAdminAlerts: user.notificationPreferences?.browserPushAdminAlerts === true,
  };
}

async function whatsappPayload(userId: string, locale?: string) {
  const channel = await getWhatsAppChannelStatus(userId);
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
    consentText: getWhatsAppConsentCopy(locale),
    available: channel.available,
    sendingEnabled: channel.sendingEnabled,
    status,
  };
}

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  return NextResponse.json({
    preferences: traditionalPayload(user),
    whatsapp: await whatsappPayload(user.id, user.preferredLocale),
    phone: phonePayload(user),
    capabilities: {
      phoneVerification: isMarketplacePhoneVerificationEnabled(),
      sms: isTwilioSendEnabled(),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "exchange:notification-preferences", maxRequests: 12, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid notification preferences." }, { status: 400 });
    }
    const allowedKeys = new Set<string>([...traditionalPreferenceKeys, ...whatsappPreferenceKeys]);
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some((key) => !allowedKeys.has(key))) {
      return NextResponse.json({ error: "Invalid notification preferences." }, { status: 400 });
    }

    const traditionalKeys = traditionalPreferenceKeys.filter((key) => key in body);
    if (traditionalKeys.some((key) => typeof body[key] !== "boolean")) {
      return NextResponse.json({ error: "Notification channel values must be boolean." }, { status: 400 });
    }
    if (body.sms === true && !isTwilioSendEnabled()) {
      return NextResponse.json({ error: "SMS notifications are disabled." }, { status: 400 });
    }
    if (body.sms === true && (!user.verifiedPhone || !user.phoneVerifiedAt)) {
      return NextResponse.json({ error: "Verify a phone number before enabling SMS notifications." }, { status: 400 });
    }

    const hasWhatsAppUpdate = whatsappPreferenceKeys.some((key) => key in body);
    let whatsapp = await whatsappPayload(user.id, user.preferredLocale);
    if (hasWhatsAppUpdate) {
      if (!("whatsappTradeUpdates" in body) && !("whatsappChatMessages" in body)) {
        return NextResponse.json({ error: "Choose at least one WhatsApp notification preference to update." }, { status: 400 });
      }
      if (
        ("whatsappTradeUpdates" in body && typeof body.whatsappTradeUpdates !== "boolean")
        || ("whatsappChatMessages" in body && typeof body.whatsappChatMessages !== "boolean")
        || ("whatsappConsentAccepted" in body && typeof body.whatsappConsentAccepted !== "boolean")
        || ("whatsappConsentVersion" in body && typeof body.whatsappConsentVersion !== "string")
      ) {
        return NextResponse.json({ error: "Invalid WhatsApp notification preferences." }, { status: 400 });
      }
      const tradeUpdates = typeof body.whatsappTradeUpdates === "boolean"
        ? body.whatsappTradeUpdates
        : whatsapp.tradeUpdates;
      const chatMessages = typeof body.whatsappChatMessages === "boolean"
        ? body.whatsappChatMessages
        : whatsapp.chatMessages;
      const enabled = tradeUpdates || chatMessages;
      if (enabled && (!user.verifiedPhone || !user.phoneVerifiedAt)) {
        return NextResponse.json({ error: "Verify a phone number before enabling WhatsApp notifications." }, { status: 400 });
      }
      const updated = await updateWhatsAppSubscription({
        userId: user.id,
        enabled,
        verifiedPhone: user.verifiedPhone,
        phoneVerifiedAt: user.phoneVerifiedAt,
        locale: user.preferredLocale,
        tradeUpdatesEnabled: tradeUpdates,
        chatMessagesEnabled: chatMessages,
        consentAccepted: body.whatsappConsentAccepted === true,
        consentVersion: typeof body.whatsappConsentVersion === "string" ? body.whatsappConsentVersion : null,
      });
      const active = updated.currentConsent && updated.active;
      whatsapp = {
        ...whatsapp,
        tradeUpdates: active && updated.tradeUpdatesEnabled,
        chatMessages: active && updated.chatMessagesEnabled,
        consented: active,
        available: updated.available,
        sendingEnabled: updated.sendingEnabled,
      };
    }

    let preferences = traditionalPayload(user);
    if (traditionalKeys.length > 0) {
      const updated = await updateNotificationPreferences({
        userId: user.id,
        preferences: Object.fromEntries(traditionalKeys.map((key) => [key, body[key]])) as Partial<NotificationPreferences>,
      });
      preferences = traditionalPayload({ notificationPreferences: updated });
    }
    return NextResponse.json({
      preferences,
      whatsapp,
      phone: phonePayload(user),
      capabilities: {
        phoneVerification: isMarketplacePhoneVerificationEnabled(),
        sms: isTwilioSendEnabled(),
      },
    });
  } catch (error) {
    if (error instanceof WhatsAppPreferenceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Notification preferences are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
