-- A trust recalculation previously issued a fresh "Flagged seller" notification
-- once per Israel calendar day for every seller who remained below the risk
-- threshold. If the owner had already acknowledged the same seller alert, the
-- new row made that old condition look unread again. Reconcile only those
-- legacy reissues and the same-request burst they created; genuine transition
-- notifications use the durable reason added with the application fix and are
-- intentionally excluded.

with flagged_alerts as (
  select
    notification.id,
    notification.user_id,
    notification.created_at,
    coalesce(
      nullif(notification.payload ->> 'relatedSellerUsername', ''),
      nullif(notification.payload ->> 'relatedSellerName', ''),
      lower(regexp_replace(notification.payload ->> 'title', '^flagged seller:[[:space:]]*', '', 'i'))
    ) as seller_key,
    coalesce(
      nullif(notification.payload ->> 'state', ''),
      case when notification.is_read then 'read' else 'unread' end
    ) as notification_state,
    coalesce(notification.payload ->> 'reason', '') as reason
  from alpha_exchange.notifications as notification
  join alpha_exchange.users as owner_user
    on owner_user.id = notification.user_id
  where notification.category = 'trust'
    and lower(coalesce(notification.payload ->> 'title', '')) like 'flagged seller:%'
    and (
      owner_user.role = 'owner'
      or coalesce(owner_user.payload -> 'roles', '[]'::jsonb) @> '["owner"]'::jsonb
    )
), resurrected_alerts as (
  select candidate.id
  from flagged_alerts as candidate
  where candidate.notification_state = 'unread'
    and candidate.reason <> 'seller_entered_flagged_state'
    and candidate.seller_key is not null
    and (
      exists (
        select 1
        from flagged_alerts as acknowledged
        where acknowledged.user_id = candidate.user_id
          and acknowledged.seller_key = candidate.seller_key
          and acknowledged.id <> candidate.id
          and acknowledged.created_at <= candidate.created_at
          and acknowledged.notification_state in ('read', 'archived')
      )
      or exists (
        select 1
        from flagged_alerts as burst_peer
        where burst_peer.user_id = candidate.user_id
          and burst_peer.id <> candidate.id
          and burst_peer.reason <> 'seller_entered_flagged_state'
          and burst_peer.created_at between candidate.created_at - interval '5 minutes'
            and candidate.created_at + interval '5 minutes'
      )
    )
), repaired as (
  update alpha_exchange.notifications as notification
  set
    is_read = true,
    payload = jsonb_set(
      jsonb_set(
        jsonb_set(notification.payload, '{isRead}', 'true'::jsonb, true),
        '{state}',
        '"read"'::jsonb,
        true
      ),
      '{updatedAt}',
      to_jsonb(now()::text),
      true
    )
  where notification.id in (select id from resurrected_alerts)
  returning notification.id
)
update alpha_exchange.runtime_meta
set version = version + 1,
    updated_at = now()
where singleton = true
  and exists (select 1 from repaired);
