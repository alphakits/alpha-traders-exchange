import { Pool, type PoolClient } from "pg";
import alphaExchangeSeed from "../../data/alpha-exchange-db.json";
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

const TRUNCATE_SQL = `truncate table
  alpha_exchange.beta_announcements,
  alpha_exchange.beta_feedback,
  alpha_exchange.private_beta_invite_uses,
  alpha_exchange.private_beta_invites,
  alpha_exchange.trust_score_history,
  alpha_exchange.trust_snapshots,
  alpha_exchange.seller_reports,
  alpha_exchange.disputes,
  alpha_exchange.activity_logs,
  alpha_exchange.seller_applications,
  alpha_exchange.password_reset_tokens,
  alpha_exchange.sessions,
  alpha_exchange.evidence,
  alpha_exchange.audit_logs,
  alpha_exchange.commissions,
  alpha_exchange.notifications,
  alpha_exchange.trades,
  alpha_exchange.purchase_requests,
  alpha_exchange.listings,
  alpha_exchange.seller_settings,
  alpha_exchange.seller_profiles,
  alpha_exchange.users restart identity`;

const DEFAULT_DB = alphaExchangeSeed as AlphaExchangeDb;

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

function getConnectionString() {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
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

function attachVersion<T extends AlphaExchangeDb>(db: T, version: number): SnapshotWithVersion {
  Object.defineProperty(db, "__runtimeVersion", {
    value: version,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return db as SnapshotWithVersion;
}

function getVersion(db: AlphaExchangeDb) {
  return (db as SnapshotWithVersion).__runtimeVersion ?? 0;
}

async function runSchema(target: Queryable) {
  for (const statement of SCHEMA_SQL) {
    await target.query(statement);
  }
  await target.query(
    "insert into alpha_exchange.runtime_meta (singleton, version, updated_at) values (true, 0, now()) on conflict (singleton) do nothing",
  );
}

function createDbPool() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    return null;
  }

  return new Pool({
    connectionString,
    ssl: process.env.SUPABASE_DB_SSL === "false" ? undefined : { rejectUnauthorized: false },
    max: 10,
  });
}

function ensureMemorySeed() {
  if (!globalThis.__alphaExchangeMemorySnapshot) {
    globalThis.__alphaExchangeMemorySnapshot = attachVersion(cloneSnapshot(DEFAULT_DB), 0);
  }
  if (!globalThis.__alphaExchangeMemoryEvidenceContent) {
    globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
  }
}

export class AlphaExchangeRepository {
  private readonly pool: Pool | null;
  private readonly usesMemoryFallback: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(pool: Pool | null) {
    this.pool = pool;
    this.usesMemoryFallback = pool === null;
  }

  async ensureReady() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        if (this.usesMemoryFallback || !this.pool) {
          ensureMemorySeed();
          return;
        }
        await runSchema(this.pool);
        const usersCount = await this.pool.query<{ count: string }>("select count(*)::text as count from alpha_exchange.users");
        const shouldSeed = usersCount.rows[0]?.count === "0" && process.env.NODE_ENV !== "production";
        if (shouldSeed) {
          await this.saveSnapshot(DEFAULT_DB, { skipReadyCheck: true });
        }
      })();
    }
    await this.initPromise;
  }

  async healthCheck() {
    await this.ensureReady();
    if (this.usesMemoryFallback || !this.pool) {
      return "ok" as const;
    }
    await this.pool.query("select 1");
    return "ok" as const;
  }

  async loadSnapshot(): Promise<SnapshotWithVersion> {
    await this.ensureReady();
    if (this.usesMemoryFallback || !this.pool) {
      ensureMemorySeed();
      return attachVersion(cloneSnapshot(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion), getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion));
    }
    const [meta, ...results] = await Promise.all([
      this.pool.query<{ version: string }>("select version::text as version from alpha_exchange.runtime_meta where singleton = true"),
      ...tables.map((table) => this.pool.query(table.selectSql)),
    ]);

    const snapshot: AlphaExchangeDb = {
      users: fromPayloadRows(results[0].rows),
      sellerApplications: fromPayloadRows(results[12].rows),
      marketplaceListings: fromPayloadRows(results[3].rows),
      purchaseRequests: fromPayloadRows(results[5].rows),
      commissionRecords: fromPayloadRows(results[7].rows),
      auditLogs: fromPayloadRows(results[8].rows),
      authSessions: fromPayloadRows(results[10].rows),
      passwordResetTokens: fromPayloadRows(results[11].rows),
      notifications: fromPayloadRows(results[6].rows),
      activityLog: fromPayloadRows(results[13].rows),
      disputes: fromPayloadRows(results[14].rows),
      sellerReports: fromPayloadRows(results[15].rows),
      trustSnapshots: fromPayloadRows(results[16].rows),
      trustScoreHistory: fromPayloadRows(results[17].rows),
      tradeEvidenceFiles: fromPayloadRows(results[9].rows),
      privateBetaInvites: fromPayloadRows(results[18].rows),
      privateBetaInviteUses: fromPayloadRows(results[19].rows),
      betaFeedback: fromPayloadRows(results[20].rows),
      betaAnnouncements: fromPayloadRows(results[21].rows),
    };

    return attachVersion(snapshot, Number(meta.rows[0]?.version ?? "0"));
  }

  async saveSnapshot(
    db: AlphaExchangeDb,
    options?: { evidenceOverrides?: EvidenceWriteMap; skipReadyCheck?: boolean },
  ) {
    if (this.usesMemoryFallback || !this.pool) {
      ensureMemorySeed();
      const next = attachVersion(cloneSnapshot(db), getVersion(globalThis.__alphaExchangeMemorySnapshot as SnapshotWithVersion) + 1);
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
      return;
    }

    if (!options?.skipReadyCheck) {
      await this.ensureReady();
    } else {
      await runSchema(this.pool);
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock(61422917)");
      } catch {
        // pg-mem does not implement advisory locks; local tests stay single-process.
      }

      const evidenceRows = await client.query<{ id: string; content: Buffer | null }>("select id, content from alpha_exchange.evidence");
      const evidenceContentById = new Map(evidenceRows.rows.map((row) => [row.id, row.content]));

      await client.query(TRUNCATE_SQL);
      for (const table of tables) {
        await table.insert(client, table.values(db), {
          evidenceContentById,
          evidenceOverrides: options?.evidenceOverrides,
        });
      }

      await client.query(
        "update alpha_exchange.runtime_meta set version = $1, updated_at = now() where singleton = true",
        [getVersion(db) + 1],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async readEvidenceContent(evidenceId: string) {
    await this.ensureReady();
    if (this.usesMemoryFallback || !this.pool) {
      ensureMemorySeed();
      return globalThis.__alphaExchangeMemoryEvidenceContent?.get(evidenceId) ?? null;
    }
    const result = await this.pool.query<{ content: Buffer | null }>(
      "select content from alpha_exchange.evidence where id = $1",
      [evidenceId],
    );
    return result.rows[0]?.content ?? null;
  }
}

export async function getAlphaExchangeRepository() {
  if (!globalThis.__alphaExchangeRepositoryPromise) {
    globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(new AlphaExchangeRepository(createDbPool()));
  }
  return globalThis.__alphaExchangeRepositoryPromise;
}
