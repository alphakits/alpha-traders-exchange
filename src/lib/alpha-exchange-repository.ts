import { Pool, type PoolClient } from "pg";
import { appendFileSync } from "fs";
import alphaExchangeSeed from "../../data/alpha-exchange-db.json";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import type {
  AlphaExchangeDb,
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
} from "@/types/alpha-exchange";

type Queryable = Pool | PoolClient;

type EvidenceWriteMap = Map<string, Buffer>;

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
];

const TRUNCATE_SQL = `
  delete from alpha_exchange.beta_announcements;
  delete from alpha_exchange.beta_feedback;
  delete from alpha_exchange.private_beta_invite_uses;
  delete from alpha_exchange.private_beta_invites;
  delete from alpha_exchange.trust_score_history;
  delete from alpha_exchange.trust_snapshots;
  delete from alpha_exchange.seller_reports;
  delete from alpha_exchange.disputes;
  delete from alpha_exchange.activity_logs;
  delete from alpha_exchange.seller_applications;
  delete from alpha_exchange.password_reset_tokens;
  delete from alpha_exchange.evidence;
  delete from alpha_exchange.audit_logs;
  delete from alpha_exchange.commissions;
  delete from alpha_exchange.notifications;
  delete from alpha_exchange.trades;
  delete from alpha_exchange.purchase_requests;
  delete from alpha_exchange.listings;
  delete from alpha_exchange.seller_settings;
  delete from alpha_exchange.seller_profiles;
  delete from alpha_exchange.users;
`

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

const SNAPSHOT_TABLE_NAMES = new Set([
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
]);

