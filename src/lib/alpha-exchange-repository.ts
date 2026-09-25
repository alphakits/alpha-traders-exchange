import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { createHash, randomUUID } from "crypto";
import alphaExchangeSeed from "../../data/alpha-exchange-db.json";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { isProductionSecurityRuntime, allowsRuntimeDiagnostics } from "@/lib/runtime-safety";
import { logEvent } from "@/lib/structured-logging";
import type {
  AlphaExchangeDb,
  MarketplaceEnforcementAuditEntry,
  MarketplaceEnforcementRecord,
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
  TradeChatMessage,
  TradeRoomPokeState,
  TradeDisputeCase,
  TradeEvidenceFile,
  TrustScoreChangeLog,
  TrustSnapshotRecord,
  AlphaExchangeActivityLogEntry,
  SmsDeliveryRecord,
} from "@/types/alpha-exchange";

type Queryable = Pool | PoolClient;

// This index is the final object created by SCHEMA_SQL. Its presence proves
// that the current runtime schema bootstrap completed successfully. When the
// schema changes, append the new statements and advance this sentinel too.
const CURRENT_SCHEMA_SENTINEL = "alpha_exchange.idx_alpha_exchange_commissions_unpaid_seller";

type EvidenceWriteMap = Map<string, Buffer>;

const TEST_FALLBACK_DIR_SUFFIX = process.env.NODE_ENV === "test"
  ? `-${process.env.VITEST_WORKER_ID ?? "single"}-${process.pid}-${randomUUID()}`
  : "";
const WORKSPACE_FALLBACK_KEY = createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12);
const NON_TEST_FALLBACK_DIR = path.join(tmpdir(), "alpha-exchange-runtime", WORKSPACE_FALLBACK_KEY);
const FALLBACK_SNAPSHOT_DIR = path.join(
  process.env.NODE_ENV === "test" ? process.cwd() : NON_TEST_FALLBACK_DIR,
  process.env.NODE_ENV === "test" ? `.next-runtime-test${TEST_FALLBACK_DIR_SUFFIX}` : "snapshot",
);
const FALLBACK_SNAPSHOT_PATH = path.join(FALLBACK_SNAPSHOT_DIR, "alpha-exchange-fallback.json");
function resolveDurableEvidenceStorageKey(evidenceId: string) {
  if (!evidenceId.startsWith("db://")) return null;
  const withoutScheme = evidenceId.slice(5).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!withoutScheme) return null;
  const segments = withoutScheme.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Invalid evidence storage path.");
  }
  return `db://${segments.join("/")}`;
}

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
  `update alpha_exchange.users as u
  set payload = jsonb_set(
    u.payload,
    '{preferredLocale}',
    to_jsonb('ar'::text),
    true
  )
  where u.payload->>'preferredLocale' is null
    or u.payload->>'preferredLocale' not in ('ar', 'en')`,
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
    purchase_request_id text,
    listing_id text,
    seller_id text not null,
    buyer_id text,
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
  `create table if not exists alpha_exchange.evidence_blobs (
    storage_key text primary key,
    content bytea not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
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
  `create table if not exists alpha_exchange.marketplace_enforcement_records (
    id text primary key,
    seller_id text not null references alpha_exchange.users(id) on delete cascade,
    status text not null,
    violation_number integer not null,
    issued_at timestamptz not null,
    due_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.marketplace_enforcement_audit_log (
    id text primary key,
    seller_id text not null references alpha_exchange.users(id) on delete cascade,
    action text not null,
    actor_user_id text not null references alpha_exchange.users(id) on delete cascade,
    created_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists alpha_exchange.mobile_push_subscriptions (
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
  )`,
  `create table if not exists alpha_exchange.mobile_push_deliveries (
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
  "create index if not exists idx_alpha_exchange_marketplace_enforcement_records_seller_status on alpha_exchange.marketplace_enforcement_records (seller_id, status, updated_at desc)",
  "create index if not exists idx_alpha_exchange_marketplace_enforcement_audit_seller_created on alpha_exchange.marketplace_enforcement_audit_log (seller_id, created_at desc)",
  "create index if not exists idx_alpha_exchange_mobile_push_user_active on alpha_exchange.mobile_push_subscriptions (user_id, active, updated_at desc)",
  "create index if not exists idx_alpha_exchange_mobile_push_session on alpha_exchange.mobile_push_subscriptions (session_token_hash)",
  "create index if not exists idx_alpha_exchange_mobile_push_receipts on alpha_exchange.mobile_push_deliveries (status, updated_at) where status = 'sent' and ticket_id is not null",
  "alter table alpha_exchange.commissions alter column purchase_request_id drop not null",
  "alter table alpha_exchange.commissions alter column listing_id drop not null",
  "alter table alpha_exchange.commissions alter column buyer_id drop not null",
  `with flagged_alerts as (
    select
      notification.id,
      notification.user_id,
      notification.created_at,
      coalesce(
        nullif(notification.payload ->> 'relatedSellerUsername', ''),
        nullif(notification.payload ->> 'relatedSellerName', ''),
        lower(regexp_replace(notification.payload ->> 'title', '^flagged seller:[[:space:]]*', '', 'i'))
      ) as seller_key,
      coalesce(
        nullif(notification.payload ->> 'state', ''),
        case when notification.is_read then 'read' else 'unread' end
      ) as notification_state,
      coalesce(notification.payload ->> 'reason', '') as reason
    from alpha_exchange.notifications as notification
    join alpha_exchange.users as owner_user
      on owner_user.id = notification.user_id
    where notification.category = 'trust'
      and lower(coalesce(notification.payload ->> 'title', '')) like 'flagged seller:%'
      and (
        owner_user.role = 'owner'
        or coalesce(owner_user.payload -> 'roles', '[]'::jsonb) @> '["owner"]'::jsonb
      )
  ), resurrected_alerts as (
    select candidate.id
    from flagged_alerts as candidate
    where candidate.notification_state = 'unread'
      and candidate.reason <> 'seller_entered_flagged_state'
      and candidate.seller_key is not null
      and (
        exists (
          select 1
          from flagged_alerts as acknowledged
          where acknowledged.user_id = candidate.user_id
            and acknowledged.seller_key = candidate.seller_key
            and acknowledged.id <> candidate.id
            and acknowledged.created_at <= candidate.created_at
            and acknowledged.notification_state in ('read', 'archived')
        )
        or exists (
          select 1
          from flagged_alerts as burst_peer
          where burst_peer.user_id = candidate.user_id
            and burst_peer.id <> candidate.id
            and burst_peer.reason <> 'seller_entered_flagged_state'
            and burst_peer.created_at between candidate.created_at - interval '5 minutes'
              and candidate.created_at + interval '5 minutes'
        )
      )
  ), repaired as (
    update alpha_exchange.notifications as notification
    set
      is_read = true,
      payload = jsonb_set(
        jsonb_set(
          jsonb_set(notification.payload, '{isRead}', 'true'::jsonb, true),
          '{state}',
          '"read"'::jsonb,
          true
        ),
        '{updatedAt}',
        to_jsonb(now()::text),
        true
      )
    where notification.id in (select id from resurrected_alerts)
    returning notification.id
  )
  update alpha_exchange.runtime_meta
  set version = version + 1,
      updated_at = now()
  where singleton = true
    and exists (select 1 from repaired)`,
  "create index if not exists idx_alpha_exchange_notifications_trust_reconciliation on alpha_exchange.notifications (user_id, category, created_at desc)",
  "create index if not exists idx_alpha_exchange_evidence_blobs_updated on alpha_exchange.evidence_blobs (updated_at desc)",
  "create index if not exists idx_alpha_exchange_commissions_seller_status on alpha_exchange.commissions (seller_id, payment_status, due_at)",
  "create index if not exists idx_alpha_exchange_commissions_unpaid_seller on alpha_exchange.commissions (seller_id) where payment_status <> 'paid'",
];

const DEFAULT_DB = alphaExchangeSeed as unknown as AlphaExchangeDb;

type SnapshotWithVersion = AlphaExchangeDb & { __runtimeVersion?: number };

export type TradeRoomRevision = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: PurchaseRequest["status"];
  updatedAt: string;
};

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
  "marketplace_enforcement_records",
  "marketplace_enforcement_audit_log",
] as const;

export type SnapshotTableName = (typeof SNAPSHOT_TABLE_NAMES)[number];

// The owner dashboard needs broad operational visibility, but it does not need
// authentication secrets, password-reset state, delivery queues, or the three
// denormalized compatibility tables that are discarded by snapshot mapping.
// Keeping the large append-only collections in separate groups prevents one
// oversized jsonb_agg statement from monopolizing the pooler until timeout.
const ADMIN_DASHBOARD_SNAPSHOT_TABLE_GROUPS = [
  ["users", "seller_applications", "trust_snapshots"],
  ["listings", "purchase_requests", "commissions", "evidence", "disputes"],
  ["notifications", "seller_reports"],
  ["audit_logs", "trust_score_history"],
  ["activity_logs", "marketplace_enforcement_records", "marketplace_enforcement_audit_log"],
  ["private_beta_invites", "private_beta_invite_uses", "beta_feedback", "beta_announcements"],
] as const satisfies readonly (readonly SnapshotTableName[])[];

// The admin API only renders a recent operational window for these append-only
// collections. Bound them in PostgreSQL so the dashboard does not aggregate and
// transfer an ever-growing history merely to discard it in application code.
const ADMIN_DASHBOARD_TABLE_LIMITS: Partial<Record<SnapshotTableName, number>> = {
  notifications: 250,
  audit_logs: 250,
  trust_score_history: 250,
  activity_logs: 250,
  marketplace_enforcement_audit_log: 250,
};

function shouldLogRepoVersionFlow() {
  return allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_REPO_TRACE === "1";
}

