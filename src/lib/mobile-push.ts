import { createHash, randomUUID } from "crypto";
import { after } from "next/server";
import type { Pool } from "pg";
import type { MobileLocale, MobilePlatform } from "@alpha-traders/contracts";
import { toMobileNotification } from "@/lib/mobile-notifications";
import { getSafeInternalNotificationDestination } from "@/lib/notification-action-destination";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { rollbackFailedTransaction } from "@/lib/postgres-transaction";
import { logEvent } from "@/lib/structured-logging";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const PUSH_FETCH_TIMEOUT_MS = 5_000;
const PUSH_FETCH_MAX_ATTEMPTS = 3;
const PUSH_RETRY_DELAY_CAP_MS = 5_000;
const MAX_PUSH_BATCH = 100;
// The shared runtime pool has five connections. Notification bursts must not
// occupy all of them while financial actions wait to read or commit a trade.
const MAX_CONCURRENT_PUSH_LOOKUPS = 2;
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9._=+\/-]{8,220}\]$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

type MobilePushSubscription = {
  id: string;
  userId: string;
  expoPushToken: string;
  platform: MobilePlatform;
  locale: MobileLocale;
  sessionTokenHash: string;
};

type ClaimedPushSubscription = MobilePushSubscription & { attempt: number };

type ExpoPushTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoPushReceipt = {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  badge: number;
  priority: "default" | "high";
  channelId: "alpha-trade-updates";
  ttl: number;
  collapseId: string;
  data: Record<string, string | boolean>;
};

class ExpoPushResponseError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "ExpoPushResponseError";
  }
}

let schemaPromise: Promise<void> | null = null;
let activePushLookups = 0;
const pushLookupWaiters: Array<() => void> = [];

