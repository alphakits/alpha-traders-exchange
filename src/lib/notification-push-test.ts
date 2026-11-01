import "server-only";
import { createHash, randomUUID } from "crypto";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { rollbackFailedTransaction } from "@/lib/postgres-transaction";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { browserDeliveryKey, deliverBrowserPushNotification } from "@/lib/browser-push";
import { deliverMobilePushNotification, mobilePushDeliveryKey } from "@/lib/mobile-push";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

export class PushTestError extends Error {
  constructor(readonly code: "session_ended" | "alerts_disabled" | "storage_unavailable") {
    super(code);
  }
}

export async function sendNotificationPushTest(input: {
  userId: string;
  sessionToken: string;
  locale: "en" | "ar";
}) {
  if (!input.userId.trim() || !input.sessionToken.trim()) throw new PushTestError("session_ended");
  const pool = getRuntimePostgresPool();
  if (!pool) throw new PushTestError("storage_unavailable");
  const now = new Date().toISOString();
  const notification: AlphaExchangeNotification = {
    id: `push-test:${randomUUID()}`,
    userId: input.userId,
    category: "system",
    centerCategory: "system",
    title: "Test notification",
    message: "This is a test alert. Open Alpha Traders to confirm notifications are working.",
    titleEn: "Test notification",
    messageEn: "This is a test alert. Open Alpha Traders to confirm notifications are working.",
    titleAr: "إشعار تجريبي",
    messageAr: "هذا تنبيه تجريبي. افتح Alpha Traders للتأكد من عمل الإشعارات.",
    isRead: false,
    state: "unread",
    priority: "normal",
    reason: "push_test",
    actionHref: `/${input.locale}/notifications`,
    createdAt: now,
    updatedAt: now,
  };

  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query("begin");
    // Share the repository snapshot-write lock: a stale whole-snapshot save
    // cannot erase this isolated notice. Never replace a user or trade row.
    await client.query("select pg_advisory_xact_lock(61422917)");
    const recipient = await client.query<{ alerts_enabled: boolean }>(
      `select u.payload->'notificationPreferences'->>'inApp' is distinct from 'false' as alerts_enabled
       from alpha_exchange.users u join alpha_exchange.sessions s on s.user_id=u.id
       where u.id=$1 and s.token_hash=$2 and s.expires_at>now()
         and u.payload->>'disabled' is distinct from 'true'
       for share of u, s`,
      [input.userId, createHash("sha256").update(input.sessionToken).digest("hex")],
    );
    if (!recipient.rows.length) throw new PushTestError("session_ended");
    if (!recipient.rows[0].alerts_enabled) throw new PushTestError("alerts_disabled");
    await client.query(
      `insert into alpha_exchange.notifications (id,user_id,category,is_read,created_at,sort_index,payload)
       values($1,$2,'system',false,$3,
         (select coalesce(min(sort_index),1)-1 from alpha_exchange.notifications),$4::jsonb)`,
      [notification.id, input.userId, now, JSON.stringify(notification)],
    );
    const version = await client.query(
      "update alpha_exchange.runtime_meta set version=version+1,updated_at=now() where singleton=true",
    );
    if (version.rowCount !== 1) throw new PushTestError("storage_unavailable");
    await client.query("commit");
  } catch (error) {
    destroy = await rollbackFailedTransaction(client, error);
    throw error;
  } finally {
    client.release(destroy);
  }
  invalidateAlphaExchangeStoreCache();

  // No global publisher, queue drain, email/SMS fanout or receipt sweep. Both
  // senders reread this exact committed notice and current consent/sessions.
  const [browser] = await Promise.allSettled([
    deliverBrowserPushNotification({ userId: input.userId, notificationId: notification.id }),
    deliverMobilePushNotification(notification, { reconcileReceipts: false, providerMaxAttempts: 1 }),
  ]);
  // A concurrent recovery sender may have won the claim. Read only this
  // notice's durable receipts so a successful parallel send is not reported
  // as unaccepted. A receipt still does not prove OS display.
  const [browserReceipt, nativeReceipt] = await Promise.allSettled([
    pool.query<{ accepted: string }>(
      `select count(*)::text as accepted from alpha_exchange.browser_push_deliveries d
       join alpha_exchange.browser_push_subscriptions s on s.endpoint_hash=d.endpoint_hash
       where d.delivery_key=$1 and s.user_id=$2 and d.status='sent'`,
      [browserDeliveryKey(notification), input.userId],
    ),
    pool.query<{ accepted: string }>(
      `select count(*)::text as accepted from alpha_exchange.mobile_push_deliveries d
       join alpha_exchange.mobile_push_subscriptions s on s.id=d.subscription_id
       where d.notification_id=$1 and s.user_id=$2 and d.status in ('sent','delivered')`,
      [mobilePushDeliveryKey(notification), input.userId],
    ),
  ]);
  const accepted = {
    browser: Math.max(browser.status === "fulfilled" ? browser.value.sent : 0,
      browserReceipt.status === "fulfilled" ? Number(browserReceipt.value.rows[0]?.accepted ?? 0) : 0),
    native: nativeReceipt.status === "fulfilled" ? Number(nativeReceipt.value.rows[0]?.accepted ?? 0) : 0,
  };
  return {
    notificationId: notification.id,
    status: accepted.browser + accepted.native > 0 ? "accepted" as const : "saved" as const,
    accepted,
  };
}
