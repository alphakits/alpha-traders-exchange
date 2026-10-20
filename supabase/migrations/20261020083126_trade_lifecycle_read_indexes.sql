-- Lifecycle mutations read global event ordering bounds while holding the
-- financial lock. Avoid scanning growing histories for each MIN/MAX pair.
-- Short lock/statement budgets make a busy deployment fail safely for retry.
set local lock_timeout = '500ms';
set local statement_timeout = '10s';

create index if not exists idx_alpha_exchange_notifications_sort on alpha_exchange.notifications (sort_index);
create index if not exists idx_alpha_exchange_audit_logs_sort on alpha_exchange.audit_logs (sort_index);
create index if not exists idx_alpha_exchange_activity_logs_sort on alpha_exchange.activity_logs (sort_index);
create index if not exists idx_alpha_exchange_evidence_sort on alpha_exchange.evidence (sort_index);
create index if not exists idx_alpha_exchange_sms_deliveries_sort on alpha_exchange.sms_deliveries (sort_index);

-- Match the existing per-trade filters and ordering without loading other
-- trades' notification/audit histories. No financial or permission rules change.
create index if not exists idx_alpha_exchange_notifications_request_sort on alpha_exchange.notifications ((payload->>'relatedRequestId'), sort_index);
create index if not exists idx_alpha_exchange_audit_logs_request_sort on alpha_exchange.audit_logs (purchase_request_id, sort_index);
