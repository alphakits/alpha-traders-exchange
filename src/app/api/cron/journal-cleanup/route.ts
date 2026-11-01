import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { journalEnabled, journalJson } from "@/lib/journal/api";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { JOURNAL_BUCKET } from "@/lib/journal/repository";
import { logEvent } from "@/lib/structured-logging";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    logEvent("error", { event: "journal_cleanup", outcome: "failed", reason: "cron_secret_not_configured" });
    return journalJson({ error: "Scheduler unavailable" },503);
  }
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(request.headers.get("authorization") ?? "");
  if (received.length !== expected.length || !timingSafeEqual(received,expected)) return journalJson({ error: "Unauthorized" },401);
  if (!journalEnabled()) {
    logEvent("info", { event: "journal_cleanup", outcome: "success", reason: "feature_disabled" });
    return journalJson({ enabled: false });
  }
  const startedAt = Date.now();
  try {
    const db = getRuntimePostgresPool(); if (!db) throw new Error("Database unavailable");
    const expired = await db.query(`delete from alpha_exchange.journal_files where status='pending' and created_at < now()-interval '1 day'`);
    const { rows } = await db.query<{ storage_key: string }>(`select storage_key from alpha_exchange.journal_file_cleanup order by created_at limit 100`);
    if (!rows.length) {
      logEvent("info", { event: "journal_cleanup", outcome: "success", metadata: { removed: 0, expiredPending: expired.rowCount ?? 0, durationMs: Date.now() - startedAt } });
      return journalJson({ removed: 0 });
    }
    const keys = rows.map(row => row.storage_key);
    const { error } = await createSupabaseAdminClient().storage.from(JOURNAL_BUCKET).remove(keys);
    if (error) throw error;
    await db.query(`delete from alpha_exchange.journal_file_cleanup where storage_key=any($1::text[])`,[keys]);
    logEvent("info", { event: "journal_cleanup", outcome: "success", metadata: { removed: keys.length, expiredPending: expired.rowCount ?? 0, durationMs: Date.now() - startedAt } });
    return journalJson({ removed: keys.length });
  } catch {
    logEvent("error", { event: "journal_cleanup", outcome: "failed", reason: "cleanup_unavailable", metadata: { durationMs: Date.now() - startedAt } });
    return journalJson({ error: "Chart cleanup will retry." },503);
  }
}