function shouldLogRepoVersionFlow() {
  if (process.env.ALPHA_EXCHANGE_REPO_TRACE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

function logRepoVersionFlow(event: string, payload: Record<string, unknown>) {
  if (!shouldLogRepoVersionFlow()) return;
  const line = `[alpha-exchange-repo] ${new Date().toISOString()} ${event} ${JSON.stringify(payload)}`;
  console.log(line);
  try {
    appendFileSync(`${process.cwd()}\\data\\alpha-exchange-repo-trace.log`, `${line}\n`);
  } catch {
    // Ignore log persistence failures; console output remains available.
  }
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

function cloneSnapshot(db: AlphaExchangeDb) {
  return structuredClone(db);
}

const tables = [
  {
    name: "users",
    selectSql: "select payload from alpha_exchange.users order by sort_index asc",
    values: (db) => db.users,
    insert: async (tx, rows: AlphaExchangeUser[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.users
            (id, email, role, seller_status, availability_status, online_status, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [row.id, row.email, row.role, row.sellerStatus, row.availabilityStatus, row.onlineStatus, row.createdAt, row.updatedAt, index, json(row)],
        );
      }
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
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.seller_profiles
            (user_id, seller_status, availability_status, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [String(row.userId), String(row.sellerStatus), String(row.availabilityStatus), String(row.updatedAt), index, json(row)],
        );
      }
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
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.seller_settings
            (user_id, availability_status, notification_preferences, updated_at, sort_index, payload)
           values ($1,$2,$3::jsonb,$4,$5,$6::jsonb)`,
          [String(row.userId), String(row.availabilityStatus), json(row.notificationPreferences), String(row.updatedAt), index, json(row)],
        );
      }
    },
  },
  {
    name: "listings",
    selectSql: "select payload from alpha_exchange.listings order by sort_index asc",
    values: (db) => db.marketplaceListings,
    insert: async (tx, rows: MarketplaceListing[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.listings
            (id, seller_id, status, active_trade_request_id, expires_at, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [row.id, row.sellerId, row.status, row.activeTradeRequestId ?? null, toTimestamp(row.expiresAt), row.createdAt, row.updatedAt, index, json(row)],
        );
      }
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
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.trades
            (id, purchase_request_id, listing_id, seller_id, buyer_id, status, completed_at, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            String(row.id),
            String(row.purchaseRequestId),
            String(row.listingId),
            String(row.sellerId),
            String(row.buyerId),
            String(row.status),
            toTimestamp(typeof row.completedAt === "string" ? row.completedAt : undefined),
            String(row.createdAt),
            String(row.updatedAt),
            index,
            json(row),
          ],
        );
      }
    },
  },
  {
    name: "purchase_requests",
    selectSql: "select payload from alpha_exchange.purchase_requests order by sort_index asc",
    values: (db) => db.purchaseRequests,
    insert: async (tx, rows: PurchaseRequest[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.purchase_requests
            (id, trade_id, listing_id, seller_id, buyer_id, status, timed_out_at, completed_at, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            row.id,
            row.tradeId ?? null,
            row.listingId,
            row.sellerId,
            row.buyerId,
            row.status,
            toTimestamp(row.timedOutAt),
            toTimestamp(row.completedAt),
            row.createdAt,
            row.updatedAt,
            index,
            json(row),
          ],
        );
      }
    },
  },
  {
    name: "notifications",
    selectSql: "select payload from alpha_exchange.notifications order by sort_index asc",
    values: (db) => db.notifications,
    insert: async (tx, rows: AlphaExchangeNotification[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.notifications
            (id, user_id, category, is_read, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [row.id, row.userId, row.category, row.isRead, row.createdAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "commissions",
    selectSql: "select payload from alpha_exchange.commissions order by sort_index asc",
    values: (db) => db.commissionRecords,
    insert: async (tx, rows: CommissionRecord[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.commissions
            (id, purchase_request_id, listing_id, seller_id, buyer_id, payment_status, due_at, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [row.id, row.purchaseRequestId, row.listingId, row.sellerId, row.buyerId, row.paymentStatus, toTimestamp(row.dueAt), row.createdAt, row.updatedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "audit_logs",
    selectSql: "select payload from alpha_exchange.audit_logs order by sort_index asc",
    values: (db) => db.auditLogs,
    insert: async (tx, rows: AuditLogEntry[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.audit_logs
            (id, action, actor_user_id, target_user_id, listing_id, purchase_request_id, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [row.id, row.action, row.actorUserId, row.targetUserId ?? null, row.listingId ?? null, row.purchaseRequestId ?? null, row.createdAt, index, json(row)],
        );
      }
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
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.sessions
            (token_hash, user_id, expires_at, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [row.token, row.userId, row.expiresAt, row.createdAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "password_reset_tokens",
    selectSql: "select payload from alpha_exchange.password_reset_tokens order by sort_index asc",
    values: (db) => db.passwordResetTokens,
    insert: async (tx, rows: PasswordResetToken[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.password_reset_tokens
            (id, user_id, token_hash, expires_at, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [row.id, row.userId, row.tokenHash, row.expiresAt, row.createdAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "seller_applications",
    selectSql: "select payload from alpha_exchange.seller_applications order by sort_index asc",
    values: (db) => db.sellerApplications,
    insert: async (tx, rows: SellerApplication[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.seller_applications
            (id, user_id, status, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [row.id, row.userId, row.status, row.createdAt, row.updatedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "activity_logs",
    selectSql: "select payload from alpha_exchange.activity_logs order by sort_index asc",
    values: (db) => db.activityLog,
    insert: async (tx, rows: AlphaExchangeActivityLogEntry[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.activity_logs
            (id, user_id, category, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [row.id, row.userId, row.category, row.createdAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "disputes",
    selectSql: "select payload from alpha_exchange.disputes order by sort_index asc",
    values: (db) => db.disputes,
    insert: async (tx, rows: TradeDisputeCase[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.disputes
            (id, trade_id, purchase_request_id, seller_id, buyer_id, status, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [row.id, row.tradeId, row.purchaseRequestId, row.sellerId, row.buyerId, row.status, row.createdAt, row.updatedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "seller_reports",
    selectSql: "select payload from alpha_exchange.seller_reports order by sort_index asc",
    values: (db) => db.sellerReports,
    insert: async (tx, rows: SellerReport[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.seller_reports
            (id, reporter_user_id, seller_id, purchase_request_id, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [row.id, row.reporterUserId, row.sellerId, row.purchaseRequestId ?? null, row.createdAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "trust_snapshots",
    selectSql: "select payload from alpha_exchange.trust_snapshots order by sort_index asc",
    values: (db) => db.trustSnapshots,
    insert: async (tx, rows: TrustSnapshotRecord[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.trust_snapshots
            (seller_id, updated_at, sort_index, payload)
           values ($1,$2,$3,$4::jsonb)`,
          [row.sellerId, row.updatedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "trust_score_history",
    selectSql: "select payload from alpha_exchange.trust_score_history order by sort_index asc",
    values: (db) => db.trustScoreHistory,
    insert: async (tx, rows: TrustScoreChangeLog[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.trust_score_history
            (id, seller_id, created_at, sort_index, payload)
           values ($1,$2,$3,$4,$5::jsonb)`,
          [row.id, row.sellerId, row.createdAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "private_beta_invites",
    selectSql: "select payload from alpha_exchange.private_beta_invites order by sort_index asc",
    values: (db) => db.privateBetaInvites,
    insert: async (tx, rows: PrivateBetaInviteCode[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.private_beta_invites
            (id, code, status, created_by_user_id, expires_at, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [row.id, row.code, row.status, row.createdByUserId, toTimestamp(row.expiresAt), row.createdAt, row.updatedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "private_beta_invite_uses",
    selectSql: "select payload from alpha_exchange.private_beta_invite_uses order by sort_index asc",
    values: (db) => db.privateBetaInviteUses,
    insert: async (tx, rows: PrivateBetaInviteUse[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.private_beta_invite_uses
            (id, invite_code_id, used_by_user_id, used_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [row.id, row.inviteCodeId, row.usedByUserId, row.usedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "beta_feedback",
    selectSql: "select payload from alpha_exchange.beta_feedback order by sort_index asc",
    values: (db) => db.betaFeedback,
    insert: async (tx, rows: BetaFeedbackEntry[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.beta_feedback
            (id, user_id, status, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [row.id, row.userId, row.status, row.createdAt, row.updatedAt, index, json(row)],
        );
      }
    },
  },
  {
    name: "beta_announcements",
    selectSql: "select payload from alpha_exchange.beta_announcements order by sort_index asc",
    values: (db) => db.betaAnnouncements,
    insert: async (tx, rows: BetaAnnouncement[]) => {
      for (const [index, row] of rows.entries()) {
        await tx.query(
          `insert into alpha_exchange.beta_announcements
            (id, type, is_active, created_by_user_id, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [row.id, row.type, row.isActive, row.createdByUserId, row.createdAt, row.updatedAt, index, json(row)],
        );
      }
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
  for (const [index, row] of rows.entries()) {
    await tx.query(
      `insert into alpha_exchange.users
        (id, email, role, seller_status, availability_status, online_status, created_at, updated_at, sort_index, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       on conflict (id) do update set
         email = excluded.email,
         role = excluded.role,
         seller_status = excluded.seller_status,
         availability_status = excluded.availability_status,
         online_status = excluded.online_status,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         sort_index = excluded.sort_index,
         payload = excluded.payload`,
      [row.id, row.email, row.role, row.sellerStatus, row.availabilityStatus, row.onlineStatus, row.createdAt, row.updatedAt, index, json(row)],
    );
  }
}

async function replaceTableContents(tx: PoolClient, tableName: string, db: AlphaExchangeDb) {
  await tx.query(`delete from alpha_exchange.${tableName}`);
  const table = getTable(tableName);
  await table.insert(tx, table.values(db), {
    evidenceContentById: new Map(),
    evidenceOverrides: undefined,
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

function snapshotFromTableRows(results: Array<{ rows: Array<{ payload: unknown }> }>): AlphaExchangeDb {
  const rowsAt = <T>(index: number) => results[index].rows as Array<{ payload: T }>;

  return {
    users: fromPayloadRows(rowsAt<AlphaExchangeUser>(0)),
    sellerApplications: fromPayloadRows(rowsAt<SellerApplication>(12)),
    marketplaceListings: fromPayloadRows(rowsAt<MarketplaceListing>(3)),
    purchaseRequests: fromPayloadRows(rowsAt<PurchaseRequest>(5)),
    commissionRecords: fromPayloadRows(rowsAt<CommissionRecord>(7)),
    auditLogs: fromPayloadRows(rowsAt<AuditLogEntry>(8)),
    authSessions: fromPayloadRows(rowsAt<AuthSession>(10)),
    passwordResetTokens: fromPayloadRows(rowsAt<PasswordResetToken>(11)),
    notifications: fromPayloadRows(rowsAt<AlphaExchangeNotification>(6)),
    activityLog: fromPayloadRows(rowsAt<AlphaExchangeActivityLogEntry>(13)),
    disputes: fromPayloadRows(rowsAt<TradeDisputeCase>(14)),
    sellerReports: fromPayloadRows(rowsAt<SellerReport>(15)),
    trustSnapshots: fromPayloadRows(rowsAt<TrustSnapshotRecord>(16)),
    trustScoreHistory: fromPayloadRows(rowsAt<TrustScoreChangeLog>(17)),
    tradeEvidenceFiles: fromPayloadRows(rowsAt<TradeEvidenceFile>(9)),
    privateBetaInvites: fromPayloadRows(rowsAt<PrivateBetaInviteCode>(18)),
    privateBetaInviteUses: fromPayloadRows(rowsAt<PrivateBetaInviteUse>(19)),
    betaFeedback: fromPayloadRows(rowsAt<BetaFeedbackEntry>(20)),
    betaAnnouncements: fromPayloadRows(rowsAt<BetaAnnouncement>(21)),
    sellerReviews: [],
  };
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

  return {
    ...latest,
    ...incoming,
    users: getCollection(incoming.users, latest.users),
    sellerApplications: getCollection(incoming.sellerApplications, latest.sellerApplications),
    marketplaceListings: getCollection(incoming.marketplaceListings, latest.marketplaceListings),
    purchaseRequests: mergedPurchaseRequests,
    commissionRecords: getCollection(incoming.commissionRecords, latest.commissionRecords),
    auditLogs: getCollection(incoming.auditLogs, latest.auditLogs),
    authSessions: latest.authSessions,
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
    sellerReviews: getCollection(incoming.sellerReviews, latest.sellerReviews),
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
    globalThis.__alphaExchangeMemorySnapshot = attachVersion(cloneSnapshot(DEFAULT_DB), 0);
  }
  if (!globalThis.__alphaExchangeMemoryEvidenceContent) {
    globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
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
          console.warn("[alpha-exchange-repository] Falling back to the in-memory snapshot because the database is unavailable:", error instanceof Error ? error.message : error);
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

  async loadSnapshot(): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      const snapshot = attachVersion(
        cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
        getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
      );
      logRepoVersionFlow("load:memory", {
        version: getVersion(snapshot),
        purchaseRequests: snapshot.purchaseRequests.length,
      });
      return snapshot;
    }
    try {
      const [meta, ...results] = await Promise.all([
        pool.query<{ version: string }>("select version::text as version from alpha_exchange.runtime_meta where singleton = true"),
        ...tables.map((table) => pool.query(table.selectSql)),
      ]);
      const snapshot = snapshotFromTableRows(results as Array<{ rows: Array<{ payload: unknown }> }>);

      const version = Number(meta.rows[0]?.version ?? "0");
      const withVersion = attachVersion(snapshot, version);
      logRepoVersionFlow("load:db", {
        version,
        purchaseRequests: withVersion.purchaseRequests.length,
      });
      return withVersion;
    } catch (error) {
      console.warn("[alpha-exchange-repository] Falling back to the in-memory snapshot because loading the database snapshot failed:", error instanceof Error ? error.message : error);
      ensureMemorySeed();
      const fallback = attachVersion(
        cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
        getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion),
      );
      logRepoVersionFlow("load:fallback-memory", {
        version: getVersion(fallback),
        purchaseRequests: fallback.purchaseRequests.length,
      });
      return fallback;
    }

  }

  async saveSnapshot(
    db: AlphaExchangeDb,
    options?: { evidenceOverrides?: EvidenceWriteMap; skipReadyCheck?: boolean; traceTag?: string },
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
        const nextSnapshot = cloneSnapshot(db);
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

    let client: PoolClient | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        client = await pool.connect();
        try {
          const logProfile = createRepositoryProfileLogger("saveSnapshot");
          console.log("[alpha-exchange-repository] saveSnapshot begin");
          await queryWithLogging(client, "begin");
          logProfile("begin");
          try {
            console.log("[alpha-exchange-repository] saveSnapshot advisory lock");
            await queryWithLogging(client, "select pg_advisory_xact_lock(61422917)");
            logProfile("advisory_lock");
          } catch {
            // pg-mem does not implement advisory locks; local tests stay single-process.
          }

          const loadedVersion = getVersion(db);
          console.log("[alpha-exchange-repository] saveSnapshot reading runtime meta");
          const currentMeta = await queryWithLogging(client,
            "select version::text as version from alpha_exchange.runtime_meta where singleton = true",
          );
          logProfile("read_runtime_meta");
          const currentVersion = Number(currentMeta?.rows?.[0]?.version ?? "0");
          console.log("[alpha-exchange-repository] saveSnapshot reading purchase request count");
          const currentRequestCount = await queryWithLogging(client,
            "select count(*)::text as count from alpha_exchange.purchase_requests",
          );
          logProfile("read_purchase_request_count");
          const currentRequests = Number(currentRequestCount?.rows?.[0]?.count ?? "0");

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
            const currentResults: Array<{ rows: Array<{ payload: unknown }> }> = [];
            for (const table of tables) {
              currentResults.push(await queryWithLogging(client, table.selectSql) as { rows: Array<{ payload: unknown }> });
            }
            const latestSnapshot = attachVersion(snapshotFromTableRows(currentResults), currentVersion);
            const mergedSnapshot = mergeSnapshotWithLatest(latestSnapshot, db);
            const mergedVersion = getVersion(mergedSnapshot);
            const nextVersion = currentVersion + 1;
            console.log("[alpha-exchange-repository] saveSnapshot loading evidence rows for merge");
            const evidenceRows = await queryWithLogging(client, "select id, content from alpha_exchange.evidence") as { rows?: Array<{ id: string; content: Buffer | null }> };
            logProfile("load_evidence_rows_merge");
            const evidenceContentById = new Map((evidenceRows.rows ?? []).map((row) => [row.id, row.content]));
            const persistedSnapshot = attachVersion(mergedSnapshot, nextVersion);
            console.log("[alpha-exchange-repository] saveSnapshot truncating tables for merge");
            await queryWithLogging(client, TRUNCATE_SQL);
            logProfile("truncate_tables_merge");
            for (const table of tables.filter((entry) => SNAPSHOT_TABLE_NAMES.has(entry.name))) {
              console.log("[alpha-exchange-repository] saveSnapshot inserting table", table.name);
              await table.insert(client, table.values(persistedSnapshot), {
                evidenceContentById,
                evidenceOverrides: options?.evidenceOverrides,
              });
            }
            logProfile("insert_tables_merge");
            console.log("[alpha-exchange-repository] saveSnapshot updating runtime meta for merge");
            await queryWithLogging(client,
              "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
              [nextVersion],
            );
            logProfile("update_runtime_meta_merge");
            logRepoVersionFlow("save:db:merged", {
              loadedVersion,
              currentVersion,
              mergedVersion,
              writtenVersion: nextVersion,
              purchaseRequests: persistedSnapshot.purchaseRequests.length,
            });
            attachVersion(db, nextVersion);
            await client.query("commit");
            logProfile("commit_merge");
            return;
          }

          console.log("[alpha-exchange-repository] saveSnapshot loading evidence rows");
          const evidenceRows = await client.query<{ id: string; content: Buffer | null }>("select id, content from alpha_exchange.evidence");
          logProfile("load_evidence_rows");
          const evidenceContentById = new Map((evidenceRows?.rows ?? []).map((row) => [row.id, row.content]));

          // Snapshot writes should not evict active auth sessions managed by dedicated session methods.
          const currentSessions = await queryWithLogging(client, "select payload from alpha_exchange.sessions order by sort_index asc") as { rows?: Array<{ payload: unknown }> };
          logProfile("load_sessions");
          const currentSessionRows = (currentSessions.rows ?? []) as Array<{ payload: AuthSession }>;
          const persistedSnapshot: AlphaExchangeDb = {
            ...db,
            authSessions: fromPayloadRows(currentSessionRows),
          };

          console.log("[alpha-exchange-repository] saveSnapshot truncating tables");
          await client.query(TRUNCATE_SQL);
          logProfile("truncate_tables");
          for (const table of tables.filter((entry) => SNAPSHOT_TABLE_NAMES.has(entry.name))) {
            console.log("[alpha-exchange-repository] saveSnapshot inserting table", table.name);
            await table.insert(client, table.values(persistedSnapshot), {
              evidenceContentById,
              evidenceOverrides: options?.evidenceOverrides,
            });
          }
          logProfile("insert_tables");

          const writtenVersion = currentVersion + 1;
          console.log("[alpha-exchange-repository] saveSnapshot updating runtime meta");
          await queryWithLogging(client,
            "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
            [writtenVersion],
          );
          logProfile("update_runtime_meta");

          logRepoVersionFlow("save:db:commit", {
            loadedVersion,
            previousVersion: currentVersion,
            writtenVersion,
            purchaseRequests: persistedSnapshot.purchaseRequests.length,
          });

          attachVersion(db, writtenVersion);
          await client.query("commit");
          logProfile("commit");
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

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await client.query("begin");
          await client.query("delete from alpha_exchange.sessions where user_id = $1", [session.userId]);
          const nextSortIndex = await client.query<{ next_index: string }>("select coalesce(max(sort_index), -1) + 1 as next_index from alpha_exchange.sessions");
          await client.query(
            `insert into alpha_exchange.sessions
              (token_hash, user_id, expires_at, created_at, sort_index, payload)
             values ($1,$2,$3,$4,$5,$6::jsonb)`,
            [session.token, session.userId, session.expiresAt, session.createdAt, Number(nextSortIndex.rows[0]?.next_index ?? "0"), json(session)],
          );
          await client.query("commit");
          return;
        } catch (error) {
          console.error("[alpha-exchange-repository] upsertAuthSession transaction error", error);
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            console.error("[alpha-exchange-repository] upsertAuthSession rollback error", rollbackError);
            // The transaction may already be aborted; move on with a fresh client.
          }
          if (isAbortedTransactionError(error) && attempt === 0) {
            client.release(true);
            client = await pool.connect();
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

  async getAuthSession(tokenHash: string) {
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      return (globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion).authSessions.find((item) => item.token === tokenHash) ?? null;
    }

    const result = await pool.query<{ payload: AuthSession }>(
      "select payload from alpha_exchange.sessions where token_hash = $1 limit 1",
      [tokenHash],
    );
    return result.rows[0]?.payload ?? null;
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

    await pool.query("delete from alpha_exchange.sessions where token_hash = $1", [tokenHash]);
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
    try {
      client = await pool.connect();
      await client.query("begin");

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
      }

      await client.query("commit");
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
  }
}

export async function getAlphaExchangeRepository() {
  if (!globalThis.__alphaExchangeRepositoryPromise) {
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(new AlphaExchangeRepository(getRuntimePostgresPool()));
  }
  return globalThis.__alphaExchangeRepositoryPromise;
}
