alter table alpha_exchange.discord_managed_resources
  drop constraint if exists discord_managed_resources_resource_key_check;

alter table alpha_exchange.discord_managed_resources
  add constraint discord_managed_resources_resource_key_check check (
    resource_key in (
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