async function withPushLookupSlot<T>(lookup: () => Promise<T>): Promise<T> {
  if (activePushLookups < MAX_CONCURRENT_PUSH_LOOKUPS) {
    activePushLookups += 1;
  } else {
    await new Promise<void>(resolve => pushLookupWaiters.push(resolve));
  }
  try {
    return await lookup();
  } finally {
    const next = pushLookupWaiters.shift();
    if (next) next(); // Transfer this slot to the oldest waiting lookup.
    else activePushLookups -= 1;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function mobilePushDeliveryKey(notification: AlphaExchangeNotification) {
  const revision = notification.updatedAt?.trim() || notification.createdAt;
  return `${notification.id}:${sha256(revision).slice(0, 20)}`;
}

function requirePushPool() {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Mobile push storage is unavailable.");
  return pool;
}

async function ensurePushSchema(pool: Pool) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`create table if not exists alpha_exchange.mobile_push_subscriptions (
        id text primary key,
        user_id text not null,
        session_token_hash text not null,
        installation_id_hash text not null,
        expo_push_token text not null unique,
        platform text not null check (platform in ('ios', 'android')),
        locale text not null check (locale in ('ar', 'en')),
        app_version text not null,
        active boolean not null default true,
        disabled_reason text,
        last_seen_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (user_id, installation_id_hash)
      )`);
      await pool.query(`create table if not exists alpha_exchange.mobile_push_deliveries (
        notification_id text not null,
        subscription_id text not null references alpha_exchange.mobile_push_subscriptions(id) on delete cascade,
        status text not null check (status in ('processing', 'sent', 'delivered', 'failed')),
        ticket_id text,
        attempt_count integer not null default 1 check (attempt_count > 0),
        last_error_code text,
        expo_push_token_hash text,
        receipt_checked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (notification_id, subscription_id)
      )`);
      await pool.query("alter table alpha_exchange.mobile_push_deliveries add column if not exists expo_push_token_hash text");
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_user_active on alpha_exchange.mobile_push_subscriptions (user_id, active, updated_at desc)");
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_session on alpha_exchange.mobile_push_subscriptions (session_token_hash)");
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_receipts on alpha_exchange.mobile_push_deliveries (status, updated_at) where status = 'sent' and ticket_id is not null");
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_recovery on alpha_exchange.notifications ((coalesce(nullif(btrim(payload->>'updatedAt'), ''), payload->>'createdAt')), user_id, id) where is_read = false");
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export function isExpoPushToken(value: string) {
  return EXPO_PUSH_TOKEN_PATTERN.test(value.trim());
}

export function isMobilePushInstallationId(value: string) {
  return INSTALLATION_ID_PATTERN.test(value.trim());
}

export async function registerMobilePushSubscription(input: {
  userId: string;
  sessionToken: string;
  installationId: string;
  expoPushToken: string;
  platform: MobilePlatform;
  locale: MobileLocale;
  appVersion: string;
}) {
  const userId = input.userId.trim();
  const sessionToken = input.sessionToken.trim();
  const installationId = input.installationId.trim();
  const expoPushToken = input.expoPushToken.trim();
  const appVersion = input.appVersion.trim();
  if (
    !userId
    || !sessionToken
    || !isMobilePushInstallationId(installationId)
    || !isExpoPushToken(expoPushToken)
    || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(appVersion)
  ) throw new Error("Invalid mobile push registration.");

  const pool = requirePushPool();
  await ensurePushSchema(pool);
  const client = await pool.connect();
  let destroy = false;

  try {
    await client.query("begin");
    const sessionTokenHash = sha256(sessionToken);
    const activeSession = await client.query<{ user_id: string }>(
      `select user_id from alpha_exchange.sessions
       where token_hash = $1 and user_id = $2 and expires_at > now()
       limit 1`,
      [sessionTokenHash, userId],
    );
    if (!activeSession.rows[0]) throw new Error("Authenticated session is no longer active.");

    const installationIdHash = sha256(installationId);
    await client.query(
      `delete from alpha_exchange.mobile_push_subscriptions
       where expo_push_token = $1
         and (user_id <> $2 or installation_id_hash <> $3)`,
      [expoPushToken, userId, installationIdHash],
    );
    const result = await client.query<{ id: string }>(
      `insert into alpha_exchange.mobile_push_subscriptions (
         id, user_id, session_token_hash, installation_id_hash,
         expo_push_token, platform, locale, app_version, active,
         disabled_reason, last_seen_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, true, null, now(), now(), now())
       on conflict (user_id, installation_id_hash) do update set
         session_token_hash = excluded.session_token_hash,
         expo_push_token = excluded.expo_push_token,
         platform = excluded.platform,
         locale = excluded.locale,
         app_version = excluded.app_version,
         active = true,
         disabled_reason = null,
         last_seen_at = now(),
         updated_at = now()
       returning id`,
      [
        `push-${randomUUID()}`,
        userId,
        sessionTokenHash,
        installationIdHash,
        expoPushToken,
        input.platform,
        input.locale,
        appVersion,
      ],
    );
    await client.query("commit");
    return { id: result.rows[0]?.id ?? "", registered: true as const };
  } catch (error) {
    destroy = await rollbackFailedTransaction(client, error);
    throw error;
  } finally {
    client.release(destroy);
  }
}

function websitePathForMobileDestination(
  notification: AlphaExchangeNotification,
  locale: MobileLocale,
) {
  const explicitDestination = getSafeInternalNotificationDestination(notification);
  if (explicitDestination) {
    try {
      const parsed = new URL(explicitDestination, "https://www.alphatraders.co.il");
      const pathname = parsed.pathname.replace(/^\/(?:ar|en)(?=\/|$)/i, "") || "/";
      return `/${locale}${pathname}${parsed.search}${parsed.hash}`;
    } catch {
      // Fall through to the strict native destination allowlist.
    }
  }
  const destination = toMobileNotification(notification, locale).destination;
  switch (destination?.screen) {
    case "trade":
      return `/${locale}/trade-room/${encodeURIComponent(destination.requestId)}`;
    case "marketplace":
      return `/${locale}/usdt-exchange`;
    case "seller":
      return `/${locale}/dashboard/seller`;
    case "profile":
      return `/${locale}/profile`;
    case "settings":
      return `/${locale}/settings`;
    case "seller_application":
      return `/${locale}/dashboard#seller-application`;
    case "admin":
      return `/${locale}/admin/alpha-exchange`;
    default:
      return `/${locale}/notifications`;
  }
}

export function privacySafeMobilePushCopy(
  notification: Pick<AlphaExchangeNotification, "category" | "title">,
  locale: MobileLocale,
) {
  const normalizedTitle = notification.title.trim().toLowerCase();
  if (notification.category === "listing") {
    const requestCopy: Record<string, { en: { title: string; body: string }; ar: { title: string; body: string } }> = {
      "new usdt request": {
        en: { title: "New USDT request", body: "Open Alpha Traders to review the request and respond." },
        ar: { title: "طلب USDT جديد", body: "افتح Alpha Traders لمراجعة الطلب والرد عليه." },
      },
      "new response to your usdt request": {
        en: { title: "New response to your USDT request", body: "Open Alpha Traders to review the response." },
        ar: { title: "رد جديد على طلب USDT الخاص بك", body: "افتح Alpha Traders لمراجعة الرد." },
      },
      "usdt request cancelled": {
        en: { title: "USDT request cancelled", body: "The request you responded to was cancelled. Open Alpha Traders for details." },
        ar: { title: "تم إلغاء طلب USDT", body: "تم إلغاء الطلب الذي رددت عليه. افتح Alpha Traders لعرض التفاصيل." },
      },
      "response to your usdt request withdrawn": {
        en: { title: "Response withdrawn", body: "A seller withdrew their response to your USDT request. Open Alpha Traders to review your request." },
        ar: { title: "تم سحب رد على طلبك", body: "سحب أحد البائعين رده على طلب USDT الخاص بك. افتح Alpha Traders لمراجعة طلبك." },
      },
      "your usdt request expired": {
        en: { title: "Your USDT request expired", body: "Open Alpha Traders to review and renew your request if needed." },
        ar: { title: "انتهت صلاحية طلب USDT الخاص بك", body: "افتح Alpha Traders لمراجعة طلبك وتجديده إذا لزم الأمر." },
      },
    };
    if (Object.hasOwn(requestCopy, normalizedTitle)) return requestCopy[normalizedTitle][locale];
  }
  if (notification.category === "application" && normalizedTitle === "seller application approved") {
    return locale === "ar"
      ? { title: "تم اعتماد حسابك كبائع", body: "حسابك كبائع نشط الآن. افتح Alpha Traders للبدء." }
      : { title: "Your seller account is approved", body: "Your seller account is now active. Open Alpha Traders to get started." };
  }
  if (normalizedTitle === "new trade room message") {
    return locale === "ar"
      ? { title: "رسالة جديدة في غرفة التداول", body: "افتح Alpha Traders لقراءة الرسالة بأمان." }
      : { title: "New Trade Room message", body: "Open Alpha Traders to read it securely." };
  }
  if (normalizedTitle === "trade completed") {
    return locale === "ar"
      ? { title: "اكتملت الصفقة", body: "اكتملت صفقتك. افتح Alpha Traders لعرض التفاصيل." }
      : { title: "Trade completed", body: "Your trade is complete. Open Alpha Traders for details." };
  }
  if (notification.category === "trade" || notification.category === "dispute" || notification.category === "review") {
    return locale === "ar"
      ? { title: "تحديث على الصفقة", body: "افتح Alpha Traders لمعرفة آخر تحديث والخطوة المطلوبة." }
      : { title: "Trade update", body: "Open Alpha Traders for the latest update and next step." };
  }
  if (notification.category === "listing") {
    return locale === "ar"
      ? { title: "تحديث على العرض", body: "افتح Alpha Traders لمراجعة آخر تحديث على العرض." }
      : { title: "Listing update", body: "Open Alpha Traders to review the latest listing update." };
  }
  return locale === "ar"
    ? { title: "تحديث من Alpha Traders", body: "افتح التطبيق لعرض التحديث بأمان." }
    : { title: "Alpha Traders update", body: "Open the app to view the update securely." };
}

export function buildExpoPushMessage(
  notification: AlphaExchangeNotification,
  subscription: Pick<MobilePushSubscription, "expoPushToken" | "locale">,
  unreadCount = 1,
): ExpoPushMessage {
  const copy = privacySafeMobilePushCopy(notification, subscription.locale);
  const completedTrade = notification.category === "trade"
    && notification.title.trim().toLowerCase() === "trade completed";
  const tradeReference = notification.relatedRequestId?.trim()
    || notification.relatedTradeId?.trim()
    || notification.id;
  return {
    to: subscription.expoPushToken,
    title: copy.title,
    body: copy.body,
    sound: "default",
    badge: Number.isFinite(unreadCount)
      ? Math.min(9_999, Math.max(0, Math.trunc(unreadCount)))
      : 1,
    priority: notification.priority === "high" || notification.priority === "critical"
      ? "high"
      : "default",
    channelId: "alpha-trade-updates",
    ttl: 24 * 60 * 60,
    collapseId: notification.id.slice(0, 64),
    data: {
      url: `https://www.alphatraders.co.il${websitePathForMobileDestination(notification, subscription.locale)}`,
      notificationId: notification.id,
      category: notification.category,
      ...(completedTrade ? { reviewEligible: true, tradeReference } : {}),
    },
  };
}

function retryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(PUSH_RETRY_DELAY_CAP_MS, Math.round(seconds * 1_000));
  }
  const at = new Date(value).getTime();
  return Number.isFinite(at)
    ? Math.min(PUSH_RETRY_DELAY_CAP_MS, Math.max(0, at - Date.now()))
    : null;
}

function waitForPushRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function fetchExpoJson(url: string, body: unknown, options: {
  maxAttempts?: number;
  beforeAttempt?: () => Promise<unknown | null>;
} = {}) {
  let lastError: unknown;
  const maxAttempts = options.maxAttempts ?? PUSH_FETCH_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Recheck account/session/notification state after every provider backoff.
    // A logout or token rotation must not send a captured batch on retry.
    const currentBody = options.beforeAttempt ? await options.beforeAttempt() : body;
    if (currentBody === null) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_FETCH_TIMEOUT_MS);
    try {
      const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(currentBody),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (response.ok) return payload;
      throw new ExpoPushResponseError(
        `Expo push service returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        retryAfterMs(response.headers.get("retry-after")),
      );
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof ExpoPushResponseError) || error.retryable;
      if (!retryable || attempt === maxAttempts - 1) throw error;
      const retryDelay = error instanceof ExpoPushResponseError && error.retryAfterMs !== null
        ? error.retryAfterMs
        : Math.min(PUSH_RETRY_DELAY_CAP_MS, 250 * (2 ** attempt));
      await waitForPushRetry(retryDelay);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Expo push request failed.");
}

async function claimDelivery(
  pool: Pool,
  notificationId: string,
  subscription: MobilePushSubscription,
) {
  const result = await pool.query(
    `insert into alpha_exchange.mobile_push_deliveries (
       notification_id, subscription_id, status, attempt_count, expo_push_token_hash, created_at, updated_at
     ) values ($1, $2, 'processing', 1, $3, now(), now())
     on conflict (notification_id, subscription_id) do update set
       status = 'processing',
       attempt_count = alpha_exchange.mobile_push_deliveries.attempt_count + 1,
       ticket_id = null,
       last_error_code = null,
       receipt_checked_at = null,
       expo_push_token_hash = excluded.expo_push_token_hash,
       updated_at = now()
     where alpha_exchange.mobile_push_deliveries.status in ('failed', 'processing')
       and alpha_exchange.mobile_push_deliveries.attempt_count < 3
       and alpha_exchange.mobile_push_deliveries.last_error_code is distinct from 'EXPO_RECEIPT_EXPIRED'
       and alpha_exchange.mobile_push_deliveries.updated_at < now() - interval '30 seconds'
     returning attempt_count`,
    [notificationId, subscription.id, sha256(subscription.expoPushToken)],
  );
  return result.rows[0]?.attempt_count as number | undefined;
}

async function completeDelivery(
  pool: Pool,
  notificationId: string,
  subscription: ClaimedPushSubscription,
  ticket: ExpoPushTicket | undefined,
) {
  if (ticket?.status === "ok" && ticket.id) {
    await pool.query(
      `update alpha_exchange.mobile_push_deliveries
       set status = 'sent', ticket_id = $3, last_error_code = null, updated_at = now()
       where notification_id = $1 and subscription_id = $2 and attempt_count = $4 and status = 'processing'`,
      [notificationId, subscription.id, ticket.id, subscription.attempt],
    );
    return;
  }
  const errorCode = ticket?.details?.error?.trim() || "EXPO_PUSH_REJECTED";
  const completed = await pool.query(
    `update alpha_exchange.mobile_push_deliveries
     set status = 'failed', last_error_code = $3, updated_at = now()
     where notification_id = $1 and subscription_id = $2 and attempt_count = $4 and status = 'processing'`,
    [notificationId, subscription.id, errorCode, subscription.attempt],
  );
  if (!completed.rowCount) return;
  if (errorCode === "DeviceNotRegistered") {
    await pool.query(
      `update alpha_exchange.mobile_push_subscriptions
       set active = false, disabled_reason = 'DeviceNotRegistered', updated_at = now()
       where id = $1 and expo_push_token = $2`,
      [subscription.id, subscription.expoPushToken],
    );
  }
}

async function sendClaimedBatch(
  pool: Pool,
  notification: AlphaExchangeNotification,
  deliveryKey: string,
  subscriptions: ClaimedPushSubscription[],
  unreadCount: number,
  maxAttempts?: number,
  recovery = false,
) {
  let currentSubscriptions = subscriptions;
  let tickets: ExpoPushTicket[] = [];
  try {
    const response = await fetchExpoJson(EXPO_PUSH_SEND_URL, null, {
      maxAttempts,
      beforeAttempt: async () => {
        const fresh = await readEligiblePushRows(pool, notification, recovery, subscriptions);
        const canonical = fresh.rows[0]?.payload;
        if (!canonical || mobilePushDeliveryKey(canonical) !== deliveryKey) {
          currentSubscriptions = [];
          return null;
        }
        currentSubscriptions = subscriptions.filter(subscription => fresh.rows.some(row =>
          row.id === subscription.id && row.expo_push_token === subscription.expoPushToken
          && row.session_token_hash === subscription.sessionTokenHash));
        return currentSubscriptions.length ? currentSubscriptions.map(subscription => buildExpoPushMessage(
          canonical, subscription, fresh.rows[0]?.unread_count ?? unreadCount,
        )) : null;
      },
    }) as { data?: ExpoPushTicket[] | ExpoPushTicket } | null;
    tickets = Array.isArray(response?.data) ? response.data : response?.data ? [response.data] : [];
  } catch (error) {
    logEvent("error", {
      event: "mobile_push_send",
      targetUserId: notification.userId,
      resourceId: notification.id,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Expo push request failed.",
      metadata: { recipientCount: subscriptions.length },
    });
  }
  await Promise.all(subscriptions.map(subscription => {
    const index = currentSubscriptions.indexOf(subscription);
    return completeDelivery(pool, deliveryKey, subscription, index >= 0 ? tickets[index] : undefined);
  }));
}

const receiptReconciliations = new WeakMap<Pool, Promise<void>>();
const emptyReceiptScans = new WeakMap<Pool, number>();
// Receipt eligibility starts after 15 minutes. Reuse only a confirmed empty
// scan for one second to avoid borrowing a connection for every publication.
// Use a monotonic clock; failed or nonempty scans never suppress recovery.
const EMPTY_RECEIPT_SCAN_REUSE_MS = 1_000;

function reconcileExpoPushReceipts(pool: Pool, maxAttempts?: number): Promise<void> {
  const active = receiptReconciliations.get(pool);
  if (active) return active;
  const emptyAt = emptyReceiptScans.get(pool);
  if (emptyAt !== undefined && performance.now() - emptyAt < EMPTY_RECEIPT_SCAN_REUSE_MS) {
    return Promise.resolve();
  }
  emptyReceiptScans.delete(pool);
  const task = reconcileExpoPushReceiptBatch(pool, maxAttempts).finally(() => {
    if (receiptReconciliations.get(pool) === task) receiptReconciliations.delete(pool);
  });
  receiptReconciliations.set(pool, task);
  return task;
}

async function reconcileExpoPushReceiptBatch(pool: Pool, maxAttempts?: number) {
  const pending = await pool.query<{ notification_id: string; subscription_id: string; ticket_id: string;
    expo_push_token_hash: string | null; expired: boolean }>(
    `select notification_id, subscription_id, ticket_id, expo_push_token_hash,
            updated_at < now() - interval '24 hours' as expired
     from alpha_exchange.mobile_push_deliveries
     where status = 'sent'
       and ticket_id is not null
       and updated_at < now() - interval '15 minutes'
       and (receipt_checked_at is null or receipt_checked_at < now() - interval '6 hours')
     order by coalesce(receipt_checked_at, updated_at) asc
     limit 100`,
  );
  if (pending.rows.length === 0) {
    emptyReceiptScans.set(pool, performance.now());
    return;
  }
  try {
    // Expo discards receipts after 24 hours. Missing receipts must rotate out
    // of the bounded batch and must never turn into a duplicate resend.
    const live = pending.rows.filter(row => !row.expired);
    const response = live.length ? await fetchExpoJson(EXPO_PUSH_RECEIPTS_URL, {
      ids: live.map((row) => row.ticket_id),
    }, { maxAttempts }) as { data?: Record<string, ExpoPushReceipt> } | null : null;
    await Promise.all(pending.rows.map(async (row) => {
      const receipt = response?.data?.[row.ticket_id];
      if (!receipt || (receipt.status !== "ok" && receipt.status !== "error")) {
        await pool.query(`update alpha_exchange.mobile_push_deliveries
          set receipt_checked_at = now(),
              status = case when $4 then 'failed' else status end,
              last_error_code = case when $4 then 'EXPO_RECEIPT_EXPIRED' else last_error_code end
          where notification_id = $1 and subscription_id = $2 and ticket_id = $3 and status = 'sent'`,
        [row.notification_id, row.subscription_id, row.ticket_id, row.expired]);
        return;
      }
      const errorCode = receipt.details?.error?.trim() || null;
      const reconciled = await pool.query(
        `update alpha_exchange.mobile_push_deliveries
         set status = $3, last_error_code = $4, receipt_checked_at = now(), updated_at = now()
         where notification_id = $1 and subscription_id = $2 and ticket_id = $5 and status = 'sent'`,
        [row.notification_id, row.subscription_id, receipt.status === "ok" ? "delivered" : "failed", errorCode, row.ticket_id],
      );
      if (reconciled.rowCount && errorCode === "DeviceNotRegistered") {
        await pool.query(
          `update alpha_exchange.mobile_push_subscriptions
           set active = false, disabled_reason = 'DeviceNotRegistered', updated_at = now()
           where id = $1 and $2::text is not null
             and encode(sha256(convert_to(expo_push_token, 'UTF8')), 'hex') = $2`,
          [row.subscription_id, row.expo_push_token_hash],
        );
      }
    }));
  } catch {
    // Receipt reconciliation is opportunistic. The ticket remains pending and
    // a later notification delivery retries this bounded receipt batch.
  }
}

type EligiblePushRow = {
  payload: AlphaExchangeNotification;
  unread_count: number;
  id: string;
  user_id: string;
  expo_push_token: string;
  session_token_hash: string;
  platform: MobilePlatform;
  locale: MobileLocale;
};

// Critical transactional notifications intentionally survive the optional
// in-app preference, matching forceInApp publication in the exchange store.
const NATIVE_PUSH_RECIPIENT_FILTER = `recipient.payload->>'disabled' is distinct from 'true'
  and (recipient.payload->'notificationPreferences'->>'inApp' is distinct from 'false'
       or notification.category in ('trade', 'dispute', 'application'))
  and not notification.is_read
  and notification.payload->>'isRead' is distinct from 'true'
  and coalesce(notification.payload->>'state', 'unread') = 'unread'
  and notification.payload->>'whatsappChannelOnly' is distinct from 'true'`;

// Store revisions are UTC ISO strings from nowIso(). Keep this expression in
// sync with the recovery index and JS key; notifications has no updated_at column.
const NATIVE_PUSH_REVISION_SQL = "coalesce(nullif(btrim(notification.payload->>'updatedAt'), ''), notification.payload->>'createdAt')";
const PUSH_SUBSCRIPTION_CREATED_ISO_SQL = `to_char(push.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const NATIVE_PUSH_DELIVERY_KEY_SQL = `notification.id || ':' || left(encode(sha256(convert_to(
  ${NATIVE_PUSH_REVISION_SQL}, 'UTF8')), 'hex'), 20)`;
const NATIVE_PUSH_DELIVERY_DUE_SQL = `(delivery.notification_id is null or (
  delivery.status in ('failed', 'processing') and delivery.attempt_count < 3
  and delivery.last_error_code is distinct from 'EXPO_RECEIPT_EXPIRED'
  and delivery.updated_at < now() - interval '30 seconds'))`;

function readEligiblePushRows(pool: Pool, notification: Pick<AlphaExchangeNotification, "id" | "userId">,
  recovery = false, claims?: ClaimedPushSubscription[]) {
  // Read the committed notification and eligible sessions together. A burst
  // without any registered devices needs no separate notification/count read.
  // Apply the device cap after excluding completed/non-due deliveries. Each
  // later sweep can then reach older devices instead of reselecting the same
  // twenty already-sent subscriptions. Send-time reads use the exact claimed
  // IDs/attempts so newly registered devices cannot displace active work.
  // Queue only database lookups. Provider calls and shared receipt
  // recovery never retain a slot, so a slow provider cannot block other users.
  // The row and session remain canonical when a queued lookup actually runs.
  return withPushLookupSlot(() => pool.query<EligiblePushRow>(
    `select notification.payload, push.id, push.user_id, push.expo_push_token, push.session_token_hash, push.platform, push.locale,
            (select count(*)::int from alpha_exchange.notifications unread
             where unread.user_id = notification.user_id and unread.is_read = false) as unread_count
     from alpha_exchange.notifications notification
     join alpha_exchange.users recipient on recipient.id = notification.user_id
     join alpha_exchange.mobile_push_subscriptions push on push.user_id = notification.user_id
     join alpha_exchange.sessions session
       on session.token_hash = push.session_token_hash
      and session.user_id = push.user_id
      and session.expires_at > now()
     left join alpha_exchange.mobile_push_deliveries delivery on delivery.subscription_id = push.id
       and delivery.notification_id = ${NATIVE_PUSH_DELIVERY_KEY_SQL}
     where notification.id = $1 and notification.user_id = $2 and push.active = true
       and ${NATIVE_PUSH_RECIPIENT_FILTER}
       and ($3::text is null or ${NATIVE_PUSH_REVISION_SQL} >= greatest($3, ${PUSH_SUBSCRIPTION_CREATED_ISO_SQL}))
       and (($4::text[] is null and ${NATIVE_PUSH_DELIVERY_DUE_SQL})
         or ($4::text[] is not null and delivery.status = 'processing' and exists (
           select 1 from unnest($4::text[], $5::integer[]) as claimed(subscription_id, attempt)
           where claimed.subscription_id = push.id and claimed.attempt = delivery.attempt_count)))
     order by push.updated_at desc, push.id asc
     limit 20`,
    [notification.id, notification.userId,
      recovery ? new Date(Date.now() - 24 * 60 * 60_000).toISOString() : null,
      claims?.map(subscription => subscription.id) ?? null,
      claims?.map(subscription => subscription.attempt) ?? null],
  ));
}

export async function deliverMobilePushNotification(notification: AlphaExchangeNotification, options: {
  providerMaxAttempts?: number;
  reconcileReceipts?: boolean;
  recovery?: boolean;
} = {}) {
  const pool = requirePushPool();
  await ensurePushSchema(pool);
  const result = await readEligiblePushRows(pool, notification, options.recovery);
  const canonical = result.rows[0]?.payload;
  if (!canonical || canonical.isRead || canonical.state === "read" || canonical.state === "archived") {
    // Receipt recovery is independent of whether this recipient has a device.
    // Concurrent publications share one bounded batch, then later calls retry.
    if (options.reconcileReceipts !== false) await reconcileExpoPushReceipts(pool);
    return;
  }
  const unreadCount = result.rows[0]?.unread_count ?? 1;
  const deliveryKey = mobilePushDeliveryKey(canonical);
  const subscriptions: MobilePushSubscription[] = result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    expoPushToken: row.expo_push_token,
    platform: row.platform,
    locale: row.locale,
    sessionTokenHash: row.session_token_hash,
  }));
  const claimed: ClaimedPushSubscription[] = [];
  for (const subscription of subscriptions) {
    const attempt = await claimDelivery(pool, deliveryKey, subscription);
    if (attempt) claimed.push({ ...subscription, attempt });
  }
  for (let index = 0; index < claimed.length; index += MAX_PUSH_BATCH) {
    await sendClaimedBatch(
      pool,
      canonical,
      deliveryKey,
      claimed.slice(index, index + MAX_PUSH_BATCH),
      unreadCount,
      options.providerMaxAttempts,
      options.recovery,
    );
  }
  if (options.reconcileReceipts !== false) await reconcileExpoPushReceipts(pool);
}

