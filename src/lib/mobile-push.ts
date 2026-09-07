import { createHash, randomUUID } from "crypto";
import { after } from "next/server";
import type { Pool, PoolClient } from "pg";
import type { MobileLocale, MobilePlatform } from "@alpha-traders/contracts";
import { toMobileNotification } from "@/lib/mobile-notifications";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { logEvent } from "@/lib/structured-logging";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const PUSH_FETCH_TIMEOUT_MS = 5_000;
const PUSH_FETCH_MAX_ATTEMPTS = 3;
const PUSH_RETRY_DELAY_CAP_MS = 5_000;
const MAX_PUSH_BATCH = 100;
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9._=+\/-]{8,220}\]$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

type MobilePushSubscription = {
  id: string;
  userId: string;
  expoPushToken: string;
  platform: MobilePlatform;
  locale: MobileLocale;
};

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
        receipt_checked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (notification_id, subscription_id)
      )`);
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_user_active on alpha_exchange.mobile_push_subscriptions (user_id, active, updated_at desc)");
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_session on alpha_exchange.mobile_push_subscriptions (session_token_hash)");
      await pool.query("create index if not exists idx_alpha_exchange_mobile_push_receipts on alpha_exchange.mobile_push_deliveries (status, updated_at) where status = 'sent' and ticket_id is not null");
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
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function websitePathForMobileDestination(
  notification: AlphaExchangeNotification,
  locale: MobileLocale,
) {
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

async function fetchExpoJson(url: string, body: unknown) {
  let lastError: unknown;
  for (let attempt = 0; attempt < PUSH_FETCH_MAX_ATTEMPTS; attempt += 1) {
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
        body: JSON.stringify(body),
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
      if (!retryable || attempt === PUSH_FETCH_MAX_ATTEMPTS - 1) throw error;
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
  subscriptionId: string,
) {
  const result = await pool.query(
    `insert into alpha_exchange.mobile_push_deliveries (
       notification_id, subscription_id, status, attempt_count, created_at, updated_at
     ) values ($1, $2, 'processing', 1, now(), now())
     on conflict (notification_id, subscription_id) do update set
       status = 'processing',
       attempt_count = alpha_exchange.mobile_push_deliveries.attempt_count + 1,
       last_error_code = null,
       updated_at = now()
     where alpha_exchange.mobile_push_deliveries.status = 'failed'
       and alpha_exchange.mobile_push_deliveries.attempt_count < 3
       and alpha_exchange.mobile_push_deliveries.updated_at < now() - interval '30 seconds'
     returning notification_id`,
    [notificationId, subscriptionId],
  );
  return (result.rowCount ?? 0) === 1;
}

async function completeDelivery(
  pool: Pool,
  notificationId: string,
  subscriptionId: string,
  ticket: ExpoPushTicket | undefined,
) {
  if (ticket?.status === "ok" && ticket.id) {
    await pool.query(
      `update alpha_exchange.mobile_push_deliveries
       set status = 'sent', ticket_id = $3, last_error_code = null, updated_at = now()
       where notification_id = $1 and subscription_id = $2`,
      [notificationId, subscriptionId, ticket.id],
    );
    return;
  }
  const errorCode = ticket?.details?.error?.trim() || "EXPO_PUSH_REJECTED";
  await pool.query(
    `update alpha_exchange.mobile_push_deliveries
     set status = 'failed', last_error_code = $3, updated_at = now()
     where notification_id = $1 and subscription_id = $2`,
    [notificationId, subscriptionId, errorCode],
  );
  if (errorCode === "DeviceNotRegistered") {
    await pool.query(
      `update alpha_exchange.mobile_push_subscriptions
       set active = false, disabled_reason = 'DeviceNotRegistered', updated_at = now()
       where id = $1`,
      [subscriptionId],
    );
  }
}

async function sendClaimedBatch(
  pool: Pool,
  notification: AlphaExchangeNotification,
  deliveryKey: string,
  subscriptions: MobilePushSubscription[],
  unreadCount: number,
) {
  const messages = subscriptions.map((subscription) => buildExpoPushMessage(
    notification,
    subscription,
    unreadCount,
  ));
  let tickets: ExpoPushTicket[] = [];
  try {
    const response = await fetchExpoJson(EXPO_PUSH_SEND_URL, messages) as { data?: ExpoPushTicket[] | ExpoPushTicket } | null;
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
  await Promise.all(subscriptions.map((subscription, index) =>
    completeDelivery(pool, deliveryKey, subscription.id, tickets[index])));
}

async function reconcileExpoPushReceipts(pool: Pool) {
  const pending = await pool.query<{ notification_id: string; subscription_id: string; ticket_id: string }>(
    `select notification_id, subscription_id, ticket_id
     from alpha_exchange.mobile_push_deliveries
     where status = 'sent'
       and ticket_id is not null
       and updated_at < now() - interval '15 minutes'
       and (receipt_checked_at is null or receipt_checked_at < now() - interval '6 hours')
     order by updated_at asc
     limit 100`,
  );
  if (pending.rows.length === 0) return;
  try {
    const response = await fetchExpoJson(EXPO_PUSH_RECEIPTS_URL, {
      ids: pending.rows.map((row) => row.ticket_id),
    }) as { data?: Record<string, ExpoPushReceipt> } | null;
    await Promise.all(pending.rows.map(async (row) => {
      const receipt = response?.data?.[row.ticket_id];
      if (!receipt) return;
      const errorCode = receipt.details?.error?.trim() || null;
      await pool.query(
        `update alpha_exchange.mobile_push_deliveries
         set status = $3, last_error_code = $4, receipt_checked_at = now(), updated_at = now()
         where notification_id = $1 and subscription_id = $2`,
        [row.notification_id, row.subscription_id, receipt.status === "ok" ? "delivered" : "failed", errorCode],
      );
      if (errorCode === "DeviceNotRegistered") {
        await pool.query(
          `update alpha_exchange.mobile_push_subscriptions
           set active = false, disabled_reason = 'DeviceNotRegistered', updated_at = now()
           where id = $1`,
          [row.subscription_id],
        );
      }
    }));
  } catch {
    // Receipt reconciliation is opportunistic. The ticket remains pending and
    // a later notification delivery retries this bounded receipt batch.
  }
}

export async function deliverMobilePushNotification(notification: AlphaExchangeNotification) {
  const pool = requirePushPool();
  await ensurePushSchema(pool);
  const canonicalResult = await pool.query<{ payload: AlphaExchangeNotification; unread_count: number }>(
    `select notification.payload,
            (select count(*)::int
             from alpha_exchange.notifications unread
             where unread.user_id = $2 and unread.is_read = false) as unread_count
     from alpha_exchange.notifications notification
     where notification.id = $1 and notification.user_id = $2
     limit 1`,
    [notification.id, notification.userId],
  );
  const canonical = canonicalResult.rows[0]?.payload;
  if (!canonical || canonical.isRead || canonical.state === "read" || canonical.state === "archived") return;
  const unreadCount = canonicalResult.rows[0]?.unread_count ?? 1;
  const deliveryKey = mobilePushDeliveryKey(canonical);

  const result = await pool.query<{
    id: string;
    user_id: string;
    expo_push_token: string;
    platform: MobilePlatform;
    locale: MobileLocale;
  }>(
    `select push.id, push.user_id, push.expo_push_token, push.platform, push.locale
     from alpha_exchange.mobile_push_subscriptions push
     join alpha_exchange.sessions session
       on session.token_hash = push.session_token_hash
      and session.user_id = push.user_id
      and session.expires_at > now()
     where push.user_id = $1 and push.active = true
     order by push.updated_at desc
     limit 20`,
    [canonical.userId],
  );
  const subscriptions: MobilePushSubscription[] = result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    expoPushToken: row.expo_push_token,
    platform: row.platform,
    locale: row.locale,
  }));
  const claimed: MobilePushSubscription[] = [];
  for (const subscription of subscriptions) {
    if (await claimDelivery(pool, deliveryKey, subscription.id)) claimed.push(subscription);
  }
  for (let index = 0; index < claimed.length; index += MAX_PUSH_BATCH) {
    await sendClaimedBatch(
      pool,
      canonical,
      deliveryKey,
      claimed.slice(index, index + MAX_PUSH_BATCH),
      unreadCount,
    );
  }
  await reconcileExpoPushReceipts(pool);
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
