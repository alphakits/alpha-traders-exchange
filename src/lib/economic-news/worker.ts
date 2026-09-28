import "server-only";
import { randomUUID } from "node:crypto";
import { fetchEconomicNews, newsProviderConfigured } from "./provider";
import { newsPool, persistNewsSnapshot } from "./repository";
import { newsResultSummary, type NewsEvent } from "./model";

type Delivery = { id: string; user_id: string; channel: "inApp" | "email"; payload: NewsEvent; lease_token: string };

export function newsAlertCopy(event: NewsEvent) {
  return {
    titleEn: `USD news: ${event.title}`,
    titleAr: `أخبار الدولار: ${event.titleAr}`,
    messageEn: newsResultSummary(event, "en"),
    messageAr: newsResultSummary(event, "ar"),
  };
}

export async function deliverNewsRelease(delivery: Delivery) {
  const pool = await newsPool();
  const subscription = await pool.query<{ in_app: boolean; email: boolean }>(
    "select in_app,email from alpha_exchange.economic_news_subscriptions where user_id=$1", [delivery.user_id],
  );
  const preference = subscription.rows[0];
  if (!preference || !(delivery.channel === "inApp" ? preference.in_app : preference.email)) return "skipped";
  const { findUserById, createEconomicNewsNotification } = await import("@/lib/alpha-exchange-store");
  const user = await findUserById(delivery.user_id);
  if (!user || user.disabled || user.emailVerified !== true) return "skipped";
  const copy = newsAlertCopy(delivery.payload);
  if (delivery.channel === "inApp") {
    if (user.notificationPreferences?.inApp === false) return "skipped";
    await createEconomicNewsNotification({ userId: user.id, eventId: delivery.payload.id, ...copy });
  } else {
    if (user.notificationPreferences?.email !== true) return "skipped";
    const { sendMarketplaceEmail } = await import("@/lib/marketplace-email-delivery");
    const result = await sendMarketplaceEmail({
      event: "economic_news_released", to: user.email, recipientName: user.fullName,
      recipientLocale: user.preferredLocale === "en" ? "en" : "ar",
      title: { en: copy.titleEn, ar: copy.titleAr }, message: { en: copy.messageEn, ar: copy.messageAr },
      actionLabel: { en: "View news result", ar: "عرض نتيجة الخبر" },
      actionPath: `/news?event=${encodeURIComponent(delivery.payload.id)}`,
      idempotencyKey: `economic-news:${delivery.id}`, referenceLabel: delivery.payload.title,
      maxAttempts: 1, timeoutMs: 5_000,
    });
    if (!result.ok) throw new Error("News email delivery failed");
  }
  return "sent";
}

export async function drainNewsDeliveries(deadline: number) {
  const pool = await newsPool();
  let sent = 0;
  let failed = 0;
  for (let batch = 0; batch < 30 && Date.now() < deadline - 8_000; batch++) {
    const leaseToken = randomUUID();
    const rows = await pool.query<Delivery>(`with due as (
      select id from alpha_exchange.economic_news_deliveries
      where ((status='pending' and available_at <= now()) or (status='processing' and lease_until < now()))
        and created_at > now() - interval '1 hour' and attempts < 5
      order by created_at, id for update skip locked limit 3
    ) update alpha_exchange.economic_news_deliveries d set status='processing',attempts=d.attempts+1,
      lease_token=$1,lease_until=now()+interval '2 minutes'
      from due where due.id=d.id returning d.*`, [leaseToken]);
    if (!rows.rows.length) break;
    await Promise.all(rows.rows.map(async (delivery) => {
      try {
        const status = await deliverNewsRelease(delivery);
        await pool.query(`update alpha_exchange.economic_news_deliveries set status=$2,lease_until=null
          where id=$1 and lease_token=$3 and status='processing'`, [delivery.id, status, leaseToken]);
        if (status === "sent") sent++;
      } catch {
        failed++;
        await pool.query(`update alpha_exchange.economic_news_deliveries
          set status=case when attempts >= 5 then 'failed' else 'pending' end,
            available_at=now()+interval '2 minutes',lease_until=null
          where id=$1 and lease_token=$2 and status='processing'`, [delivery.id, leaseToken]);
      }
    }));
  }
  return { sent, failed };
}

export async function runEconomicNewsSync() {
  if (!newsProviderConfigured()) return { status: "not_configured", synced: false, releases: 0, sent: 0, failed: 0 };
  const deadline = Date.now() + 45_000;
  const now = new Date();
  // Fetch first. A failed/stale provider must never dispatch old queued news as a new release.
  const events = await fetchEconomicNews(now);
  const sync = await persistNewsSnapshot(events, now);
  const delivery = sync.synced ? await drainNewsDeliveries(deadline) : { sent: 0, failed: 0 };
  return { status: "ready", ...sync, ...delivery };
}
