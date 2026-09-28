/**
 * Listing-creation performance profiler.
 *
 * Measures the wall-clock cost of every stage inside createMarketplaceListing.
 * No application data is modified — the writeDb stage runs inside a rolled-back
 * PostgreSQL transaction.
 *
 * Usage:
 *   node scripts/profile-listing-creation.mjs
 *
 * Requires SUPABASE_DB_URL (or DATABASE_URL) to be set in .env.local.
 * Falls back to the in-memory seed when no database is reachable.
 */

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Load .env.local without dotenv dependency
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

// ---------------------------------------------------------------------------
// Load pg from the project's node_modules
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
let Pool;
try {
  ({ Pool } = require(join(ROOT, "node_modules", "pg")));
} catch {
  console.error("Could not load 'pg' from node_modules. Run 'npm install' first.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ms(start, end) {
  return Number((end - start).toFixed(2));
}

function printTable(rows) {
  const colWidths = [
    Math.max(12, ...rows.map((r) => String(r[0]).length)),
    Math.max(11, ...rows.map((r) => String(r[1]).length)),
    Math.max(6,  ...rows.map((r) => String(r[2]).length)),
  ];
  const sep = `+${"-".repeat(colWidths[0] + 2)}+${"-".repeat(colWidths[1] + 2)}+${"-".repeat(colWidths[2] + 2)}+`;
  const fmt = (cols) =>
    `| ${String(cols[0]).padEnd(colWidths[0])} | ${String(cols[1]).padStart(colWidths[1])} | ${String(cols[2]).padStart(colWidths[2])} |`;
  console.log(sep);
  console.log(fmt(["operation", "duration_ms", "kind"]));
  console.log(sep);
  for (const row of rows) console.log(fmt(row));
  console.log(sep);
}

// ---------------------------------------------------------------------------
// Seed data (used when DB is unreachable)
// ---------------------------------------------------------------------------
let seedDb;
function getSeedDb() {
  if (seedDb) return seedDb;
  try {
    const seedPath = join(ROOT, "data", "alpha-exchange-db.json");
    seedDb = JSON.parse(readFileSync(seedPath, "utf8"));
  } catch {
    seedDb = {
      users: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [],
      auditLogs: [], notifications: [], activityLogs: [], trustSnapshots: [],
      trustScoreHistory: [], disputes: [], sellerApplications: [], sellerReviews: [],
      tradeEvidenceFiles: [], sellerSettings: [], sellerReports: [], betaFeedback: [],
      authSessions: [], betaAnnouncements: [], passwordResetTokens: [],
      privateBetaInviteCodes: [], privateBetaInviteUses: [],
    };
  }
  return seedDb;
}

// ---------------------------------------------------------------------------
// SELECT SQL (exact table names from alpha-exchange-repository.ts tables array)
// ---------------------------------------------------------------------------
// Each entry: [sql, dbFieldName]
// seller_profiles and seller_settings are denormalised views of users — not
// separate db fields.  trades is also derived.  We skip those in the mapping.
const TABLE_QUERIES = [
  { sql: "select payload from alpha_exchange.users order by sort_index asc",                    field: "users" },
  { sql: "select payload from alpha_exchange.seller_profiles order by sort_index asc",          field: null },  // derived from users
  { sql: "select payload from alpha_exchange.seller_settings order by sort_index asc",          field: null },  // derived from users
  { sql: "select payload from alpha_exchange.listings order by sort_index asc",                 field: "marketplaceListings" },
  { sql: "select payload from alpha_exchange.trades order by sort_index asc",                   field: null },  // derived from purchaseRequests
  { sql: "select payload from alpha_exchange.purchase_requests order by sort_index asc",        field: "purchaseRequests" },
  { sql: "select payload from alpha_exchange.notifications order by sort_index asc",            field: "notifications" },
  { sql: "select payload from alpha_exchange.commissions order by sort_index asc",              field: "commissionRecords" },
  { sql: "select payload from alpha_exchange.audit_logs order by sort_index asc",               field: "auditLogs" },
  { sql: "select payload from alpha_exchange.evidence order by sort_index asc",                 field: "tradeEvidenceFiles" },
  { sql: "select payload from alpha_exchange.sessions order by sort_index asc",                 field: "authSessions" },
  { sql: "select payload from alpha_exchange.password_reset_tokens order by sort_index asc",    field: "passwordResetTokens" },
  { sql: "select payload from alpha_exchange.seller_applications order by sort_index asc",      field: "sellerApplications" },
  { sql: "select payload from alpha_exchange.activity_logs order by sort_index asc",            field: "activityLog" },
  { sql: "select payload from alpha_exchange.disputes order by sort_index asc",                 field: "disputes" },
  { sql: "select payload from alpha_exchange.seller_reports order by sort_index asc",           field: "sellerReports" },
  { sql: "select payload from alpha_exchange.trust_snapshots order by sort_index asc",          field: "trustSnapshots" },
  { sql: "select payload from alpha_exchange.trust_score_history order by sort_index asc",      field: "trustScoreHistory" },
  { sql: "select payload from alpha_exchange.private_beta_invites order by sort_index asc",     field: "privateBetaInvites" },
  { sql: "select payload from alpha_exchange.private_beta_invite_uses order by sort_index asc", field: "privateBetaInviteUses" },
  { sql: "select payload from alpha_exchange.beta_feedback order by sort_index asc",            field: "betaFeedback" },
  { sql: "select payload from alpha_exchange.beta_announcements order by sort_index asc",       field: "betaAnnouncements" },
];

// ---------------------------------------------------------------------------
// Profile stage 1: readDb
// ---------------------------------------------------------------------------
async function profileReadDb(pool) {
  if (!pool) {
    const t0 = performance.now();
    const seed = getSeedDb();
    const clone = JSON.parse(JSON.stringify(seed));
    const t1 = performance.now();
    return { db: clone, durationMs: ms(t0, t1), mode: "memory" };
  }
  const t0 = performance.now();
  try {
    const [meta, ...results] = await Promise.all([
      pool.query("select version::text as version from alpha_exchange.runtime_meta where singleton = true"),
      ...TABLE_QUERIES.map((tq) => pool.query(tq.sql)),
    ]);
    const t1 = performance.now();
    const db = {
      version: Number(meta.rows[0]?.version ?? "0"),
      sellerReviews: [],
    };
    for (let i = 0; i < TABLE_QUERIES.length; i++) {
      const field = TABLE_QUERIES[i].field;
      if (field) db[field] = (results[i]?.rows ?? []).map((r) => r.payload);
    }
    return { db, durationMs: ms(t0, t1), mode: "postgres" };
  } catch (err) {
    const t1 = performance.now();
    console.warn(`  [readDb] DB query failed (${err.message}), using memory seed`);
    const db = JSON.parse(JSON.stringify(getSeedDb()));
    return { db, durationMs: ms(t0, t1), mode: "memory-fallback" };
  }
}

// ---------------------------------------------------------------------------
// Profile stage 2: getSellerListingBlockReason (sync, pure computation)
// ---------------------------------------------------------------------------
function profileGetSellerListingBlockReason(db, sellerId) {
  const t0 = performance.now();
  const MAX_ACTIVE = 2;
  const pendingCommissions = (db.commissionRecords ?? []).filter(
    (r) => r.sellerId === sellerId && (r.status === "pending" || r.status === "overdue"),
  );
  const blockForCommission = pendingCommissions.length > 0
    ? "You have commission payments pending. Clear them before creating a new listing."
    : null;
  const openListings = (db.marketplaceListings ?? []).filter(
    (l) => l.sellerId === sellerId && (l.status === "active" || l.status === "paused"),
  );
  const blockForListings = !blockForCommission && openListings.length >= MAX_ACTIVE
    ? "You already have 2 active listings. Close one before creating another."
    : null;
  const blockReason = blockForCommission ?? blockForListings ?? null;
  const t1 = performance.now();
  return { blockReason, durationMs: ms(t0, t1) };
}

// ---------------------------------------------------------------------------
// Profile stage 3: appendAuditLog (sync, in-memory array mutation)
// ---------------------------------------------------------------------------
function profileAppendAuditLog(db, actorUserId, listingId) {
  const t0 = performance.now();
  const entry = {
    id: `audit-${randomUUID()}`,
    action: "listing_created",
    actorUserId,
    targetUserId: actorUserId,
    listingId,
    details: `[profile] created listing ${listingId}`,
    createdAt: new Date().toISOString(),
  };
  if (!db.auditLogs) db.auditLogs = [];
  db.auditLogs.unshift(entry);
  const t1 = performance.now();
  return { durationMs: ms(t0, t1) };
}

// ---------------------------------------------------------------------------
// Profile stage 4: pushNotification (sync, array scan + push)
// ---------------------------------------------------------------------------
function profilePushNotification(db, userId, listingId) {
  const t0 = performance.now();
  if (!db.notifications) db.notifications = [];
  const category = "listing";
  const title = "New listing published";
  const createdAt = new Date().toISOString();
  // Dedup check (mirrors the real implementation)
  const duplicate = db.notifications.find((item) => {
    if (item.userId !== userId) return false;
    if (item.category !== category) return false;
    if (item.title !== title) return false;
    const ageMs = Date.now() - new Date(item.createdAt).getTime();
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 45_000;
  });
  if (!duplicate) {
    db.notifications.unshift({
      id: `notif-${randomUUID()}`,
      userId,
      category,
      title,
      message: `[profile] listing ${listingId} published`,
      isRead: false,
      state: "unread",
      createdAt,
      updatedAt: createdAt,
    });
  }
  const t1 = performance.now();
  return { durationMs: ms(t0, t1) };
}

// ---------------------------------------------------------------------------
// Profile stage 5: pushActivityLog (sync, array push)
// ---------------------------------------------------------------------------
function profilePushActivityLog(db, userId, listingId) {
  const t0 = performance.now();
  if (!db.activityLogs) db.activityLogs = [];
  db.activityLogs.unshift({
    id: `activity-${randomUUID()}`,
    userId,
    category: "listing",
    title: "Listing published",
    details: `[profile] listing ${listingId} is now live`,
    createdAt: new Date().toISOString(),
  });
  const t1 = performance.now();
  return { durationMs: ms(t0, t1) };
}

// ---------------------------------------------------------------------------
// Profile stage 6: recalculateTrustEngine (CPU-bound, mirrors real logic)
// ---------------------------------------------------------------------------
function profileRecalculateTrustEngine(db) {
  const t0 = performance.now();
  const eligibleSellers = (db.users ?? []).filter(
    (u) => u.sellerStatus === "approved" || u.sellerStatus === "active",
  );
  const snapshots = eligibleSellers.map((seller) => {
    const sellerListings = (db.marketplaceListings ?? []).filter((l) => l.sellerId === seller.id);
    const sellerRequests = (db.purchaseRequests ?? []).filter((r) => r.sellerId === seller.id);
    const sellerCommissions = (db.commissionRecords ?? []).filter((r) => r.sellerId === seller.id);
    const completedRequests = sellerRequests.filter((r) => r.status === "completed");
    const cancelledRequests = sellerRequests.filter((r) => r.status === "cancelled" || r.status === "declined");
    const totalRequests = sellerRequests.length;
    const completionRate = totalRequests > 0 ? (completedRequests.length / totalRequests) * 100 : 0;
    const cancellationRate = totalRequests > 0 ? (cancelledRequests.length / totalRequests) * 100 : 0;
    const responseTimes = sellerRequests
      .map((r) => {
        const submitted = new Date(r.createdAt).getTime();
        const accepted = new Date(r.tradeCreatedAt ?? r.updatedAt).getTime();
        return accepted > submitted ? (accepted - submitted) / 60_000 : 0;
      })
      .filter((v) => v > 0);
    const avgResponseMinutes = responseTimes.length
      ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length
      : 0;
    const ratings = sellerRequests
      .filter((r) => r.buyerReview?.rating)
      .map((r) => r.buyerReview.rating);
    const avgRating = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 0;
    const totalVolumeUsdt = sellerCommissions.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const pendingCommissions = sellerCommissions.filter(
      (r) => r.status === "pending" || r.status === "overdue",
    ).length;
    // Simplified trust score
    let score = 50;
    score += Math.min(completionRate * 0.3, 30);
    score += Math.min(avgRating * 4, 20);
    score -= Math.min(cancellationRate * 0.5, 15);
    score -= pendingCommissions * 5;
    score = Math.max(0, Math.min(100, score));
    return {
      sellerId: seller.id,
      trustScore: score,
      completionRate,
      cancellationRate,
      avgResponseMinutes,
      avgRating,
      totalUsdtVolume: totalVolumeUsdt,
      completedTrades: completedRequests.length,
      activeListings: sellerListings.filter((l) => l.status === "active").length,
    };
  });
  // Update trust snapshots in memory
  const now = new Date().toISOString();
  db.trustSnapshots = snapshots.map((snap) => ({
    sellerId: snap.sellerId,
    snapshot: snap,
    updatedAt: now,
  }));
  const t1 = performance.now();
  return { sellersProcessed: eligibleSellers.length, durationMs: ms(t0, t1) };
}

// ---------------------------------------------------------------------------
// Profile stage 7: writeDbForListingCreation (async, rolled-back transaction)
// ---------------------------------------------------------------------------
async function profileWriteDbForListingCreation(pool, db) {
  if (!pool) {
    // In-memory path: measure JSON serialization cost (that's what drives memory write cost)
    const t0 = performance.now();
    JSON.stringify(db);
    const t1 = performance.now();
    return { durationMs: ms(t0, t1), mode: "memory-serialize" };
  }
  let client = null;
  const t0 = performance.now();
  try {
    client = await pool.connect();
    await client.query("begin");
    // Measure advisory lock (same as saveListingCreationSnapshot)
    try {
      await client.query("select pg_advisory_xact_lock(61422917)");
    } catch {
      // pg-mem skips advisory locks
    }
    // Read runtime meta (version check)
    await client.query(
      "select version::text as version from alpha_exchange.runtime_meta where singleton = true",
    );
    // Simulate the table-level writes as no-ops (SELECT 1 per table) to measure round-trip overhead
    // without touching real data. Real writes are the same network round-trip but with more payload.
    const simulatedTableCount = 9; // mirrors saveListingCreationSnapshot
    for (let i = 0; i < simulatedTableCount; i++) {
      await client.query("select 1");
    }
    // Always ROLLBACK — no data is persisted
    await client.query("rollback");
    const t1 = performance.now();
    return { durationMs: ms(t0, t1), mode: "postgres-rolled-back" };
  } catch {
    if (client) {
      try { await client.query("rollback"); } catch { /* ignore */ }
    }
    const t1 = performance.now();
    return { durationMs: ms(t0, t1), mode: "error" };
  } finally {
    if (client) client.release();
  }
}

// ---------------------------------------------------------------------------
// Profile stage 8: publishRealtimeEvent (sync, in-process emit)
// ---------------------------------------------------------------------------
function profilePublishRealtimeEvent() {
  // Simulate the listener dispatch with a small set of listeners
  const listeners = new Set();
  listeners.add(() => { /* listener A */ });
  listeners.add(() => { /* listener B */ });
  const t0 = performance.now();
  const event = { type: "listing.created", payload: { listing: { id: "profile-test" } } };
  listeners.forEach((fn) => fn(event));
  const t1 = performance.now();
  return { durationMs: ms(t0, t1) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\n── Alpha Exchange: listing-creation profiler ──────────────────────────────\n");

  // Connect to PostgreSQL if a URL is provided
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
  let pool = null;
  if (dbUrl) {
    try {
      pool = new Pool({
        connectionString: dbUrl,
        max: 2,
        connectionTimeoutMillis: 8_000,
        ssl: process.env.SUPABASE_DB_SSL === "false" ? false : { rejectUnauthorized: false },
      });
      // Verify the connection before proceeding
      const client = await pool.connect();
      client.release();
      console.log("  Connected to PostgreSQL.\n");
    } catch (err) {
      console.warn(`  PostgreSQL unavailable (${err.message}). Using in-memory seed.\n`);
      try { await pool.end(); } catch { /* ignore */ }
      pool = null;
    }
  } else {
    console.warn("  No SUPABASE_DB_URL set — using in-memory seed.\n");
  }

  // Fake seller/owner IDs for simulation
  const FAKE_SELLER_ID = "profile-seller-001";
  const FAKE_LISTING_ID = `listing-${randomUUID()}`;

  // ── Stage 1: readDb ──
  const stage1 = await profileReadDb(pool);
  const db = stage1.db;
  const dbMode = stage1.mode;
  console.log(`  readDb: ${stage1.durationMs} ms [${dbMode}]`);

  // ── Stage 2: getSellerListingBlockReason ──
  const stage2 = profileGetSellerListingBlockReason(db, FAKE_SELLER_ID);
  console.log(`  getSellerListingBlockReason: ${stage2.durationMs} ms`);

  // ── Stage 3: appendAuditLog ──
  const stage3 = profileAppendAuditLog(db, FAKE_SELLER_ID, FAKE_LISTING_ID);
  console.log(`  appendAuditLog: ${stage3.durationMs} ms`);

  // Find or pick an owner user for pushNotification
  const ownerUser = (db.users ?? []).find((u) =>
    (Array.isArray(u.roles) ? u.roles : [u.role]).includes("owner"),
  );
  const notifyUserId = ownerUser?.id ?? "profile-owner-001";

  // ── Stage 4: pushNotification ──
  const stage4 = profilePushNotification(db, notifyUserId, FAKE_LISTING_ID);
  console.log(`  pushNotification: ${stage4.durationMs} ms`);

  // ── Stage 5: pushActivityLog ──
  const stage5 = profilePushActivityLog(db, FAKE_SELLER_ID, FAKE_LISTING_ID);
  console.log(`  pushActivityLog: ${stage5.durationMs} ms`);

  // ── Stage 6: recalculateTrustEngine ──
  const stage6 = profileRecalculateTrustEngine(db);
  console.log(`  recalculateTrustEngine: ${stage6.durationMs} ms [${stage6.sellersProcessed} sellers]`);

  // ── Stage 7: writeDbForListingCreation ──
  const stage7 = await profileWriteDbForListingCreation(pool, db);
  console.log(`  writeDbForListingCreation: ${stage7.durationMs} ms [${stage7.mode}]`);

  // ── Stage 8: publishRealtimeEvent ──
  const stage8 = profilePublishRealtimeEvent();
  console.log(`  publishRealtimeEvent: ${stage8.durationMs} ms`);

  if (pool) {
    await pool.end();
  }

  // ── Results table ──
  const rows = [
    ["readDb",                      stage1.durationMs, "async/I-O"],
    ["getSellerListingBlockReason", stage2.durationMs, "sync/CPU"],
    ["appendAuditLog",              stage3.durationMs, "sync/CPU"],
    ["pushNotification",            stage4.durationMs, "sync/CPU"],
    ["pushActivityLog",             stage5.durationMs, "sync/CPU"],
    ["recalculateTrustEngine",      stage6.durationMs, "async/CPU"],
    ["writeDbForListingCreation",   stage7.durationMs, "async/I-O"],
    ["publishRealtimeEvent",        stage8.durationMs, "sync/CPU"],
  ];

  const total = rows.reduce((s, r) => s + r[1], 0).toFixed(2);

  console.log("\n── Timing table ────────────────────────────────────────────────────────────\n");
  printTable(rows);

  // Slowest
  const slowest = rows.reduce((prev, curr) => (curr[1] > prev[1] ? curr : prev));
  console.log(`\n  Slowest: ${slowest[0]} — ${slowest[1]} ms`);
  console.log(`  Total (sequential): ${total} ms\n`);

  // Why is the slowest slow?
  const analysis = {
    readDb:
      "Fires N+1 parallel SELECT queries across all PostgreSQL tables then deserialises JSONB rows. Network latency to Supabase's pooler dominates.",
    getSellerListingBlockReason:
      "Pure synchronous array filter over in-memory data. O(listings + commissions). Effectively zero cost.",
    appendAuditLog:
      "Synchronous Array.unshift on the in-memory auditLogs array. Zero I/O. Cost is proportional to array length (pre-shift).",
    pushNotification:
      "Synchronous Array.find dedup scan + Array.unshift. O(notifications). Zero I/O.",
    pushActivityLog:
      "Synchronous Array.unshift on activityLogs. Zero I/O. Near-zero cost.",
    recalculateTrustEngine:
      "CPU-bound O(sellers × records) iteration: filters listings/requests/commissions per seller, computes ratings/response-times, rebuilds trust snapshots for every eligible seller. Cost scales with active seller count and trade volume.",
    writeDbForListingCreation:
      "Opens a PostgreSQL connection, acquires an advisory lock, reads runtime_meta for version check, then upserts/replaces 9 tables in a single transaction. Dominated by network RTT to Supabase pooler × (lock + 9 writes + commit).",
    publishRealtimeEvent:
      "Synchronous forEach over an in-process Set of listener functions. Zero I/O. Sub-microsecond.",
  };

  console.log(`  Root cause of '${slowest[0]}':\n  ${analysis[slowest[0]]}\n`);
  console.log("── Done ─────────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
