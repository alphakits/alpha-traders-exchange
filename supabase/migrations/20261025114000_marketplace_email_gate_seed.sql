-- Schema-only restores of the runtime baseline need the delivery singleton.
-- Preserve any existing provider cooldown and all queued delivery records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into alpha_exchange.marketplace_email_gate(singleton)
values (true)
on conflict do nothing;

commit;
