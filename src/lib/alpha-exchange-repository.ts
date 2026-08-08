import { Pool, type PoolClient } from "pg";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import alphaExchangeSeed from "../../data/alpha-exchange-db.json";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import type {
  AlphaExchangeDb,
  AdminAnnouncementRun,
  AlphaExchangeNotification,
  AlphaExchangeUser,
  AuditLogEntry,
  AuthSession,
  BetaAnnouncement,
  BetaFeedbackEntry,
  CommissionRecord,
  MarketplaceListing,
  PasswordResetToken,
  PrivateBetaInviteCode,
  PrivateBetaInviteUse,
  PurchaseRequest,
  SellerApplication,
  SellerReport,
  TradeDisputeCase,
  TradeEvidenceFile,
  TrustScoreChangeLog,
  TrustSnapshotRecord,
  AlphaExchangeActivityLogEntry,
  SmsDeliveryRecord,
} from "@/types/alpha-exchange";

type Queryable = Pool | PoolClient;

type EvidenceWriteMap = Map<string, Buffer>;

const TEST_FALLBACK_DIR_SUFFIX = process.env.NODE_ENV === "test" && process.env.VITEST_WORKER_ID
  ? `-${process.env.VITEST_WORKER_ID}`
  : "";
const FALLBACK_SNAPSHOT_DIR = path.join(
  process.cwd(),
  process.env.NODE_ENV === "test" ? `.next-runtime-test${TEST_FALLBACK_DIR_SUFFIX}` : ".next-runtime",
);
const FALLBACK_SNAPSHOT_PATH = path.join(FALLBACK_SNAPSHOT_DIR, "alpha-exchange-fallback.json");

