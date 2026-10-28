import "server-only";
import { createECDH, createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import webpush from "web-push";
import { getRuntimePostgresPool } from "./postgres-runtime";
import { ensureNotificationEngagementSchema } from "./notification-engagement-schema";
import { getSafeInternalNotificationDestination } from "./notification-action-destination";
import { getTradeRoomConversationDestination, isTradeRoomConversationNotification } from "./trade-room-notification-destination";
import { privacySafeMobilePushCopy } from "./mobile-push";
import { demandNotificationDestination } from "./usdt-demand-notification";
import type { AlphaExchangeNotification, NotificationPreferences } from "@/types/alpha-exchange";

export const pushHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function browserPushConfiguration() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || process.env.WEB_PUSH_ENABLED !== "true") return null;
  try {
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
    const configuredPublic = Buffer.from(publicKey, "base64url");
    const derivedPublic = pair.getPublicKey();
    if (configuredPublic.length !== derivedPublic.length || !timingSafeEqual(configuredPublic, derivedPublic)) return null;
    // Validate before advertising a working channel to a user.
    webpush.generateRequestDetails({ endpoint: "https://fcm.googleapis.com/fcm/send/config-check", keys: { p256dh: publicKey, auth: Buffer.alloc(16).toString("base64url") } }, undefined,
      { vapidDetails: { subject, publicKey, privateKey } });
    return { subject, publicKey, privateKey };
  } catch { return null; }
}

export function parseBrowserPushSubscription(value: unknown): webpush.PushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<webpush.PushSubscription>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 2048) return null;
  try {
    const url = new URL(candidate.endpoint);
    const trusted = url.hostname === "fcm.googleapis.com"
      || url.hostname === "updates.push.services.mozilla.com"
      || /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(url.hostname)
      || /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname)
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
    if (!trusted || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
    const { p256dh, auth } = candidate.keys ?? {};
    if (typeof p256dh !== "string" || typeof auth !== "string"
      || !/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth)
      || Buffer.from(p256dh, "base64url").length !== 65 || Buffer.from(p256dh, "base64url")[0] !== 4
      || Buffer.from(auth, "base64url").length !== 16) return null;
    return { endpoint: url.href, keys: { p256dh, auth } };
  } catch { return null; }
}

export async function saveBrowserPush(input: { userId: string; sessionToken: string; subscription: webpush.PushSubscription; locale: "ar" | "en" }) {
  const subscription = parseBrowserPushSubscription(input.subscription);
  if (!subscription) throw new Error("Invalid subscription");
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Push storage unavailable");
  await ensureNotificationEngagementSchema(pool);
  const result = await pool.query<{ active: boolean }>(`insert into alpha_exchange.browser_push_subscriptions
    (endpoint_hash, user_id, session_token_hash, subscription, locale)
    select $1,$2,$3,$4::jsonb,$5 from alpha_exchange.sessions
    where token_hash=$3 and user_id=$2 and expires_at>now()
    on conflict(endpoint_hash) do update set user_id=excluded.user_id,
      session_token_hash=excluded.session_token_hash, subscription=excluded.subscription,
      locale=excluded.locale,
      active=alpha_exchange.browser_push_subscriptions.active
        or alpha_exchange.browser_push_subscriptions.subscription is distinct from excluded.subscription,
      created_at=case when alpha_exchange.browser_push_subscriptions.user_id<>excluded.user_id then now() else alpha_exchange.browser_push_subscriptions.created_at end,
      updated_at=now()
    returning active`, [pushHash(subscription.endpoint), input.userId, pushHash(input.sessionToken), JSON.stringify(subscription), input.locale]);
  if (!result.rowCount) throw new Error("Session ended");
  // Browser APIs may retain a locally cached subscription after the provider
  // retires it. A health refresh must not revive that rejected endpoint/key.
  return result.rows[0].active;
}

