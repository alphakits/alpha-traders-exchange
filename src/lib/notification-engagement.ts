import "server-only";
import { getRuntimePostgresPool } from "./postgres-runtime";
import { ensureNotificationEngagementSchema } from "./notification-engagement-schema";

export const NOTIFICATION_REMINDER_INTERVAL_HOURS = 12;

/** Atomic across tabs, devices and server instances; DB time is authoritative. */
export async function claimNotificationReminder(userId: string) {
  const pool = getRuntimePostgresPool();
  if (!pool) return false;
  await ensureNotificationEngagementSchema(pool);
  const result = await pool.query(`
    insert into alpha_exchange.notification_reminder_state(user_id, next_prompt_at)
    values ($1, now() + interval '12 hours')
    on conflict (user_id) do update set next_prompt_at = now() + interval '12 hours', updated_at = now()
    where alpha_exchange.notification_reminder_state.next_prompt_at <= now()
    returning user_id`, [userId]);
  return result.rowCount === 1;
}

export async function snoozeNotificationReminder(userId: string) {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Reminder storage unavailable");
  await ensureNotificationEngagementSchema(pool);
  await pool.query(`insert into alpha_exchange.notification_reminder_state(user_id, next_prompt_at)
    values ($1, now() + interval '7 days')
    on conflict (user_id) do update set next_prompt_at = now() + interval '7 days', updated_at = now()`, [userId]);
}
