-- One verified phone per account; only the three authorized existing accounts
-- may share an unverified private contact. Never fabricate OTP verification.
lock table alpha_exchange.users in share row exclusive mode;

create or replace function alpha_exchange.canonical_user_phone(phone text)
returns text language sql immutable strict set search_path = '' as $$
  with clean as (
    select regexp_replace(
      translate(btrim(phone), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '[[:space:]().-]', '', 'g'
    ) as value
    where length(btrim(phone)) between 1 and 30
      and translate(btrim(phone), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
        ~ '^[+0-9[:space:]().-]+$'
  ), canonical as (
    select case
      when value ~ '^05[0-9]{8}$' then '+972' || substr(value, 2)
      when value ~ '^9725[0-9]{8}$' then '+' || value
      when left(value, 2) = '00' then '+' || substr(value, 3)
      else value end as value
    from clean
  ) select value from canonical where value ~ '^\+[1-9][0-9]{7,14}$';
$$;
revoke all on function alpha_exchange.canonical_user_phone(text) from public, anon, authenticated;
grant execute on function alpha_exchange.canonical_user_phone(text) to service_role;

create table if not exists alpha_exchange.phone_verification_reconciliations (
  user_id text primary key,
  verified_phone text not null,
  phone_verified_at text,
  reconciled_at timestamptz not null default now(),
  reason text not null default 'duplicate_phone'
);
alter table alpha_exchange.phone_verification_reconciliations enable row level security;
revoke all on alpha_exchange.phone_verification_reconciliations from public, anon, authenticated;

-- Preserve the first verification; retire later duplicates without deleting
-- accounts, contact numbers, sessions, trades, roles, or seller history.
with ranked as (
  select id, payload, row_number() over (
    partition by alpha_exchange.canonical_user_phone(payload->>'verifiedPhone')
    order by case when payload->>'phoneVerifiedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      then payload->>'phoneVerifiedAt' end asc nulls last, created_at asc, id asc
  ) as position
  from alpha_exchange.users
  where alpha_exchange.canonical_user_phone(payload->>'verifiedPhone') is not null
)
insert into alpha_exchange.phone_verification_reconciliations(user_id, verified_phone, phone_verified_at)
select id, payload->>'verifiedPhone', payload->>'phoneVerifiedAt' from ranked where position > 1
on conflict (user_id) do nothing;

update alpha_exchange.users u set
  payload = (u.payload - array['verifiedPhone', 'phoneVerifiedAt', 'phoneOtpHash',
    'phoneOtpSalt', 'phoneOtpPhone', 'phoneOtpChannel', 'phoneOtpExpiresAt', 'phoneOtpAttempts'])
    || jsonb_build_object('buyerVerificationStatus', 'not_started', 'updatedAt', now()),
  updated_at = now()
from alpha_exchange.phone_verification_reconciliations r
where r.user_id = u.id and u.payload->>'verifiedPhone' = r.verified_phone
  and exists (select 1 from alpha_exchange.users other where other.id <> u.id
    and alpha_exchange.canonical_user_phone(other.payload->>'verifiedPhone')
      = alpha_exchange.canonical_user_phone(r.verified_phone));

create unique index if not exists users_verified_phone_unique
on alpha_exchange.users (alpha_exchange.canonical_user_phone(payload->>'verifiedPhone'));

create or replace function alpha_exchange.enforce_unique_contact_phone()
returns trigger language plpgsql set search_path = '' as $$
declare next_phone text; previous_phone text;
begin
  next_phone := alpha_exchange.canonical_user_phone(new.payload->>'whatsappNumber');
  if next_phone is null then return new; end if;
  if tg_op = 'UPDATE' then
    previous_phone := alpha_exchange.canonical_user_phone(old.payload->>'whatsappNumber');
  else
    -- The runtime writes existing users with INSERT ... ON CONFLICT UPDATE.
    select alpha_exchange.canonical_user_phone(payload->>'whatsappNumber')
      into previous_phone from alpha_exchange.users where id = new.id;
  end if;
  if previous_phone = next_phone then return new; end if;
  if coalesce(new.payload->>'disabled', 'false') <> 'true' and exists (
    select 1 from (values
      ('user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a', 'alphatradersai@gmail.com'),
      ('user-6f3a0120-5d36-423f-8dee-9a875e8e064e', 'claudiahttps11@gmail.com'),
      ('user-cfa3bd2c-25e7-4a9e-9ae5-55ac4900846f', 'jozenmark834@yahoo.com')
    ) as allowed(user_id, email)
    where allowed.user_id = new.id and allowed.email = lower(btrim(new.email))
  ) then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alpha_exchange.contact:' || next_phone, 0));
  if exists (select 1 from alpha_exchange.users other where other.id <> new.id and (
    alpha_exchange.canonical_user_phone(other.payload->>'whatsappNumber') = next_phone
    or alpha_exchange.canonical_user_phone(other.payload->>'verifiedPhone') = next_phone
  )) then
    raise exception 'This phone number is already linked to another account.'
      using errcode = '23505', constraint = 'users_contact_phone_unique';
  end if;
  return new;
end;
$$;
revoke all on function alpha_exchange.enforce_unique_contact_phone() from public, anon, authenticated;
drop trigger if exists enforce_unique_contact_phone on alpha_exchange.users;
create trigger enforce_unique_contact_phone before insert or update of payload, email
on alpha_exchange.users for each row execute function alpha_exchange.enforce_unique_contact_phone();

update alpha_exchange.runtime_meta set version = version + 1, updated_at = now() where singleton = true;
