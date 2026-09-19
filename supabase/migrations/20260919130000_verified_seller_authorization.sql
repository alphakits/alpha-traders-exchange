-- Approved Seller privileges require both the canonical seller status and the
-- durable administrator attestation created after ID, live-video, contact,
-- and marketplace-rules review. Status alone must never grant a Discord role.

create or replace function alpha_exchange.seller_approval_verification_complete(user_payload jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    jsonb_typeof(user_payload -> 'sellerApprovalVerification') = 'object'
    and user_payload #>> '{sellerApprovalVerification,method}' = 'manual_authorized_reviewer_v1'
    and user_payload #> '{sellerApprovalVerification,identityDocumentReviewed}' = 'true'::jsonb
    and user_payload #> '{sellerApprovalVerification,liveIdentityVideoReviewed}' = 'true'::jsonb
    and user_payload #> '{sellerApprovalVerification,contactOwnershipConfirmed}' = 'true'::jsonb
    and user_payload #> '{sellerApprovalVerification,marketplaceRulesAccepted}' = 'true'::jsonb
    and user_payload #>> '{sellerApprovalVerification,verifiedAt}'
      ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{3})?Z$'
    and nullif(btrim(user_payload #>> '{sellerApprovalVerification,verifiedByUserId}'), '') is not null,
    false
  )
$$;

-- Keep the legacy one-argument function fail-closed during a rolling deploy.
-- It can still express pending/suspended roles but cannot infer approval.
create or replace function alpha_exchange.discord_desired_seller_status(value text)
returns text
language sql
immutable
as $$
  select case value
    when 'pending_seller_approval' then 'pending'
    when 'suspended' then 'suspended'
    else 'none'
  end
$$;

create or replace function alpha_exchange.discord_desired_seller_status(
  value text,
  user_payload jsonb
)
returns text
language sql
immutable
as $$
  select case
    when value = 'approved_seller'
      and alpha_exchange.seller_approval_verification_complete(user_payload)
      then 'approved'
    when value = 'pending_seller_approval' then 'pending'
    when value = 'suspended' then 'suspended'
    else 'none'
  end
$$;

create or replace function alpha_exchange.enqueue_discord_seller_status_change()
returns trigger
language plpgsql
as $$
declare
  linked_discord_user_id text;
  desired text;
  reason_code text;
begin
  if old.seller_status is not distinct from new.seller_status
    and old.payload -> 'sellerApprovalVerification'
      is not distinct from new.payload -> 'sellerApprovalVerification'
  then
    return new;
  end if;

  select discord_user_id
    into linked_discord_user_id
    from alpha_exchange.discord_identities
   where platform_user_id = new.id;

  if linked_discord_user_id is null then
    return new;
  end if;

  desired := alpha_exchange.discord_desired_seller_status(
    new.seller_status,
    new.payload
  );
  reason_code := case
    when old.seller_status is distinct from new.seller_status
      then 'seller_status_changed'
    else 'seller_verification_changed'
  end;

  insert into alpha_exchange.discord_role_sync_outbox (
    platform_user_id,
    discord_user_id,
    desired_status,
    reason,
    dedupe_key
  )
  values (
    new.id,
    linked_discord_user_id,
    desired,
    reason_code,
    'seller-authorization:' || new.id || ':' || desired || ':' || new.updated_at::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end
$$;

drop trigger if exists enqueue_discord_seller_status_change on alpha_exchange.users;
create trigger enqueue_discord_seller_status_change
after update of seller_status, payload on alpha_exchange.users
for each row
execute function alpha_exchange.enqueue_discord_seller_status_change();

-- Reconcile every existing link once so legacy status-only Approved Seller
-- roles are removed promptly and verified sellers retain the correct role.
insert into alpha_exchange.discord_role_sync_outbox (
  platform_user_id,
  discord_user_id,
  desired_status,
  reason,
  dedupe_key
)
select identity.platform_user_id,
       identity.discord_user_id,
       alpha_exchange.discord_desired_seller_status(users.seller_status, users.payload),
       'verification_policy_migration',
       'verified-seller-authorization-v1:' || identity.platform_user_id
  from alpha_exchange.discord_identities identity
  join alpha_exchange.users users on users.id = identity.platform_user_id
on conflict (dedupe_key) do nothing;