function shouldPersistRepoVersionTrace() {
  return allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_REPO_TRACE === "1";
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
  return allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_PERF === "1";
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
  AS t(id,seller_id,status,active_trade_request_id,expires_at,created_at,updated_at,sort_index,payload)
ON CONFLICT (id) DO UPDATE SET
  seller_id = excluded.seller_id,
  status = excluded.status,
  active_trade_request_id = excluded.active_trade_request_id,
  expires_at = excluded.expires_at,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  sort_index = excluded.sort_index,
  payload = excluded.payload
WHERE alpha_exchange.listings.seller_id IS DISTINCT FROM excluded.seller_id
   OR alpha_exchange.listings.status IS DISTINCT FROM excluded.status
   OR alpha_exchange.listings.active_trade_request_id IS DISTINCT FROM excluded.active_trade_request_id
   OR alpha_exchange.listings.expires_at IS DISTINCT FROM excluded.expires_at
   OR alpha_exchange.listings.created_at IS DISTINCT FROM excluded.created_at
   OR alpha_exchange.listings.updated_at IS DISTINCT FROM excluded.updated_at
   OR alpha_exchange.listings.sort_index IS DISTINCT FROM excluded.sort_index
   OR alpha_exchange.listings.payload IS DISTINCT FROM excluded.payload`, [
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
        rows.map(r => r.purchaseRequestId ?? null),
        rows.map(r => r.listingId ?? null),
        rows.map(r => r.sellerId),
        rows.map(r => r.buyerId ?? null),
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
  {
    name: "marketplace_enforcement_records",
    selectSql: "select payload from alpha_exchange.marketplace_enforcement_records order by sort_index asc",
    values: (db) => db.marketplaceEnforcementRecords ?? [],
    insert: async (tx, rows: MarketplaceEnforcementRecord[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.marketplace_enforcement_records (id, seller_id, status, violation_number, issued_at, due_at, created_at, updated_at, sort_index, payload)
SELECT id, seller_id, status, violation_number::int, issued_at::timestamptz, due_at::timestamptz, created_at::timestamptz, updated_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[])
  AS t(id,seller_id,status,violation_number,issued_at,due_at,created_at,updated_at,sort_index,payload)`, [
        rows.map((r) => r.id),
        rows.map((r) => r.sellerId),
        rows.map((r) => r.status),
        rows.map((r) => String(r.violationNumber)),
        rows.map((r) => r.issuedAt),
        rows.map((r) => r.dueAt ?? null),
        rows.map((r) => r.createdAt),
        rows.map((r) => r.updatedAt),
        rows.map((_, i) => String(i)),
        rows.map((r) => json(r)),
      ]);
    },
  },
  {
    name: "marketplace_enforcement_audit_log",
    selectSql: "select payload from alpha_exchange.marketplace_enforcement_audit_log order by sort_index asc",
    values: (db) => db.marketplaceEnforcementAuditLog ?? [],
    insert: async (tx, rows: MarketplaceEnforcementAuditEntry[]) => {
      await bulkInsert(tx, `INSERT INTO alpha_exchange.marketplace_enforcement_audit_log (id, seller_id, action, actor_user_id, created_at, sort_index, payload)
SELECT id, seller_id, action, actor_user_id, created_at::timestamptz, sort_index::int, payload::jsonb
FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
  AS t(id,seller_id,action,actor_user_id,created_at,sort_index,payload)`, [
        rows.map((r) => r.id),
        rows.map((r) => r.sellerId),
        rows.map((r) => r.action),
        rows.map((r) => r.actorUserId),
        rows.map((r) => r.createdAt),
        rows.map((_, i) => String(i)),
        rows.map((r) => json(r)),
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

type AggregatedSnapshotRow = {
  version?: string | null;
} & Partial<Record<SnapshotTableName, unknown>>;

/**
 * Reads every requested JSON payload collection in one PostgreSQL statement.
 *
 * Besides removing one network round trip per table, this is important for
 * transaction safety: node-postgres does not support overlapping query calls
 * on a checked-out PoolClient. The previous stale-writer recovery path issued
 * every table SELECT through Promise.all on the same client, which can stall a
 * trade mutation and is deprecated by pg.
 *
 * `tableNames` is restricted to the compile-time snapshot table allowlist, so
 * interpolating these identifiers cannot introduce user-controlled SQL.
 */
function buildAggregatedSnapshotSql(
  tableNames: readonly SnapshotTableName[],
  tableLimits: Partial<Record<SnapshotTableName, number>> = {},
) {
  const selectedNames = Array.from(new Set(tableNames));
  const payloadColumns = selectedNames.map((tableName) => {
    const requestedLimit = tableLimits[tableName];
    const limit = typeof requestedLimit === "number" && Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : null;
    if (limit) {
      return `coalesce((
        select jsonb_agg(bounded.payload order by bounded.sort_index asc)
        from (
          select payload, sort_index
          from alpha_exchange.${tableName}
          order by sort_index asc
          limit ${limit}
        ) bounded
      ), '[]'::jsonb) as "${tableName}"`;
    }
    return `coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.${tableName}), '[]'::jsonb) as "${tableName}"`;
  });
  return `select
    (select version::text from alpha_exchange.runtime_meta where singleton = true) as version${payloadColumns.length ? `,\n    ${payloadColumns.join(",\n    ")}` : ""}`;
}

function snapshotFromAggregatedRow(
  row: AggregatedSnapshotRow | undefined,
  tableNames: readonly SnapshotTableName[],
) {
  return snapshotFromTableRows(tableNames.map((tableName) => {
    const payloads = row?.[tableName];
    return {
      tableName,
      rows: (Array.isArray(payloads) ? payloads : []).map((payload) => ({ payload })),
    };
  }));
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
  if (tableName === "listings") {
    const listingRows = db.marketplaceListings;
    if (listingRows.length === 0) {
      await tx.query("delete from alpha_exchange.listings");
      return;
    }
    await tx.query(
      "delete from alpha_exchange.listings where not (id = any($1::text[]))",
      [listingRows.map((row) => row.id)],
    );
    await getTable(tableName).insert(tx, listingRows, {
      evidenceContentById: context?.evidenceContentById ?? new Map(),
      evidenceOverrides: context?.evidenceOverrides,
    });
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
  return allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_PROFILE_LISTING_CREATE === "1";
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
    marketplaceEnforcementRecords: [],
    marketplaceEnforcementAuditLog: [],
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
      case "marketplace_enforcement_records":
        snapshot.marketplaceEnforcementRecords = fromPayloadRows(rows as Array<{ payload: MarketplaceEnforcementRecord }>);
        break;
      case "marketplace_enforcement_audit_log":
        snapshot.marketplaceEnforcementAuditLog = fromPayloadRows(rows as Array<{ payload: MarketplaceEnforcementAuditEntry }>);
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

function newerIsoValue(left: string | undefined, right: string | undefined) {
  if (!left) return right;
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function mergeTradeMessages(
  latest: TradeChatMessage[] | undefined,
  incoming: TradeChatMessage[] | undefined,
) {
  if (!latest?.length && !incoming?.length) return undefined;
  const messagesById = new Map<string, TradeChatMessage>();
  for (const message of [...(latest ?? []), ...(incoming ?? [])]) {
    const current = messagesById.get(message.id);
    if (!current) {
      messagesById.set(message.id, message);
      continue;
    }
    const currentCreatedAt = new Date(current.createdAt).getTime();
    const incomingCreatedAt = new Date(message.createdAt).getTime();
    const preferred = incomingCreatedAt >= currentCreatedAt ? message : current;
    messagesById.set(message.id, {
      ...preferred,
      readByUserIds: Array.from(new Set([...(current.readByUserIds ?? []), ...(message.readByUserIds ?? [])])),
      sentAt: newerIsoValue(current.sentAt, message.sentAt),
      deliveredAt: newerIsoValue(current.deliveredAt, message.deliveredAt),
      seenAt: newerIsoValue(current.seenAt, message.seenAt),
      deletedAt: newerIsoValue(current.deletedAt, message.deletedAt),
    });
  }
  return [...messagesById.values()].sort((left, right) => {
    const rightCreatedAt = new Date(right.createdAt).getTime();
    const leftCreatedAt = new Date(left.createdAt).getTime();
    if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt;
    return right.id.localeCompare(left.id);
  });
}

function mergeTradeRoomPokeState(
  latest: TradeRoomPokeState | undefined,
  incoming: TradeRoomPokeState | undefined,
) {
  const buyerToSellerAt = newerIsoValue(latest?.buyerToSellerAt, incoming?.buyerToSellerAt);
  const sellerToBuyerAt = newerIsoValue(latest?.sellerToBuyerAt, incoming?.sellerToBuyerAt);
  return buyerToSellerAt || sellerToBuyerAt
    ? { buyerToSellerAt, sellerToBuyerAt } satisfies TradeRoomPokeState
    : undefined;
}

function mergeMatchingPurchaseRequest(latest: PurchaseRequest, incoming: PurchaseRequest) {
  const latestUpdatedAt = new Date(latest.updatedAt ?? latest.createdAt ?? 0).getTime();
  const incomingUpdatedAt = new Date(incoming.updatedAt ?? incoming.createdAt ?? 0).getTime();
  const incomingRank = getPurchaseRequestStatusRank(incoming.status);
  const latestRank = getPurchaseRequestStatusRank(latest.status);
  const preferred = incomingRank !== latestRank
    ? (incomingRank > latestRank ? incoming : latest)
    : (incomingUpdatedAt > latestUpdatedAt ? incoming : latest);
  return {
    ...preferred,
    // Trade Room communication must be additive even when two Vercel instances
    // write from different snapshot versions. Lifecycle status still follows the
    // existing monotonic winner above; messages and directional Poke state merge.
    messages: mergeTradeMessages(latest.messages, incoming.messages),
    pokeState: mergeTradeRoomPokeState(latest.pokeState, incoming.pokeState),
  };
}

type IdentifiedSnapshotRecord = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  uploadedAt?: string;
};

function snapshotRecordTimestamp(record: IdentifiedSnapshotRecord) {
  const raw = record.updatedAt ?? record.uploadedAt ?? record.createdAt;
  const timestamp = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Combines snapshots record-by-record so a stale whole-table writer cannot
 * roll back a newer mutation to a different entity in that same table.
 */
function mergeTimestampedRecords<T extends IdentifiedSnapshotRecord>(latest: T[], incoming: T[]) {
  const merged = new Map(latest.map((record) => [record.id, record]));
  for (const record of incoming) {
    const current = merged.get(record.id);
    if (!current || snapshotRecordTimestamp(record) > snapshotRecordTimestamp(current)) {
      merged.set(record.id, record);
    }
  }

  const incomingIds = new Set(incoming.map((record) => record.id));
  const orderedIds = [
    ...incoming.map((record) => record.id),
    ...latest.map((record) => record.id).filter((id) => !incomingIds.has(id)),
  ];
  return orderedIds.map((id) => merged.get(id)).filter((record): record is T => Boolean(record));
}

/**
 * Commission settlement is monotonic: once the canonical snapshot says a
 * commission is paid, a stale maintenance writer must never make it unpaid
 * again. The exact TRC20 amount is also an issued payment instruction, so its
 * allocation fields follow the canonical record even when a stale copy has a
 * later `updatedAt` timestamp (for example after marking the row overdue).
 */
function mergeCommissionRecords(latest: CommissionRecord[], incoming: CommissionRecord[]) {
  const latestById = new Map(latest.map((record) => [record.id, record]));
  const incomingById = new Map(incoming.map((record) => [record.id, record]));
  const incomingIds = new Set(incoming.map((record) => record.id));
  const orderedIds = [
    ...incoming.map((record) => record.id),
    ...latest.map((record) => record.id).filter((id) => !incomingIds.has(id)),
  ];

  return orderedIds.map((id) => {
    const canonical = latestById.get(id);
    const candidate = incomingById.get(id);
    if (!canonical) return candidate as CommissionRecord;
    if (!candidate) return canonical;

    // A paid canonical row is final for stale-snapshot merging. Deliberate
    // owner corrections still use the normal, version-current write path.
    if (canonical.paymentStatus === "paid") return canonical;

    const selected = snapshotRecordTimestamp(candidate) > snapshotRecordTimestamp(canonical)
      ? candidate
      : canonical;
    const issuedIntent = typeof canonical.paymentExpectedAmount === "number"
      ? canonical
      : typeof candidate.paymentExpectedAmount === "number"
        ? candidate
        : null;
    const submittedPayment = canonical.paymentSignature
      ? canonical
      : candidate.paymentSignature
        ? candidate
        : null;
    const reservedExpectedAmounts = Array.from(new Set([
      ...(canonical.paymentReservedExpectedAmounts ?? []),
      ...(candidate.paymentReservedExpectedAmounts ?? []),
    ]));

    return {
      ...selected,
      ...(issuedIntent
        ? {
            paymentExpectedAmount: issuedIntent.paymentExpectedAmount,
            paymentExpectedAmountMode: issuedIntent.paymentExpectedAmountMode,
            paymentExpectedAmountAssignedAt: issuedIntent.paymentExpectedAmountAssignedAt,
        }
        : {}),
      ...(reservedExpectedAmounts.length > 0
        ? { paymentReservedExpectedAmounts: reservedExpectedAmounts }
        : {}),
      // Default stale merges are used by background maintenance. Payment
      // writers perform a locked canonical rebase, so maintenance may advance
      // overdue status but may not erase or replace a submitted TxID.
      ...(submittedPayment
        ? {
            paymentProvider: submittedPayment.paymentProvider,
            paymentNetwork: submittedPayment.paymentNetwork,
            payerWalletAddress: submittedPayment.payerWalletAddress,
            recipientWalletAddress: submittedPayment.recipientWalletAddress,
            paymentSignature: submittedPayment.paymentSignature,
            paymentSubmittedAt: submittedPayment.paymentSubmittedAt,
            paymentVerificationStatus: submittedPayment.paymentVerificationStatus,
            paymentVerificationNotes: submittedPayment.paymentVerificationNotes,
          }
        : {}),
    };
  });
}

function mergeAppendOnlyRecords<T extends IdentifiedSnapshotRecord>(latest: T[], incoming: T[]) {
  const merged = new Map(latest.map((record) => [record.id, record]));
  for (const record of incoming) merged.set(record.id, record);
  return [...merged.values()].sort((left, right) => {
    const timestampDifference = snapshotRecordTimestamp(right) - snapshotRecordTimestamp(left);
    return timestampDifference || right.id.localeCompare(left.id);
  });
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
    const index = mergedPurchaseRequests.findIndex((item) => item.id === request.id);
    if (index < 0) continue;
    mergedPurchaseRequests[index] = mergeMatchingPurchaseRequest(latestRequest, request);
  }
  const mergedNotificationsById = new Map<string, AlphaExchangeNotification>();
  for (const notification of latest.notifications) {
    mergedNotificationsById.set(notification.id, notification);
  }
  for (const notification of incoming.notifications) {
    const current = mergedNotificationsById.get(notification.id);
    if (!current) {
      mergedNotificationsById.set(notification.id, notification);
      continue;
    }
    const currentUpdatedAt = new Date(current.updatedAt ?? current.createdAt ?? 0).getTime();
    const incomingUpdatedAt = new Date(notification.updatedAt ?? notification.createdAt ?? 0).getTime();
    if (incomingUpdatedAt >= currentUpdatedAt) {
      mergedNotificationsById.set(notification.id, notification);
    }
  }
  const mergedNotifications = [...mergedNotificationsById.values()].sort((left, right) => {
    const leftCreatedAt = new Date(left.createdAt ?? 0).getTime();
    const rightCreatedAt = new Date(right.createdAt ?? 0).getTime();
    if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt;
    const leftUpdatedAt = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightUpdatedAt = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    if (rightUpdatedAt !== leftUpdatedAt) return rightUpdatedAt - leftUpdatedAt;
    return right.id.localeCompare(left.id);
  });
  const getCollection = <T>(value: T[] | undefined, fallback: T[]) => Array.isArray(value) ? value : fallback;
  const mergedMarketplaceListings = mergeTimestampedRecords(
    getCollection(latest.marketplaceListings, []),
    getCollection(incoming.marketplaceListings, []),
  );
  const mergedCommissionRecords = mergeCommissionRecords(
    getCollection(latest.commissionRecords, []),
    getCollection(incoming.commissionRecords, []),
  );
  const mergedAuditLogs = mergeAppendOnlyRecords(
    getCollection(latest.auditLogs, []),
    getCollection(incoming.auditLogs, []),
  );
  const mergedActivityLog = mergeAppendOnlyRecords(
    getCollection(latest.activityLog, []),
    getCollection(incoming.activityLog, []),
  );
  const mergedTradeEvidenceFiles = mergeTimestampedRecords(
    getCollection(latest.tradeEvidenceFiles, []),
    getCollection(incoming.tradeEvidenceFiles, []),
  );
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
    marketplaceListings: mergedMarketplaceListings,
    purchaseRequests: mergedPurchaseRequests,
    commissionRecords: mergedCommissionRecords,
    auditLogs: mergedAuditLogs,
    authSessions: pruneOrphanAuthSessions(latest).authSessions,
    passwordResetTokens: getCollection(incoming.passwordResetTokens, latest.passwordResetTokens),
    notifications: mergedNotifications,
    activityLog: mergedActivityLog,
    disputes: getCollection(incoming.disputes, latest.disputes),
    sellerReports: getCollection(incoming.sellerReports, latest.sellerReports),
    trustSnapshots: getCollection(incoming.trustSnapshots, latest.trustSnapshots),
    trustScoreHistory: getCollection(incoming.trustScoreHistory, latest.trustScoreHistory),
    tradeEvidenceFiles: mergedTradeEvidenceFiles,
    privateBetaInvites: getCollection(incoming.privateBetaInvites, latest.privateBetaInvites),
    privateBetaInviteUses: getCollection(incoming.privateBetaInviteUses, latest.privateBetaInviteUses),
    betaFeedback: getCollection(incoming.betaFeedback, latest.betaFeedback),
    betaAnnouncements: getCollection(incoming.betaAnnouncements, latest.betaAnnouncements),
    adminAnnouncementRuns: [...mergedAnnouncementRuns.values()]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    sellerReviews: getCollection(incoming.sellerReviews, latest.sellerReviews),
    smsDeliveries: [...mergedSmsDeliveries.values()]
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    marketplaceEnforcementRecords: getCollection(incoming.marketplaceEnforcementRecords, latest.marketplaceEnforcementRecords ?? []),
    marketplaceEnforcementAuditLog: getCollection(incoming.marketplaceEnforcementAuditLog, latest.marketplaceEnforcementAuditLog ?? []),
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

async function isCurrentSchemaReady(target: Pool) {
  const result = await queryReadWithRetry<{ ready: boolean }>(
    target,
    "select to_regclass($1) is not null as ready",
    [CURRENT_SCHEMA_SENTINEL],
    "schema_sentinel",
  );
  return result.rows[0]?.ready === true;
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
  // Prefer explicit in-process memory when present. Tests and harness flows
  // intentionally seed memory directly and must not be silently replaced by
  // a persisted snapshot from a previous run. Avoid reading and parsing the
  // entire fallback file on every request once that authoritative snapshot is
  // already warm; the file is only needed to recover a fresh process.
  if (memorySnapshot) return memorySnapshot;

  const persistedFallback = loadPersistedFallbackSnapshot();
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

function syncFallbackAuthSessions(update: (sessions: AuthSession[]) => AuthSession[]) {
  const snapshot = getLatestAvailableFallbackSnapshot();
  const next = attachVersion({
    ...snapshot,
    authSessions: update(snapshot.authSessions),
  }, getVersion(snapshot));
  syncMemoryFallbackSnapshot(next, getVersion(snapshot));
}

function shouldPersistLocalFallbackSnapshot() {
  if (isProductionSecurityRuntime()) return false;
  // Unit and load tests seed an isolated in-memory snapshot explicitly. Writing
  // the growing JSON snapshot after every mutation adds quadratic disk I/O and
  // does not improve their durability. Repository persistence tests opt in so
  // the cross-process recovery contract remains covered.
  return process.env.NODE_ENV !== "test"
    || process.env.ALPHA_EXCHANGE_TEST_PERSIST_FALLBACK === "1";
}

function loadPersistedFallbackSnapshot(): SnapshotWithVersion | null {
  // Production must never read a prior mutable snapshot from local disk.
  if (!shouldPersistLocalFallbackSnapshot()) return null;
  try {
    if (!existsSync(FALLBACK_SNAPSHOT_PATH)) return null;
    const raw = readFileSync(FALLBACK_SNAPSHOT_PATH, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotWithVersion;
    const version = getVersion(parsed);
    return attachVersion(cloneSnapshot(parsed), version);
  } catch (error) {
    logEvent("warn", {
      event: "alpha_exchange_repository_fallback_snapshot",
      outcome: "failed",
      reason: "fallback_snapshot_read_failed",
      metadata: { errorName: error instanceof Error ? error.name : typeof error },
    });
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
  // A successful production database read may update the in-process mirror for
  // cache coherence, but must not persist user/session data to /tmp.
  if (!shouldPersistLocalFallbackSnapshot()) return;
  try {
    mkdirSync(FALLBACK_SNAPSHOT_DIR, { recursive: true });
    const tempPath = `${FALLBACK_SNAPSHOT_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(next), "utf8");
    renameSync(tempPath, FALLBACK_SNAPSHOT_PATH);
  } catch (error) {
    logEvent("warn", {
      event: "alpha_exchange_repository_fallback_snapshot",
      outcome: "failed",
      reason: "fallback_snapshot_write_failed",
      metadata: { errorName: error instanceof Error ? error.name : typeof error },
    });
  }
}

async function queryWithLogging(client: PoolClient, queryText: string, values?: unknown[]) {
  try {
    return await client.query(queryText, values);
  } catch (error) {
    logEvent("error", {
      event: "alpha_exchange_repository_query",
      outcome: "failed",
      reason: "database_query_failed",
      metadata: {
        errorName: error instanceof Error ? error.name : "unknown",
      },
    });
    throw error;
  }
}

function databaseErrorMetadata(error: unknown) {
  const code = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  const message = error instanceof Error ? error.message : "";
  const timeoutKind = /query read timeout/i.test(message)
    ? "query_read_timeout"
    : /timeout exceeded when trying to connect/i.test(message)
      ? "pool_checkout_timeout"
      : code === "57014"
        ? "statement_timeout"
        : undefined;
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(code ? { errorCode: code } : {}),
    ...(timeoutKind ? { timeoutKind } : {}),
  };
}

function isTransientReadError(error: unknown) {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && ["08000", "08003", "08006", "57P01", "57P02", "57P03"].includes(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /query read timeout|timeout exceeded when trying to connect|connection terminated|connection closed|ECONNRESET|EPIPE|ETIMEDOUT/i.test(message);
}

async function queryReadWithRetry<T extends QueryResultRow>(
  target: Queryable,
  queryText: string,
  values: unknown[] | undefined,
  operation: string,
): Promise<QueryResult<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await target.query<T>(queryText, values);
    } catch (error) {
      if (attempt > 0 || !isTransientReadError(error)) throw error;
      logEvent("warn", {
        event: "alpha_exchange_repository_read_retry",
        outcome: "failed",
        reason: "transient_database_read_failure",
        metadata: {
          operation,
          attempt: attempt + 1,
          ...databaseErrorMetadata(error),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw new Error("Database read retry exhausted.");
}

export class AlphaExchangeRepository {
  private readonly pool: Pool | null;
  private usesMemoryFallback: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(pool: Pool | null) {
    if (!pool && isProductionSecurityRuntime()) {
      throw new Error("Durable Alpha Exchange persistence is unavailable in production.");
    }
    this.pool = pool;
    this.usesMemoryFallback = pool === null;
  }

  async ensureReady() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const pool = this.pool;
        if (this.usesMemoryFallback || !pool) {
          if (isProductionSecurityRuntime()) {
            throw new Error("Durable Alpha Exchange persistence is unavailable in production.");
          }
          ensureMemorySeed();
          return;
        }
        let initializationPhase = "schema_sentinel";
        try {
          if (!(await isCurrentSchemaReady(pool))) {
            initializationPhase = "schema_migration";
            await runSchema(pool);
          }
          // Production is never seeded from the bundled fixture. Avoid paying
          // for an extra full-table count on every cold serverless instance.
          if (process.env.NODE_ENV !== "production") {
            initializationPhase = "local_seed_check";
            const usersCount = await queryReadWithRetry<{ count: string }>(
              pool,
              "select count(*)::text as count from alpha_exchange.users",
              undefined,
              "local_seed_check",
            );
            if (usersCount.rows[0]?.count === "0") {
              initializationPhase = "local_seed_write";
              await this.saveSnapshot(DEFAULT_DB, { skipReadyCheck: true });
            }
          }
        } catch (error) {
          if (isProductionSecurityRuntime()) {
            logEvent("error", {
              event: "alpha_exchange_repository_initialize",
              outcome: "failed",
              reason: "durable_persistence_unavailable",
              metadata: {
                phase: initializationPhase,
                ...databaseErrorMetadata(error),
              },
            });
            throw new Error("Durable Alpha Exchange persistence is unavailable.");
          }
          logEvent("warn", {
            event: "alpha_exchange_repository_initialize",
            outcome: "failed",
            reason: "local_memory_fallback_enabled",
            metadata: { errorName: error instanceof Error ? error.name : typeof error },
          });
          ensureMemorySeed();
          this.usesMemoryFallback = true;
        }
      })();
    }
    const currentAttempt = this.initPromise;
    try {
      await currentAttempt;
    } catch (error) {
      // A transient pool/database failure must not poison this warm serverless
      // instance forever. Keep concurrent callers on the same attempt, then
      // allow the next request to establish a fresh connection and recover.
      if (this.initPromise === currentAttempt) this.initPromise = null;
      throw error;
    }
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

  async loadOperationalHealthData(): Promise<{
    marketplaceListings: MarketplaceListing[];
    purchaseRequests: PurchaseRequest[];
  }> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const snapshot = getLatestAvailableFallbackSnapshot();
      return {
        marketplaceListings: cloneSnapshot(snapshot.marketplaceListings),
        purchaseRequests: cloneSnapshot(snapshot.purchaseRequests),
      };
    }

    const [listingsResult, purchaseRequestsResult] = await Promise.all([
      pool.query<{ payload: MarketplaceListing }>("select payload from alpha_exchange.listings order by sort_index asc"),
      pool.query<{ payload: PurchaseRequest }>("select payload from alpha_exchange.purchase_requests order by sort_index asc"),
    ]);

    return {
      marketplaceListings: fromPayloadRows(listingsResult.rows),
      purchaseRequests: fromPayloadRows(purchaseRequestsResult.rows),
    };
  }

  /** Commit one trade plus newly appended events without replacing shared tables. */
  async mutateFocusedTrade(
    requestId: string,
    apply: (snapshot: AlphaExchangeDb) => AlphaExchangeDb | Promise<AlphaExchangeDb>,
  ): Promise<AlphaExchangeDb | null> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) return null;
    const client = await pool.connect();
    let destroy = false;
    try {
      await client.query("begin");
      // Keep the same lock/version protocol as snapshot writers. A later stale
      // snapshot must rebase rather than erase this review or amount adjustment.
      await client.query("select pg_advisory_xact_lock(61422917)");
      const result = await client.query<{ payload: AlphaExchangeDb; target_id: string }>(`
        select r.id as target_id, jsonb_build_object(
          'purchaseRequests', (select coalesce(jsonb_agg(p.payload), '[]'::jsonb) from alpha_exchange.purchase_requests p where p.seller_id = r.seller_id),
          'users', (select coalesce(jsonb_agg(u.payload), '[]'::jsonb) from alpha_exchange.users u where u.id in (r.buyer_id, r.seller_id)),
          'marketplaceListings', (select coalesce(jsonb_agg(l.payload), '[]'::jsonb) from alpha_exchange.listings l where l.seller_id = r.seller_id),
          'commissionRecords', (select coalesce(jsonb_agg(c.payload), '[]'::jsonb) from alpha_exchange.commissions c where c.seller_id = r.seller_id),
          'trustSnapshots', (select coalesce(jsonb_agg(t.payload), '[]'::jsonb) from alpha_exchange.trust_snapshots t where t.seller_id = r.seller_id),
          'disputes', (select coalesce(jsonb_agg(d.payload), '[]'::jsonb) from alpha_exchange.disputes d where d.purchase_request_id = r.id)
        ) as payload
        from alpha_exchange.purchase_requests r where r.id = $1 or r.trade_id = $1 limit 1`, [requestId]);
      const row = result.rows[0];
      if (!row) throw new Error("Trade not found.");
      const snapshot = { ...emptySnapshotCollections(), ...row.payload };
      const before = structuredClone(snapshot.purchaseRequests.find((request) => request.id === row.target_id)!);
      const beforeJson = JSON.stringify(before);
      const next = await apply(snapshot);
      const updated = next.purchaseRequests.find((request) => request.id === row.target_id);
      if (!updated || updated.status !== before.status || updated.buyerId !== before.buyerId || updated.sellerId !== before.sellerId || updated.listingId !== before.listingId) {
        throw new Error("Focused trade updates cannot change lifecycle or participants.");
      }
      const changed = JSON.stringify(updated) !== beforeJson;
      if (changed) {
        await client.query("update alpha_exchange.purchase_requests set payload = $2::jsonb, updated_at = $3::timestamptz where id = $1", [updated.id, json(updated), updated.updatedAt]);
        if (updated.buyerReview && !before.buyerReview) {
          // One recipient/request-scoped update replaces the post-review client
          // burst of full snapshot reads and individual notification writes.
          await client.query(`update alpha_exchange.notifications
            set is_read = true, payload = payload || jsonb_build_object('isRead', true, 'state', 'read', 'updatedAt', $3::text)
            where user_id = $1 and payload->>'relatedRequestId' = $2 and is_read = false
              and coalesce(payload->>'state', 'unread') <> 'archived'
              and (lower(payload->>'title') like '%action required%'
                or lower(payload->>'title') like '%confirm usdt receipt%'
                or lower(payload->>'message') like '%confirm that you received your usdt%')`,
          [updated.buyerId, updated.id, updated.updatedAt]);
        }
        for (const name of ["notifications", "audit_logs", "activity_logs"] as const) {
          const table = getTable(name);
          await table.insert(client, table.values(next), { evidenceContentById: new Map() });
        }
        await client.query("update alpha_exchange.runtime_meta set version = version + 1, updated_at = now() where singleton = true");
      }
      await client.query("commit");
      return next;
    } catch (error) {
      destroy = isTransientReadError(error);
      try { await client.query("rollback"); } catch { destroy = true; }
      throw error;
    } finally {
      client.release(destroy);
    }
  }

  /**
   * Loads complete rows for a small, explicit set of snapshot tables plus the
   * canonical runtime version. Critical trade mutations use this instead of
   * paying for every unrelated exchange table before each tap.
   */
  async loadSelectedSnapshot(tableNames: readonly SnapshotTableName[]): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) return this.loadSnapshot();

    const selectedNames = Array.from(new Set(tableNames));
    try {
      const result = await queryReadWithRetry<AggregatedSnapshotRow>(
        pool,
        buildAggregatedSnapshotSql(selectedNames),
        undefined,
        `selected_snapshot_${selectedNames.length}`,
      );
      const row = result.rows[0];
      return attachVersion(
        snapshotFromAggregatedRow(row, selectedNames),
        Number(row?.version ?? "0"),
      );
    } catch (error) {
      logEvent("warn", {
        event: "alpha_exchange_repository_selected_snapshot",
        outcome: "failed",
        reason: "selected_snapshot_fallback",
        metadata: {
          tableCount: selectedNames.length,
          errorName: error instanceof Error ? error.name : typeof error,
        },
      });
      // A failed targeted read must not fan back out into the substantially
      // larger full snapshot in production. During a database incident that
      // fallback multiplied load, kept requests open for minutes, and made
      // every dashboard widget fail together. Local/test repositories retain
      // the compatibility fallback used by their lightweight mocks.
      if (isProductionSecurityRuntime()) throw error;
      return this.loadSnapshot();
    }
  }

  /**
   * Load the public marketplace in one canonical statement without aggregating
   * unrelated buyers, inactive sellers, sessions, notifications, or evidence.
   *
   * Candidate sellers come from active listings. Their complete listing and
   * trade history is retained so trust and reliability ordering stays
   * identical to a full snapshot, while the optional viewer row preserves
   * bidirectional account-block visibility rules.
   */
  async loadMarketplaceListingSnapshotForViewer(viewerUserId?: string): Promise<{
    snapshot: SnapshotWithVersion;
    unpaidCommissionSellerIds: string[];
  }> {
    await this.ensureReady();
    const viewerId = viewerUserId?.trim() || null;
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      const candidateSellerIds = new Set(
        source.marketplaceListings
          .filter((listing) => ["active", "matched", "in_trade"].includes(listing.status))
          .map((listing) => listing.sellerId),
      );
      const relevantUserIds = new Set(candidateSellerIds);
      if (viewerId) relevantUserIds.add(viewerId);
      return {
        snapshot: attachVersion({
          ...emptySnapshotCollections(),
          users: cloneSnapshot(source.users.filter((user) => relevantUserIds.has(user.id))),
          sellerApplications: cloneSnapshot(source.sellerApplications.filter((application) => relevantUserIds.has(application.userId))),
          marketplaceListings: cloneSnapshot(source.marketplaceListings.filter((listing) => candidateSellerIds.has(listing.sellerId))),
          purchaseRequests: cloneSnapshot(source.purchaseRequests.filter((request) => candidateSellerIds.has(request.sellerId))),
          commissionRecords: cloneSnapshot(source.commissionRecords.filter((record) => candidateSellerIds.has(record.sellerId))),
          auditLogs: cloneSnapshot(source.auditLogs.filter((entry) => candidateSellerIds.has(entry.targetUserId ?? ""))),
          trustSnapshots: cloneSnapshot(source.trustSnapshots.filter((snapshot) => candidateSellerIds.has(snapshot.sellerId))),
          marketplaceEnforcementRecords: cloneSnapshot((source.marketplaceEnforcementRecords ?? []).filter((record) => candidateSellerIds.has(record.sellerId))),
        }, getVersion(source)),
        unpaidCommissionSellerIds: Array.from(new Set(
          source.commissionRecords
            .filter((record) => candidateSellerIds.has(record.sellerId) && record.paymentStatus !== "paid")
            .map((record) => record.sellerId),
        )),
      };
    }

    const result = await pool.query<AggregatedSnapshotRow & { unpaid_commission_seller_ids?: unknown }>(
      `with candidate_seller_ids as materialized (
         select distinct seller_id
         from alpha_exchange.listings
         where status in ('active', 'matched', 'in_trade')
       )
       select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((
           select jsonb_agg(account.payload order by account.sort_index asc)
           from alpha_exchange.users account
           where account.id in (select seller_id from candidate_seller_ids)
              or ($1::text is not null and account.id = $1)
         ), '[]'::jsonb) as users,
         coalesce((
           select jsonb_agg(application.payload order by application.sort_index asc)
           from alpha_exchange.seller_applications application
           where application.user_id in (select seller_id from candidate_seller_ids)
              or ($1::text is not null and application.user_id = $1)
         ), '[]'::jsonb) as seller_applications,
         coalesce((
           select jsonb_agg(listing.payload order by listing.sort_index asc)
           from alpha_exchange.listings listing
           where listing.seller_id in (select seller_id from candidate_seller_ids)
         ), '[]'::jsonb) as listings,
         coalesce((
           select jsonb_agg(request.payload order by request.sort_index asc)
           from alpha_exchange.purchase_requests request
           where request.seller_id in (select seller_id from candidate_seller_ids)
         ), '[]'::jsonb) as purchase_requests,
         coalesce((
           select jsonb_agg(commission.payload order by commission.sort_index asc)
           from alpha_exchange.commissions commission
           where commission.seller_id in (select seller_id from candidate_seller_ids)
         ), '[]'::jsonb) as commissions,
         coalesce((
           select jsonb_agg(blocked.seller_id order by blocked.seller_id)
           from (
             select distinct commission.seller_id
             from alpha_exchange.commissions commission
             where commission.payment_status <> 'paid'
               and commission.seller_id in (select seller_id from candidate_seller_ids)
           ) blocked
         ), '[]'::jsonb) as unpaid_commission_seller_ids,
         coalesce((
           select jsonb_agg(entry.payload order by entry.sort_index asc)
           from alpha_exchange.audit_logs entry
           where entry.target_user_id in (select seller_id from candidate_seller_ids)
         ), '[]'::jsonb) as audit_logs,
         coalesce((
           select jsonb_agg(snapshot.payload order by snapshot.sort_index asc)
           from alpha_exchange.trust_snapshots snapshot
           where snapshot.seller_id in (select seller_id from candidate_seller_ids)
         ), '[]'::jsonb) as trust_snapshots,
         coalesce((
           select jsonb_agg(enforcement.payload order by enforcement.sort_index asc)
           from alpha_exchange.marketplace_enforcement_records enforcement
           where enforcement.seller_id in (select seller_id from candidate_seller_ids)
         ), '[]'::jsonb) as marketplace_enforcement_records`,
      [viewerId],
    );
    const row = result.rows[0];
    const tableNames = [
      "users",
      "seller_applications",
      "listings",
      "purchase_requests",
      "commissions",
      "audit_logs",
      "trust_snapshots",
      "marketplace_enforcement_records",
    ] as const satisfies readonly SnapshotTableName[];
    return {
      snapshot: attachVersion(
        snapshotFromAggregatedRow(row, tableNames),
        Number(row?.version ?? "0"),
      ),
      unpaidCommissionSellerIds: Array.isArray(row?.unpaid_commission_seller_ids)
        ? row.unpaid_commission_seller_ids.filter((sellerId): sellerId is string => typeof sellerId === "string")
        : [],
    };
  }

  /** Load one account and the application row needed for legacy role repair. */
  async loadAuthUserSnapshot(input: { userId?: string; normalizedEmail?: string }): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const userId = input.userId?.trim() || null;
    const normalizedEmail = input.normalizedEmail?.trim().toLowerCase() || null;
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      const users = source.users.filter((user) => (
        (userId !== null && user.id === userId)
        || (normalizedEmail !== null && user.email.trim().toLowerCase() === normalizedEmail)
      ));
      const ids = new Set(users.map((user) => user.id));
      return attachVersion({
        ...emptySnapshotCollections(),
        users: cloneSnapshot(users),
        sellerApplications: cloneSnapshot(source.sellerApplications.filter((application) => ids.has(application.userId))),
      }, getVersion(source));
    }

    const result = await pool.query<AggregatedSnapshotRow>(
      `with selected_users as materialized (
         select id, sort_index, payload
         from alpha_exchange.users
         where ($1::text is not null and id = $1)
            or ($2::text is not null and email = $2)
       )
       select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((select jsonb_agg(payload order by sort_index asc) from selected_users), '[]'::jsonb) as users,
         coalesce((
           select jsonb_agg(application.payload order by application.sort_index asc)
           from alpha_exchange.seller_applications application
           where application.user_id in (select id from selected_users)
         ), '[]'::jsonb) as seller_applications`,
      [userId, normalizedEmail],
    );
    const row = result.rows[0];
    return attachVersion(
      snapshotFromAggregatedRow(row, ["users", "seller_applications"]),
      Number(row?.version ?? "0"),
    );
  }

  /** Load the authenticated account profile and only that account's statistics. */
  async loadAccountProfileSnapshotForUser(userId: string): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      return attachVersion({
        ...emptySnapshotCollections(),
        users: cloneSnapshot(source.users.filter((user) => user.id === userId)),
        sellerApplications: cloneSnapshot(source.sellerApplications.filter((application) => application.userId === userId)),
        authSessions: cloneSnapshot(source.authSessions.filter((session) => session.userId === userId)),
        purchaseRequests: cloneSnapshot(source.purchaseRequests.filter((request) => request.buyerId === userId || request.sellerId === userId)),
        marketplaceListings: cloneSnapshot(source.marketplaceListings.filter((listing) => listing.sellerId === userId)),
        commissionRecords: cloneSnapshot(source.commissionRecords.filter((record) => record.buyerId === userId || record.sellerId === userId)),
        trustSnapshots: cloneSnapshot(source.trustSnapshots.filter((snapshot) => snapshot.sellerId === userId)),
      }, getVersion(source));
    }

    const result = await pool.query<AggregatedSnapshotRow>(
      `select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.users where id = $1), '[]'::jsonb) as users,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.seller_applications where user_id = $1), '[]'::jsonb) as seller_applications,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.sessions where user_id = $1), '[]'::jsonb) as sessions,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.purchase_requests where buyer_id = $1 or seller_id = $1), '[]'::jsonb) as purchase_requests,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.listings where seller_id = $1), '[]'::jsonb) as listings,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.commissions where buyer_id = $1 or seller_id = $1), '[]'::jsonb) as commissions,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.trust_snapshots where seller_id = $1), '[]'::jsonb) as trust_snapshots`,
      [userId],
    );
    const row = result.rows[0];
    const tableNames = [
      "users",
      "seller_applications",
      "sessions",
      "purchase_requests",
      "listings",
      "commissions",
      "trust_snapshots",
    ] as const satisfies readonly SnapshotTableName[];
    return attachVersion(
      snapshotFromAggregatedRow(row, tableNames),
      Number(row?.version ?? "0"),
    );
  }

  /** Load the records needed by one seller's listing and commission workspace. */
  async loadSellerWorkspaceSnapshotForUser(sellerId: string): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      return attachVersion({
        ...emptySnapshotCollections(),
        users: cloneSnapshot(source.users.filter((user) => user.id === sellerId)),
        sellerApplications: cloneSnapshot(source.sellerApplications.filter((application) => application.userId === sellerId)),
        marketplaceListings: cloneSnapshot(source.marketplaceListings.filter((listing) => listing.sellerId === sellerId)),
        purchaseRequests: cloneSnapshot(source.purchaseRequests.filter((request) => request.sellerId === sellerId)),
        commissionRecords: cloneSnapshot(source.commissionRecords.filter((record) => record.sellerId === sellerId)),
        auditLogs: cloneSnapshot(source.auditLogs.filter((entry) => entry.targetUserId === sellerId)),
        trustSnapshots: cloneSnapshot(source.trustSnapshots.filter((snapshot) => snapshot.sellerId === sellerId)),
        marketplaceEnforcementRecords: cloneSnapshot((source.marketplaceEnforcementRecords ?? []).filter((record) => record.sellerId === sellerId)),
        marketplaceEnforcementAuditLog: cloneSnapshot((source.marketplaceEnforcementAuditLog ?? []).filter((entry) => entry.sellerId === sellerId)),
      }, getVersion(source));
    }

    const result = await pool.query<AggregatedSnapshotRow>(
      `select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.users where id = $1), '[]'::jsonb) as users,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.seller_applications where user_id = $1), '[]'::jsonb) as seller_applications,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.listings where seller_id = $1), '[]'::jsonb) as listings,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.purchase_requests where seller_id = $1), '[]'::jsonb) as purchase_requests,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.commissions where seller_id = $1), '[]'::jsonb) as commissions,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.audit_logs where target_user_id = $1), '[]'::jsonb) as audit_logs,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.trust_snapshots where seller_id = $1), '[]'::jsonb) as trust_snapshots,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.marketplace_enforcement_records where seller_id = $1), '[]'::jsonb) as marketplace_enforcement_records,
         coalesce((select jsonb_agg(payload order by sort_index asc) from alpha_exchange.marketplace_enforcement_audit_log where seller_id = $1), '[]'::jsonb) as marketplace_enforcement_audit_log`,
      [sellerId],
    );
    const row = result.rows[0];
    const tableNames = [
      "users",
      "seller_applications",
      "listings",
      "purchase_requests",
      "commissions",
      "audit_logs",
      "trust_snapshots",
      "marketplace_enforcement_records",
      "marketplace_enforcement_audit_log",
    ] as const satisfies readonly SnapshotTableName[];
    return attachVersion(
      snapshotFromAggregatedRow(row, tableNames),
      Number(row?.version ?? "0"),
    );
  }

  /** Load only the newest status-matching trade candidate for one actor. */
  async loadPurchaseRequestCandidateSnapshotForActor(input: {
    userId: string;
    includeAll: boolean;
    activeStatuses: readonly PurchaseRequest["status"][];
    includeBuyerPending: boolean;
  }): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      const activeStatuses = new Set(input.activeStatuses);
      const purchaseRequest = source.purchaseRequests
        .filter((request) => (
          input.includeAll || request.buyerId === input.userId || request.sellerId === input.userId
        ))
        .filter((request) => (
          activeStatuses.has(request.status)
          || (input.includeBuyerPending && request.status === "pending" && request.buyerId === input.userId)
        ))
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
      return attachVersion({
        ...emptySnapshotCollections(),
        users: purchaseRequest ? cloneSnapshot(source.users.filter(user => user.id === input.userId || user.id === purchaseRequest.buyerId || user.id === purchaseRequest.sellerId)) : [],
        marketplaceListings: purchaseRequest
          ? cloneSnapshot(source.marketplaceListings.filter((listing) => listing.id === purchaseRequest.listingId))
          : [],
        purchaseRequests: purchaseRequest ? cloneSnapshot([purchaseRequest]) : [],
      }, getVersion(source));
    }

    const result = await pool.query<AggregatedSnapshotRow>(
      `with candidate_request as materialized (
         select id, listing_id, buyer_id, seller_id, sort_index, payload
         from alpha_exchange.purchase_requests
         where ($2::boolean or buyer_id = $1 or seller_id = $1)
           and (
             status = any($3::text[])
             or ($4::boolean and status = 'pending' and buyer_id = $1)
           )
         order by updated_at desc
         limit 1
       )
       select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((
           select jsonb_agg(users.payload order by users.sort_index asc)
           from alpha_exchange.users users
           where users.id = $1 or users.id in (select buyer_id from candidate_request union select seller_id from candidate_request)
         ), '[]'::jsonb) as users,
         coalesce((
           select jsonb_agg(listing.payload order by listing.sort_index asc)
           from alpha_exchange.listings listing
           where listing.id in (select listing_id from candidate_request)
         ), '[]'::jsonb) as listings,
         coalesce((select jsonb_agg(payload order by sort_index asc) from candidate_request), '[]'::jsonb) as purchase_requests`,
      [input.userId, input.includeAll, input.activeStatuses, input.includeBuyerPending],
    );
    const row = result.rows[0];
    return attachVersion(
      snapshotFromAggregatedRow(row, ["users", "listings", "purchase_requests"]),
      Number(row?.version ?? "0"),
    );
  }

  /** Load only the trade history visible to one actor, plus its evidence metadata. */
  async loadPurchaseRequestSnapshotForActor(input: { userId: string; includeAll: boolean; requestId?: string }): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      const purchaseRequests = source.purchaseRequests.filter((request) => (
        (input.includeAll || request.buyerId === input.userId || request.sellerId === input.userId)
        && (!input.requestId || request.id === input.requestId)
      ));
      const requestIds = new Set(purchaseRequests.map((request) => request.id));
      const listingIds = new Set(purchaseRequests.map((request) => request.listingId));
      const participantIds = new Set([input.userId, ...purchaseRequests.flatMap(request => [request.buyerId, request.sellerId])]);
      return attachVersion({
        ...emptySnapshotCollections(),
        users: cloneSnapshot(source.users.filter(user => participantIds.has(user.id))),
        marketplaceListings: cloneSnapshot(source.marketplaceListings.filter((listing) => listingIds.has(listing.id))),
        purchaseRequests: cloneSnapshot(purchaseRequests),
        tradeEvidenceFiles: cloneSnapshot(source.tradeEvidenceFiles.filter((file) => requestIds.has(file.purchaseRequestId))),
      }, getVersion(source));
    }

    const result = await pool.query<AggregatedSnapshotRow>(
      `with visible_requests as materialized (
         select id, listing_id, buyer_id, seller_id, sort_index, payload
         from alpha_exchange.purchase_requests
         where ($2::boolean or buyer_id = $1 or seller_id = $1)
           and ($3::text is null or id = $3)
       )
       select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((
           select jsonb_agg(users.payload order by users.sort_index asc)
           from alpha_exchange.users users
           where users.id = $1 or users.id in (select buyer_id from visible_requests union select seller_id from visible_requests)
         ), '[]'::jsonb) as users,
         coalesce((
           select jsonb_agg(listing.payload order by listing.sort_index asc)
           from alpha_exchange.listings listing
           where listing.id in (select listing_id from visible_requests)
         ), '[]'::jsonb) as listings,
         coalesce((select jsonb_agg(payload order by sort_index asc) from visible_requests), '[]'::jsonb) as purchase_requests,
         coalesce((
           select jsonb_agg(evidence.payload order by evidence.sort_index asc)
           from alpha_exchange.evidence evidence
           where evidence.purchase_request_id in (select id from visible_requests)
         ), '[]'::jsonb) as evidence`,
      [input.userId, input.includeAll, input.requestId ?? null],
    );
    const row = result.rows[0];
    return attachVersion(
      snapshotFromAggregatedRow(row, ["users", "listings", "purchase_requests", "evidence"]),
      Number(row?.version ?? "0"),
    );
  }

  /**
   * Load a notification inbox without scanning unrelated users' inboxes,
   * activity, trades, commissions, or disputes. This query is deliberately
   * scoped to a single recipient.
   */
  async loadNotificationSnapshotForUser(input: { userId: string; includeActivity: boolean }): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      const notifications = source.notifications.filter((notification) => notification.userId === input.userId);
      const relatedRequestIds = new Set(notifications.map((notification) => notification.relatedRequestId).filter(Boolean));
      const relatedTradeIds = new Set(notifications.map((notification) => notification.relatedTradeId).filter(Boolean));
      const relatedListingIds = new Set(notifications.map((notification) => notification.relatedListingId).filter(Boolean));
      const requests = source.purchaseRequests.filter((request) => (
        request.buyerId === input.userId
        || request.sellerId === input.userId
        || relatedRequestIds.has(request.id)
        || Boolean(request.tradeId && relatedTradeIds.has(request.tradeId))
        || relatedListingIds.has(request.listingId)
      ));
      const requestIds = new Set(requests.map((request) => request.id));
      const listings = source.marketplaceListings.filter((listing) => (
        listing.sellerId === input.userId
        || relatedListingIds.has(listing.id)
        || requests.some((request) => request.listingId === listing.id)
      ));
      const participantIds = new Set<string>([input.userId]);
      requests.forEach((request) => { participantIds.add(request.buyerId); participantIds.add(request.sellerId); });
      listings.forEach((listing) => participantIds.add(listing.sellerId));
      // Older trust alerts embedded only a seller UUID in their free-form
      // title/message. Include that referenced account so enrichment can
      // replace the identifier with the seller's safe public identity.
      const legacyNotificationText = notifications.map((notification) => JSON.stringify(notification)).join("\n");
      source.users.forEach((user) => {
        if (legacyNotificationText.includes(user.id)) participantIds.add(user.id);
      });
      return attachVersion({
        ...emptySnapshotCollections(),
        users: cloneSnapshot(source.users.filter((user) => participantIds.has(user.id))),
        sellerApplications: cloneSnapshot(source.sellerApplications.filter((application) => participantIds.has(application.userId))),
        marketplaceListings: cloneSnapshot(listings),
        purchaseRequests: cloneSnapshot(requests),
        commissionRecords: cloneSnapshot(source.commissionRecords.filter((record) => (
          record.sellerId === input.userId || record.buyerId === input.userId || Boolean(record.purchaseRequestId && requestIds.has(record.purchaseRequestId))
        ))),
        notifications: cloneSnapshot(notifications),
        activityLog: input.includeActivity
          ? cloneSnapshot(source.activityLog.filter((entry) => entry.userId === input.userId))
          : [],
        disputes: cloneSnapshot(source.disputes.filter((dispute) => (
          dispute.buyerId === input.userId || dispute.sellerId === input.userId || requestIds.has(dispute.purchaseRequestId)
        ))),
        trustSnapshots: cloneSnapshot(source.trustSnapshots.filter((entry) => participantIds.has(entry.sellerId))),
      }, getVersion(source));
    }

    const result = await queryReadWithRetry<AggregatedSnapshotRow>(
      pool,
      `with recipient_notifications as materialized (
         select sort_index, payload
         from alpha_exchange.notifications
         where user_id = $1
       ), legacy_notification_text as materialized (
         -- Serialize each notification once, not once per account in the
         -- legacy identity lookup. Keep the same substring matching behavior.
         select string_agg(payload::text, chr(10)) as body from recipient_notifications
       ), related_requests as materialized (
         select id, listing_id, seller_id, buyer_id, sort_index, payload
         from alpha_exchange.purchase_requests
         where buyer_id = $1
            or seller_id = $1
            or id in (select payload->>'relatedRequestId' from recipient_notifications)
            or trade_id in (select payload->>'relatedTradeId' from recipient_notifications)
            or listing_id in (select payload->>'relatedListingId' from recipient_notifications)
       ), related_listings as materialized (
         select id, seller_id, sort_index, payload
         from alpha_exchange.listings
         where seller_id = $1
            or id in (select payload->>'relatedListingId' from recipient_notifications)
            or id in (select listing_id from related_requests)
       ), participant_ids as materialized (
         select $1::text as id
         union select seller_id from related_requests
         union select buyer_id from related_requests
         union select seller_id from related_listings
         union
         select account.id
         from alpha_exchange.users account
         where (select body from legacy_notification_text) like '%' || account.id || '%'
       )
       select
         (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
         coalesce((
           select jsonb_agg(account.payload order by account.sort_index asc)
           from alpha_exchange.users account
           where account.id in (select id from participant_ids)
         ), '[]'::jsonb) as users,
         coalesce((
           select jsonb_agg(application.payload order by application.sort_index asc)
           from alpha_exchange.seller_applications application
           where application.user_id in (select id from participant_ids)
              or application.id in (select payload->>'relatedRequestId' from recipient_notifications)
         ), '[]'::jsonb) as seller_applications,
         coalesce((select jsonb_agg(payload order by sort_index asc) from related_listings), '[]'::jsonb) as listings,
         coalesce((select jsonb_agg(payload order by sort_index asc) from related_requests), '[]'::jsonb) as purchase_requests,
         coalesce((
           select jsonb_agg(commission.payload order by commission.sort_index asc)
           from alpha_exchange.commissions commission
           where commission.seller_id = $1
              or commission.buyer_id = $1
              or commission.purchase_request_id in (select id from related_requests)
         ), '[]'::jsonb) as commissions,
         coalesce((select jsonb_agg(payload order by sort_index asc) from recipient_notifications), '[]'::jsonb) as notifications,
         case when $2::boolean then coalesce((
           select jsonb_agg(activity.payload order by activity.sort_index asc)
           from alpha_exchange.activity_logs activity
           where activity.user_id = $1
         ), '[]'::jsonb) else '[]'::jsonb end as activity_logs,
         coalesce((
           select jsonb_agg(dispute.payload order by dispute.sort_index asc)
           from alpha_exchange.disputes dispute
           where dispute.buyer_id = $1
              or dispute.seller_id = $1
              or dispute.purchase_request_id in (select id from related_requests)
         ), '[]'::jsonb) as disputes,
         coalesce((
           select jsonb_agg(snapshot.payload order by snapshot.sort_index asc)
           from alpha_exchange.trust_snapshots snapshot
           where snapshot.seller_id in (select id from participant_ids)
         ), '[]'::jsonb) as trust_snapshots`,
      [input.userId, input.includeActivity],
      "notification_snapshot",
    );
    const row = result.rows[0];
    const tableNames = [
      "users",
      "seller_applications",
      "listings",
      "purchase_requests",
      "commissions",
      "notifications",
      "activity_logs",
      "disputes",
      "trust_snapshots",
    ] as const satisfies readonly SnapshotTableName[];
    return attachVersion(
      snapshotFromAggregatedRow(row, tableNames),
      Number(row?.version ?? "0"),
    );
  }

  /**
   * Return a cheap recipient-scoped token for cross-instance notification
   * reconciliation. The SSE loop compares this before loading the enriched
   * notification snapshot, avoiding repeated joins while nothing changed.
   */
  async loadNotificationRevisionForUser(userId: string): Promise<string> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const notifications = getLatestAvailableFallbackSnapshot().notifications
        .filter((notification) => notification.userId === userId);
      const unreadCount = notifications.filter((notification) => notification.isRead === false).length;
      const latestUpdatedAt = notifications.reduce((latest, notification) => {
        const candidate = notification.updatedAt ?? notification.createdAt;
        return candidate > latest ? candidate : latest;
      }, "");
      return `${notifications.length}:${unreadCount}:${latestUpdatedAt}`;
    }

    const result = await queryReadWithRetry<{
      total: string;
      unread_count: string;
      latest_updated_at: string | null;
    }>(
      pool,
      `select
         count(*)::text as total,
         count(*) filter (where is_read = false)::text as unread_count,
         max(coalesce(nullif(payload->>'updatedAt', ''), nullif(payload->>'createdAt', ''), created_at::text)) as latest_updated_at
       from alpha_exchange.notifications
       where user_id = $1`,
      [userId],
      "notification_revision",
    );
    const row = result.rows[0];
    return `${row?.total ?? "0"}:${row?.unread_count ?? "0"}:${row?.latest_updated_at ?? ""}`;
  }

  /**
   * Loads the exact records needed to render one Trade Room with a single
   * PostgreSQL round trip. The live stream calls this only when that trade's
   * revision changed; it must never fan out through the full exchange
   * snapshot on a per-connection timer.
   */
  async loadTradeRoomSnapshot(lookupCandidates: string[], viewerUserId?: string, includeOwnerHistory = false): Promise<SnapshotWithVersion | null> {
    await this.ensureReady();
    const candidates = Array.from(new Set(lookupCandidates.map((value) => value.trim()).filter(Boolean)));
    if (candidates.length === 0) return null;

    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const snapshot = getLatestAvailableFallbackSnapshot();
      const request = snapshot.purchaseRequests.find((candidate) => (
        candidates.includes(candidate.id) || Boolean(candidate.tradeId && candidates.includes(candidate.tradeId))
      ));
      return request ? snapshot : null;
    }

    type TradeRoomSnapshotRow = {
      request_payload: PurchaseRequest;
      listing_payload: MarketplaceListing | null;
      viewer_payload: AlphaExchangeUser | null;
      buyer_payload: AlphaExchangeUser | null;
      seller_payload: AlphaExchangeUser | null;
      dispute_payloads: TradeDisputeCase[] | null;
      commission_payloads: CommissionRecord[] | null;
      evidence_payloads: TradeEvidenceFile[] | null;
      audit_payloads: AuditLogEntry[] | null;
      version: string;
    };

    const result = await pool.query<TradeRoomSnapshotRow>(
      `select
         request.payload as request_payload,
         listing.payload as listing_payload,
         viewer.payload as viewer_payload,
         buyer.payload as buyer_payload,
         seller.payload as seller_payload,
         coalesce((
           select jsonb_agg(dispute.payload order by dispute.sort_index asc)
             from alpha_exchange.disputes dispute
            where dispute.purchase_request_id = request.id
         ), '[]'::jsonb) as dispute_payloads,
         coalesce((
           select jsonb_agg(commission.payload order by commission.sort_index asc)
             from alpha_exchange.commissions commission
            where commission.seller_id = request.seller_id
         ), '[]'::jsonb) as commission_payloads,
         coalesce((
           select jsonb_agg(evidence.payload order by evidence.sort_index asc)
             from alpha_exchange.evidence evidence
            where evidence.purchase_request_id = request.id
         ), '[]'::jsonb) as evidence_payloads,
         case when $4::boolean then coalesce((
           select jsonb_agg(audit.payload order by audit.created_at asc)
             from alpha_exchange.audit_logs audit
            where audit.purchase_request_id = request.id
         ), '[]'::jsonb) else '[]'::jsonb end as audit_payloads,
         meta.version::text as version
       from alpha_exchange.purchase_requests request
       left join alpha_exchange.listings listing on listing.id = request.listing_id
       left join alpha_exchange.users viewer on viewer.id = $3
       left join alpha_exchange.users buyer on buyer.id = request.buyer_id
       left join alpha_exchange.users seller on seller.id = request.seller_id
       cross join alpha_exchange.runtime_meta meta
       where request.id = any($1::text[])
       order by case when request.id = $2 then 0 else 1 end, request.updated_at desc
       limit 1`,
      [candidates, candidates[0], viewerUserId ?? null, includeOwnerHistory],
    );
    const row = result.rows[0];
    if (!row?.request_payload) return null;

    const snapshot = emptySnapshotCollections();
    snapshot.purchaseRequests = [row.request_payload];
    snapshot.marketplaceListings = row.listing_payload ? [row.listing_payload] : [];
    snapshot.users = [row.buyer_payload, row.seller_payload, row.viewer_payload]
      .filter((user): user is AlphaExchangeUser => Boolean(user))
      .filter((user, index, users) => users.findIndex((candidate) => candidate.id === user.id) === index);
    snapshot.disputes = Array.isArray(row.dispute_payloads) ? row.dispute_payloads : [];
    snapshot.commissionRecords = Array.isArray(row.commission_payloads) ? row.commission_payloads : [];
    snapshot.tradeEvidenceFiles = Array.isArray(row.evidence_payloads) ? row.evidence_payloads : [];
    snapshot.auditLogs = Array.isArray(row.audit_payloads) ? row.audit_payloads : [];
    return attachVersion(snapshot, Number(row.version ?? "0"));
  }

  /** Lightweight cross-instance change detector used by Trade Room SSE. */
  async loadTradeRoomRevision(lookupCandidates: string[]): Promise<TradeRoomRevision | null> {
    await this.ensureReady();
    const candidates = Array.from(new Set(lookupCandidates.map((value) => value.trim()).filter(Boolean)));
    if (candidates.length === 0) return null;

    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const snapshot = getLatestAvailableFallbackSnapshot();
      const request = snapshot.purchaseRequests.find((candidate) => (
        candidates.includes(candidate.id) || Boolean(candidate.tradeId && candidates.includes(candidate.tradeId))
      ));
      return request
        ? {
            id: request.id,
            buyerId: request.buyerId,
            sellerId: request.sellerId,
            status: request.status,
            updatedAt: request.updatedAt,
          }
        : null;
    }

    const result = await pool.query<{
      id: string;
      buyer_id: string;
      seller_id: string;
      status: PurchaseRequest["status"];
      updated_at: string;
    }>(
      `select id, buyer_id, seller_id, status, updated_at::text as updated_at
         from alpha_exchange.purchase_requests
        where id = any($1::text[])
        order by case when id = $2 then 0 else 1 end, updated_at desc
        limit 1`,
      [candidates, candidates[0]],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      status: row.status,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async acquireAdminAnnouncementBatchLock(input: {
    run: AdminAnnouncementRun;
    staleBefore: string;
  }) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      if (isProductionSecurityRuntime()) {
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
      if (isProductionSecurityRuntime()) {
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

  /**
   * Load the broad owner dashboard snapshot in bounded statements while one
   * read-only repeatable-read transaction retains a single pooler backend.
   * This preserves a coherent dashboard view without the former 26-table
   * aggregate that repeatedly crossed the production read timeout.
   */
  async loadAdminDashboardSnapshot(): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) return this.loadSnapshot();

    const selectedNames = ADMIN_DASHBOARD_SNAPSHOT_TABLE_GROUPS.flat();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let client: PoolClient | null = null;
      let groupIndex = -1;
      try {
        client = await pool.connect();
        await client.query("begin transaction isolation level repeatable read read only");
        const aggregateRow: AggregatedSnapshotRow = {};
        for (let index = 0; index < ADMIN_DASHBOARD_SNAPSHOT_TABLE_GROUPS.length; index += 1) {
          groupIndex = index;
          const group = ADMIN_DASHBOARD_SNAPSHOT_TABLE_GROUPS[index];
          const result = await client.query<AggregatedSnapshotRow>(
            buildAggregatedSnapshotSql(group, ADMIN_DASHBOARD_TABLE_LIMITS),
          );
          const row = result.rows[0];
          if (row) Object.assign(aggregateRow, row);
        }
        await client.query("commit");
        client.release();
        client = null;
        return attachVersion(
          snapshotFromAggregatedRow(aggregateRow, selectedNames),
          Number(aggregateRow.version ?? "0"),
        );
      } catch (error) {
        if (client) {
          // Query-read timeouts may leave a response pending on the socket.
          // Destroy that checkout instead of queuing ROLLBACK behind it.
          if (!(error instanceof Error && /query read timeout/i.test(error.message))) {
            try { await client.query("rollback"); } catch { /* release(true) below discards the client */ }
          }
          client.release(true);
          client = null;
        }
        if (attempt === 0 && isTransientReadError(error)) {
          logEvent("warn", {
            event: "alpha_exchange_repository_read_retry",
            outcome: "failed",
            reason: "transient_database_read_failure",
            metadata: {
              operation: "admin_dashboard_snapshot",
              groupIndex,
              attempt: attempt + 1,
              ...databaseErrorMetadata(error),
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (isProductionSecurityRuntime()) {
          logEvent("error", {
            event: "alpha_exchange_repository_admin_dashboard_load",
            outcome: "failed",
            reason: "durable_persistence_unavailable",
            metadata: { groupIndex, ...databaseErrorMetadata(error) },
          });
          throw new Error("Durable Alpha Exchange persistence is unavailable.");
        }
        logEvent("warn", {
          event: "alpha_exchange_repository_admin_dashboard_load",
          outcome: "failed",
          reason: "local_memory_fallback_enabled",
          metadata: { groupIndex, ...databaseErrorMetadata(error) },
        });
        return getLatestAvailableFallbackSnapshot();
      }
    }
    throw new Error("Admin dashboard snapshot retry exhausted.");
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
      const result = await pool.query<AggregatedSnapshotRow>(buildAggregatedSnapshotSql(SNAPSHOT_TABLE_NAMES));
      perf?.step(`aggregate_query(${SNAPSHOT_TABLE_NAMES.length})`);
      const row = result.rows[0];
      const snapshot = snapshotFromAggregatedRow(row, SNAPSHOT_TABLE_NAMES);
      perf?.step("snapshotFromTableRows");

      const version = Number(row?.version ?? "0");
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
      if (isProductionSecurityRuntime()) {
        logEvent("error", {
          event: "alpha_exchange_repository_load",
          outcome: "failed",
          reason: "durable_persistence_unavailable",
          metadata: { errorName: error instanceof Error ? error.name : "unknown" },
        });
        throw new Error("Durable Alpha Exchange persistence is unavailable.");
      }
      logEvent("warn", {
        event: "alpha_exchange_repository_load",
        outcome: "failed",
        reason: "local_memory_fallback_enabled",
        metadata: { errorName: error instanceof Error ? error.name : typeof error },
      });
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

  /**
   * Lightweight authoritative lookup for the public marketplace visibility
   * gate. Loading the full exchange snapshot here would fan out across every
   * table on the highest-traffic unauthenticated route.
   */
  async loadUnpaidCommissionSellerIds(): Promise<string[]> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const snapshot = getLatestAvailableFallbackSnapshot();
      return Array.from(new Set(
        snapshot.commissionRecords
          .filter((record) => record.paymentStatus !== "paid")
          .map((record) => record.sellerId),
      ));
    }
    const result = await pool.query<{ seller_id: string }>(
      "select distinct seller_id from alpha_exchange.commissions where payment_status <> 'paid'",
    );
    return result.rows.map((row) => row.seller_id);
  }

  async saveSnapshot(
    db: AlphaExchangeDb,
    options?: {
      evidenceOverrides?: EvidenceWriteMap;
      skipReadyCheck?: boolean;
      traceTag?: string;
      selectedTables?: readonly SnapshotTableName[];
      /**
       * Runs while the repository's advisory transaction lock is held, after
       * any stale snapshot merge and before any selected table is replaced.
       * Security-sensitive callers use this to revalidate a state transition
       * against the canonical snapshot that will actually be committed.
       */
      validateBeforeCommit?: (snapshot: AlphaExchangeDb) => void;
      /**
       * Runs only when the caller's snapshot became stale, against the latest
       * canonical snapshot before the incoming mutation is merged or rebased.
       * Callers can reject a stale business decision and retry it from fresh
       * state instead of allowing status-rank merging to choose a winner.
       */
      validateLatestBeforeCommit?: (snapshot: AlphaExchangeDb) => void;
      /**
       * For a narrowly scoped security-sensitive mutation, rebuilds the
       * candidate from the latest canonical snapshot while the advisory lock
       * is held. This avoids stale whole-table replacement when two instances
       * mutate different records concurrently.
       */
      rebaseOnLatest?: (persistedSnapshot: AlphaExchangeDb) => AlphaExchangeDb | Promise<AlphaExchangeDb>;
      /** Complete read dependencies for a scoped rebase, including all written tables. */
      rebaseTables?: readonly SnapshotTableName[];
    },
  ) {
    if (options?.traceTag && allowsRuntimeDiagnostics()) {
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
        options?.validateLatestBeforeCommit?.(cloneSnapshot(latestSnapshot));
        const nextSnapshot = options?.rebaseOnLatest
          ? pruneOrphanAuthSessions(await options.rebaseOnLatest(cloneSnapshot(latestSnapshot)))
          : pruneOrphanAuthSessions(cloneSnapshot(db));
        const mergedSnapshot = options?.rebaseOnLatest
          ? nextSnapshot
          : mergeSnapshotWithLatest(latestSnapshot, nextSnapshot);
        options?.validateBeforeCommit?.(mergedSnapshot);
        const next = attachVersion(mergedSnapshot, previousVersion + 1);
        const previousEvidence = globalThis.__alphaExchangeMemoryEvidenceContent as Map<string, Buffer | null>;
        const nextEvidence = new Map<string, Buffer | null>();
        for (const [storageKey, content] of previousEvidence) {
          if (storageKey.startsWith("db://")) nextEvidence.set(storageKey, content);
        }
        for (const evidence of mergedSnapshot.tradeEvidenceFiles) {
          nextEvidence.set(
            evidence.id,
            options?.evidenceOverrides?.get(evidence.id) ?? previousEvidence.get(evidence.id) ?? null,
          );
        }
        syncMemoryFallbackSnapshot(next, getVersion(next));
        Object.assign(db, cloneSnapshot(next));
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
      options?.validateBeforeCommit?.(nextSnapshot);
      const next = attachVersion(nextSnapshot, previousVersion + 1);
      const previousEvidence = globalThis.__alphaExchangeMemoryEvidenceContent as Map<string, Buffer | null>;
      const nextEvidence = new Map<string, Buffer | null>();
      for (const [storageKey, content] of previousEvidence) {
        if (storageKey.startsWith("db://")) nextEvidence.set(storageKey, content);
      }
      for (const evidence of db.tradeEvidenceFiles) {
        nextEvidence.set(
          evidence.id,
          options?.evidenceOverrides?.get(evidence.id) ?? previousEvidence.get(evidence.id) ?? null,
        );
      }
      syncMemoryFallbackSnapshot(next, getVersion(next));
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
    if (options?.rebaseTables && !options.rebaseOnLatest) {
      throw new Error("Scoped snapshot rebasing requires a canonical mutation.");
    }
    // When writing the 'users' table, also write 'sessions' to preserve active auth sessions.
    // PostgreSQL's ON DELETE CASCADE on sessions.user_id can evict auth sessions if a user is deleted.
    if (selectedTableSet.has("users") && !selectedTableSet.has("sessions")) {
      selectedTables.push("sessions");
      selectedTableSet.add("sessions");
    }
    const rebaseTables = options?.rebaseTables
      ? Array.from(new Set([...options.rebaseTables, ...selectedTables]))
      : SNAPSHOT_TABLE_NAMES;

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
          } catch (error) {
            // A real timeout means the lock was NOT acquired. Only the local
            // pg-mem unsupported-function error may skip this lock.
            if (isProductionSecurityRuntime() || !(error instanceof Error)
              || !/function .*pg_advisory_xact_lock.*does not exist/i.test(error.message)) throw error;
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
            const aggregateResult = await queryWithLogging(
              client,
              buildAggregatedSnapshotSql(rebaseTables),
            ) as { rows: AggregatedSnapshotRow[] };
            perf?.step("stale_aggregate_read");
            const latestSnapshot = attachVersion(
              snapshotFromAggregatedRow(aggregateResult.rows[0], rebaseTables),
              currentVersion,
            );
            options?.validateLatestBeforeCommit?.(cloneSnapshot(latestSnapshot));
            const incomingSnapshot = options?.rebaseOnLatest
              ? pruneOrphanAuthSessions(await options.rebaseOnLatest(cloneSnapshot(latestSnapshot)))
              : pruneOrphanAuthSessions(db);
            const mergedSnapshot = options?.rebaseOnLatest
              ? incomingSnapshot
              : mergeSnapshotWithLatest(latestSnapshot, incomingSnapshot);
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
            options?.validateBeforeCommit?.(persistedSnapshot);
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
            await client.query("commit");
            Object.assign(db, cloneSnapshot(persistedSnapshot));
            attachVersion(db, nextVersion);
            if (!options?.rebaseTables) syncMemoryFallbackSnapshot(persistedSnapshot, nextVersion);
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
          options?.validateBeforeCommit?.(persistedSnapshot);
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

          await client.query("commit");
          attachVersion(db, writtenVersion);
          if (!options?.rebaseTables) syncMemoryFallbackSnapshot(persistedSnapshot, writtenVersion);
          logProfile("commit");
          perf?.step("commit");
          perf?.done();
          return;
        } catch (error) {
          logEvent("error", {
            event: "alpha_exchange_repository_save",
            outcome: "failed",
            reason: "transaction_failed",
            metadata: { ...databaseErrorMetadata(error), tables: selectedTables.join(",") },
          });
          // A client-side timeout can leave the query running and its global
          // transaction lock held. Do not queue another command on that socket
          // or return it to the pool for the next user's request.
          if (error instanceof Error && /query read timeout/i.test(error.message)) {
            client.release(true);
            client = null;
            throw error;
          }
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            logEvent("error", {
              event: "alpha_exchange_repository_save",
              outcome: "failed",
              reason: "rollback_failed",
              metadata: { errorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError },
            });
            // The transaction may already be aborted; dispose this client so the next request gets a fresh connection.
            client.release(true);
            client = null;
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
      logEvent("error", {
        event: "alpha_exchange_repository_session_write",
        outcome: "failed",
        reason: "durable_persistence_write_failed",
        metadata: { errorName: error instanceof Error ? error.name : typeof error },
      });
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
      const result = await queryReadWithRetry<{ payload: AuthSession }>(
        pool,
        "select payload from alpha_exchange.sessions where token_hash = $1 limit 1",
        [tokenHash],
        "auth_session",
      );
      return result.rows[0]?.payload ?? null;
    } catch (error) {
      if (isProductionSecurityRuntime()) {
        logEvent("error", {
          event: "alpha_exchange_repository_session_read",
          outcome: "failed",
          reason: "durable_persistence_unavailable",
          metadata: databaseErrorMetadata(error),
        });
        throw new Error("Durable session storage is unavailable.");
      }
      logEvent("warn", {
        event: "alpha_exchange_repository_session_read",
        outcome: "failed",
        reason: "local_cached_session_fallback",
        metadata: { errorName: error instanceof Error ? error.name : typeof error },
      });
      return getLatestAvailableFallbackSnapshot().authSessions.find((item) => item.token === tokenHash) ?? null;
    }
  }

  /**
   * Resolve the session, account, and legacy seller-application role context in
   * one indexed read. The previous web-auth path performed a session query and
   * then aggregated every user and application, multiplying pooler latency on
   * every page render and `/api/auth/me` refresh.
   */
  async loadAuthenticatedSessionSnapshot(tokenHash: string): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const source = getLatestAvailableFallbackSnapshot();
      const session = source.authSessions.find((candidate) => candidate.token === tokenHash);
      const userId = session?.userId;
      return attachVersion({
        ...emptySnapshotCollections(),
        authSessions: session ? cloneSnapshot([session]) : [],
        users: userId ? cloneSnapshot(source.users.filter((user) => user.id === userId)) : [],
        sellerApplications: userId
          ? cloneSnapshot(source.sellerApplications.filter((application) => application.userId === userId))
          : [],
      }, getVersion(source));
    }

    try {
      const result = await queryReadWithRetry<AggregatedSnapshotRow>(
        pool,
        `with matched_session as materialized (
           select user_id, sort_index, payload
           from alpha_exchange.sessions
           where token_hash = $1
           limit 1
         )
         select
           (select version::text from alpha_exchange.runtime_meta where singleton = true) as version,
           coalesce((select jsonb_agg(payload order by sort_index asc) from matched_session), '[]'::jsonb) as sessions,
           coalesce((
             select jsonb_agg(account.payload order by account.sort_index asc)
             from alpha_exchange.users account
             where account.id in (select user_id from matched_session)
           ), '[]'::jsonb) as users,
           coalesce((
             select jsonb_agg(application.payload order by application.sort_index asc)
             from alpha_exchange.seller_applications application
             where application.user_id in (select user_id from matched_session)
           ), '[]'::jsonb) as seller_applications`,
        [tokenHash],
        "authenticated_session",
      );
      const row = result.rows[0];
      return attachVersion(
        snapshotFromAggregatedRow(row, ["sessions", "users", "seller_applications"]),
        Number(row?.version ?? "0"),
      );
    } catch (error) {
      if (isProductionSecurityRuntime()) {
        logEvent("error", {
          event: "alpha_exchange_repository_session_user_read",
          outcome: "failed",
          reason: "durable_persistence_unavailable",
          metadata: databaseErrorMetadata(error),
        });
        throw new Error("Durable session storage is unavailable.");
      }
      logEvent("warn", {
        event: "alpha_exchange_repository_session_user_read",
        outcome: "failed",
        reason: "local_cached_session_fallback",
        metadata: databaseErrorMetadata(error),
      });
      const source = getLatestAvailableFallbackSnapshot();
      const session = source.authSessions.find((candidate) => candidate.token === tokenHash);
      const userId = session?.userId;
      return attachVersion({
        ...emptySnapshotCollections(),
        authSessions: session ? cloneSnapshot([session]) : [],
        users: userId ? cloneSnapshot(source.users.filter((user) => user.id === userId)) : [],
        sellerApplications: userId
          ? cloneSnapshot(source.sellerApplications.filter((application) => application.userId === userId))
          : [],
      }, getVersion(source));
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
    const storageKey = resolveDurableEvidenceStorageKey(evidenceId);
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      return globalThis.__alphaExchangeMemoryEvidenceContent?.get(evidenceId) ?? null;
    }
    if (storageKey) {
      const result = await pool.query<{ content: Buffer | null }>(
        "select content from alpha_exchange.evidence_blobs where storage_key = $1",
        [storageKey],
      );
      return result.rows[0]?.content ?? null;
    }
    const result = await pool.query<{ content: Buffer | null }>(
      "select content from alpha_exchange.evidence where id = $1",
      [evidenceId],
    );
    return result.rows[0]?.content ?? null;
  }

  async writeEvidenceContent(evidenceId: string, content: Buffer) {
    const storageKey = resolveDurableEvidenceStorageKey(evidenceId);
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      globalThis.__alphaExchangeMemoryEvidenceContent?.set(evidenceId, content);
      return;
    }
    if (storageKey) {
      await pool.query(
        `insert into alpha_exchange.evidence_blobs (storage_key, content, created_at, updated_at)
         values ($1, $2, now(), now())
         on conflict (storage_key) do update set content = excluded.content, updated_at = now()`,
        [storageKey, content],
      );
      return;
    }

    await pool.query(
      "update alpha_exchange.evidence set content = $2 where id = $1",
      [evidenceId, content],
    );
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
      logEvent("warn", {
        event: "alpha_exchange_repository_listing_snapshot",
        outcome: "failed",
        reason: "targeted_snapshot_fallback",
        metadata: { errorName: error instanceof Error ? error.name : typeof error },
      });
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
      if (current.commissionRecords.some((record) => (
        record.sellerId === delta.newListing.sellerId
        && record.paymentStatus !== "paid"
      ))) {
        throw new Error("Your listings stay visible, but new marketplace trading is locked until every pending commission is paid. Existing trades can finish.");
      }
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
      const next = attachVersion(
        current,
        getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion) + 1,
      );
      syncMemoryFallbackSnapshot(next, getVersion(next));
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

      // Serialize this final authorization check with commission assignment and
      // settlement. The earlier store read may come from another instance's
      // cache, so it is not sufficient for a financial lock. A commission that
      // commits first must prevent the listing insert; a paid commission that
      // commits first allows it.
      try {
        await client.query("select pg_advisory_xact_lock(61422917)");
      } catch {
        // pg-mem does not implement advisory locks; local tests are
        // single-process and use the memory branch above.
      }
      const blockingCommission = await client.query<{ id: string }>(
        `select id
           from alpha_exchange.commissions
          where seller_id = $1
            and payment_status <> 'paid'
          limit 1`,
        [delta.newListing.sellerId],
      );
      if (blockingCommission.rows.length > 0) {
        throw new Error("Your listings stay visible, but new marketplace trading is locked until every pending commission is paid. Existing trades can finish.");
      }
      perf?.step("commission_lock_check");

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
        logEvent("error", {
          event: "alpha_exchange_listing_append",
          targetUserId: delta.newListing.sellerId,
          resourceId: delta.newListing.id,
          outcome: "failed",
          reason: "post_commit_append_failed",
          metadata: {
            table: appendLabels[i] ?? "unknown",
            errorName: result.reason instanceof Error ? result.reason.name : typeof result.reason,
          },
        });
      }
    });

    try {
      // Fire-and-forget: the listing was already committed. Even though the full
      // reload is now one aggregate query, cache mirroring is not part of the
      // user's critical path. The cache was already updated by
      // writeDbForListingCreation and will catch up asynchronously here.
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
      const next = attachVersion(
        current,
        getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion) + 1,
      );
      syncMemoryFallbackSnapshot(next, getVersion(next));
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
  if (
    typeof repository.savePurchaseRequestCreationSnapshotTargeted !== "function"
  ) {
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(new AlphaExchangeRepository(getRuntimePostgresPool()));
    return globalThis.__alphaExchangeRepositoryPromise;
  }
  return globalThis.__alphaExchangeRepositoryPromise;
}
