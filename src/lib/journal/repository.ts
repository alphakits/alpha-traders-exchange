import "server-only";
import type { PoolClient } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { DEFAULT_SETTINGS, type JournalTrade, type JournalReview, type JournalSettings } from "./model";

export class JournalConflict extends Error {}
export class JournalNotFound extends Error {}
export class JournalLimit extends Error {}
export const JOURNAL_BUCKET = "journal-charts";

/** No process memory fallback; database failure must never look like a saved trade. */
export async function withJournalUser<T>(userId: string, operation: (db: PoolClient) => Promise<T>, readSnapshot=false) {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Journal database unavailable");
  const db = await pool.connect();
  try {
    await db.query(readSnapshot ? "begin isolation level repeatable read read only" : "begin");
    await db.query("set local role alpha_journal_runtime");
    await db.query("select set_config('alpha_journal.user_id',$1,true)", [userId]);
    const result = await operation(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally { db.release(); }
}
type TradeRow = { id: string; version: number; payload: JournalTrade; created_at: Date; updated_at: Date };
function tradeFromRow(row: TradeRow): JournalTrade {
  return { ...row.payload, id: row.id, version: row.version,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
export async function readJournal(userId: string, offset = 0) {
  return withJournalUser(userId, async db => {
    const revision = await db.query<{revision:string}>(`select md5(coalesce(string_agg(id::text || ':' || version::text,',' order by id),'')) as revision from alpha_exchange.journal_trades where user_id=$1`,[userId]);
    const rows = await db.query<TradeRow>(`select * from alpha_exchange.journal_trades where user_id=$1 order by trade_date desc,id desc limit 501 offset $2`, [userId, offset]);
    const reviews = offset === 0 ? await db.query(`select payload,version from alpha_exchange.journal_reviews where user_id=$1 order by review_date desc`, [userId]) : { rows: [] };
    const settings = offset === 0 ? await db.query(`select payload,version from alpha_exchange.journal_settings where user_id=$1`, [userId]) : { rows: [] };
    return { trades: rows.rows.slice(0,500).map(tradeFromRow),
      reviews: reviews.rows.map(row => ({ ...row.payload, version: row.version }) as JournalReview),
      settings: settings.rows[0] ? { ...settings.rows[0].payload, version: settings.rows[0].version } as JournalSettings : DEFAULT_SETTINGS,
      revision:revision.rows[0].revision,nextOffset: rows.rows.length > 500 ? offset + 500 : null };
  },true);
}
export async function saveTrade(userId: string, trade: JournalTrade) {
  return withJournalUser(userId, async db => {
    const result = trade.version === 0
      ? await db.query<TradeRow>(`insert into alpha_exchange.journal_trades(user_id,id,trade_date,payload) values($1,$2,$3,$4::jsonb) on conflict(user_id,id) do nothing returning *`, [userId,trade.id,trade.date,JSON.stringify(trade)])
      : await db.query<TradeRow>(`update alpha_exchange.journal_trades set payload=$3::jsonb,trade_date=$4,version=version+1,updated_at=now() where user_id=$1 and id=$2 and version=$5 returning *`, [userId,trade.id,JSON.stringify(trade),trade.date,trade.version]);
    if (!result.rows[0]) throw new JournalConflict();
    return tradeFromRow(result.rows[0]);
  });
}
export async function deleteTrade(userId: string, id: string, version: number) {
  return withJournalUser(userId, async db => {
    const result = await db.query(`delete from alpha_exchange.journal_trades where user_id=$1 and id=$2 and version=$3 returning id`, [userId,id,version]);
    if (!result.rowCount) throw new JournalConflict();
  });
}
export async function saveReview(userId: string, review: JournalReview) {
  return withJournalUser(userId, async db => {
    const result = review.version === 0
      ? await db.query(`insert into alpha_exchange.journal_reviews(user_id,review_date,payload,period) values($1,$2,$3::jsonb,$4) on conflict do nothing returning version`, [userId,review.date,JSON.stringify(review),review.period])
      : await db.query(`update alpha_exchange.journal_reviews set payload=$3::jsonb,version=version+1,updated_at=now() where user_id=$1 and review_date=$2 and version=$4 and period=$5 returning version`, [userId,review.date,JSON.stringify(review),review.version,review.period]);
    if (!result.rows[0]) throw new JournalConflict();
    return { ...review, version: result.rows[0].version };
  });
}
export async function saveSettings(userId: string, settings: JournalSettings) {
  return withJournalUser(userId, async db => {
    const result = settings.version === 0
      ? await db.query(`insert into alpha_exchange.journal_settings(user_id,payload) values($1,$2::jsonb) on conflict do nothing returning version`, [userId,JSON.stringify(settings)])
      : await db.query(`update alpha_exchange.journal_settings set payload=$2::jsonb,version=version+1,updated_at=now() where user_id=$1 and version=$3 returning version`, [userId,JSON.stringify(settings),settings.version]);
    if (!result.rows[0]) throw new JournalConflict();
    return { ...settings, version: result.rows[0].version };
  });
}
export async function listAttachments(userId: string, tradeId: string) {
  return withJournalUser(userId, async db => {
    const rows = await db.query(`select id,display_name from alpha_exchange.journal_files where user_id=$1 and trade_id=$2 and status='ready' order by created_at`, [userId,tradeId]);
    return rows.rows.map(row => ({ id: row.id, tradeId, name: row.display_name, url: `/api/journal/charts/${row.id}` }));
  });
}
export async function reserveAttachment(userId: string, tradeId: string, id: string, name: string) {
  return withJournalUser(userId, async db => {
    const trade = await db.query(`select id from alpha_exchange.journal_trades where user_id=$1 and id=$2 for update`, [userId,tradeId]);
    if (!trade.rows[0]) throw new JournalNotFound();
    const count = await db.query(`select count(*)::int as n from alpha_exchange.journal_files where user_id=$1 and trade_id=$2`, [userId,tradeId]);
    if (count.rows[0].n >= 3) throw new JournalLimit();
    const key = `${encodeURIComponent(userId)}/${tradeId}/${id}.webp`;
    await db.query(`insert into alpha_exchange.journal_files(user_id,id,trade_id,storage_key,display_name,status) values($1,$2,$3,$4,$5,'pending')`, [userId,id,tradeId,key,name]);
    return key;
  });
}
export async function finishAttachment(userId: string, id: string) {
  return withJournalUser(userId, async db => {
    const result = await db.query(`update alpha_exchange.journal_files set status='ready' where user_id=$1 and id=$2 returning id`, [userId,id]);
    if (!result.rowCount) throw new JournalNotFound();
  });
}
export async function attachmentKey(userId: string, id: string) {
  return withJournalUser(userId, async db => {
    const rows = await db.query(`select storage_key from alpha_exchange.journal_files where user_id=$1 and id=$2 and status='ready'`, [userId,id]);
    if (!rows.rows[0]) throw new JournalNotFound();
    return rows.rows[0].storage_key as string;
  });
}
export async function deleteAttachment(userId: string, id: string) {
  return withJournalUser(userId, async db => {
    const result = await db.query(`delete from alpha_exchange.journal_files where user_id=$1 and id=$2 returning id`, [userId,id]);
    if (!result.rowCount) throw new JournalNotFound();
  });
}
