-- Manual seller commissions use the same payable/TRC20 engine as trade fees,
-- but have no trade, listing, or buyer to reference. Keep the seller identity
-- required while allowing the unrelated linkage columns to be null.
alter table alpha_exchange.commissions
  alter column purchase_request_id drop not null,
  alter column listing_id drop not null,
  alter column buyer_id drop not null;

create index if not exists idx_alpha_exchange_commissions_seller_status
  on alpha_exchange.commissions (seller_id, payment_status, due_at);

-- Public marketplace reads use this small partial index to hide every listing
-- belonging to a seller with any unpaid commission without loading all
-- exchange tables.
create index if not exists idx_alpha_exchange_commissions_unpaid_seller
  on alpha_exchange.commissions (seller_id)
  where payment_status <> 'paid';
