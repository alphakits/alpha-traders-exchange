-- Run once, only as part of the owner-approved fresh-start release.
-- Deletes old traffic analytics, not users, sessions, trades or payments.
-- Retries retain the original boundary and never remove the new period's data.
begin;
lock table alpha_exchange.traffic_events in share row exclusive mode;

insert into alpha_exchange.owner_analytics_periods (id, started_at)
values ('unique-visitors-v1', clock_timestamp())
on conflict (id) do nothing;

delete from alpha_exchange.traffic_events e
using alpha_exchange.owner_analytics_periods p
where p.id = 'unique-visitors-v1' and e.occurred_at < p.started_at;

select started_at::text as reporting_started_at
from alpha_exchange.owner_analytics_periods where id = 'unique-visitors-v1';
commit;
