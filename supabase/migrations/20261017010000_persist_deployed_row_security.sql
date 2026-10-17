-- Preserve row-security and reconciliation-index settings observed in production.
-- Idempotent on existing deployments; restores the same privacy boundary on a clean database.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table admin_cms.lesson_versions enable row level security;
alter table admin_cms.lessons enable row level security;
alter table admin_cms.media_items enable row level security;
alter table alpha_exchange.activity_logs enable row level security;
alter table alpha_exchange.audit_logs enable row level security;
alter table alpha_exchange.beta_announcements enable row level security;
alter table alpha_exchange.beta_feedback enable row level security;
alter table alpha_exchange.commissions enable row level security;
alter table alpha_exchange.disputes enable row level security;
alter table alpha_exchange.evidence enable row level security;
alter table alpha_exchange.listings enable row level security;
alter table alpha_exchange.notifications enable row level security;
alter table alpha_exchange.password_reset_tokens enable row level security;
alter table alpha_exchange.private_beta_invite_uses enable row level security;
alter table alpha_exchange.private_beta_invites enable row level security;
alter table alpha_exchange.purchase_requests enable row level security;
alter table alpha_exchange.runtime_meta enable row level security;
alter table alpha_exchange.seller_applications enable row level security;
alter table alpha_exchange.seller_profiles enable row level security;
alter table alpha_exchange.seller_reports enable row level security;
alter table alpha_exchange.seller_settings enable row level security;
alter table alpha_exchange.sessions enable row level security;
alter table alpha_exchange.trades enable row level security;
alter table alpha_exchange.trust_score_history enable row level security;
alter table alpha_exchange.trust_snapshots enable row level security;
alter table alpha_exchange.users enable row level security;

create index if not exists idx_alpha_exchange_notifications_trust_reconciliation
  on alpha_exchange.notifications (user_id, category, created_at desc);

commit;

