alter table alpha_exchange.discord_managed_resources
  drop constraint if exists discord_managed_resources_resource_key_check;

alter table alpha_exchange.discord_managed_resources
  add constraint discord_managed_resources_resource_key_check check (
    resource_key in (
      'onboarding_category',
      'welcome',
      'how_alpha_exchange_works',
      'buyer_guide',
      'become_a_seller',
      'seller_ranks',
      'seller_rules',
      'support',
      'contact_owner',
      'seller_category',
      'seller_lounge',
      'seller_announcements',
      'seller_updates',
      'seller_chat',
      'seller_guides',
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
      'buy',
      'seller',
      'rank',
      'rules',
      'support',
      'exchange',
      'market',
      'profile',
      'listing',
      'share',
      'website',
      'help',
      'pulse'
    )
  ) not valid;

alter table alpha_exchange.discord_interaction_claims
  validate constraint discord_interaction_claims_command_name_check;

alter table alpha_exchange.discord_command_rate_limits
  drop constraint if exists discord_command_rate_limits_command_name_check;

alter table alpha_exchange.discord_command_rate_limits
  add constraint discord_command_rate_limits_command_name_check check (
    command_name in (
      'buy',
      'seller',
      'rank',
      'rules',
      'support',
      'exchange',
      'market',
      'profile',
      'listing',
      'share',
      'website',
      'help',
      'pulse'
    )
  ) not valid;

alter table alpha_exchange.discord_command_rate_limits
  validate constraint discord_command_rate_limits_command_name_check;

alter table alpha_exchange.discord_interaction_audit
  drop constraint if exists discord_interaction_audit_command_name_check;

alter table alpha_exchange.discord_interaction_audit
  add constraint discord_interaction_audit_command_name_check check (
    command_name in (
      'buy',
      'seller',
      'rank',
      'rules',
      'support',
      'exchange',
      'market',
      'profile',
      'listing',
      'share',
      'website',
      'help',
      'pulse'
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
    'seller_ranks',
    'seller_rules',
    'support',
    'contact_owner'
  )),
  channel_resource_key text not null check (channel_resource_key in (
    'welcome',
    'how_alpha_exchange_works',
    'buyer_guide',
    'become_a_seller',
    'seller_ranks',
    'seller_rules',
    'support',
    'contact_owner'
  )),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]{17,20}$'),
  message_id text check (message_id is null or message_id ~ '^[0-9]{17,20}$'),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  body_markdown text not null check (char_length(body_markdown) between 1 and 6000),
  state text not null default 'scheduled' check (state in ('scheduled', 'active', 'dead')),
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, message_id)
);

create index if not exists idx_discord_onboarding_content_state
  on alpha_exchange.discord_onboarding_content (state, updated_at);

insert into alpha_exchange.discord_onboarding_content (content_key, channel_resource_key, body_markdown)
values
  ('welcome', 'welcome', 'Welcome to Alpha Traders. Start with account linking and safe exchange flow.'),
  ('how_alpha_exchange_works', 'how_alpha_exchange_works', 'Alpha Exchange operates with website-verified identity, approved listing checks, and privacy-safe Discord guidance.'),
  ('buyer_guide', 'buyer_guide', 'Buyers should request trades only on the website and never post payment or wallet credentials in Discord.'),
  ('become_a_seller', 'become_a_seller', 'Seller applications are completed on the website from Account Settings after account linking.'),
  ('seller_ranks', 'seller_ranks', 'Seller ranks progress from bronze to elite based on completed lifetime volume under trust controls.'),
  ('seller_rules', 'seller_rules', 'Seller rules enforce approved listings, privacy boundaries, and no off-platform trade handling.'),
  ('support', 'support', 'Support is for onboarding guidance. Sensitive payment and identity data must remain off Discord.'),
  ('contact_owner', 'contact_owner', 'Escalate unresolved safety or account concerns through official owner contact channels.')
on conflict (content_key) do update set
  channel_resource_key = excluded.channel_resource_key,
  body_markdown = excluded.body_markdown,
  updated_at = now();