let deliverySweep: Promise<{ processed: number; failed: number }> | null = null;

/** Recover committed publications and interrupted sends without replaying
 * history to newly registered devices. SQL uses the same SHA-256 revision key
 * as mobilePushDeliveryKey; claims remain authoritative across cron replicas. */
export function runMobilePushDeliverySweep() {
  if (deliverySweep) return deliverySweep;
  deliverySweep = (async () => {
    const pool = requirePushPool();
    await ensurePushSchema(pool);
    const deadline = Date.now() + 40_000;
    await reconcileExpoPushReceipts(pool, 1);
    const candidates = await pool.query<{ payload: AlphaExchangeNotification }>(`
      select notification.payload
      from alpha_exchange.notifications notification
      join alpha_exchange.users recipient on recipient.id = notification.user_id
      join alpha_exchange.mobile_push_subscriptions push on push.user_id = notification.user_id and push.active
      join alpha_exchange.sessions session on session.token_hash = push.session_token_hash
        and session.user_id = push.user_id and session.expires_at > now()
      left join alpha_exchange.mobile_push_deliveries delivery on delivery.subscription_id = push.id
        and delivery.notification_id = ${NATIVE_PUSH_DELIVERY_KEY_SQL}
      where ${NATIVE_PUSH_RECIPIENT_FILTER}
        and ${NATIVE_PUSH_REVISION_SQL} >= greatest($1, ${PUSH_SUBSCRIPTION_CREATED_ISO_SQL})
        and ${NATIVE_PUSH_DELIVERY_DUE_SQL}
      group by notification.id, notification.payload
      order by case notification.payload->>'priority' when 'critical' then 0 when 'high' then 1 else 2 end,
        ${NATIVE_PUSH_REVISION_SQL} asc, notification.id asc
      limit 12`, [new Date(Date.now() - 24 * 60 * 60_000).toISOString()]);
    let processed = 0;
    let failed = 0;
    for (const row of candidates.rows) {
      if (Date.now() + PUSH_FETCH_TIMEOUT_MS >= deadline) break;
      processed += 1;
      try {
        await deliverMobilePushNotification(row.payload, { providerMaxAttempts: 1, reconcileReceipts: false, recovery: true });
      } catch {
        failed += 1;
      }
    }
    return { processed, failed };
  })().finally(() => { deliverySweep = null; });
  return deliverySweep;
}

export function scheduleMobilePushDelivery(notification: AlphaExchangeNotification) {
  const deliver = () => deliverMobilePushNotification(notification).catch((error) => {
    logEvent("error", {
      event: "mobile_push_delivery",
      targetUserId: notification.userId,
      resourceId: notification.id,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Mobile push delivery failed.",
    });
  });
  try {
    // The callback runs only after the request that persisted the notification
    // has completed. Delivery re-reads the canonical row before sending.
    after(deliver);
  } catch {
    // Store helpers also run in isolated tests and long-lived workers where a
    // Next request context is unavailable. Railway workers can safely use the
    // canonical delayed fallback; tests deliberately remain side-effect free.
    if (process.env.NODE_ENV === "production") {
      const timeout = setTimeout(() => void deliver(), 250);
      timeout.unref?.();
    }
  }
}