const SCHEMA_SQL = [
  "create schema if not exists alpha_exchange",
  `create table if not exists alpha_exchange.runtime_meta (
    singleton boolean primary key default true,
    version bigint not null default 0,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists alpha_exchange.users (
    id text primary key,
    email text not null unique,
    role text not null,
    seller_status text not null,
    availability_status text not null,
    online_status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.seller_profiles (
    user_id text primary key references alpha_exchange.users(id) on delete cascade,
    seller_status text not null,
    availability_status text not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.seller_settings (
    user_id text primary key references alpha_exchange.users(id) on delete cascade,
    availability_status text not null,
    notification_preferences jsonb not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.listings (
    id text primary key,
    seller_id text not null references alpha_exchange.users(id) on delete cascade,
    status text not null,
    active_trade_request_id text,
    expires_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.trades (
    id text primary key,
    purchase_request_id text not null unique,
    listing_id text not null,
    seller_id text not null,
    buyer_id text not null,
    status text not null,
    completed_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.purchase_requests (
    id text primary key,
    trade_id text,
    listing_id text not null,
    seller_id text not null,
    buyer_id text not null,
    status text not null,
    timed_out_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.notifications (
    id text primary key,
    user_id text not null references alpha_exchange.users(id) on delete cascade,
    category text not null,
    is_read boolean not null,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.commissions (
    id text primary key,
    purchase_request_id text not null,
    listing_id text not null,
    seller_id text not null,
    buyer_id text not null,
    payment_status text not null,
    due_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.audit_logs (
    id text primary key,
    action text not null,
    actor_user_id text not null,
    target_user_id text,
    listing_id text,
    purchase_request_id text,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.evidence (
    id text primary key,
    purchase_request_id text not null,
    side text not null,
    uploaded_by_user_id text not null,
    mime_type text not null,
    file_name text not null,
    size_bytes integer not null,
    uploaded_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null,
    content bytea
  )`,
  `create table if not exists alpha_exchange.sessions (
    token_hash text primary key,
    user_id text not null references alpha_exchange.users(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.password_reset_tokens (
    id text primary key,
    user_id text not null references alpha_exchange.users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.seller_applications (
    id text primary key,
    user_id text not null references alpha_exchange.users(id) on delete cascade,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.activity_logs (
    id text primary key,
    user_id text not null references alpha_exchange.users(id) on delete cascade,
    category text not null,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.disputes (
    id text primary key,
    trade_id text not null,
    purchase_request_id text not null,
    seller_id text not null,
    buyer_id text not null,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.seller_reports (
    id text primary key,
    reporter_user_id text not null,
    seller_id text not null,
    purchase_request_id text,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.trust_snapshots (
    seller_id text primary key references alpha_exchange.users(id) on delete cascade,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.trust_score_history (
    id text primary key,
    seller_id text not null references alpha_exchange.users(id) on delete cascade,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.private_beta_invites (
    id text primary key,
    code text not null unique,
    status text not null,
    created_by_user_id text not null,
    expires_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.private_beta_invite_uses (
    id text primary key,
    invite_code_id text not null references alpha_exchange.private_beta_invites(id) on delete cascade,
    used_by_user_id text not null references alpha_exchange.users(id) on delete cascade,
    used_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.beta_feedback (
    id text primary key,
    user_id text not null references alpha_exchange.users(id) on delete cascade,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.beta_announcements (
    id text primary key,
    type text not null,
    is_active boolean not null,
    created_by_user_id text not null references alpha_exchange.users(id) on delete cascade,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.admin_announcement_runs (
    id text primary key,
    request_key text not null,
    audience text not null,
    status text not null,
    created_by_user_id text not null references alpha_exchange.users(id) on delete cascade,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.sms_deliveries (
    id text primary key,
    event_key text not null unique,
    event_type text not null,
    recipient_user_id text not null references alpha_exchange.users(id) on delete cascade,
    status text not null,
    retry_count integer not null default 0,
    twilio_message_sid text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  "alter table alpha_exchange.admin_announcement_runs add column if not exists request_key text",
  "create index if not exists idx_alpha_exchange_users_email on alpha_exchange.users (email)",
  "create index if not exists idx_alpha_exchange_users_role on alpha_exchange.users (role)",
  "create index if not exists idx_alpha_exchange_listings_seller_status on alpha_exchange.listings (seller_id, status)",
  "create index if not exists idx_alpha_exchange_listings_expires_at on alpha_exchange.listings (expires_at)",
  "create index if not exists idx_alpha_exchange_purchase_requests_seller_status on alpha_exchange.purchase_requests (seller_id, status)",
  "create index if not exists idx_alpha_exchange_purchase_requests_buyer_status on alpha_exchange.purchase_requests (buyer_id, status)",
  "create index if not exists idx_alpha_exchange_purchase_requests_listing on alpha_exchange.purchase_requests (listing_id)",
  "create index if not exists idx_alpha_exchange_notifications_user_read on alpha_exchange.notifications (user_id, is_read, created_at desc)",
  "create index if not exists idx_alpha_exchange_commissions_payment_status on alpha_exchange.commissions (payment_status, due_at)",
  "create index if not exists idx_alpha_exchange_audit_logs_created_at on alpha_exchange.audit_logs (created_at desc)",
  "create index if not exists idx_alpha_exchange_evidence_request_side on alpha_exchange.evidence (purchase_request_id, side)",
  "create index if not exists idx_alpha_exchange_sessions_user_expires on alpha_exchange.sessions (user_id, expires_at)",
  "create index if not exists idx_alpha_exchange_seller_applications_status on alpha_exchange.seller_applications (status, created_at)",
  "create index if not exists idx_alpha_exchange_trades_status on alpha_exchange.trades (status, created_at desc)",
  "create index if not exists idx_alpha_exchange_announcement_runs_created_at on alpha_exchange.admin_announcement_runs (created_at desc)",
  "create unique index if not exists idx_alpha_exchange_announcement_runs_request_key on alpha_exchange.admin_announcement_runs (created_by_user_id, request_key)",
  "create index if not exists idx_alpha_exchange_sms_deliveries_status on alpha_exchange.sms_deliveries (status, updated_at desc)",
];

const DEFAULT_DB = alphaExchangeSeed as unknown as AlphaExchangeDb;

type SnapshotWithVersion = AlphaExchangeDb & { __runtimeVersion?: number };

type RepoTable<T> = {
  name: string;
  selectSql: string;
  values: (db: AlphaExchangeDb) => T[];
  insert: (tx: PoolClient, rows: T[], context: SaveContext) => Promise<void>;
};

type SaveContext = {
  evidenceContentById: Map<string, Buffer | null>;
  evidenceOverrides?: EvidenceWriteMap;
};

const SNAPSHOT_TABLE_NAMES = [
  "users",
  "seller_profiles",
  "seller_settings",
  "listings",
  "trades",
  "purchase_requests",
  "notifications",
  "commissions",
  "audit_logs",
  "evidence",
  "sessions",
  "password_reset_tokens",
  "seller_applications",
  "activity_logs",
  "disputes",
  "seller_reports",
  "trust_snapshots",
  "trust_score_history",
  "private_beta_invites",
  "private_beta_invite_uses",
  "beta_feedback",
  "beta_announcements",
  "admin_announcement_runs",
  "sms_deliveries",
] as const;

export type SnapshotTableName = (typeof SNAPSHOT_TABLE_NAMES)[number];

function shouldLogRepoVersionFlow() {
  return process.env.ALPHA_EXCHANGE_REPO_TRACE === "1";
}

function shouldPersistRepoVersionTrace() {
  return process.env.ALPHA_EXCHANGE_REPO_TRACE === "1";
}

function logRepoVersionFlow(event: string, payload: Record<string, unknown>) {
  if (!shouldLogRepoVersionFlow()) return;
  const line = `[alpha-exchange-repo] ${new Date().toISOString()} ${event} ${JSON.stringify(payload)}`;
  console.log(line);
  if (!shouldPersistRepoVersionTrace()) return;
  try {
    appendFileSync(`${process.cwd()}\\data\\alpha-exchange-repo-trace.log`, `${line}\n`);
  } catch {
    // Ignore log persistence failures; console output remains available.
  }
}

// ---------------------------------------------------------------------------
// Per-operation performance profiler
// Enable with: ALPHA_EXCHANGE_PERF=1
// Logs to console as:  [REPO-PERF] <op> <step> +<total>ms (delta <step>ms)
// ---------------------------------------------------------------------------
function isRepoPerfEnabled() {
  return process.env.ALPHA_EXCHANGE_PERF === "1";
}

function createRepoPerf(op: string) {
  if (!isRepoPerfEnabled()) return null;
  const start = Date.now();
  let last = start;
  const steps: Array<{ step: string; delta: number; total: number }> = [];
  return {
    step(name: string) {
      const now = Date.now();
      const delta = now - last;
      const total = now - start;
      steps.push({ step: name, delta, total });
      console.log(`[REPO-PERF] ${op} ${name} +${total}ms (step ${delta}ms)`);
      last = now;
    },
    done() {
      const total = Date.now() - start;
      console.log(`[REPO-PERF] ${op} TOTAL ${total}ms steps=${JSON.stringify(steps)}`);
    },
  };
}

declare global {
  var __alphaExchangeRepositoryPromise: Promise<AlphaExchangeRepository> | undefined;
  var __alphaExchangeMemorySnapshot: SnapshotWithVersion | undefined;
  var __alphaExchangeMemoryEvidenceContent: Map<string, Buffer | null> | undefined;
}

function toTimestamp(value: string | undefined) {
  return value ? new Date(value) : null;
}

function json<T>(value: T) {
  return JSON.stringify(value);
}

function fromPayloadRows<T>(rows: Array<{ payload: T }>) {
  return rows.map((row) => row.payload);
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

async function bulkInsert(tx: PoolClient, sql: string, columnArrays: unknown[][]): Promise<void> {
  if (!columnArrays[0]?.length) return;
  await tx.query(sql, columnArrays);
}

const tables = [
  {
    name: "users",
    selectSql: "select payload from alpha_exchange.users order by sort_index asc",
    values: (db) => db.users,
    insert: async (tx, rows: AlphaExchangeUser[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.users (id, email, role, seller_status, availability_status, online_status, created_at, updated_at, sort_index, payload)
SELECT id, email, role, seller_status, availability_status, online_status, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[])
  AS t(id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.email),
        rows.map(r => r.role),
        rows.map(r => r.sellerStatus),
        rows.map(r => r.availabilityStatus),
        rows.map(r => r.onlineStatus),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "seller_profiles",
    selectSql: "select payload from alpha_exchange.seller_profiles order by sort_index asc",
    values: (db) =>
      db.users.map((user) => ({
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        profilePhotoUrl: user.profilePhotoUrl,
        languages: user.languages,
        bio: user.bio,
        tradingExperience: user.tradingExperience,
        workingHours: user.workingHours,
        preferredPaymentMethods: user.preferredPaymentMethods,
        country: user.country,
        city: user.city,
        coverBannerUrl: user.coverBannerUrl,
        onlineStatus: user.onlineStatus,
        availabilityStatus: user.availabilityStatus,
        lastActiveAt: user.lastActiveAt,
        isFeaturedSeller: user.isFeaturedSeller,
        isProfileHidden: user.isProfileHidden,
        isFoundingMember: user.isFoundingMember,
        isFoundingSeller: user.isFoundingSeller,
        sellerStatus: user.sellerStatus,
        updatedAt: user.updatedAt,
      })),
    insert: async (tx, rows: Array<Record<string, unknown>>) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.seller_profiles (user_id, seller_status, availability_status, updated_at, sort_index, payload)
SELECT user_id, seller_status, availability_status, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[])
  AS t(user_id,seller_status,availability_status,updated_at,sort_index,payload)`, [
        rows.map(r => String(r.userId)),
        rows.map(r => String(r.sellerStatus)),
        rows.map(r => String(r.availabilityStatus)),
        rows.map(r => String(r.updatedAt)),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "seller_settings",
    selectSql: "select payload from alpha_exchange.seller_settings order by sort_index asc",
    values: (db) =>
      db.users.map((user) => ({
        userId: user.id,
        availabilityStatus: user.availabilityStatus,
        preferredNetworks: user.preferredNetworks,
        preferredPaymentMethods: user.preferredPaymentMethods ?? [],
        notificationPreferences: user.notificationPreferences ?? { inApp: true, email: false, sms: false },
        updatedAt: user.updatedAt,
      })),
    insert: async (tx, rows: Array<Record<string, unknown>>) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.seller_settings (user_id, availability_status, notification_preferences, updated_at, sort_index, payload)
SELECT user_id, availability_status, notification_preferences::jsonb, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[])
  AS t(user_id,availability_status,notification_preferences,updated_at,sort_index,payload)`, [
        rows.map(r => String(r.userId)),
        rows.map(r => String(r.availabilityStatus)),
        rows.map(r => json(r.notificationPreferences)),
        rows.map(r => String(r.updatedAt)),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "listings",
    selectSql: "select payload from alpha_exchange.listings order by sort_index asc",
    values: (db) => db.marketplaceListings,
    insert: async (tx, rows: MarketplaceListing[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.listings (id, seller_id, status, active_trade_request_id, expires_at, created_at, updated_at, sort_index, payload)
SELECT id, seller_id, status, active_trade_request_id, expires_at::timestamptz, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[])
  AS t(id,seller_id,status,active_trade_request_id,expires_at,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.sellerId),
        rows.map(r => r.status),
        rows.map(r => r.activeTradeRequestId ?? null),
        rows.map(r => toTimestamp(r.expiresAt)?.toISOString() ?? null),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "trades",
    selectSql: "select payload from alpha_exchange.trades order by sort_index asc",
    values: (db) =>
      db.purchaseRequests.map((request) => ({
        id: request.tradeId ?? request.id,
        purchaseRequestId: request.id,
        listingId: request.listingId,
        sellerId: request.sellerId,
        buyerId: request.buyerId,
        status: request.status,
        completedAt: request.completedAt,
        createdAt: request.tradeCreatedAt ?? request.createdAt,
        updatedAt: request.updatedAt,
        timeline: request.timeline,
      })),
    insert: async (tx, rows: Array<Record<string, unknown>>) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.trades (id, purchase_request_id, listing_id, seller_id, buyer_id, status, completed_at, created_at, updated_at, sort_index, payload)
SELECT id, purchase_request_id, listing_id, seller_id, buyer_id, status, completed_at::timestamptz, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[])
  AS t(id,purchase_request_id,listing_id,seller_id,buyer_id,status,completed_at,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => String(r.id)),
        rows.map(r => String(r.purchaseRequestId)),
        rows.map(r => String(r.listingId)),
        rows.map(r => String(r.sellerId)),
        rows.map(r => String(r.buyerId)),
        rows.map(r => String(r.status)),
        rows.map(r => toTimestamp(typeof r.completedAt === "string" ? r.completedAt : undefined)?.toISOString() ?? null),
        rows.map(r => String(r.createdAt)),
        rows.map(r => String(r.updatedAt)),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "purchase_requests",
    selectSql: "select payload from alpha_exchange.purchase_requests order by sort_index asc",
    values: (db) => db.purchaseRequests,
    insert: async (tx, rows: PurchaseRequest[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.purchase_requests (id, trade_id, listing_id, seller_id, buyer_id, status, timed_out_at, completed_at, created_at, updated_at, sort_index, payload)
SELECT id, trade_id, listing_id, seller_id, buyer_id, status, timed_out_at::timestamptz, completed_at::timestamptz, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[],$12::text[])
  AS t(id,trade_id,listing_id,seller_id,buyer_id,status,timed_out_at,completed_at,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.tradeId ?? null),
        rows.map(r => r.listingId),
        rows.map(r => r.sellerId),
        rows.map(r => r.buyerId),
        rows.map(r => r.status),
        rows.map(r => toTimestamp(r.timedOutAt)?.toISOString() ?? null),
        rows.map(r => toTimestamp(r.completedAt)?.toISOString() ?? null),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "notifications",
    selectSql: "select payload from alpha_exchange.notifications order by sort_index asc",
    values: (db) => db.notifications,
    insert: async (tx, rows: AlphaExchangeNotification[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.notifications (id, user_id, category, is_read, created_at, sort_index, payload)
SELECT id, user_id, category, is_read::boolean, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
  AS t(id,user_id,category,is_read,created_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.userId),
        rows.map(r => r.category),
        rows.map(r => String(r.isRead)),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "commissions",
    selectSql: "select payload from alpha_exchange.commissions order by sort_index asc",
    values: (db) => db.commissionRecords,
    insert: async (tx, rows: CommissionRecord[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.commissions (id, purchase_request_id, listing_id, seller_id, buyer_id, payment_status, due_at, created_at, updated_at, sort_index, payload)
SELECT id, purchase_request_id, listing_id, seller_id, buyer_id, payment_status, due_at::timestamptz, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[])
  AS t(id,purchase_request_id,listing_id,seller_id,buyer_id,payment_status,due_at,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.purchaseRequestId),
        rows.map(r => r.listingId),
        rows.map(r => r.sellerId),
        rows.map(r => r.buyerId),
        rows.map(r => r.paymentStatus),
        rows.map(r => toTimestamp(r.dueAt)?.toISOString() ?? null),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "audit_logs",
    selectSql: "select payload from alpha_exchange.audit_logs order by sort_index asc",
    values: (db) => db.auditLogs,
    insert: async (tx, rows: AuditLogEntry[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.audit_logs (id, action, actor_user_id, target_user_id, listing_id, purchase_request_id, created_at, sort_index, payload)
SELECT id, action, actor_user_id, target_user_id, listing_id, purchase_request_id, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[])
  AS t(id,action,actor_user_id,target_user_id,listing_id,purchase_request_id,created_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.action),
        rows.map(r => r.actorUserId),
        rows.map(r => r.targetUserId ?? null),
        rows.map(r => r.listingId ?? null),
        rows.map(r => r.purchaseRequestId ?? null),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "evidence",
    selectSql: "select payload from alpha_exchange.evidence order by sort_index asc",
    values: (db) => db.tradeEvidenceFiles,
    insert: async (tx, rows: TradeEvidenceFile[], context) => {
      for (const [index, row] of rows.entries()) {
        const content = context.evidenceOverrides?.get(row.id) ?? context.evidenceContentById.get(row.id) ?? null;
        await tx.query(
          `insert into alpha_exchange.evidence
            (id, purchase_request_id, side, uploaded_by_user_id, mime_type, file_name, size_bytes, uploaded_at, sort_index, payload, content)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
          [row.id, row.purchaseRequestId, row.side, row.uploadedByUserId, row.mimeType, row.fileName, row.sizeBytes, row.uploadedAt, index, json(row), content],
        );
      }
    },
  },
  {
    name: "sessions",
    selectSql: "select payload from alpha_exchange.sessions order by sort_index asc",
    values: (db) => db.authSessions,
    insert: async (tx, rows: AuthSession[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.sessions (token_hash, user_id, expires_at, created_at, sort_index, payload)
SELECT token_hash, user_id, expires_at::timestamptz, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[])
  AS t(token_hash,user_id,expires_at,created_at,sort_index,payload)`, [
        rows.map(r => r.token),
        rows.map(r => r.userId),
        rows.map(r => r.expiresAt),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "password_reset_tokens",
    selectSql: "select payload from alpha_exchange.password_reset_tokens order by sort_index asc",
    values: (db) => db.passwordResetTokens,
    insert: async (tx, rows: PasswordResetToken[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.password_reset_tokens (id, user_id, token_hash, expires_at, created_at, sort_index, payload)
SELECT id, user_id, token_hash, expires_at::timestamptz, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
  AS t(id,user_id,token_hash,expires_at,created_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.userId),
        rows.map(r => r.tokenHash),
        rows.map(r => r.expiresAt),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "seller_applications",
    selectSql: "select payload from alpha_exchange.seller_applications order by sort_index asc",
    values: (db) => db.sellerApplications,
    insert: async (tx, rows: SellerApplication[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.seller_applications (id, user_id, status, created_at, updated_at, sort_index, payload)
SELECT id, user_id, status, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
  AS t(id,user_id,status,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.userId),
        rows.map(r => r.status),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "activity_logs",
    selectSql: "select payload from alpha_exchange.activity_logs order by sort_index asc",
    values: (db) => db.activityLog,
    insert: async (tx, rows: AlphaExchangeActivityLogEntry[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.activity_logs (id, user_id, category, created_at, sort_index, payload)
SELECT id, user_id, category, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[])
  AS t(id,user_id,category,created_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.userId),
        rows.map(r => r.category),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "disputes",
    selectSql: "select payload from alpha_exchange.disputes order by sort_index asc",
    values: (db) => db.disputes,
    insert: async (tx, rows: TradeDisputeCase[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.disputes (id, trade_id, purchase_request_id, seller_id, buyer_id, status, created_at, updated_at, sort_index, payload)
SELECT id, trade_id, purchase_request_id, seller_id, buyer_id, status, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[])
  AS t(id,trade_id,purchase_request_id,seller_id,buyer_id,status,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.tradeId),
        rows.map(r => r.purchaseRequestId),
        rows.map(r => r.sellerId),
        rows.map(r => r.buyerId),
        rows.map(r => r.status),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "seller_reports",
    selectSql: "select payload from alpha_exchange.seller_reports order by sort_index asc",
    values: (db) => db.sellerReports,
    insert: async (tx, rows: SellerReport[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.seller_reports (id, reporter_user_id, seller_id, purchase_request_id, created_at, sort_index, payload)
SELECT id, reporter_user_id, seller_id, purchase_request_id, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
  AS t(id,reporter_user_id,seller_id,purchase_request_id,created_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.reporterUserId),
        rows.map(r => r.sellerId),
        rows.map(r => r.purchaseRequestId ?? null),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "trust_snapshots",
    selectSql: "select payload from alpha_exchange.trust_snapshots order by sort_index asc",
    values: (db) => db.trustSnapshots,
    insert: async (tx, rows: TrustSnapshotRecord[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.trust_snapshots (seller_id, updated_at, sort_index, payload)
SELECT seller_id, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[])
  AS t(seller_id,updated_at,sort_index,payload)`, [
        rows.map(r => r.sellerId),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "trust_score_history",
    selectSql: "select payload from alpha_exchange.trust_score_history order by sort_index asc",
    values: (db) => db.trustScoreHistory,
    insert: async (tx, rows: TrustScoreChangeLog[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.trust_score_history (id, seller_id, created_at, sort_index, payload)
SELECT id, seller_id, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[])
  AS t(id,seller_id,created_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.sellerId),
        rows.map(r => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "private_beta_invites",
    selectSql: "select payload from alpha_exchange.private_beta_invites order by sort_index asc",
    values: (db) => db.privateBetaInvites,
    insert: async (tx, rows: PrivateBetaInviteCode[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.private_beta_invites (id, code, status, created_by_user_id, expires_at, created_at, updated_at, sort_index, payload)
SELECT id, code, status, created_by_user_id, expires_at::timestamptz, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[])
  AS t(id,code,status,created_by_user_id,expires_at,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.code),
        rows.map(r => r.status),
        rows.map(r => r.createdByUserId),
        rows.map(r => toTimestamp(r.expiresAt)?.toISOString() ?? null),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "private_beta_invite_uses",
    selectSql: "select payload from alpha_exchange.private_beta_invite_uses order by sort_index asc",
    values: (db) => db.privateBetaInviteUses,
    insert: async (tx, rows: PrivateBetaInviteUse[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.private_beta_invite_uses (id, invite_code_id, used_by_user_id, used_at, sort_index, payload)
SELECT id, invite_code_id, used_by_user_id, used_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[])
  AS t(id,invite_code_id,used_by_user_id,used_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.inviteCodeId),
        rows.map(r => r.usedByUserId),
        rows.map(r => r.usedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "beta_feedback",
    selectSql: "select payload from alpha_exchange.beta_feedback order by sort_index asc",
    values: (db) => db.betaFeedback,
    insert: async (tx, rows: BetaFeedbackEntry[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.beta_feedback (id, user_id, status, created_at, updated_at, sort_index, payload)
SELECT id, user_id, status, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
  AS t(id,user_id,status,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.userId),
        rows.map(r => r.status),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "beta_announcements",
    selectSql: "select payload from alpha_exchange.beta_announcements order by sort_index asc",
    values: (db) => db.betaAnnouncements,
    insert: async (tx, rows: BetaAnnouncement[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.beta_announcements (id, type, is_active, created_by_user_id, created_at, updated_at, sort_index, payload)
SELECT id, type, is_active::boolean, created_by_user_id, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[])
  AS t(id,type,is_active,created_by_user_id,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.type),
        rows.map(r => String(r.isActive)),
        rows.map(r => r.createdByUserId),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "admin_announcement_runs",
    selectSql: "select payload from alpha_exchange.admin_announcement_runs order by sort_index asc",
    values: (db) => db.adminAnnouncementRuns ?? [],
    insert: async (tx, rows: AdminAnnouncementRun[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.admin_announcement_runs (id, request_key, audience, status, created_by_user_id, created_at, updated_at, sort_index, payload)
SELECT id, request_key, audience, status, created_by_user_id, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[])
  AS t(id,request_key,audience,status,created_by_user_id,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id),
        rows.map(r => r.requestKey),
        rows.map(r => r.audience),
        rows.map(r => r.status),
        rows.map(r => r.createdByUserId),
        rows.map(r => r.createdAt),
        rows.map(r => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map(r => json(r)),
      ]);
    },
  },
  {
    name: "sms_deliveries",
    selectSql: "select payload from alpha_exchange.sms_deliveries order by sort_index asc",
    values: (db) => db.smsDeliveries ?? [],
    insert: async (tx, rows: SmsDeliveryRecord[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.sms_deliveries (id, event_key, event_type, recipient_user_id, status, retry_count, twilio_message_sid, created_at, updated_at, sort_index, payload)
SELECT id, event_key, event_type, recipient_user_id, status, retry_count::int, twilio_message_sid, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[])
  AS t(id,event_key,event_type,recipient_user_id,status,retry_count,twilio_message_sid,created_at,updated_at,sort_index,payload)`, [
        rows.map(r => r.id), rows.map(r => r.eventKey), rows.map(r => r.eventType), rows.map(r => r.recipientUserId),
        rows.map(r => r.status), rows.map(r => String(r.retryCount)), rows.map(r => r.twilioMessageSid ?? null),
        rows.map(r => r.createdAt), rows.map(r => r.updatedAt), rows.map((_, i) => String(i)), rows.map(r => json(r)),
      ]);
    },
  },
] as Array<RepoTable<unknown>>;

const tableByName = new Map(tables.map((table) => [table.name, table]));

function getTable(name: string) {
  const table = tableByName.get(name);
  if (!table) throw new Error(`Unknown repository table: ${name}`);
  return table;
}

async function upsertUsersTable(tx: PoolClient, rows: AlphaExchangeUser[]) {
  await bulkInsert(tx, `INSERT INTO alpha_exchange.users (id, email, role, seller_status, availability_status, online_status, created_at, updated_at, sort_index, payload)
SELECT id, email, role, seller_status, availability_status, online_status, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[])
  AS t(id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload)
ON CONFLICT (id) DO UPDATE SET
  email = excluded.email,
  role = excluded.role,
  seller_status = excluded.seller_status,
  availability_status = excluded.availability_status,
  online_status = excluded.online_status,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  sort_index = excluded.sort_index,
  payload = excluded.payload`, [
    rows.map(r => r.id),
    rows.map(r => r.email),
    rows.map(r => r.role),
    rows.map(r => r.sellerStatus),
    rows.map(r => r.availabilityStatus),
    rows.map(r => r.onlineStatus),
    rows.map(r => r.createdAt),
    rows.map(r => r.updatedAt),
    rows.map((_, i) => String(i)),
    rows.map(r => json(r)),
  ]);
}

async function replaceTableContents(tx: PoolClient, tableName: SnapshotTableName, db: AlphaExchangeDb, context?: SaveContext) {
  if (tableName === "users") {
    const userRows = db.users;
    if (userRows.length === 0) {
      await tx.query("delete from alpha_exchange.users");
      return;
    }
    await tx.query("delete from alpha_exchange.users where not (id = any($1::text[]))", [userRows.map((row) => row.id)]);
    await upsertUsersTable(tx, userRows);
    return;
  }
  await tx.query(`delete from alpha_exchange.${tableName}`);
  const table = getTable(tableName);
  await table.insert(tx, table.values(db), {
    evidenceContentById: context?.evidenceContentById ?? new Map(),
    evidenceOverrides: context?.evidenceOverrides,
  });
}

function isListingCreateProfilingEnabled() {
  return process.env.ALPHA_EXCHANGE_PROFILE_LISTING_CREATE === "1";
}

function createRepositoryProfileLogger(scope: string) {
  const startedAt = Date.now();
  let lastAt = startedAt;
  return (stage: string) => {
    if (!isListingCreateProfilingEnabled()) return;
    const now = Date.now();
    console.log(`[alpha-exchange-profile] ${scope} ${stage} +${now - startedAt}ms (delta ${now - lastAt}ms)`);
    lastAt = now;
  };
}

function attachVersion<T extends AlphaExchangeDb>(db: T, version: number): SnapshotWithVersion {
  Object.defineProperty(db, "__runtimeVersion", {
    value: version,
    // Keep this enumerable so spread/clone operations in the store preserve version metadata.
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return db as SnapshotWithVersion;
}

function getVersion(db: AlphaExchangeDb) {
  return (db as SnapshotWithVersion).__runtimeVersion ?? 0;
}

function emptySnapshotCollections(): AlphaExchangeDb {
  return {
    users: [],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [],
    tradeEvidenceFiles: [],
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
    smsDeliveries: [],
  };
}

function snapshotFromTableRows(
  results: Array<{ tableName: SnapshotTableName; rows: Array<{ payload: unknown }> }>,
): AlphaExchangeDb {
  const snapshot = emptySnapshotCollections();

  for (const { tableName, rows } of results) {
    switch (tableName) {
      case "users":
        snapshot.users = fromPayloadRows(rows as Array<{ payload: AlphaExchangeUser }>);
        break;
      case "seller_applications":
        snapshot.sellerApplications = fromPayloadRows(rows as Array<{ payload: SellerApplication }>);
        break;
      case "listings":
        snapshot.marketplaceListings = fromPayloadRows(rows as Array<{ payload: MarketplaceListing }>);
        break;
      case "purchase_requests":
        snapshot.purchaseRequests = fromPayloadRows(rows as Array<{ payload: PurchaseRequest }>);
        break;
      case "commissions":
        snapshot.commissionRecords = fromPayloadRows(rows as Array<{ payload: CommissionRecord }>);
        break;
      case "audit_logs":
        snapshot.auditLogs = fromPayloadRows(rows as Array<{ payload: AuditLogEntry }>);
        break;
      case "sessions":
        snapshot.authSessions = fromPayloadRows(rows as Array<{ payload: AuthSession }>);
        break;
      case "password_reset_tokens":
        snapshot.passwordResetTokens = fromPayloadRows(rows as Array<{ payload: PasswordResetToken }>);
        break;
      case "notifications":
        snapshot.notifications = fromPayloadRows(rows as Array<{ payload: AlphaExchangeNotification }>);
        break;
      case "activity_logs":
        snapshot.activityLog = fromPayloadRows(rows as Array<{ payload: AlphaExchangeActivityLogEntry }>);
        break;
      case "disputes":
        snapshot.disputes = fromPayloadRows(rows as Array<{ payload: TradeDisputeCase }>);
        break;
      case "seller_reports":
        snapshot.sellerReports = fromPayloadRows(rows as Array<{ payload: SellerReport }>);
        break;
      case "trust_snapshots":
        snapshot.trustSnapshots = fromPayloadRows(rows as Array<{ payload: TrustSnapshotRecord }>);
        break;
      case "trust_score_history":
        snapshot.trustScoreHistory = fromPayloadRows(rows as Array<{ payload: TrustScoreChangeLog }>);
        break;
      case "evidence":
        snapshot.tradeEvidenceFiles = fromPayloadRows(rows as Array<{ payload: TradeEvidenceFile }>);
        break;
      case "private_beta_invites":
        snapshot.privateBetaInvites = fromPayloadRows(rows as Array<{ payload: PrivateBetaInviteCode }>);
        break;
      case "private_beta_invite_uses":
        snapshot.privateBetaInviteUses = fromPayloadRows(rows as Array<{ payload: PrivateBetaInviteUse }>);
        break;
      case "beta_feedback":
        snapshot.betaFeedback = fromPayloadRows(rows as Array<{ payload: BetaFeedbackEntry }>);
        break;
      case "beta_announcements":
        snapshot.betaAnnouncements = fromPayloadRows(rows as Array<{ payload: BetaAnnouncement }>);
        break;
      case "admin_announcement_runs":
        snapshot.adminAnnouncementRuns = fromPayloadRows(rows as Array<{ payload: AdminAnnouncementRun }>);
        break;
      case "sms_deliveries":
        snapshot.smsDeliveries = fromPayloadRows(rows as Array<{ payload: SmsDeliveryRecord }>);
        break;
      default:
        break;
    }
  }

  return snapshot;
}

function isAbortedTransactionError(error: unknown) {
  if (!error) return false;
  if (typeof error === "object") {
    const code = (error as { code?: string }).code;
    if (code === "25P02") return true;
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && /current transaction is aborted|in failed sql transaction|transaction aborted/i.test(message)) {
      return true;
    }
  }
  return false;
}

function getPurchaseRequestStatusRank(status: PurchaseRequest["status"]) {
  const rank: Record<PurchaseRequest["status"], number> = {
    pending: 0,
    accepted: 1,
    payment_sent: 2,
    funds_received: 3,
    usdt_release_pending: 4,
    usdt_sent: 5,
    completed: 6,
    locked: 7,
    review_open: 8,
    declined: 9,
    cancelled: 9,
  };
  return rank[status] ?? 0;
}

function mergeSnapshotWithLatest(latest: AlphaExchangeDb, incoming: AlphaExchangeDb): AlphaExchangeDb {
  const latestById = new Map<string, unknown>();
  for (const item of latest.purchaseRequests) {
    latestById.set(item.id, item);
  }
  const incomingById = new Map<string, unknown>();
  for (const item of incoming.purchaseRequests) {
    incomingById.set(item.id, item);
  }
  const mergedPurchaseRequests = [...incoming.purchaseRequests];
  for (const request of latest.purchaseRequests) {
    if (!incomingById.has(request.id)) {
      mergedPurchaseRequests.push(request);
    }
  }
  for (const request of incoming.purchaseRequests) {
    const latestRequest = latestById.get(request.id) as PurchaseRequest | undefined;
    if (!latestRequest) continue;
    const latestUpdatedAt = new Date(latestRequest.updatedAt ?? latestRequest.createdAt ?? 0).getTime();
    const incomingUpdatedAt = new Date(request.updatedAt ?? request.createdAt ?? 0).getTime();
    const index = mergedPurchaseRequests.findIndex((item) => item.id === request.id);
    if (index < 0) continue;
    const incomingRank = getPurchaseRequestStatusRank(request.status);
    const latestRank = getPurchaseRequestStatusRank(latestRequest.status);
    if (incomingRank !== latestRank) {
      mergedPurchaseRequests[index] = incomingRank > latestRank ? request : latestRequest;
      continue;
    }
    mergedPurchaseRequests[index] = incomingUpdatedAt > latestUpdatedAt ? request : latestRequest;
  }
  const getCollection = <T>(value: T[] | undefined, fallback: T[]) => Array.isArray(value) ? value : fallback;
  const mergedAnnouncementRuns = new Map(
    getCollection(latest.adminAnnouncementRuns, []).map((run) => [run.id, run]),
  );
  for (const run of getCollection(incoming.adminAnnouncementRuns, [])) {
    const latestRun = mergedAnnouncementRuns.get(run.id);
    if (!latestRun || new Date(run.updatedAt).getTime() > new Date(latestRun.updatedAt).getTime()) {
      mergedAnnouncementRuns.set(run.id, run);
    }
  }
  const smsStatusRank = { queued: 0, sent: 1, failed: 2, delivered: 3 } as const;
  const mergedSmsDeliveries = new Map(
    getCollection(latest.smsDeliveries, []).map((delivery) => [delivery.id, delivery]),
  );
  for (const delivery of getCollection(incoming.smsDeliveries, [])) {
    const current = mergedSmsDeliveries.get(delivery.id);
    if (!current) {
      mergedSmsDeliveries.set(delivery.id, delivery);
      continue;
    }
    const currentRank = smsStatusRank[current.status];
    const incomingRank = smsStatusRank[delivery.status];
    if (
      incomingRank > currentRank
      || (incomingRank === currentRank && new Date(delivery.updatedAt).getTime() > new Date(current.updatedAt).getTime())
    ) {
      mergedSmsDeliveries.set(delivery.id, delivery);
    }
  }

  return {
    ...latest,
    ...incoming,
    users: getCollection(incoming.users, latest.users),
    sellerApplications: getCollection(incoming.sellerApplications, latest.sellerApplications),
    marketplaceListings: getCollection(incoming.marketplaceListings, latest.marketplaceListings),
    purchaseRequests: mergedPurchaseRequests,
    commissionRecords: getCollection(incoming.commissionRecords, latest.commissionRecords),
    auditLogs: getCollection(incoming.auditLogs, latest.auditLogs),
    authSessions: pruneOrphanAuthSessions(latest).authSessions,
    passwordResetTokens: getCollection(incoming.passwordResetTokens, latest.passwordResetTokens),
    notifications: getCollection(incoming.notifications, latest.notifications),
    activityLog: getCollection(incoming.activityLog, latest.activityLog),
    disputes: getCollection(incoming.disputes, latest.disputes),
    sellerReports: getCollection(incoming.sellerReports, latest.sellerReports),
    trustSnapshots: getCollection(incoming.trustSnapshots, latest.trustSnapshots),
    trustScoreHistory: getCollection(incoming.trustScoreHistory, latest.trustScoreHistory),
    tradeEvidenceFiles: getCollection(incoming.tradeEvidenceFiles, latest.tradeEvidenceFiles),
    privateBetaInvites: getCollection(incoming.privateBetaInvites, latest.privateBetaInvites),
    privateBetaInviteUses: getCollection(incoming.privateBetaInviteUses, latest.privateBetaInviteUses),
    betaFeedback: getCollection(incoming.betaFeedback, latest.betaFeedback),
    betaAnnouncements: getCollection(incoming.betaAnnouncements, latest.betaAnnouncements),
    adminAnnouncementRuns: [...mergedAnnouncementRuns.values()]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    sellerReviews: getCollection(incoming.sellerReviews, latest.sellerReviews),
    smsDeliveries: [...mergedSmsDeliveries.values()]
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
  };
}

async function runSchema(target: Queryable) {
  for (const statement of SCHEMA_SQL) {
    await target.query(statement);
  }
  await target.query(
    "insert into alpha_exchange.runtime_meta (singleton, version, updated_at) values (true, 0, now()) on conflict (singleton) do nothing",
  );
}

function ensureMemorySeed() {
  if (!globalThis.__alphaExchangeMemorySnapshot) {
    const persistedFallback = loadPersistedFallbackSnapshot();
    globalThis.__alphaExchangeMemorySnapshot = persistedFallback ?? attachVersion(cloneSnapshot(DEFAULT_DB), 0);
  }
  if (!globalThis.__alphaExchangeMemoryEvidenceContent) {
    globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
  }
}

function getLatestAvailableFallbackSnapshot(): SnapshotWithVersion {
  const memorySnapshot = globalThis.__alphaExchangeMemorySnapshot
    ? attachVersion(
      cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
      getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
    )
    : null;
  const persistedFallback = loadPersistedFallbackSnapshot();
  if (!memorySnapshot) {
    if (persistedFallback) {
      globalThis.__alphaExchangeMemorySnapshot = attachVersion(cloneSnapshot(persistedFallback), getVersion(persistedFallback));
      return attachVersion(cloneSnapshot(persistedFallback), getVersion(persistedFallback));
    }
    ensureMemorySeed();
    return attachVersion(
      cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
      getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
    );
  }
  if (!persistedFallback) {
    return memorySnapshot;
  }

  if (getVersion(persistedFallback) >= getVersion(memorySnapshot)) {
    globalThis.__alphaExchangeMemorySnapshot = attachVersion(cloneSnapshot(persistedFallback), getVersion(persistedFallback));
    return attachVersion(cloneSnapshot(persistedFallback), getVersion(persistedFallback));
  }

  return memorySnapshot;
}

function syncFallbackAuthSessions(update: (sessions: AuthSession[]) => AuthSession[]) {
  const snapshot = getLatestAvailableFallbackSnapshot();
  const next = attachVersion({
    ...snapshot,
    authSessions: update(snapshot.authSessions),
  }, getVersion(snapshot));
  syncMemoryFallbackSnapshot(next, getVersion(snapshot));
}

function loadPersistedFallbackSnapshot(): SnapshotWithVersion | null {
  try {
    if (!existsSync(FALLBACK_SNAPSHOT_PATH)) return null;
    const raw = readFileSync(FALLBACK_SNAPSHOT_PATH, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotWithVersion;
    const version = getVersion(parsed);
    return attachVersion(cloneSnapshot(parsed), version);
  } catch (error) {
    console.warn(
      "[alpha-exchange-repository] failed to load persisted fallback snapshot:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function pruneOrphanAuthSessions<T extends AlphaExchangeDb>(snapshot: T): T {
  const userIds = new Set(snapshot.users.map((user) => user.id));
  return {
    ...snapshot,
    authSessions: snapshot.authSessions.filter((session) => userIds.has(session.userId)),
  };
}

function syncMemoryFallbackSnapshot(snapshot: AlphaExchangeDb, version = getVersion(snapshot)) {
  ensureMemorySeed();
  const next = attachVersion(pruneOrphanAuthSessions(cloneSnapshot(snapshot)), version);
  globalThis.__alphaExchangeMemorySnapshot = next;
  try {
    mkdirSync(FALLBACK_SNAPSHOT_DIR, { recursive: true });
    writeFileSync(FALLBACK_SNAPSHOT_PATH, JSON.stringify(next), "utf8");
  } catch (error) {
    console.warn(
      "[alpha-exchange-repository] failed to persist fallback snapshot:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function queryWithLogging(client: PoolClient, queryText: string, values?: unknown[]) {
  try {
    return await client.query(queryText, values);
  } catch (error) {
    console.error("[alpha-exchange-repository] query failed", {
      queryText,
      values,
      error,
    });
    throw error;
  }
}

export class AlphaExchangeRepository {
  private readonly pool: Pool | null;
  private usesMemoryFallback: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(pool: Pool | null) {
    this.pool = pool;
    this.usesMemoryFallback = pool === null;
  }

  async ensureReady() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const pool = this.pool;
        if (this.usesMemoryFallback || !pool) {
          ensureMemorySeed();
          return;
        }
        try {
          await runSchema(pool);
          const usersCount = await pool.query<{ count: string }>("select count(*)::text as count from alpha_exchange.users");
          const shouldSeed = usersCount.rows[0]?.count === "0" && process.env.NODE_ENV !== "production";
          if (shouldSeed) {
            await this.saveSnapshot(DEFAULT_DB, { skipReadyCheck: true });
          }
        } catch (error) {
          console.error("[alpha-exchange-repository] CRITICAL: Falling back to in-memory snapshot because the database is unavailable. All data created during this session will be lost on the next invocation. Ensure SUPABASE_DB_URL uses the Transaction Mode pooler URL (pooler.supabase.com:6543), NOT the direct host (db.<ref>.supabase.co). Error:", error instanceof Error ? error.message : error);
          ensureMemorySeed();
          this.usesMemoryFallback = true;
        }
      })();
    }
    await this.initPromise;
  }

  async healthCheck() {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      return "ok" as const;
    }
    await pool.query("select 1");
    return "ok" as const;
  }

  async acquireAdminAnnouncementBatchLock(input: {
    run: AdminAnnouncementRun;
    staleBefore: string;
  }) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Durable announcement delivery is unavailable while the database is offline.");
      }
      const snapshot = getLatestAvailableFallbackSnapshot();
      const index = (snapshot.adminAnnouncementRuns ?? []).findIndex((run) => run.id === input.run.id);
      if (index === -1) return false;
      const existing = snapshot.adminAnnouncementRuns[index];
      const lockedAt = existing.batchLockedAt ? new Date(existing.batchLockedAt).getTime() : 0;
      const staleBefore = new Date(input.staleBefore).getTime();
      const anotherCampaignIsSending = snapshot.adminAnnouncementRuns.some((run) => {
        if (run.id === input.run.id || !run.batchLockedAt) return false;
        const otherLockedAt = new Date(run.batchLockedAt).getTime();
        return Number.isFinite(otherLockedAt) && otherLockedAt >= staleBefore;
      });
      if (existing.finishedAt || anotherCampaignIsSending || (lockedAt && lockedAt >= staleBefore)) return false;
      snapshot.adminAnnouncementRuns[index] = cloneSnapshot(input.run);
      syncMemoryFallbackSnapshot(snapshot, getVersion(snapshot) + 1);
      return true;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select pg_advisory_xact_lock(61422917)");
      const result = await client.query(
        `update alpha_exchange.admin_announcement_runs
         set status = $3, updated_at = $4::timestamptz, payload = $5::jsonb
         where id = $1
           and status in ('queued', 'sending')
           and (
             payload->>'batchLockedAt' is null
             or (payload->>'batchLockedAt')::timestamptz < $2::timestamptz
           )
           and not exists (
             select 1
             from alpha_exchange.admin_announcement_runs other
             where other.id <> $1
               and other.payload->>'batchLockedAt' is not null
               and (other.payload->>'batchLockedAt')::timestamptz >= $2::timestamptz
           )
         returning id`,
        [input.run.id, input.staleBefore, input.run.status, input.run.updatedAt, json(input.run)],
      );
      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("update alpha_exchange.runtime_meta set version = version + 1, updated_at = now() where singleton = true");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async commitAdminAnnouncementBatch(input: {
    run: AdminAnnouncementRun;
    batchLockId: string;
  }) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Durable announcement delivery is unavailable while the database is offline.");
      }
      const snapshot = getLatestAvailableFallbackSnapshot();
      const index = (snapshot.adminAnnouncementRuns ?? []).findIndex((run) => run.id === input.run.id);
      if (index === -1 || snapshot.adminAnnouncementRuns[index].batchLockId !== input.batchLockId) return false;
      snapshot.adminAnnouncementRuns[index] = cloneSnapshot(input.run);
      syncMemoryFallbackSnapshot(snapshot, getVersion(snapshot) + 1);
      return true;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select pg_advisory_xact_lock(61422917)");
      const result = await client.query(
        `update alpha_exchange.admin_announcement_runs
         set status = $3, updated_at = $4::timestamptz, payload = $5::jsonb
         where id = $1 and payload->>'batchLockId' = $2
         returning id`,
        [input.run.id, input.batchLockId, input.run.status, input.run.updatedAt, json(input.run)],
      );
      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("update alpha_exchange.runtime_meta set version = version + 1, updated_at = now() where singleton = true");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadSnapshot(): Promise<SnapshotWithVersion> {
    const perf = createRepoPerf("loadSnapshot");
    await this.ensureReady();
    perf?.step("ensureReady");
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const snapshot = getLatestAvailableFallbackSnapshot();
      logRepoVersionFlow("load:memory", {
        version: getVersion(snapshot),
        purchaseRequests: snapshot.purchaseRequests.length,
      });
      perf?.step("memory_fallback");
      perf?.done();
      return snapshot;
    }
    try {
      const [meta, ...results] = await Promise.all([
        pool.query<{ version: string }>("select version::text as version from alpha_exchange.runtime_meta where singleton = true"),
        ...tables.map((table) => pool.query(table.selectSql)),
      ]);
      perf?.step(`parallel_queries(${tables.length + 1})`);
      const snapshot = snapshotFromTableRows(
        results.map((result, index) => ({
          tableName: tables[index]!.name as SnapshotTableName,
          rows: result.rows as Array<{ payload: unknown }>,
        })),
      );
      perf?.step("snapshotFromTableRows");

      const version = Number(meta.rows[0]?.version ?? "0");
      const withVersion = attachVersion(pruneOrphanAuthSessions(snapshot), version);
      syncMemoryFallbackSnapshot(withVersion, version);
      logRepoVersionFlow("load:db", {
        version,
        purchaseRequests: withVersion.purchaseRequests.length,
      });
      perf?.step("syncMemoryFallback");
      perf?.done();
      return withVersion;
    } catch (error) {
      console.error("[alpha-exchange-repository] CRITICAL: Falling back to in-memory snapshot because loading the database snapshot failed. All data created during this session will be lost on the next invocation. Error:", error instanceof Error ? error.message : error);
      const fallback = getLatestAvailableFallbackSnapshot();
      logRepoVersionFlow("load:fallback-memory", {
        version: getVersion(fallback),
        purchaseRequests: fallback.purchaseRequests.length,
      });
      perf?.step("error_fallback");
      perf?.done();
      return fallback;
    }

  }

  async saveSnapshot(
    db: AlphaExchangeDb,
    options?: { evidenceOverrides?: EvidenceWriteMap; skipReadyCheck?: boolean; traceTag?: string; selectedTables?: readonly SnapshotTableName[] },
  ) {
    if (options?.traceTag) {
      console.log("[usdt-sent-trace] repository entry", { traceId: options.traceTag });
    }
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      const loadedVersion = getVersion(db);
      const previousVersion = getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion);
      if (loadedVersion !== previousVersion) {
        logRepoVersionFlow("save:memory:conflict", {
          loadedVersion,
          currentVersion: previousVersion,
          incomingPurchaseRequests: db.purchaseRequests.length,
          currentPurchaseRequests: (globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion).purchaseRequests.length,
        });
        const latestSnapshot = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion);
        latestSnapshot.authSessions = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion).authSessions;
        const nextSnapshot = pruneOrphanAuthSessions(cloneSnapshot(db));
        const mergedSnapshot = mergeSnapshotWithLatest(latestSnapshot, nextSnapshot);
        const next = attachVersion(mergedSnapshot, previousVersion + 1);
        const previousEvidence = globalThis.__alphaExchangeMemoryEvidenceContent as Map<string, Buffer | null>;
        const nextEvidence = new Map<string, Buffer | null>();
        for (const evidence of mergedSnapshot.tradeEvidenceFiles) {
          nextEvidence.set(
            evidence.id,
            options?.evidenceOverrides?.get(evidence.id) ?? previousEvidence.get(evidence.id) ?? null,
          );
        }
        globalThis.__alphaExchangeMemorySnapshot = next;
        globalThis.__alphaExchangeMemoryEvidenceContent = nextEvidence;
        logRepoVersionFlow("save:memory:merged", {
          loadedVersion,
          previousVersion,
          writtenVersion: getVersion(next),
          purchaseRequests: next.purchaseRequests.length,
        });
        return;
      }
      const nextSnapshot = cloneSnapshot(db);
      nextSnapshot.authSessions = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion).authSessions;
      const next = attachVersion(nextSnapshot, previousVersion + 1);
      const previousEvidence = globalThis.__alphaExchangeMemoryEvidenceContent as Map<string, Buffer | null>;
      const nextEvidence = new Map<string, Buffer | null>();
      for (const evidence of db.tradeEvidenceFiles) {
        nextEvidence.set(
          evidence.id,
          options?.evidenceOverrides?.get(evidence.id) ?? previousEvidence.get(evidence.id) ?? null,
        );
      }
      globalThis.__alphaExchangeMemorySnapshot = next;
      globalThis.__alphaExchangeMemoryEvidenceContent = nextEvidence;
      logRepoVersionFlow("save:memory", {
        loadedVersion,
        previousVersion,
        writtenVersion: getVersion(next),
        purchaseRequests: next.purchaseRequests.length,
      });
      return;
    }

    if (!options?.skipReadyCheck) {
      await this.ensureReady();
    } else {
      await runSchema(pool);
    }

    const selectedTables = options?.selectedTables?.length
      ? Array.from(new Set(options.selectedTables))
      : [...SNAPSHOT_TABLE_NAMES];
    const selectedTableSet = new Set<SnapshotTableName>(selectedTables);
    // When writing the 'users' table, also write 'sessions' to preserve active auth sessions.
    // PostgreSQL's ON DELETE CASCADE on sessions.user_id can evict auth sessions if a user is deleted.
    if (selectedTableSet.has("users") && !selectedTableSet.has("sessions")) {
      selectedTables.push("sessions");
      selectedTableSet.add("sessions");
    }

    let client: PoolClient | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        client = await pool.connect();
        try {
          const logProfile = createRepositoryProfileLogger("saveSnapshot");
          const perf = createRepoPerf(`saveSnapshot[${selectedTables.join(",")}]`);
          perf?.step("connect");
          await queryWithLogging(client, "begin");
          logProfile("begin");
          perf?.step("begin");
          try {
            await queryWithLogging(client, "select pg_advisory_xact_lock(61422917)");
            logProfile("advisory_lock");
            perf?.step("advisory_lock");
          } catch {
            // pg-mem does not implement advisory locks; local tests stay single-process.
          }

          const loadedVersion = getVersion(db);
          const currentMeta = await queryWithLogging(client,
            "select version::text as version from alpha_exchange.runtime_meta where singleton = true",
          );
          logProfile("read_runtime_meta");
          perf?.step("read_runtime_meta");
          const currentVersion = Number(currentMeta?.rows?.[0]?.version ?? "0");
          let currentRequests: number | undefined;
          if (shouldLogRepoVersionFlow()) {
            const currentRequestCount = await queryWithLogging(client,
              "select count(*)::text as count from alpha_exchange.purchase_requests",
            );
            logProfile("read_purchase_request_count");
            currentRequests = Number(currentRequestCount?.rows?.[0]?.count ?? "0");
          }

          logRepoVersionFlow("save:db:attempt", {
            loadedVersion,
            currentVersion,
            incomingPurchaseRequests: db.purchaseRequests.length,
            currentPurchaseRequests: currentRequests,
          });

          if (loadedVersion !== currentVersion) {
            logRepoVersionFlow("save:db:stale-snapshot", {
              loadedVersion,
              currentVersion,
              incomingPurchaseRequests: db.purchaseRequests.length,
              currentPurchaseRequests: currentRequests,
            });
            const currentResults: Array<{ tableName: SnapshotTableName; rows: Array<{ payload: unknown }> }> = [];
            // Parallelize all 22 table reads instead of issuing them sequentially.
            const connectedClient = client!;
            const parallelResults = await Promise.all(
              tables.map((table) => queryWithLogging(connectedClient, table.selectSql) as Promise<{ rows: Array<{ payload: unknown }> }>),
            );
            perf?.step("stale_parallel_read");
            for (let i = 0; i < tables.length; i++) {
              currentResults.push({ tableName: tables[i]!.name as SnapshotTableName, rows: parallelResults[i]!.rows });
            }
            const latestSnapshot = attachVersion(snapshotFromTableRows(currentResults), currentVersion);
            const mergedSnapshot = mergeSnapshotWithLatest(latestSnapshot, pruneOrphanAuthSessions(db));
            const mergedVersion = getVersion(mergedSnapshot);
            const nextVersion = currentVersion + 1;
            const evidenceContentById = new Map<string, Buffer | null>();
            if (selectedTableSet.has("evidence")) {
              const evidenceRows = await queryWithLogging(client, "select id, content from alpha_exchange.evidence") as { rows?: Array<{ id: string; content: Buffer | null }> };
              logProfile("load_evidence_rows_merge");
              perf?.step("load_evidence_merge");
              for (const row of evidenceRows.rows ?? []) {
                evidenceContentById.set(row.id, row.content);
              }
            }
            // When sessions are being written, use the sessions from the current full DB read
            // (latestSnapshot) rather than the potentially-stale sessions in the incoming db.
            // This prevents the deferred trust write from overwriting sessions created after
            // the initial db snapshot was loaded.
            const snapshotForMergeWrite = selectedTableSet.has("sessions")
              ? pruneOrphanAuthSessions({ ...mergedSnapshot, authSessions: latestSnapshot.authSessions })
              : pruneOrphanAuthSessions(mergedSnapshot);
            const persistedSnapshot = attachVersion(snapshotForMergeWrite, nextVersion);
            for (const tableName of selectedTables) {
              await replaceTableContents(client, tableName, persistedSnapshot, {
                evidenceContentById,
                evidenceOverrides: options?.evidenceOverrides,
              });
              perf?.step(`replace_${tableName}`);
            }
            logProfile("replace_tables_merge");
            await queryWithLogging(client,
              "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
              [nextVersion],
            );
            logProfile("update_runtime_meta_merge");
            perf?.step("update_runtime_meta_merge");
            logRepoVersionFlow("save:db:merged", {
              loadedVersion,
              currentVersion,
              mergedVersion,
              writtenVersion: nextVersion,
              purchaseRequests: persistedSnapshot.purchaseRequests.length,
            });
            attachVersion(db, nextVersion);
            syncMemoryFallbackSnapshot(persistedSnapshot, nextVersion);
            await client.query("commit");
            logProfile("commit_merge");
            perf?.step("commit_merge");
            perf?.done();
            return;
          }

          const evidenceContentById = new Map<string, Buffer | null>();
          if (selectedTableSet.has("evidence")) {
            const evidenceRows = await client.query<{ id: string; content: Buffer | null }>("select id, content from alpha_exchange.evidence");
            logProfile("load_evidence_rows");
            perf?.step("load_evidence");
            for (const row of evidenceRows?.rows ?? []) {
              evidenceContentById.set(row.id, row.content);
            }
          }

          // Snapshot writes should not evict active auth sessions managed by dedicated session methods.
          let persistedSnapshot: AlphaExchangeDb = pruneOrphanAuthSessions(db);
          if (selectedTableSet.has("sessions")) {
            const currentSessions = await queryWithLogging(client, "select payload from alpha_exchange.sessions order by sort_index asc") as { rows?: Array<{ payload: unknown }> };
            logProfile("load_sessions");
            perf?.step("load_sessions");
            const currentSessionRows = (currentSessions.rows ?? []) as Array<{ payload: AuthSession }>;
            persistedSnapshot = pruneOrphanAuthSessions({
              ...db,
              authSessions: fromPayloadRows(currentSessionRows),
            });
          }
          for (const tableName of selectedTables) {
            await replaceTableContents(client, tableName, persistedSnapshot, {
              evidenceContentById,
              evidenceOverrides: options?.evidenceOverrides,
            });
            perf?.step(`replace_${tableName}`);
          }
          logProfile("replace_tables");

          const writtenVersion = currentVersion + 1;
          await queryWithLogging(client,
            "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
            [writtenVersion],
          );
          logProfile("update_runtime_meta");
          perf?.step("update_runtime_meta");

          logRepoVersionFlow("save:db:commit", {
            loadedVersion,
            previousVersion: currentVersion,
            writtenVersion,
            purchaseRequests: persistedSnapshot.purchaseRequests.length,
          });

          attachVersion(db, writtenVersion);
          syncMemoryFallbackSnapshot(persistedSnapshot, writtenVersion);
          await client.query("commit");
          logProfile("commit");
          perf?.step("commit");
          perf?.done();
          return;
        } catch (error) {
          console.error("[alpha-exchange-repository] saveSnapshot transaction error", error);
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            console.error("[alpha-exchange-repository] saveSnapshot rollback error", rollbackError);
            // The transaction may already be aborted; dispose this client so the next request gets a fresh connection.
          }
          if ((isAbortedTransactionError(error) || (error instanceof Error && /statement timeout|canceling statement|advisory lock/i.test(error.message))) && attempt === 0) {
            if (client) {
              client.release(true);
            }
            client = null;
            continue;
          }
          throw error;
        }
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async saveListingCreationSnapshot(db: AlphaExchangeDb) {
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      await this.saveSnapshot(db);
      return;
    }

    await this.ensureReady();

    let client: PoolClient | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        client = await pool.connect();
        try {
          const logProfile = createRepositoryProfileLogger("saveListingCreationSnapshot");
          await queryWithLogging(client, "begin");
          logProfile("begin");
          try {
            await queryWithLogging(client, "select pg_advisory_xact_lock(61422917)");
            logProfile("advisory_lock");
          } catch {
            // pg-mem does not implement advisory locks; local tests stay single-process.
          }

          const loadedVersion = getVersion(db);
          const currentMeta = await queryWithLogging(client,
            "select version::text as version from alpha_exchange.runtime_meta where singleton = true",
          );
          logProfile("read_runtime_meta");
          const currentVersion = Number(currentMeta?.rows?.[0]?.version ?? "0");

          if (loadedVersion !== currentVersion) {
            await client.query("rollback");
            client.release();
            client = null;
            await this.saveSnapshot(db);
            return;
          }

          await upsertUsersTable(client, db.users);
          logProfile("upsert_users");
          await replaceTableContents(client, "seller_profiles", db);
          logProfile("replace_seller_profiles");
          await replaceTableContents(client, "seller_settings", db);
          logProfile("replace_seller_settings");
          await replaceTableContents(client, "listings", db);
          logProfile("replace_listings");
          await replaceTableContents(client, "notifications", db);
          logProfile("replace_notifications");
          await replaceTableContents(client, "audit_logs", db);
          logProfile("replace_audit_logs");
          await replaceTableContents(client, "activity_logs", db);
          logProfile("replace_activity_logs");
          await replaceTableContents(client, "trust_snapshots", db);
          logProfile("replace_trust_snapshots");
          await replaceTableContents(client, "trust_score_history", db);
          logProfile("replace_trust_score_history");

          const writtenVersion = currentVersion + 1;
          await queryWithLogging(client,
            "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
            [writtenVersion],
          );
          logProfile("update_runtime_meta");

          attachVersion(db, writtenVersion);
          await client.query("commit");
          logProfile("commit");
          return;
        } catch (error) {
          try {
            if (client) {
              await client.query("rollback");
            }
          } catch {
            // Ignore rollback failure; a fresh client will be acquired on retry.
          }
          const retryClient = client;
          if (
            retryClient &&
            (isAbortedTransactionError(error) || (error instanceof Error && /statement timeout|canceling statement|advisory lock/i.test(error.message))) &&
            attempt === 0
          ) {
            retryClient.release(true);
            client = null;
            continue;
          }
          throw error;
        }
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async upsertAuthSession(session: AuthSession) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      const current = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion);
      current.authSessions = current.authSessions.filter((item) => item.userId !== session.userId && item.token !== session.token);
      current.authSessions.push(session);
      globalThis.__alphaExchangeMemorySnapshot = attachVersion(current, getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion));
      return;
    }

    try {
      // Single CTE replaces 5 sequential round trips (BEGIN/DELETE/SELECT MAX/INSERT/COMMIT).
      // DELETE + INSERT run atomically in one statement without needing an explicit transaction.
      // Measured savings: ~320ms per login (was 5 × 80ms RTTs, now 1 × 80ms RTT).
      const perf = createRepoPerf("upsertAuthSession");
      await pool.query(
        `WITH del AS (
           DELETE FROM alpha_exchange.sessions WHERE user_id = $1
         )
         INSERT INTO alpha_exchange.sessions
           (token_hash, user_id, expires_at, created_at, sort_index, payload)
         VALUES (
           $2, $1, $3, $4,
           (SELECT coalesce(max(sort_index), -1) + 1 FROM alpha_exchange.sessions),
           $5::jsonb
         )
         ON CONFLICT (token_hash) DO UPDATE SET
           user_id = excluded.user_id,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at,
           sort_index = excluded.sort_index,
           payload = excluded.payload`,
        [session.userId, session.token, session.expiresAt, session.createdAt, json(session)],
      );
      perf?.step("upsert_session_cte");
      perf?.done();
      syncFallbackAuthSessions((sessions) => [
        ...sessions.filter((item) => item.userId !== session.userId && item.token !== session.token),
        session,
      ]);
      return;
    } catch (error) {
      console.error("[alpha-exchange-repository] upsertAuthSession error", error);
      throw error;
    }
  }

  async getAuthSession(tokenHash: string) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      return (globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion).authSessions.find((item) => item.token === tokenHash) ?? null;
    }

    try {
      const result = await pool.query<{ payload: AuthSession }>(
        "select payload from alpha_exchange.sessions where token_hash = $1 limit 1",
        [tokenHash],
      );
      return result.rows[0]?.payload ?? null;
    } catch (error) {
      console.error("[alpha-exchange-repository] falling back to cached auth session after database read failure", error);
      return getLatestAvailableFallbackSnapshot().authSessions.find((item) => item.token === tokenHash) ?? null;
    }
  }

  async deleteAuthSession(tokenHash: string) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      const current = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion);
      current.authSessions = current.authSessions.filter((item) => item.token !== tokenHash);
      globalThis.__alphaExchangeMemorySnapshot = attachVersion(current, getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion));
      return;
    }

    try {
      await pool.query("delete from alpha_exchange.sessions where token_hash = $1", [tokenHash]);
    } finally {
      syncFallbackAuthSessions((sessions) => sessions.filter((item) => item.token !== tokenHash));
    }
  }

  async readEvidenceContent(evidenceId: string) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      return globalThis.__alphaExchangeMemoryEvidenceContent?.get(evidenceId) ?? null;
    }
    const result = await pool.query<{ content: Buffer | null }>(
      "select content from alpha_exchange.evidence where id = $1",
      [evidenceId],
    );
    return result.rows[0]?.content ?? null;
  }

  // Targeted read — loads only the 11 tables required by createMarketplaceListing.
  // Eliminates 11 unnecessary SELECTs (seller_profiles, seller_settings, trades,
  // evidence, sessions, password_reset_tokens, seller_reports, private_beta_invites,
  // private_beta_invite_uses, beta_feedback, beta_announcements).
  // Falls back to a full loadSnapshot on any error.
  async loadSnapshotForListingCreation(): Promise<AlphaExchangeDb> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      return this.loadSnapshot();
    }
    try {
      const [
        usersResult,
        listingsResult,
        purchaseRequestsResult,
        commissionsResult,
        auditLogsResult,
        sellerApplicationsResult,
        activityLogsResult,
        disputesResult,
        trustSnapshotsResult,
        trustScoreHistoryResult,
      ] = await Promise.all([
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.users order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.listings order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.purchase_requests order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.commissions order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.audit_logs order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.seller_applications order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.activity_logs order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.disputes order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.trust_snapshots order by sort_index asc"),
        pool.query<{ payload: unknown }>("select payload from alpha_exchange.trust_score_history order by sort_index asc"),
      ]);

      const users = fromPayloadRows<AlphaExchangeUser>(usersResult.rows as Array<{ payload: AlphaExchangeUser }>);
      const ownerUser = users.find((u) => u.role === "owner");

      // Load only today's trust notifications for the owner — used by recalculateTrustEngine's
      // alreadyNotifiedRecently check. A filtered query is safe here because:
      // - pushNotification dedup (45 s window) will not match unloaded notifications, causing at most
      //   one extra notification per duplicate creation event — an acceptable trade-off.
      const notificationsResult = ownerUser
        ? await pool.query<{ payload: unknown }>(
            `select payload from alpha_exchange.notifications
             where user_id = $1 and category = 'trust' and date(created_at) = current_date
             order by sort_index asc`,
            [ownerUser.id],
          )
        : { rows: [] as Array<{ payload: unknown }> };

      return {
        users,
        marketplaceListings: fromPayloadRows(listingsResult.rows as Array<{ payload: MarketplaceListing }>),
        purchaseRequests: fromPayloadRows(purchaseRequestsResult.rows as Array<{ payload: PurchaseRequest }>),
        commissionRecords: fromPayloadRows(commissionsResult.rows as Array<{ payload: CommissionRecord }>),
        auditLogs: fromPayloadRows(auditLogsResult.rows as Array<{ payload: AuditLogEntry }>),
        sellerApplications: fromPayloadRows(sellerApplicationsResult.rows as Array<{ payload: SellerApplication }>),
        activityLog: fromPayloadRows(activityLogsResult.rows as Array<{ payload: AlphaExchangeActivityLogEntry }>),
        disputes: fromPayloadRows(disputesResult.rows as Array<{ payload: TradeDisputeCase }>),
        trustSnapshots: fromPayloadRows(trustSnapshotsResult.rows as Array<{ payload: TrustSnapshotRecord }>),
        trustScoreHistory: fromPayloadRows(trustScoreHistoryResult.rows as Array<{ payload: TrustScoreChangeLog }>),
        notifications: fromPayloadRows(notificationsResult.rows as Array<{ payload: AlphaExchangeNotification }>),
        // Tables not touched by listing creation — kept empty for this code path
        authSessions: [],
        passwordResetTokens: [],
        tradeEvidenceFiles: [],
        sellerReports: [],
        privateBetaInvites: [],
        privateBetaInviteUses: [],
        betaFeedback: [],
        betaAnnouncements: [],
        adminAnnouncementRuns: [],
        sellerReviews: [],
      } as AlphaExchangeDb;
    } catch (error) {
      console.warn(
        "[alpha-exchange-repository] loadSnapshotForListingCreation falling back to full snapshot:",
        error instanceof Error ? error.message : error,
      );
      return this.loadSnapshot();
    }
  }

  // Targeted write — applies only the delta produced by createMarketplaceListing.
  // The listing INSERT + trust_snapshot UPSERTs run in a single transaction.
  // Append-only writes (audit_logs, notifications, activity_log, trust_score_history)
  // run as independent parallel INSERTs — they require no atomicity with the listing.
  async saveListingCreationSnapshotTargeted(delta: {
    newListing: MarketplaceListing;
    newAuditLogs: AuditLogEntry[];
    newNotifications: AlphaExchangeNotification[];
    newActivityLogs: AlphaExchangeActivityLogEntry[];
    newTrustHistoryEntries: TrustScoreChangeLog[];
    updatedTrustSnapshots: TrustSnapshotRecord[];
  }): Promise<void> {
    await this.ensureReady();
    const pool = this.pool;

    if (this.usesMemoryFallback || !pool) {
      // Apply delta directly to the in-memory snapshot
      ensureMemorySeed();
      const current = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion);
      current.marketplaceListings.push(delta.newListing);
      if (delta.newAuditLogs.length) current.auditLogs.unshift(...delta.newAuditLogs);
      if (delta.newNotifications.length) current.notifications.unshift(...delta.newNotifications);
      if (delta.newActivityLogs.length) current.activityLog.unshift(...delta.newActivityLogs);
      if (delta.newTrustHistoryEntries.length) current.trustScoreHistory.unshift(...delta.newTrustHistoryEntries);
      for (const snap of delta.updatedTrustSnapshots) {
        const idx = current.trustSnapshots.findIndex((s) => s.sellerId === snap.sellerId);
        if (idx >= 0) {
          current.trustSnapshots[idx] = snap;
        } else {
          current.trustSnapshots.push(snap);
        }
      }
      globalThis.__alphaExchangeMemorySnapshot = attachVersion(
        current,
        getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion) + 1,
      );
      return;
    }

    // ── Step 1: transactional — INSERT listing + UPSERT trust_snapshots ──────
    let client: PoolClient | null = null;
    let nextVersion = 0;
    const perf = createRepoPerf(`saveListingCreationSnapshotTargeted[trustSnapshots=${delta.updatedTrustSnapshots.length}]`);
    try {
      client = await pool.connect();
      perf?.step("connect");
      await client.query("begin");
      perf?.step("begin");

      await client.query(
        `insert into alpha_exchange.listings
           (id, seller_id, status, active_trade_request_id, expires_at, created_at, updated_at, sort_index, payload)
         values ($1,$2,$3,$4,$5,$6,$7,
           (select coalesce(max(sort_index), -1) + 1 from alpha_exchange.listings),
           $8::jsonb)`,
        [
          delta.newListing.id,
          delta.newListing.sellerId,
          delta.newListing.status,
          delta.newListing.activeTradeRequestId ?? null,
          toTimestamp(delta.newListing.expiresAt),
          delta.newListing.createdAt,
          delta.newListing.updatedAt,
          json(delta.newListing),
        ],
      );
      perf?.step("insert_listing");

      for (const snap of delta.updatedTrustSnapshots) {
        await client.query(
          `insert into alpha_exchange.trust_snapshots (seller_id, updated_at, sort_index, payload)
           values ($1, $2,
             coalesce(
               (select sort_index from alpha_exchange.trust_snapshots where seller_id = $1),
               (select coalesce(max(sort_index), -1) + 1 from alpha_exchange.trust_snapshots)
             ),
             $3::jsonb)
           on conflict (seller_id) do update set
             updated_at = excluded.updated_at,
             payload = excluded.payload`,
          [snap.sellerId, snap.updatedAt, json(snap)],
        );
        perf?.step(`trust_snapshot_upsert_${snap.sellerId.slice(-8)}`);
      }

      const versionResult = await client.query<{ version: string }>(
        "update alpha_exchange.runtime_meta set version = version + 1, updated_at = now() where singleton = true returning version::text as version",
      );
      nextVersion = Number(versionResult.rows[0]?.version ?? "0");
      perf?.step("update_meta");

      await client.query("commit");
      perf?.step("commit");
    } catch (error) {
      if (client) {
        try { await client.query("rollback"); } catch { /* ignore rollback failure */ }
      }
      throw error;
    } finally {
      if (client) { client.release(); client = null; }
    }

    // ── Step 2: independent parallel INSERTs for append-only collections ─────
    // sort_index uses a subquery so new entries sort before (lower index) existing ones.
    const appendTasks: Array<Promise<void>> = [];

    if (delta.newAuditLogs.length) {
      appendTasks.push((async () => {
        for (const entry of delta.newAuditLogs) {
          await pool.query(
            `insert into alpha_exchange.audit_logs
               (id, action, actor_user_id, target_user_id, listing_id, purchase_request_id, created_at, sort_index, payload)
             values ($1,$2,$3,$4,$5,$6,$7,
               (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.audit_logs),
               $8::jsonb)`,
            [
              entry.id, entry.action, entry.actorUserId, entry.targetUserId ?? null,
              entry.listingId ?? null, entry.purchaseRequestId ?? null, entry.createdAt, json(entry),
            ],
          );
        }
      })());
    }

    if (delta.newNotifications.length) {
      appendTasks.push((async () => {
        for (const notif of delta.newNotifications) {
          await pool.query(
            `insert into alpha_exchange.notifications
               (id, user_id, category, is_read, created_at, sort_index, payload)
             values ($1,$2,$3,$4,$5,
               (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.notifications),
               $6::jsonb)`,
            [notif.id, notif.userId, notif.category, notif.isRead, notif.createdAt, json(notif)],
          );
        }
      })());
    }

    if (delta.newActivityLogs.length) {
      appendTasks.push((async () => {
        for (const entry of delta.newActivityLogs) {
          await pool.query(
            `insert into alpha_exchange.activity_logs
               (id, user_id, category, created_at, sort_index, payload)
             values ($1,$2,$3,$4,
               (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.activity_logs),
               $5::jsonb)`,
            [entry.id, entry.userId, entry.category, entry.createdAt, json(entry)],
          );
        }
      })());
    }

    if (delta.newTrustHistoryEntries.length) {
      appendTasks.push((async () => {
        for (const entry of delta.newTrustHistoryEntries) {
          await pool.query(
            `insert into alpha_exchange.trust_score_history
               (id, seller_id, created_at, sort_index, payload)
             values ($1,$2,$3,
               (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.trust_score_history),
               $4::jsonb)`,
            [entry.id, entry.sellerId, entry.createdAt, json(entry)],
          );
        }
      })());
    }

    // Use allSettled so that a failed append-only INSERT never rolls back or
    // changes the HTTP response — the listing transaction already committed.
    // Failures are logged with enough context for manual retry or investigation.
    const appendLabels = ["audit_logs", "notifications", "activity_logs", "trust_score_history"];
    const results = await Promise.allSettled(appendTasks);
    perf?.step("parallel_appends");
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(
          `[alpha-exchange] append INSERT failed for ${appendLabels[i] ?? "unknown"} ` +
          `after listing ${delta.newListing.id} committed. ` +
          `Seller: ${delta.newListing.sellerId}. ` +
          `Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    });

    try {
      // Fire-and-forget: the listing was already committed. Awaiting this full 23-table
      // reload here cost ~1000ms for every listing creation (pool max:2 serializes the
      // 23 parallel queries). The cache was already updated by writeDbForListingCreation;
      // the fallback snapshot will catch up on the next natural loadSnapshot call.
      this.loadSnapshot()
        .then((snapshot) => {
          syncMemoryFallbackSnapshot(snapshot, nextVersion || getVersion(snapshot));
          perf?.step("sync_memory_fallback");
        })
        .catch(() => {
          // Non-critical — ignore fallback mirror refresh failures.
        });
    } catch {
      // Ignore synchronous errors from the fire-and-forget setup.
    }
    perf?.done();
  }

  async savePurchaseRequestCreationSnapshotTargeted(delta: {
    purchaseRequest: PurchaseRequest;
    users: AlphaExchangeUser[];
    trustSnapshots: TrustSnapshotRecord[];
    newAuditLogs: AuditLogEntry[];
    newNotifications: AlphaExchangeNotification[];
    newActivityLogs: AlphaExchangeActivityLogEntry[];
    newTrustHistoryEntries: TrustScoreChangeLog[];
  }): Promise<void> {
    await this.ensureReady();
    const pool = this.pool;

    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      const current = cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion);
      current.users = cloneSnapshot(delta.users);
      current.purchaseRequests.push(cloneSnapshot(delta.purchaseRequest));
      if (delta.newAuditLogs.length) current.auditLogs.unshift(...cloneSnapshot(delta.newAuditLogs));
      if (delta.newNotifications.length) current.notifications.unshift(...cloneSnapshot(delta.newNotifications));
      if (delta.newActivityLogs.length) current.activityLog.unshift(...cloneSnapshot(delta.newActivityLogs));
      if (delta.newTrustHistoryEntries.length) current.trustScoreHistory.unshift(...cloneSnapshot(delta.newTrustHistoryEntries));
      for (const snap of delta.trustSnapshots) {
        const idx = current.trustSnapshots.findIndex((entry) => entry.sellerId === snap.sellerId);
        if (idx >= 0) {
          current.trustSnapshots[idx] = snap;
        } else {
          current.trustSnapshots.push(snap);
        }
      }
      globalThis.__alphaExchangeMemorySnapshot = attachVersion(
        current,
        getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion) + 1,
      );
      return;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock(61422917)");
      } catch {
        // pg-mem does not implement advisory locks; local tests stay single-process.
      }

      const currentMeta = await queryWithLogging(client,
        "select version::text as version from alpha_exchange.runtime_meta where singleton = true",
      );
      const currentVersion = Number(currentMeta?.rows?.[0]?.version ?? "0");

      await upsertUsersTable(client, delta.users);

      await client.query(
        `insert into alpha_exchange.purchase_requests
          (id, trade_id, listing_id, seller_id, buyer_id, status, timed_out_at, completed_at, created_at, updated_at, sort_index, payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           (select coalesce(max(sort_index), -1) + 1 from alpha_exchange.purchase_requests),
           $11::jsonb)`,
        [
          delta.purchaseRequest.id,
          delta.purchaseRequest.tradeId ?? null,
          delta.purchaseRequest.listingId,
          delta.purchaseRequest.sellerId,
          delta.purchaseRequest.buyerId,
          delta.purchaseRequest.status,
          toTimestamp(delta.purchaseRequest.timedOutAt),
          toTimestamp(delta.purchaseRequest.completedAt),
          delta.purchaseRequest.createdAt,
          delta.purchaseRequest.updatedAt,
          json(delta.purchaseRequest),
        ],
      );

      for (const entry of delta.newAuditLogs) {
        await client.query(
          `insert into alpha_exchange.audit_logs
            (id, action, actor_user_id, target_user_id, listing_id, purchase_request_id, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,
             (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.audit_logs),
             $8::jsonb)`,
          [entry.id, entry.action, entry.actorUserId, entry.targetUserId ?? null, entry.listingId ?? null, entry.purchaseRequestId ?? null, entry.createdAt, json(entry)],
        );
      }

      for (const notif of delta.newNotifications) {
        await client.query(
          `insert into alpha_exchange.notifications
            (id, user_id, category, is_read, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,
             (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.notifications),
             $6::jsonb)`,
          [notif.id, notif.userId, notif.category, notif.isRead, notif.createdAt, json(notif)],
        );
      }

      for (const entry of delta.newActivityLogs) {
        await client.query(
          `insert into alpha_exchange.activity_logs
            (id, user_id, category, created_at, sort_index, payload)
           values ($1,$2,$3,$4,
             (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.activity_logs),
             $5::jsonb)`,
          [entry.id, entry.userId, entry.category, entry.createdAt, json(entry)],
        );
      }

      for (const snap of delta.trustSnapshots) {
        await client.query(
          `insert into alpha_exchange.trust_snapshots (seller_id, updated_at, sort_index, payload)
           values ($1, $2,
             coalesce(
               (select sort_index from alpha_exchange.trust_snapshots where seller_id = $1),
               (select coalesce(max(sort_index), -1) + 1 from alpha_exchange.trust_snapshots)
             ),
             $3::jsonb)
           on conflict (seller_id) do update set
             updated_at = excluded.updated_at,
             payload = excluded.payload`,
          [snap.sellerId, snap.updatedAt, json(snap)],
        );
      }

      for (const entry of delta.newTrustHistoryEntries) {
        await client.query(
          `insert into alpha_exchange.trust_score_history
            (id, seller_id, created_at, sort_index, payload)
           values ($1,$2,$3,
             (select coalesce(min(sort_index), 1) - 1 from alpha_exchange.trust_score_history),
             $4::jsonb)`,
          [entry.id, entry.sellerId, entry.createdAt, json(entry)],
        );
      }

      await queryWithLogging(client,
        "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
        [currentVersion + 1],
      );
      await client.query("commit");
    } catch (error) {
      if (client) {
        try { await client.query("rollback"); } catch { /* ignore rollback failure */ }
      }
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }
}

export async function getAlphaExchangeRepository() {
  if (!globalThis.__alphaExchangeRepositoryPromise) {
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(new AlphaExchangeRepository(getRuntimePostgresPool()));
  }
  const repository = await globalThis.__alphaExchangeRepositoryPromise;
  if (typeof repository.savePurchaseRequestCreationSnapshotTargeted !== "function") {
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(new AlphaExchangeRepository(getRuntimePostgresPool()));
    return globalThis.__alphaExchangeRepositoryPromise;
  }
  return globalThis.__alphaExchangeRepositoryPromise;
}
