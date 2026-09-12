import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { after } from "next/server";
import type { Pool, PoolClient } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { logEvent } from "@/lib/structured-logging";
import {
  getWhatsAppCloudReadiness,
  isWhatsAppEventType,
  normalizeWhatsAppE164,
  sendWhatsAppTemplateWithRetry,
  type WhatsAppDeliveryStatusUpdate,
  type WhatsAppEventType,
} from "@/lib/whatsapp-platform";
import type {
  AlphaExchangeNotification,
  AlphaExchangeUser,
  PurchaseRequest,
} from "@/types/alpha-exchange";

export const CURRENT_WHATSAPP_CONSENT_VERSION = "2026-09-12.v1";

export const WHATSAPP_CONSENT_COPY =
  "Yes, send me private WhatsApp notifications from Alpha Traders about my own requests and active Trade Rooms. Messages will not include amounts, payment details, wallet details, or chat content. I can turn this off at any time in Settings or reply STOP.";

const WHATSAPP_CONSENT_COPY_AR =
  "نعم، أرسلوا لي إشعارات خاصة عبر واتساب من Alpha Traders عن طلباتي وغرف التداول النشطة الخاصة بي. لن تتضمن الرسائل المبالغ أو تفاصيل الدفع أو المحافظ أو محتوى الدردشة. يمكنني إيقافها في أي وقت من الإعدادات أو بالرد بكلمة STOP.";

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LEASE_SECONDS = 120;
const DELIVERY_SWEEP_LIMIT = 50;
const DELIVERY_SWEEP_WORK_LIMIT = 12;
const DELIVERY_SWEEP_CONCURRENCY = 3;
const DELIVERY_SWEEP_BUDGET_MS = 18_000;
const DELIVERY_SWEEP_PROVIDER_TIMEOUT_MS = 3_500;
const PHONE_FINGERPRINT_SECRET_MIN_LENGTH = 32;

type WhatsAppLocale = "ar" | "en";
type WhatsAppDeliveryStatus =
  | "processing"
  | "retry_scheduled"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "suppressed";

export type WhatsAppSubscription = Readonly<{
  userId: string;
  locale: WhatsAppLocale;
  tradeUpdatesEnabled: boolean;
  chatMessagesEnabled: boolean;
  active: boolean;
  consentVersion: string;
  consentedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  updatedAt: string;
}>;

export type WhatsAppChannelStatus = Readonly<{
  available: boolean;
  sendingEnabled: boolean;
  providerState: ReturnType<typeof getWhatsAppCloudReadiness>["state"];
  subscribed: boolean;
  active: boolean;
  phoneVerified: boolean;
  currentConsent: boolean;
  tradeUpdatesEnabled: boolean;
  chatMessagesEnabled: boolean;
  consentVersion: string;
  consentedAt: string | null;
  revokedAt: string | null;
  reason:
    | "available"
    | "feature_disabled"
    | "storage_unavailable"
    | "not_subscribed"
    | "phone_verification_required"
    | "phone_changed"
    | "consent_outdated"
    | "revoked";
}>;

export class WhatsAppPreferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppPreferenceValidationError";
  }
}

type PersistedSubscriptionRow = {
  user_id: string;
  phone_fingerprint: string;
  locale: WhatsAppLocale;
  trade_updates_enabled: boolean;
  chat_messages_enabled: boolean;
  active: boolean;
  consent_version: string;
  consent_copy_hash: string;
  consented_at: Date | string | null;
  revoked_at: Date | string | null;
  revocation_reason: string | null;
  updated_at: Date | string;
};

type CanonicalContext = {
  notification: AlphaExchangeNotification;
  user: AlphaExchangeUser;
  request: PurchaseRequest;
};

type DeliveryClaim = {
  id: string;
  leaseToken: string;
  attemptCount: number;
};

let schemaPromise: Promise<void> | null = null;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeLocale(value: unknown): WhatsAppLocale {
  return value === "ar" ? "ar" : "en";
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePayload<T>(value: unknown): T | null {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as T : null;
  } catch {
    return null;
  }
}

function isConsentUiEnabled() {
  return process.env.ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED?.trim().toLowerCase() === "true";
}

export function isWhatsAppChannelAvailable() {
  const readiness = getWhatsAppCloudReadiness();
  return isConsentUiEnabled()
    && readiness.configured
    && readiness.policyApproved
    && readiness.approvalReferenceRecorded
    && Boolean(phoneFingerprintSecret());
}

export function getWhatsAppConsentCopy(locale: string | null | undefined = "en") {
  return normalizeLocale(locale) === "ar" ? WHATSAPP_CONSENT_COPY_AR : WHATSAPP_CONSENT_COPY;
}

export function getWhatsAppConsentCopyHash(locale: string | null | undefined = "en") {
  return sha256(getWhatsAppConsentCopy(locale));
}

function phoneFingerprintSecret() {
  const secret = (
    process.env.ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET
    ?? process.env.META_WHATSAPP_APP_SECRET
    ?? ""
  ).trim();
  return secret.length >= PHONE_FINGERPRINT_SECRET_MIN_LENGTH ? secret : null;
}

function phoneFingerprint(phone: string) {
  const normalized = normalizeWhatsAppE164(phone);
  const secret = phoneFingerprintSecret();
  if (!normalized || !secret) return null;
  return createHmac("sha256", secret).update(normalized, "utf8").digest("hex");
}

function requireWhatsAppPool() {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("WhatsApp notification storage is unavailable.");
  return pool;
}

