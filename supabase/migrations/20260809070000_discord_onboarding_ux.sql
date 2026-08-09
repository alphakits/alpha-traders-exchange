alter table alpha_exchange.discord_managed_resources
  drop constraint if exists discord_managed_resources_resource_key_check;

alter table alpha_exchange.discord_managed_resources
  add constraint discord_managed_resources_resource_key_check check (
    resource_key in (
      'start_here_category',
      'onboarding_welcome',
      'how_alpha_exchange_works',
      'buyer_guide',
      'become_a_seller',
      'seller_ranks_public',
      'seller_rules_public',
      'onboarding_support',
      'contact_owner',
      'seller_category',
      'seller_lounge',
      'seller_announcements',
      'seller_updates',
      'seller_chat',
      'seller_guides',
      'seller_ranks',
      'seller_rules',
      'seller_support',
      'share_your_success',
      'marketplace_category',
      'marketplace_listings',
      'market_activity',
      'live_market_pulse',
      'buyer_support'
    )
  ) not valid;

alter table alpha_exchange.discord_managed_resources
  validate constraint discord_managed_resources_resource_key_check;

alter table alpha_exchange.discord_interaction_claims
  drop constraint if exists discord_interaction_claims_command_name_check;

alter table alpha_exchange.discord_interaction_claims
  add constraint discord_interaction_claims_command_name_check check (
    command_name in (
      'market', 'profile', 'listing', 'share', 'website', 'help', 'pulse',
      'buy', 'seller', 'rank', 'rules', 'support', 'exchange'
    )
  ) not valid;

alter table alpha_exchange.discord_interaction_claims
  validate constraint discord_interaction_claims_command_name_check;

alter table alpha_exchange.discord_command_rate_limits
  drop constraint if exists discord_command_rate_limits_command_name_check;

alter table alpha_exchange.discord_command_rate_limits
  add constraint discord_command_rate_limits_command_name_check check (
    command_name in (
      'market', 'profile', 'listing', 'share', 'website', 'help', 'pulse',
      'buy', 'seller', 'rank', 'rules', 'support', 'exchange'
    )
  ) not valid;

alter table alpha_exchange.discord_command_rate_limits
  validate constraint discord_command_rate_limits_command_name_check;

alter table alpha_exchange.discord_interaction_audit
  drop constraint if exists discord_interaction_audit_command_name_check;

alter table alpha_exchange.discord_interaction_audit
  add constraint discord_interaction_audit_command_name_check check (
    command_name in (
      'market', 'profile', 'listing', 'share', 'website', 'help', 'pulse',
      'buy', 'seller', 'rank', 'rules', 'support', 'exchange'
    )
  ) not valid;

alter table alpha_exchange.discord_interaction_audit
  validate constraint discord_interaction_audit_command_name_check;

create table if not exists alpha_exchange.discord_onboarding_content (
  content_key text primary key check (content_key in (
    'welcome',
    'how_alpha_exchange_works',
    'buyer_guide',
    'become_a_seller',
    'seller_ranks_public',
    'seller_rules_public',
    'support',
    'contact_owner',
    'seller_dashboard_help',
    'seller_ranks',
    'seller_rules'
  )),
  channel_resource_key text not null unique check (channel_resource_key in (
    'onboarding_welcome',
    'how_alpha_exchange_works',
    'buyer_guide',
    'become_a_seller',
    'seller_ranks_public',
    'seller_rules_public',
    'onboarding_support',
    'contact_owner',
    'seller_guides',
    'seller_ranks',
    'seller_rules'
  )),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]{17,20}$'),
  message_id text check (message_id is null or message_id ~ '^[0-9]{17,20}$'),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'scheduled' check (
    state in ('scheduled', 'active', 'degraded')
  ),
  last_error_code text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, message_id)
);

insert into alpha_exchange.discord_onboarding_content (
  content_key,
  channel_resource_key
)
values
  ('welcome', 'onboarding_welcome'),
  ('how_alpha_exchange_works', 'how_alpha_exchange_works'),
  ('buyer_guide', 'buyer_guide'),
  ('become_a_seller', 'become_a_seller'),
  ('seller_ranks_public', 'seller_ranks_public'),
  ('seller_rules_public', 'seller_rules_public'),
  ('support', 'onboarding_support'),
  ('contact_owner', 'contact_owner'),
  ('seller_dashboard_help', 'seller_guides'),
  ('seller_ranks', 'seller_ranks'),
  ('seller_rules', 'seller_rules')
on conflict (content_key) do update set
  channel_resource_key = excluded.channel_resource_key,
  updated_at = now();