export async function removeBrowserPush(userId: string, endpoint: string) {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Push storage unavailable");
  await ensureNotificationEngagementSchema(pool);
  await pool.query("update alpha_exchange.browser_push_subscriptions set active=false, updated_at=now() where user_id=$1 and endpoint_hash=$2", [userId, pushHash(endpoint)]);
}

export function browserPushCategoryEnabled(notice: AlphaExchangeNotification, preferences: Partial<NotificationPreferences>) {
  if (preferences.browserPush !== true || preferences.inApp === false || notice.whatsappChannelOnly) return false;
  const destination = getSafeInternalNotificationDestination(notice) ?? "";
  if (notice.category === "report" || /^\/(?:en\/|ar\/)?admin(?:\/|[?#]|$)/.test(destination)) return preferences.browserPushAdminAlerts === true;
  if (isTradeRoomConversationNotification(notice) || /^(new|owner) (message in trade room|trade room message)$/i.test(notice.title.trim())) return preferences.browserPushChatMessages !== false;
  if (notice.category === "review" || /^(review available|feedback required)$/i.test(notice.title.trim())) return preferences.browserPushFeedback !== false;
  if (notice.category === "listing") {
    // Personal request responses/statuses need the transaction preference;
    // discovery broadcasts retain the separate listings preference.
    if (demandNotificationDestination(notice) && !notice.id.endsWith(`:new:${notice.userId}`)) {
      return preferences.browserPushTradeUpdates !== false;
    }
    return preferences.browserPushListings !== false;
  }
  if (notice.category === "trade" || notice.category === "dispute") return preferences.browserPushTradeUpdates !== false;
  return true;
}

export function browserPushPayload(notice: AlphaExchangeNotification, locale: "en" | "ar") {
  const copy = privacySafeMobilePushCopy(notice, locale);
  const path = getTradeRoomConversationDestination(notice) ?? getSafeInternalNotificationDestination(notice) ?? "/notifications";
  return { ...copy, url: `/${locale}${path.replace(/^\/(en|ar)(?=\/|$)/, "")}`, tag: notice.id.slice(0, 120) };
}

type Candidate = { payload: AlphaExchangeNotification; preferences: Partial<NotificationPreferences>; endpoint_hash: string; subscription: webpush.PushSubscription; locale: "ar" | "en" };
const BROWSER_PUSH_REVISION_SQL = "coalesce(nullif(btrim(n.payload->>'updatedAt'), ''), n.payload->>'createdAt')";
const browserDeliveryKey = (notice: AlphaExchangeNotification) => `${notice.id}:${notice.updatedAt?.trim() || notice.createdAt}`;
let running: Promise<{ sent: number }> | null = null;

/** Durable reconciliation also picks up Buy Request notices written directly by
 * their transaction. Only recent, unread, committed notices are eligible. */
export function drainBrowserPush() {
  if (running) return running;
  running = drain().finally(() => { running = null; });
  return running;
}

async function drain() {
  const config = browserPushConfiguration();
  const pool = getRuntimePostgresPool();
  if (!config || !pool) return { sent: 0 };
  await ensureNotificationEngagementSchema(pool);
  const candidates = await pool.query<Candidate>(`select n.payload, u.payload->'notificationPreferences' as preferences,
      p.endpoint_hash, p.subscription, p.locale
    from alpha_exchange.browser_push_subscriptions p
    join alpha_exchange.users u on u.id=p.user_id
    join alpha_exchange.sessions s on s.token_hash=p.session_token_hash and s.user_id=p.user_id and s.expires_at>now()
    join alpha_exchange.notifications n on n.user_id=p.user_id
    left join alpha_exchange.browser_push_deliveries d on d.endpoint_hash=p.endpoint_hash
      and d.delivery_key=n.id || ':' || ${BROWSER_PUSH_REVISION_SQL}
    where p.active and u.payload->>'disabled' is distinct from 'true'
      and u.payload->'notificationPreferences'->>'browserPush'='true'
      and u.payload->'notificationPreferences'->>'inApp' is distinct from 'false'
      and not n.is_read and n.payload->>'state' is distinct from 'archived'
      and ${BROWSER_PUSH_REVISION_SQL} >= greatest($1, to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      and (d.delivery_key is null or (d.status in ('failed','processing') and d.attempts<3 and d.updated_at<now()-interval '2 minutes'))
    order by case n.payload->>'priority' when 'critical' then 0 when 'high' then 1 else 2 end,
      ${BROWSER_PUSH_REVISION_SQL} asc, n.id, p.endpoint_hash limit 30`, [new Date(Date.now() - 24 * 60 * 60_000).toISOString()]);
  let sent = 0;
  const deadline = Date.now() + 40_000;
  for (const row of candidates.rows) {
    if (Date.now() > deadline) break;
    const notice = row.payload;
    const key = browserDeliveryKey(notice);
    const claim = await pool.query<{ attempts: number }>(`insert into alpha_exchange.browser_push_deliveries(delivery_key,endpoint_hash,status)
      values($1,$2,'processing') on conflict(delivery_key,endpoint_hash) do update
      set status='processing',attempts=alpha_exchange.browser_push_deliveries.attempts+1,updated_at=now()
      where alpha_exchange.browser_push_deliveries.status in ('failed','processing')
        and alpha_exchange.browser_push_deliveries.attempts<3
        and alpha_exchange.browser_push_deliveries.updated_at<now()-interval '2 minutes'
      returning attempts`, [key, row.endpoint_hash]);
    if (!claim.rowCount) continue;
    let status = "skipped";
    let sentSubscription: webpush.PushSubscription | null = null;
    try {
      // Recheck revocation/read state after waiting for earlier provider calls.
      const current = await pool.query<Candidate>(`select n.payload, u.payload->'notificationPreferences' as preferences, p.subscription, p.locale
        from alpha_exchange.browser_push_subscriptions p
        join alpha_exchange.sessions s on s.token_hash=p.session_token_hash and s.user_id=p.user_id and s.expires_at>now()
        join alpha_exchange.users u on u.id=p.user_id
        join alpha_exchange.notifications n on n.user_id=p.user_id
        where p.endpoint_hash=$1 and p.active and n.id=$2 and not n.is_read
          and n.payload->>'state' is distinct from 'archived' and u.payload->>'disabled' is distinct from 'true'`, [row.endpoint_hash, notice.id]);
      const fresh = current.rows[0];
      const subscription = fresh && parseBrowserPushSubscription(fresh.subscription);
      if (fresh && subscription && browserDeliveryKey(fresh.payload) === key
          && browserPushCategoryEnabled(fresh.payload, fresh.preferences ?? {})) {
        sentSubscription = subscription;
        await webpush.sendNotification(subscription, JSON.stringify(browserPushPayload(fresh.payload, fresh.locale)), {
          vapidDetails: config, TTL: 3600, timeout: 5000,
          urgency: fresh.payload.priority === "high" || fresh.payload.priority === "critical" ? "high" : "normal",
        });
        status = "sent";
        sent++;
      }
    } catch (error) {
      const code = (error as { statusCode?: number }).statusCode;
      status = code === 404 || code === 410 ? "skipped" : "failed";
      if ((code === 404 || code === 410) && sentSubscription) await pool.query("update alpha_exchange.browser_push_subscriptions set active=false,updated_at=now() where endpoint_hash=$1 and subscription=$2::jsonb and user_id=$3", [row.endpoint_hash, JSON.stringify(sentSubscription), notice.userId]);
      // Provider errors may embed the endpoint/key; never log the raw error.
    }
    await pool.query("update alpha_exchange.browser_push_deliveries set status=$3,updated_at=now() where delivery_key=$1 and endpoint_hash=$2 and attempts=$4", [key, row.endpoint_hash, status, claim.rows[0].attempts]);
  }
  return { sent };
}

export function scheduleBrowserPushDelivery() {
  if (!browserPushConfiguration()) return;
  try { after(async () => { await drainBrowserPush().catch(() => undefined); }); }
  catch { /* Durable scheduler recovers notifications outside Next requests. */ }
}