async function ensureWhatsAppSchema(pool: Pool) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const result = await pool.query<{
        subscriptions: string | null;
        consent_events: string | null;
        deliveries: string | null;
        inbound_commands: string | null;
      }>(
        `select to_regclass('alpha_exchange.whatsapp_subscriptions')::text as subscriptions,
                to_regclass('alpha_exchange.whatsapp_consent_events')::text as consent_events,
                to_regclass('alpha_exchange.whatsapp_deliveries')::text as deliveries,
                to_regclass('alpha_exchange.whatsapp_inbound_commands')::text as inbound_commands`,
      );
      const row = result.rows[0];
      if (!row?.subscriptions || !row.consent_events || !row.deliveries || !row.inbound_commands) {
        throw new Error("WhatsApp notification migration has not been applied.");
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function rollbackQuietly(client: PoolClient) {
  return client.query("rollback").catch(() => undefined);
}

function subscriptionFromRow(row: PersistedSubscriptionRow): WhatsAppSubscription {
  return {
    userId: row.user_id,
    locale: normalizeLocale(row.locale),
    tradeUpdatesEnabled: row.trade_updates_enabled,
    chatMessagesEnabled: row.chat_messages_enabled,
    active: row.active,
    consentVersion: row.consent_version,
    consentedAt: toIso(row.consented_at),
    revokedAt: toIso(row.revoked_at),
    revocationReason: row.revocation_reason,
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

async function selectSubscription(
  pool: Pool | PoolClient,
  userId: string,
  options: { forUpdate?: boolean } = {},
) {
  const result = await pool.query<PersistedSubscriptionRow>(
    `select user_id, phone_fingerprint, locale, trade_updates_enabled,
            chat_messages_enabled, active, consent_version, consent_copy_hash,
            consented_at, revoked_at, revocation_reason, updated_at
     from alpha_exchange.whatsapp_subscriptions
     where user_id = $1
     limit 1${options.forUpdate ? " for update" : ""}`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function getWhatsAppSubscriptionForUser(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return null;
  const pool = getRuntimePostgresPool();
  if (!pool) return null;
  try {
    await ensureWhatsAppSchema(pool);
    const row = await selectSubscription(pool, normalizedUserId);
    return row ? subscriptionFromRow(row) : null;
  } catch {
    return null;
  }
}

const disabledChannelStatus = (): WhatsAppChannelStatus => ({
  available: false,
  sendingEnabled: false,
  providerState: getWhatsAppCloudReadiness().state,
  subscribed: false,
  active: false,
  phoneVerified: false,
  currentConsent: false,
  tradeUpdatesEnabled: false,
  chatMessagesEnabled: false,
  consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
  consentedAt: null,
  revokedAt: null,
  reason: "feature_disabled",
});

export async function getWhatsAppChannelStatus(userId: string): Promise<WhatsAppChannelStatus> {
  const readiness = getWhatsAppCloudReadiness();
  const normalizedUserId = userId.trim();
  const pool = getRuntimePostgresPool();
  if (!normalizedUserId || !pool) {
    return {
      ...disabledChannelStatus(),
      available: isWhatsAppChannelAvailable(),
      sendingEnabled: readiness.readyToSend,
      providerState: readiness.state,
      reason: "storage_unavailable",
    };
  }
  // With both feature switches off, this optional channel must not make the
  // existing notification-settings endpoint depend on its migration.
  if (!isConsentUiEnabled() && !readiness.readyToSend) return disabledChannelStatus();
  try {
    await ensureWhatsAppSchema(pool);
    const result = await pool.query<{
    user_payload: unknown;
    phone_fingerprint: string | null;
    locale: WhatsAppLocale | null;
    trade_updates_enabled: boolean | null;
    chat_messages_enabled: boolean | null;
    active: boolean | null;
    consent_version: string | null;
    consent_copy_hash: string | null;
    consented_at: Date | string | null;
    revoked_at: Date | string | null;
    }>(
    `select user_record.payload as user_payload,
            subscription.phone_fingerprint,
            subscription.locale,
            subscription.trade_updates_enabled,
            subscription.chat_messages_enabled,
            subscription.active,
            subscription.consent_version,
            subscription.consent_copy_hash,
            subscription.consented_at,
            subscription.revoked_at
     from alpha_exchange.users user_record
     left join alpha_exchange.whatsapp_subscriptions subscription
       on subscription.user_id = user_record.id
     where user_record.id = $1
     limit 1`,
    [normalizedUserId],
    );
    const row = result.rows[0];
    const user = parsePayload<AlphaExchangeUser>(row?.user_payload);
    const normalizedPhone = normalizeWhatsAppE164(user?.verifiedPhone ?? "");
    const phoneVerified = Boolean(normalizedPhone && user?.phoneVerifiedAt);
    const subscribed = Boolean(row?.consent_version);
    const locale = normalizeLocale(row?.locale ?? user?.preferredLocale);
    const expectedFingerprint = normalizedPhone ? phoneFingerprint(normalizedPhone) : null;
    const currentConsent = Boolean(
      row?.active
      && phoneVerified
      && expectedFingerprint
      && row.phone_fingerprint === expectedFingerprint
      && row.consent_version === CURRENT_WHATSAPP_CONSENT_VERSION
      && row.consent_copy_hash === getWhatsAppConsentCopyHash(locale),
    );
    const reason: WhatsAppChannelStatus["reason"] = !subscribed
      ? "not_subscribed"
      : !phoneVerified
        ? "phone_verification_required"
        : row?.phone_fingerprint !== expectedFingerprint
          ? "phone_changed"
          : row?.consent_version !== CURRENT_WHATSAPP_CONSENT_VERSION
            || row?.consent_copy_hash !== getWhatsAppConsentCopyHash(locale)
            ? "consent_outdated"
            : !row?.active
              ? "revoked"
              : "available";
    return {
      available: isWhatsAppChannelAvailable(),
      sendingEnabled: readiness.readyToSend,
      providerState: readiness.state,
      subscribed,
      active: Boolean(row?.active),
      phoneVerified,
      currentConsent,
      tradeUpdatesEnabled: Boolean(row?.trade_updates_enabled),
      chatMessagesEnabled: Boolean(row?.chat_messages_enabled),
      consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
      consentedAt: toIso(row?.consented_at),
      revokedAt: toIso(row?.revoked_at),
      reason,
    };
  } catch (error) {
    logEvent("warn", {
      event: "whatsapp_channel_status",
      targetUserId: normalizedUserId,
      outcome: "failed",
      reason: "storage_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error },
    });
    return {
      ...disabledChannelStatus(),
      providerState: readiness.state,
      reason: "storage_unavailable",
    };
  }
}

async function insertConsentEvent(
  client: PoolClient,
  input: {
    userId: string;
    eventType: "granted" | "updated" | "revoked";
    source: "settings" | "inbound_stop" | "phone_changed";
    phoneFingerprint: string;
    locale: WhatsAppLocale;
    consentVersion: string;
    consentCopyHash: string;
    tradeUpdatesEnabled: boolean;
    chatMessagesEnabled: boolean;
  },
) {
  await client.query(
    `insert into alpha_exchange.whatsapp_consent_events (
       id, user_id, event_type, source, phone_fingerprint, locale,
       consent_version, consent_copy_hash, trade_updates_enabled,
       chat_messages_enabled, occurred_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [
      `wa-consent-${randomUUID()}`,
      input.userId,
      input.eventType,
      input.source,
      input.phoneFingerprint,
      input.locale,
      input.consentVersion,
      input.consentCopyHash,
      input.tradeUpdatesEnabled,
      input.chatMessagesEnabled,
    ],
  );
}

export async function updateWhatsAppSubscription(input: {
  userId: string;
  enabled: boolean;
  verifiedPhone?: string | null;
  phoneVerifiedAt?: string | null;
  locale?: string | null;
  tradeUpdatesEnabled?: boolean;
  chatMessagesEnabled?: boolean;
  consentAccepted?: boolean;
  consentVersion?: string | null;
}) {
  const actionOccurredAt = new Date().toISOString();
  const userId = input.userId.trim();
  if (!userId) throw new WhatsAppPreferenceValidationError("Authenticated user is required.");
  const pool = requireWhatsAppPool();
  await ensureWhatsAppSchema(pool);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const userResult = await client.query<{ payload: unknown }>(
      "select payload from alpha_exchange.users where id = $1 for update",
      [userId],
    );
    const user = parsePayload<AlphaExchangeUser>(userResult.rows[0]?.payload);
    if (!user) throw new WhatsAppPreferenceValidationError("User not found.");
    let existing: PersistedSubscriptionRow | null = null;

    if (!input.enabled) {
      existing = await selectSubscription(client, userId, { forUpdate: true });
      if (existing?.active) {
        await client.query(
          `update alpha_exchange.whatsapp_subscriptions
           set active = false, revoked_at = now(), revocation_reason = 'settings',
               updated_at = now()
           where user_id = $1`,
          [userId],
        );
        await insertConsentEvent(client, {
          userId,
          eventType: "revoked",
          source: "settings",
          phoneFingerprint: existing.phone_fingerprint,
          locale: normalizeLocale(existing.locale),
          consentVersion: existing.consent_version,
          consentCopyHash: existing.consent_copy_hash,
          tradeUpdatesEnabled: existing.trade_updates_enabled,
          chatMessagesEnabled: existing.chat_messages_enabled,
        });
      }
    } else {
      if (!isWhatsAppChannelAvailable()) {
        throw new WhatsAppPreferenceValidationError("WhatsApp notifications are not available yet.");
      }
      if (input.consentAccepted !== true || input.consentVersion !== CURRENT_WHATSAPP_CONSENT_VERSION) {
        throw new WhatsAppPreferenceValidationError("Current explicit WhatsApp consent is required.");
      }
      const canonicalPhone = normalizeWhatsAppE164(user.verifiedPhone ?? "");
      const suppliedPhone = normalizeWhatsAppE164(input.verifiedPhone ?? "");
      const canonicalVerifiedAt = user.phoneVerifiedAt?.trim() ?? "";
      if (!canonicalPhone || !canonicalVerifiedAt || !suppliedPhone || suppliedPhone !== canonicalPhone) {
        throw new WhatsAppPreferenceValidationError("A current verified phone number is required.");
      }
      if (input.phoneVerifiedAt?.trim() !== canonicalVerifiedAt) {
        throw new WhatsAppPreferenceValidationError("Phone verification changed. Reload Settings and try again.");
      }
      const locale = normalizeLocale(input.locale ?? user.preferredLocale);
      const fingerprint = phoneFingerprint(canonicalPhone);
      if (!fingerprint) throw new WhatsAppPreferenceValidationError("WhatsApp consent storage is not configured securely.");
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1))",
        [`whatsapp-consent:${fingerprint}`],
      );
      existing = await selectSubscription(client, userId, { forUpdate: true });
      const newerOptOut = await client.query(
        `select 1
         from alpha_exchange.whatsapp_inbound_commands
         where phone_fingerprint = $1
           and command_type = 'stop'
           and occurred_at > $2::timestamptz
         limit 1`,
        [fingerprint, actionOccurredAt],
      );
      if (newerOptOut.rows[0]) {
        throw new WhatsAppPreferenceValidationError(
          "A newer WhatsApp opt-out was received. Reload Settings before opting in again.",
        );
      }
      const tradeUpdatesEnabled = input.tradeUpdatesEnabled !== false;
      const chatMessagesEnabled = input.chatMessagesEnabled !== false;
      if (!tradeUpdatesEnabled && !chatMessagesEnabled) {
        throw new WhatsAppPreferenceValidationError("Select at least one WhatsApp notification category.");
      }
      const consentCopyHash = getWhatsAppConsentCopyHash(locale);
      const unchanged = Boolean(
        existing?.active
        && existing.phone_fingerprint === fingerprint
        && existing.locale === locale
        && existing.consent_version === CURRENT_WHATSAPP_CONSENT_VERSION
        && existing.consent_copy_hash === consentCopyHash
        && existing.trade_updates_enabled === tradeUpdatesEnabled
        && existing.chat_messages_enabled === chatMessagesEnabled,
      );
      if (!unchanged) {
        await client.query(
        `insert into alpha_exchange.whatsapp_subscriptions (
           user_id, phone_fingerprint, locale, trade_updates_enabled,
           chat_messages_enabled, active, consent_version, consent_copy_hash,
           consented_at, revoked_at, revocation_reason, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, true, $6, $7, $8::timestamptz, null, null, now(), now())
         on conflict (user_id) do update set
           phone_fingerprint = excluded.phone_fingerprint,
           locale = excluded.locale,
           trade_updates_enabled = excluded.trade_updates_enabled,
           chat_messages_enabled = excluded.chat_messages_enabled,
           active = true,
           consent_version = excluded.consent_version,
           consent_copy_hash = excluded.consent_copy_hash,
           consented_at = $8::timestamptz,
           revoked_at = null,
           revocation_reason = null,
           updated_at = now()`,
        [
          userId,
          fingerprint,
          locale,
          tradeUpdatesEnabled,
          chatMessagesEnabled,
          CURRENT_WHATSAPP_CONSENT_VERSION,
          consentCopyHash,
          actionOccurredAt,
        ],
        );
        await insertConsentEvent(client, {
          userId,
          eventType: existing?.active ? "updated" : "granted",
          source: "settings",
          phoneFingerprint: fingerprint,
          locale,
          consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
          consentCopyHash,
          tradeUpdatesEnabled,
          chatMessagesEnabled,
        });
      }
    }
    await client.query("commit");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
  return getWhatsAppChannelStatus(userId);
}

export function whatsappNotificationRevision(notification: AlphaExchangeNotification) {
  const eventKey = notification.whatsappEventKey?.trim();
  if (eventKey && /^wae-[0-9a-f-]{36}$/i.test(eventKey)) return eventKey;
  return sha256([
    notification.id,
    notification.userId,
    notification.whatsappEvent ?? "not_eligible",
    notification.whatsappEventAt?.trim() || notification.createdAt,
  ].join(":"));
}

export function classifyWhatsAppNotification(
  notification: AlphaExchangeNotification,
): WhatsAppEventType | null {
  if (notification.category !== "trade") return null;
  if (!notification.relatedRequestId && !notification.relatedTradeId) return null;
  const event = notification.whatsappEvent;
  return event && isWhatsAppEventType(event) ? event : null;
}

function whatsappEventOccurredAt(notification: AlphaExchangeNotification) {
  const raw = notification.whatsappEventAt?.trim();
  if (!raw) return null;
  const milliseconds = new Date(raw).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function isWhatsAppNotificationDismissed(notification: AlphaExchangeNotification) {
  if (notification.whatsappChannelOnly) return false;
  return notification.isRead
    || notification.state === "read"
    || notification.state === "archived";
}

export function isWhatsAppEventApplicableToRequest(event: WhatsAppEventType, request: PurchaseRequest) {
  const activeStatuses = new Set<PurchaseRequest["status"]>([
    "accepted",
    "payment_sent",
    "funds_received",
    "usdt_release_pending",
    "usdt_sent",
  ]);
  if (event === "new_request") return request.status === "pending";
  if (event === "request_accepted" || event === "trade_update") {
    return activeStatuses.has(request.status);
  }
  if (event === "trade_room_message" || event === "trade_room_reminder") {
    return activeStatuses.has(request.status) && !request.closedAt && !request.completedAt;
  }
  if (event === "request_declined") return request.status === "declined";
  if (event === "trade_cancelled") return request.status === "cancelled";
  return event === "trade_completed"
    && Boolean(request.completedAt)
    && new Set<PurchaseRequest["status"]>(["completed", "locked", "review_open"]).has(request.status);
}

function isEventEnabled(subscription: PersistedSubscriptionRow, event: WhatsAppEventType) {
  return event === "trade_room_message"
    ? subscription.chat_messages_enabled
    : subscription.trade_updates_enabled;
}

async function loadCanonicalContext(
  pool: Pool,
  notificationId: string,
  recipientUserId: string,
): Promise<CanonicalContext | null> {
  const notificationResult = await pool.query<{
    notification_payload: unknown;
    user_payload: unknown;
  }>(
    `select notification.payload as notification_payload,
            recipient.payload as user_payload
     from alpha_exchange.notifications notification
     join alpha_exchange.users recipient on recipient.id = notification.user_id
     where notification.id = $1 and notification.user_id = $2
     limit 1`,
    [notificationId, recipientUserId],
  );
  const notification = parsePayload<AlphaExchangeNotification>(notificationResult.rows[0]?.notification_payload);
  const user = parsePayload<AlphaExchangeUser>(notificationResult.rows[0]?.user_payload);
  if (!notification || !user) return null;
  const requestId = notification.relatedRequestId?.trim() || null;
  const tradeId = notification.relatedTradeId?.trim() || null;
  if (!requestId && !tradeId) return null;
  const requestResult = await pool.query<{ payload: unknown }>(
    `select payload
     from alpha_exchange.purchase_requests
     where ($1::text is not null and id = $1)
        or ($2::text is not null and (trade_id = $2 or id = $2))
     order by case when id = $1 then 0 when trade_id = $2 then 1 else 2 end
     limit 1`,
    [requestId, tradeId],
  );
  const tradeRequest = parsePayload<PurchaseRequest>(requestResult.rows[0]?.payload);
  return tradeRequest ? { notification, user, request: tradeRequest } : null;
}

function deliveryId(input: {
  notificationId: string;
  notificationRevision: string;
  recipientUserId: string;
}) {
  return `wa-delivery-${sha256(`${input.notificationId}:${input.notificationRevision}:${input.recipientUserId}`).slice(0, 40)}`;
}

function sanitizeDeliveryErrorCode(value: unknown) {
  const normalized = String(value ?? "delivery_failed")
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 80);
  return normalized || "delivery_failed";
}

async function suppressDelivery(
  pool: Pool,
  context: CanonicalContext,
  event: WhatsAppEventType,
  revision: string,
  reason: string,
) {
  await pool.query(
    `insert into alpha_exchange.whatsapp_deliveries (
       id, notification_id, notification_revision, recipient_user_id,
       request_id, event_type, status, attempt_count, last_error_code,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, 'suppressed', 0, $7, now(), now())
     on conflict (notification_id, notification_revision, recipient_user_id)
     do update set status = 'suppressed', last_error_code = excluded.last_error_code,
                   lease_token = null, lease_expires_at = null,
                   next_attempt_at = null, updated_at = now()
     where alpha_exchange.whatsapp_deliveries.status in ('processing', 'retry_scheduled')`,
    [
      deliveryId({
        notificationId: context.notification.id,
        notificationRevision: revision,
        recipientUserId: context.notification.userId,
      }),
      context.notification.id,
      revision,
      context.notification.userId,
      context.request.id,
      event,
      sanitizeDeliveryErrorCode(reason),
    ],
  );
}

async function claimDelivery(
  pool: Pool,
  context: CanonicalContext,
  event: WhatsAppEventType,
  revision: string,
): Promise<DeliveryClaim | "coalesced" | null> {
  const leaseToken = randomUUID();
  const id = deliveryId({
    notificationId: context.notification.id,
    notificationRevision: revision,
    recipientUserId: context.notification.userId,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (event === "trade_room_message") {
      // Serialize this recipient/request pair so two rapid messages created on
      // separate instances cannot both pass the coalescing check.
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1))",
        [`whatsapp-chat:${context.request.id}:${context.notification.userId}`],
      );
      const recentAlert = await client.query(
        `select 1
         from alpha_exchange.whatsapp_deliveries
         where request_id = $1
           and recipient_user_id = $2
           and event_type = 'trade_room_message'
           and status not in ('failed', 'suppressed')
           and created_at >= now() - interval '2 minutes'
           and not (notification_id = $3 and notification_revision = $4)
         limit 1`,
        [context.request.id, context.notification.userId, context.notification.id, revision],
      );
      if (recentAlert.rows[0]) {
        await client.query(
          `insert into alpha_exchange.whatsapp_deliveries (
             id, notification_id, notification_revision, recipient_user_id,
             request_id, event_type, status, attempt_count, last_error_code,
             created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, 'suppressed', 0,
                     'chat_coalesced', now(), now())
           on conflict (notification_id, notification_revision, recipient_user_id)
           do update set status = 'suppressed', last_error_code = 'chat_coalesced',
                         next_attempt_at = null, lease_token = null,
                         lease_expires_at = null, updated_at = now()
           where alpha_exchange.whatsapp_deliveries.status in ('processing', 'retry_scheduled')`,
          [
            id,
            context.notification.id,
            revision,
            context.notification.userId,
            context.request.id,
            event,
          ],
        );
        await client.query("commit");
        return "coalesced";
      }
    }

    const result = await client.query<{ id: string; attempt_count: number }>(
      `insert into alpha_exchange.whatsapp_deliveries (
         id, notification_id, notification_revision, recipient_user_id,
         request_id, event_type, status, attempt_count, lease_token,
         lease_expires_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, 'processing', 1, $7,
                 now() + ($8::int * interval '1 second'), now(), now())
       on conflict (notification_id, notification_revision, recipient_user_id)
       do update set status = 'processing',
                     attempt_count = alpha_exchange.whatsapp_deliveries.attempt_count + 1,
                     lease_token = excluded.lease_token,
                     lease_expires_at = excluded.lease_expires_at,
                     next_attempt_at = null,
                     last_error_code = null,
                     updated_at = now()
       where alpha_exchange.whatsapp_deliveries.attempt_count < $9
         and (
           (alpha_exchange.whatsapp_deliveries.status = 'retry_scheduled'
            and alpha_exchange.whatsapp_deliveries.next_attempt_at <= now())
           or (alpha_exchange.whatsapp_deliveries.status = 'processing'
               and alpha_exchange.whatsapp_deliveries.lease_expires_at <= now())
         )
       returning id, attempt_count`,
      [
        id,
        context.notification.id,
        revision,
        context.notification.userId,
        context.request.id,
        event,
        leaseToken,
        DELIVERY_LEASE_SECONDS,
        MAX_DELIVERY_ATTEMPTS,
      ],
    );
    await client.query("commit");
    const claimed = result.rows[0];
    return claimed ? { id: claimed.id, leaseToken, attemptCount: claimed.attempt_count } : null;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function retryDelaySeconds(attemptCount: number) {
  return [60, 5 * 60, 15 * 60, 60 * 60][Math.max(0, Math.min(attemptCount - 1, 3))];
}

async function completeDelivery(
  pool: Pool,
  claim: DeliveryClaim,
  result: Awaited<ReturnType<typeof sendWhatsAppTemplateWithRetry>>,
) {
  if (result.ok) {
    await pool.query(
      `update alpha_exchange.whatsapp_deliveries
       set status = 'accepted', provider_message_id = $3,
           accepted_at = now(), lease_token = null, lease_expires_at = null,
           next_attempt_at = null, last_error_code = null, updated_at = now()
       where id = $1 and lease_token = $2 and status = 'processing'`,
      [claim.id, claim.leaseToken, result.messageId],
    );
    return "accepted" as const;
  }
  const shouldRetry = result.retryable && claim.attemptCount < MAX_DELIVERY_ATTEMPTS;
  const errorCode = sanitizeDeliveryErrorCode(result.providerCode ?? result.reason);
  await pool.query(
    `update alpha_exchange.whatsapp_deliveries
     set status = $3,
         next_attempt_at = case when $3 = 'retry_scheduled'
           then now() + ($4::int * interval '1 second') else null end,
         failed_at = case when $3 = 'failed' then now() else failed_at end,
         lease_token = null, lease_expires_at = null,
         last_error_code = $5, updated_at = now()
     where id = $1 and lease_token = $2 and status = 'processing'`,
    [
      claim.id,
      claim.leaseToken,
      shouldRetry ? "retry_scheduled" : "failed",
      retryDelaySeconds(claim.attemptCount),
      errorCode,
    ],
  );
  return shouldRetry ? "retry_scheduled" as const : "failed" as const;
}

async function getCurrentDestination(
  pool: Pool,
  context: CanonicalContext,
  event: WhatsAppEventType,
) {
  const subscription = await selectSubscription(pool, context.notification.userId);
  if (!subscription?.active) return { destination: null, locale: "en" as const, reason: "no_active_consent" } as const;
  const locale = normalizeLocale(subscription.locale);
  if (subscription.consent_version !== CURRENT_WHATSAPP_CONSENT_VERSION) {
    return { destination: null, locale, reason: "consent_outdated" } as const;
  }
  if (subscription.consent_copy_hash !== getWhatsAppConsentCopyHash(locale)) {
    return { destination: null, locale, reason: "consent_copy_changed" } as const;
  }
  if (!isEventEnabled(subscription, event)) {
    return { destination: null, locale, reason: "category_disabled" } as const;
  }
  const eventOccurredAt = whatsappEventOccurredAt(context.notification);
  const consentedAt = subscription.consented_at ? new Date(subscription.consented_at).getTime() : Number.NaN;
  if (!eventOccurredAt || !Number.isFinite(consentedAt) || eventOccurredAt < consentedAt) {
    return { destination: null, locale, reason: "event_before_consent" } as const;
  }
  const destination = normalizeWhatsAppE164(context.user.verifiedPhone ?? "");
  if (!destination || !context.user.phoneVerifiedAt) {
    return { destination: null, locale, reason: "verified_phone_missing" } as const;
  }
  const fingerprint = phoneFingerprint(destination);
  if (!fingerprint || fingerprint !== subscription.phone_fingerprint) {
    return {
      destination: null,
      locale,
      reason: "verified_phone_changed",
      observedPhoneFingerprint: subscription.phone_fingerprint,
    } as const;
  }
  return { destination, locale, reason: null } as const;
}

async function suppressClaim(pool: Pool, claim: DeliveryClaim, reason: string) {
  await pool.query(
    `update alpha_exchange.whatsapp_deliveries
     set status = 'suppressed', last_error_code = $3,
         next_attempt_at = null, lease_token = null, lease_expires_at = null,
         updated_at = now()
     where id = $1 and lease_token = $2 and status = 'processing'`,
    [claim.id, claim.leaseToken, sanitizeDeliveryErrorCode(reason)],
  );
}

async function suppressExistingDelivery(
  pool: Pool,
  input: { notificationId: string; recipientUserId: string; expectedRevision: string },
  reason: string,
) {
  await pool.query(
    `update alpha_exchange.whatsapp_deliveries
     set status = 'suppressed', last_error_code = $4,
         next_attempt_at = null, lease_token = null, lease_expires_at = null,
         updated_at = now()
     where notification_id = $1
       and recipient_user_id = $2
       and notification_revision = $3
       and status in ('processing', 'retry_scheduled')`,
    [
      input.notificationId,
      input.recipientUserId,
      input.expectedRevision,
      sanitizeDeliveryErrorCode(reason),
    ],
  );
}

async function deactivateChangedPhoneConsent(pool: Pool, userId: string, observedPhoneFingerprint: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from alpha_exchange.users where id = $1 for update", [userId]);
    const result = await client.query<PersistedSubscriptionRow>(
      `select user_id, phone_fingerprint, locale, trade_updates_enabled,
              chat_messages_enabled, active, consent_version, consent_copy_hash,
              consented_at, revoked_at, revocation_reason, updated_at
       from alpha_exchange.whatsapp_subscriptions
       where user_id = $1 and phone_fingerprint = $2
       for update`,
      [userId, observedPhoneFingerprint],
    );
    const existing = result.rows[0];
    if (!existing?.active) {
      await client.query("commit");
      return;
    }
    const updated = await client.query(
      `update alpha_exchange.whatsapp_subscriptions
       set active = false, revoked_at = now(), revocation_reason = 'phone_changed',
           updated_at = now()
       where user_id = $1 and phone_fingerprint = $2 and active = true`,
      [userId, observedPhoneFingerprint],
    );
    if ((updated.rowCount ?? 0) === 1) await insertConsentEvent(client, {
      userId,
      eventType: "revoked",
      source: "phone_changed",
      phoneFingerprint: existing.phone_fingerprint,
      locale: normalizeLocale(existing.locale),
      consentVersion: existing.consent_version,
      consentCopyHash: existing.consent_copy_hash,
      tradeUpdatesEnabled: existing.trade_updates_enabled,
      chatMessagesEnabled: existing.chat_messages_enabled,
    });
    await client.query("commit");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function processWhatsAppNotification(input: {
  notificationId: string;
  recipientUserId: string;
  expectedRevision: string;
  providerMaxAttempts?: number;
  providerTimeoutMs?: number;
}) {
  if (!getWhatsAppCloudReadiness().readyToSend) return "disabled" as const;
  const pool = requireWhatsAppPool();
  await ensureWhatsAppSchema(pool);
  let context = await loadCanonicalContext(pool, input.notificationId, input.recipientUserId);
  if (!context) {
    await suppressExistingDelivery(pool, input, "canonical_context_missing");
    return "suppressed" as const;
  }
  const revision = whatsappNotificationRevision(context.notification);
  if (revision !== input.expectedRevision) {
    await suppressExistingDelivery(pool, input, "notification_revision_changed");
    return "stale" as const;
  }
  const event = classifyWhatsAppNotification(context.notification);
  if (!event) {
    await suppressExistingDelivery(pool, input, "event_no_longer_allowed");
    return "suppressed" as const;
  }
  if (isWhatsAppNotificationDismissed(context.notification)) {
    await suppressDelivery(pool, context, event, revision, "notification_dismissed");
    return "suppressed" as const;
  }
  if (!isWhatsAppEventApplicableToRequest(event, context.request)) {
    await suppressDelivery(pool, context, event, revision, "request_state_changed");
    return "suppressed" as const;
  }
  if (
    context.notification.userId !== context.request.buyerId
    && context.notification.userId !== context.request.sellerId
  ) {
    await suppressExistingDelivery(pool, input, "recipient_no_longer_participant");
    return "suppressed" as const;
  }

  let destinationState = await getCurrentDestination(pool, context, event);
  if (!destinationState.destination) {
    await suppressDelivery(pool, context, event, revision, destinationState.reason ?? "delivery_not_allowed");
    if (
      destinationState.reason === "verified_phone_changed"
      && "observedPhoneFingerprint" in destinationState
      && destinationState.observedPhoneFingerprint
    ) {
      await deactivateChangedPhoneConsent(
        pool,
        context.notification.userId,
        destinationState.observedPhoneFingerprint,
      );
    }
    return "suppressed" as const;
  }

  const claim = await claimDelivery(pool, context, event, revision);
  if (claim === "coalesced") return "suppressed" as const;
  if (!claim) return "already_claimed" as const;

  // Re-read all canonical records and consent immediately before the external
  // request. This makes opt-out, phone changes, trade removal, and recipient
  // changes fail closed even after a retry row was claimed.
  context = await loadCanonicalContext(pool, input.notificationId, input.recipientUserId);
  if (
    !context
    || whatsappNotificationRevision(context.notification) !== revision
    || classifyWhatsAppNotification(context.notification) !== event
    || isWhatsAppNotificationDismissed(context.notification)
    || !isWhatsAppEventApplicableToRequest(event, context.request)
    || (context.notification.userId !== context.request.buyerId
      && context.notification.userId !== context.request.sellerId)
  ) {
    await suppressClaim(pool, claim, "canonical_context_changed");
    return "suppressed" as const;
  }
  destinationState = await getCurrentDestination(pool, context, event);
  if (!destinationState.destination) {
    await suppressClaim(pool, claim, destinationState.reason ?? "delivery_not_allowed");
    if (
      destinationState.reason === "verified_phone_changed"
      && "observedPhoneFingerprint" in destinationState
      && destinationState.observedPhoneFingerprint
    ) {
      await deactivateChangedPhoneConsent(
        pool,
        context.notification.userId,
        destinationState.observedPhoneFingerprint,
      );
    }
    return "suppressed" as const;
  }

  const sendResult = await sendWhatsAppTemplateWithRetry({
    to: destinationState.destination,
    event,
    locale: destinationState.locale,
    // One provider request per leased outbox attempt. Network timeouts remain
    // ambiguous and are retried only by the delayed outbox schedule, reducing
    // the chance of immediate duplicate user messages.
    maxAttempts: input.providerMaxAttempts ?? 1,
    timeoutMs: input.providerTimeoutMs,
  });
  const status = await completeDelivery(pool, claim, sendResult);
  logEvent(sendResult.ok ? "info" : "warn", {
    event: "whatsapp_notification_delivery",
    targetUserId: context.notification.userId,
    resourceId: context.notification.id,
    outcome: sendResult.ok ? "success" : "failed",
    reason: sendResult.ok ? undefined : sanitizeDeliveryErrorCode(sendResult.reason),
    metadata: { eventType: event, status, attempts: sendResult.attempts },
  });
  return status;
}

export async function deliverWhatsAppNotification(notification: AlphaExchangeNotification) {
  if (!getWhatsAppCloudReadiness().readyToSend) return "disabled" as const;
  return processWhatsAppNotification({
    notificationId: notification.id,
    recipientUserId: notification.userId,
    expectedRevision: whatsappNotificationRevision(notification),
  });
}

export function scheduleWhatsAppNotificationDelivery(notification: AlphaExchangeNotification) {
  // The policy approval switch and complete provider configuration are checked
  // before scheduling, so disabled environments perform no database work.
  if (!getWhatsAppCloudReadiness().readyToSend) return false;
  const deliver = () => deliverWhatsAppNotification(notification).catch((error) => {
    logEvent("error", {
      event: "whatsapp_notification_delivery",
      targetUserId: notification.userId,
      resourceId: notification.id,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "WhatsApp delivery failed.",
    });
  });
  try {
    after(deliver);
  } catch {
    if (process.env.NODE_ENV === "production") {
      const timeout = setTimeout(() => void deliver(), 250);
      timeout.unref?.();
    }
  }
  return true;
}

export async function runWhatsAppDeliverySweep() {
  if (!getWhatsAppCloudReadiness().readyToSend) {
    return { enabled: false, claimed: 0, recovered: 0, recoveryCandidates: 0, accepted: 0, retried: 0, failed: 0, suppressed: 0 };
  }
  const pool = requireWhatsAppPool();
  await ensureWhatsAppSchema(pool);
  await pool.query(
    `update alpha_exchange.whatsapp_deliveries
     set status = 'failed', failed_at = now(), next_attempt_at = null,
         lease_token = null, lease_expires_at = null,
         last_error_code = 'max_attempts_exhausted', updated_at = now()
     where status in ('processing', 'retry_scheduled')
       and attempt_count >= $1
       and (status <> 'processing' or lease_expires_at <= now())`,
    [MAX_DELIVERY_ATTEMPTS],
  );
  const due = await pool.query<{
    notification_id: string;
    notification_revision: string;
    recipient_user_id: string;
  }>(
    `select notification_id, notification_revision, recipient_user_id
     from alpha_exchange.whatsapp_deliveries
     where attempt_count < $1
       and (
         (status = 'retry_scheduled' and next_attempt_at <= now())
         or (status = 'processing' and lease_expires_at <= now())
       )
     order by coalesce(next_attempt_at, lease_expires_at, created_at) asc
     limit $2`,
    [MAX_DELIVERY_ATTEMPTS, DELIVERY_SWEEP_LIMIT],
  );
  const totals = { accepted: 0, retried: 0, failed: 0, suppressed: 0 };
  const recordResult = (result: string) => {
    if (result === "accepted") totals.accepted += 1;
    else if (result === "retry_scheduled") totals.retried += 1;
    else if (result === "failed") totals.failed += 1;
    else if (result === "suppressed" || result === "stale" || result === "excluded") totals.suppressed += 1;
  };
  // Recover only the narrow post-commit crash window. This is intentionally
  // not a historical backfill: notifications older than 15 minutes are never
  // enrolled. Every recent row is reconsidered because a reused notification
  // can have a newer revision; the exact revision uniqueness guard makes this
  // scan idempotent without missing that crash edge.
  const recent = await pool.query<{
    notification_payload: unknown;
    recipient_user_id: string;
  }>(
    `select notification.payload as notification_payload,
            notification.user_id as recipient_user_id
     from alpha_exchange.notifications notification
     join alpha_exchange.whatsapp_subscriptions subscription
       on subscription.user_id = notification.user_id
      and subscription.active = true
      and subscription.consent_version = $1
     join alpha_exchange.users recipient on recipient.id = notification.user_id
     where notification.category = 'trade'
       and notification.payload ->> 'whatsappEvent' = any($4::text[])
       and notification.payload ->> 'whatsappEventAt'
             ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
       and notification.payload ->> 'whatsappEventKey'
             ~ '^wae-[0-9a-fA-F-]{36}$'
       and notification.payload ->> 'whatsappEventAt' >= $2
       and (
         nullif(notification.payload ->> 'relatedRequestId', '') is not null
         or nullif(notification.payload ->> 'relatedTradeId', '') is not null
       )
       and not exists (
         select 1
         from alpha_exchange.whatsapp_deliveries delivery
         where delivery.notification_id = notification.id
           and delivery.notification_revision = notification.payload ->> 'whatsappEventKey'
           and delivery.recipient_user_id = notification.user_id
       )
     order by notification.payload ->> 'whatsappEventAt' asc
     limit $3`,
    [
      CURRENT_WHATSAPP_CONSENT_VERSION,
      new Date(Date.now() - 15 * 60_000).toISOString(),
      DELIVERY_SWEEP_LIMIT,
      Object.keys({
        new_request: true,
        request_accepted: true,
        request_declined: true,
        trade_update: true,
        trade_room_message: true,
        trade_room_reminder: true,
        trade_completed: true,
        trade_cancelled: true,
      } satisfies Record<WhatsAppEventType, true>),
    ],
  );
  const recoveryCandidates: Array<{
    notificationId: string;
    recipientUserId: string;
    expectedRevision: string;
  }> = [];
  for (const row of recent.rows) {
    const notification = parsePayload<AlphaExchangeNotification>(row.notification_payload);
    if (!notification || notification.userId !== row.recipient_user_id) continue;
    recoveryCandidates.push({
      notificationId: notification.id,
      recipientUserId: notification.userId,
      expectedRevision: whatsappNotificationRevision(notification),
    });
  }
  const recoveryWork = recoveryCandidates;

  const dueWork = due.rows.map((row) => ({
      source: "due" as const,
      notificationId: row.notification_id,
      recipientUserId: row.recipient_user_id,
      expectedRevision: row.notification_revision,
    }));
  const recoveryQueue = recoveryWork.map((row) => ({ source: "recovery" as const, ...row }));
  // Reserve half of every bounded sweep for the narrow post-commit recovery
  // window. Otherwise a sustained retry backlog could keep crash-window work
  // out of the first 12 slots until it ages out permanently. Interleave the
  // queues and fill any unused reservation from the other source.
  const reservedPerSource = Math.floor(DELIVERY_SWEEP_WORK_LIMIT / 2);
  const work: Array<(typeof dueWork)[number] | (typeof recoveryQueue)[number]> = [];
  for (let index = 0; index < reservedPerSource; index += 1) {
    if (recoveryQueue[index]) work.push(recoveryQueue[index]);
    if (dueWork[index]) work.push(dueWork[index]);
  }
  const overflow = [
    ...recoveryQueue.slice(reservedPerSource),
    ...dueWork.slice(reservedPerSource),
  ];
  for (const row of overflow) {
    if (work.length >= DELIVERY_SWEEP_WORK_LIMIT) break;
    work.push(row);
  }
  const deadline = Date.now() + DELIVERY_SWEEP_BUDGET_MS;
  let nextIndex = 0;
  let processed = 0;
  let recovered = 0;

  const worker = async () => {
    while (nextIndex < work.length) {
      // Leave enough time for one bounded provider request. Backlog stays due
      // for the next cron run rather than consuming the whole 60-second job.
      if (Date.now() + DELIVERY_SWEEP_PROVIDER_TIMEOUT_MS >= deadline) return;
      const row = work[nextIndex];
      nextIndex += 1;
      processed += 1;
      try {
        const result = await processWhatsAppNotification({
          notificationId: row.notificationId,
          recipientUserId: row.recipientUserId,
          expectedRevision: row.expectedRevision,
          providerMaxAttempts: 1,
          providerTimeoutMs: DELIVERY_SWEEP_PROVIDER_TIMEOUT_MS,
        });
        recordResult(result);
        if (row.source === "recovery" && result !== "already_claimed" && result !== "disabled") {
          recovered += 1;
        }
      } catch (error) {
        totals.failed += 1;
        logEvent("error", {
          event: row.source === "due" ? "whatsapp_delivery_sweep_item" : "whatsapp_delivery_recovery_item",
          targetUserId: row.recipientUserId,
          resourceId: row.notificationId,
          outcome: "failed",
          reason: error instanceof Error ? error.message : "WhatsApp delivery sweep failed.",
        });
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(DELIVERY_SWEEP_CONCURRENCY, work.length) },
    () => worker(),
  ));
  return {
    enabled: true,
    claimed: processed,
    recovered,
    recoveryCandidates: recoveryWork.length,
    deferred: Math.max(0, due.rows.length + recoveryWork.length - processed),
    ...totals,
  };
}

export async function getWhatsAppDeliveryOperationsSummary() {
  const pool = getRuntimePostgresPool();
  if (!pool) return { storageAvailable: false, totals24h: {}, recent: [] } as const;
  try {
    await ensureWhatsAppSchema(pool);
    const [totals, recent] = await Promise.all([
      pool.query<{ status: WhatsAppDeliveryStatus; count: string }>(
        `select status, count(*)::text as count
         from alpha_exchange.whatsapp_deliveries
         where created_at >= now() - interval '24 hours'
         group by status`,
      ),
      pool.query<{
        status: WhatsAppDeliveryStatus;
        event_type: WhatsAppEventType;
        attempt_count: number;
        last_error_code: string | null;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `select status, event_type, attempt_count, last_error_code, created_at, updated_at
         from alpha_exchange.whatsapp_deliveries
         order by updated_at desc
         limit 25`,
      ),
    ]);
    return {
      storageAvailable: true,
      totals24h: Object.fromEntries(totals.rows.map((row) => [row.status, Number(row.count)])),
      recent: recent.rows.map((row) => ({
        status: row.status,
        event: row.event_type,
        attempts: row.attempt_count,
        errorCode: row.last_error_code,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      })),
    } as const;
  } catch {
    return { storageAvailable: false, totals24h: {}, recent: [] } as const;
  }
}

export async function applyWhatsAppWebhookStatuses(
  statuses: readonly WhatsAppDeliveryStatusUpdate[],
) {
  if (statuses.length === 0) return 0;
  const pool = getRuntimePostgresPool();
  if (!pool) return 0;
  await ensureWhatsAppSchema(pool);
  let updatedCount = 0;
  for (const update of statuses) {
    const providerMessageId = update.messageId.trim();
    if (!providerMessageId) continue;
    const occurredAt = toIso(update.occurredAt) ?? new Date().toISOString();
    const failureCode = update.status === "failed"
      ? sanitizeDeliveryErrorCode(update.failureCode ?? "provider_failed")
      : null;
    const result = await pool.query(
      `update alpha_exchange.whatsapp_deliveries
       set status = case
             when $2 = 'read' and status in ('accepted', 'sent', 'delivered', 'read') then 'read'
             when $2 = 'delivered' and status in ('accepted', 'sent', 'delivered') then 'delivered'
             when $2 = 'sent' and status in ('processing', 'retry_scheduled', 'accepted', 'sent') then 'sent'
             when $2 = 'failed' and status in ('processing', 'retry_scheduled', 'accepted', 'sent') then 'failed'
             else status
           end,
           sent_at = case when $2 = 'sent' and status in ('processing', 'retry_scheduled', 'accepted', 'sent')
             then coalesce(sent_at, $3::timestamptz) else sent_at end,
           delivered_at = case when $2 = 'delivered' and status in ('accepted', 'sent', 'delivered')
             then coalesce(delivered_at, $3::timestamptz) else delivered_at end,
           read_at = case when $2 = 'read' and status in ('accepted', 'sent', 'delivered', 'read')
             then coalesce(read_at, $3::timestamptz) else read_at end,
           failed_at = case when $2 = 'failed' and status not in ('delivered', 'read')
             then coalesce(failed_at, $3::timestamptz) else failed_at end,
           last_error_code = case when $2 = 'failed' and status not in ('delivered', 'read')
             then $4 else last_error_code end,
           updated_at = now()
       where provider_message_id = $1`,
      [providerMessageId, update.status, occurredAt, failureCode],
    );
    updatedCount += result.rowCount ?? 0;
  }
  return updatedCount;
}

export async function revokeWhatsAppConsentByPhone(input: {
  phone: string;
  messageId: string;
  occurredAt?: string;
}) {
  const fingerprint = phoneFingerprint(input.phone);
  const messageId = input.messageId.trim();
  if (!fingerprint || !messageId) return 0;
  const pool = getRuntimePostgresPool();
  if (!pool) return 0;
  await ensureWhatsAppSchema(pool);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const occurredAt = toIso(input.occurredAt) ?? new Date().toISOString();
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [`whatsapp-consent:${fingerprint}`],
    );
    const command = await client.query(
      `insert into alpha_exchange.whatsapp_inbound_commands (
         message_id, phone_fingerprint, command_type, occurred_at, processed_at, revoked_count
       ) values ($1, $2, 'stop', $3::timestamptz, now(), 0)
       on conflict (message_id) do nothing
       returning message_id`,
      [messageId, fingerprint, occurredAt],
    );
    if (!command.rows[0]) {
      await client.query("commit");
      return 0;
    }
    const result = await client.query<PersistedSubscriptionRow>(
      `update alpha_exchange.whatsapp_subscriptions
       set active = false, revoked_at = now(), revocation_reason = 'inbound_stop',
           updated_at = now()
       where phone_fingerprint = $1
         and active = true
         and consented_at <= $2::timestamptz
       returning user_id, phone_fingerprint, locale, trade_updates_enabled,
                 chat_messages_enabled, active, consent_version, consent_copy_hash,
                 consented_at, revoked_at, revocation_reason, updated_at`,
      [fingerprint, occurredAt],
    );
    for (const row of result.rows) {
      await insertConsentEvent(client, {
        userId: row.user_id,
        eventType: "revoked",
        source: "inbound_stop",
        phoneFingerprint: row.phone_fingerprint,
        locale: normalizeLocale(row.locale),
        consentVersion: row.consent_version,
        consentCopyHash: row.consent_copy_hash,
        tradeUpdatesEnabled: row.trade_updates_enabled,
        chatMessagesEnabled: row.chat_messages_enabled,
      });
    }
    await client.query(
      `update alpha_exchange.whatsapp_inbound_commands
       set revoked_count = $2, processed_at = now()
       where message_id = $1`,
      [messageId, result.rows.length],
    );
    await client.query("commit");
    return result.rows.length;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export type { WhatsAppDeliveryStatus, WhatsAppEventType };
