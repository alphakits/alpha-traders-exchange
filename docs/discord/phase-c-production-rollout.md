# Phase C Discord Stack: Production Rollout, Rollback, and Acceptance

This guide closes the C1-C5 stack. It is an operations plan only. Do not merge,
deploy, migrate production, or change Discord Developer Portal settings while
reviewing this document.

## Non-negotiable boundaries

- Railway is the only runtime that owns `discord.js`, the gateway connection,
  Discord REST mutations, reconciliation, and integration job processing.
- Vercel may read privacy-safe aggregates, verify signed Railway diagnostics, and
  enqueue bounded durable operator work. It must never call Discord directly.
- Keep the OAuth permission bitset exactly `268528656`.
- Do not add webhooks, cooldown reset controls, seller role overrides, listing
  state controls, raw delete buttons, or arbitrary Discord user/channel/message
  inputs.
- Begin from clean, committed, pushed source. Record the exact Vercel and Railway
  source SHAs. Never deploy a dirty worktree or an unreviewed local build.

## Feature ownership and lifecycle

| Layer | Feature | Authoritative state | Mutation owner | Durable lifecycle |
| --- | --- | --- | --- | --- |
| Layer A/B | Identity, roles, signed worker health, job foundations | Website users, Discord identity records, role outbox | Railway | pending → processing → completed/dead |
| C1 | Managed category/channel topology and permissions | Managed resource definitions and resource rows | Railway | pending/degraded → ready, lease-fenced reconciliation |
| C2 | Premium listing embeds, updates, SOLD/deletion lifecycle, share cooldown | Website listing state and listing mapping/outbox | Railway | queued/publishing/active/update/delete/SOLD/deleted/failed |
| C3 | Live pulse, market activity, weekly leaderboard, seller profile cards | Website marketplace/trust data and singleton content rows | Railway | scheduled → processing → active/dead |
| C4 | Welcome/approval DMs and guild commands | Website identity/seller state, notification rows, command definitions | Railway | pending → processing → delivered/suppressed/dead; command reconciliation |
| C5 | Private management dashboard and safe reconciliation request | Safe DB aggregates, signed worker readiness, operator request/audit rows | Website enqueues; Railway processes | pending → processing → completed/dead with lease fence |

The website remains authoritative for seller approval, listing state, cooldown
eligibility, public profile eligibility, and marketplace data. Discord is a
projection and interaction surface, never an alternate source of truth.

## Preflight

1. Confirm C1-C5 reviews and CI are complete and each PR targets the preceding
   layer. Confirm the C5 base is C4 PR #35.
2. Confirm the source checkout is clean and all deployment SHAs are committed and
   pushed.
3. Confirm Railway and Vercel share the expected database and signed health
   secret, without printing either value.
4. Confirm the Railway service has a single replica for the initial rollout.
   Do not scale above one until lease/fencing and gateway ownership are observed.
5. In Discord Developer Portal, enable the **Guild Members privileged intent**.
   C4 welcome delivery depends on it. Leave the OAuth permission bitset at
   `268528656`.
6. Confirm the bot is installed only in the intended guild and no webhook-based
   integration exists.

## Migration order

Apply forward-only migrations in this exact timestamp order:

1. `20260807000000_discord_identity_sync.sql`
2. `20260807190000_discord_seller_resources.sql`
3. `20260807210000_discord_resource_reconciliation_lease.sql`
4. `20260808030000_discord_listing_sharing.sql`
5. `20260808070000_discord_channel_topology.sql`
6. `20260808100000_discord_market_intelligence.sql`
7. `20260808140000_discord_community_interactions.sql`
8. `20260808170000_discord_management_dashboard.sql`

Apply migrations before either C5 runtime. Verify each migration completed once.
Do not edit applied migrations, delete durable rows to force recovery, or reverse
schema changes during rollback.

## Deployment sequence

1. Enable and verify the Guild Members intent.
2. Apply all migrations above.
3. Deploy the reviewed C5 SHA to **one Railway replica**.
4. Wait for generic `/health/live` to report only `{"status":"alive"}`.
5. Through an authenticated signed probe, verify `/health/ready` returns a fresh,
   request-nonce-bound response signature, expected source revision, gateway
   readiness, 13/13 managed resources, 7/7 commands, and no private payloads.
6. Confirm startup command reconciliation completed and the expected commands are
   registered. Do not run an unrelated local registration script against
   production.
7. Confirm the Railway worker is processing existing role, listing, market
   content, and notification queues without stale leases or increasing dead jobs.
8. Deploy the same reviewed C5 source lineage to Vercel.
9. Sign in as an authoritative admin/owner and open Discord Management. Confirm
   the signed worker revision and safe database aggregates agree with the Railway
   deployment.
10. Enqueue at most one managed reconciliation from the dashboard. Confirm the UI
    shows accepted or coalesced, then processing, then completed with
    `reconciliation_completed`. If downstream work remains, the request returns
    to pending with `downstream_processing` without consuming a failure attempt.
11. Keep Railway at one replica through the acceptance window. Scale only after
    gateway ownership and all lease/fence metrics remain stable.

Railway must precede Vercel for C5 because the C5 website requires signed response
authentication from the worker. A C5 Vercel deployment against an older worker
will correctly report offline rather than fabricate healthy diagnostics.

## Safe live probes

- Unauthenticated liveness returns only `alive`; no guild, bot, deployment, or
  queue details.
- Unauthenticated, buyer, and seller requests to the management APIs are denied.
- An authenticated admin/owner diagnostics response contains aggregate counts,
  safe status names, safe error codes/timestamps, command names, and topology
  display names only.
- Tampered, stale, replayed, nonce-mismatched, or unsigned readiness responses are
  rejected.
- A cross-origin or malformed reconciliation request is denied.
- Repeated reconciliation requests coalesce to one active request and create
  durable audit events.
- No probe accepts Discord IDs, email addresses, raw embeds, raw provider payloads,
  secrets, internal record IDs, cooldown resets, SOLD recreation, or deletes.

## Acceptance checklist

### C1 channels and permissions

- [ ] Seller and marketplace categories exist once with the reviewed names/order.
- [ ] All 13 managed resources report ready; missing and degraded are zero.
- [ ] Seller-only channels deny unapproved members and allow the intended seller access.
- [ ] Public bot-only feeds deny member posting; buyer support retains intended public access.
- [ ] Reconciliation is idempotent and does not adopt or delete unrelated channels.

### C2 listing embeds and SOLD lifecycle

- [ ] Eligible active listings publish the premium embed once with safe mentions.
- [ ] Authoritative website edits update the owned message.
- [ ] SOLD transitions update the existing owned message and never recreate SOLD content.
- [ ] Deletion/expiry removes or updates only the integration-owned mapped message.
- [ ] Twelve-hour cooldown claims remain authoritative and cannot be reset from Discord or C5.

### C3 pulse, activity, leaderboard, and profiles

- [ ] Live market pulse has one owned active singleton.
- [ ] Market activity digest has one owned active singleton.
- [ ] Weekly top sellers has one owned active singleton.
- [ ] Last-success timestamps advance and dead/stale states remain zero.
- [ ] Seller profile cards expose only eligible public website data.

### C4 DMs and commands

- [ ] Guild Members privileged intent is enabled before worker startup.
- [ ] Welcome DM delivery records progress to delivered or explicit suppressed/dead states.
- [ ] Approved Seller DM delivery uses current authoritative seller state.
- [ ] `/market`, `/profile`, `/listing`, `/share`, `/website`, `/help`, and `/pulse` are registered.
- [ ] Commands are guild-scoped, ephemeral where required, replay protected, and rate limited.
- [ ] Discord commands do not publish listings, bypass cooldowns, or mutate seller/listing state.

### C5 dashboard and controls

- [ ] Admin and owner can access the page; seller, buyer, and unauthenticated users cannot.
- [ ] Worker, resource, identity/role, listing, queue, singleton, DM, command, and safe-error cards load.
- [ ] The response contains no raw Discord IDs, emails, internal IDs, raw embeds/payloads, or secrets.
- [ ] Layout has no horizontal overflow at 320, 390, 430, and desktop widths.
- [ ] Polling pauses while hidden, resumes when visible, and backs off after failures.
- [ ] Reconciliation requires confirmation, is rate limited, coalesces, audits, and shows durable state.
- [ ] No generic dead-job retry, cooldown reset, role override, listing mutation, raw delete, or arbitrary target exists.

## Rollback boundaries

Rollback code by layer; never roll schema backward:

| Boundary | Website rollback | Railway rollback | Durable state |
| --- | --- | --- | --- |
| C5 issue | Roll Vercel back to C4 first | Then roll Railway back to C4 | Leave C5 request/audit and interaction-audit tables; C4 ignores them |
| C4 issue | Roll website command/DM surfaces to C3 | Roll worker to C3 after Vercel | Leave notification/command rows for forensic review; do not resend suppressed DMs |
| C3 issue | Roll website profile/pulse consumers to C2 | Roll worker to C2 | Leave singleton rows; stop refresh rather than deleting owned messages manually |
| C2 issue | Disable website share entry using reviewed rollback | Roll worker to C1 | Preserve listing mappings/outbox/cooldowns; never reset cooldown or recreate SOLD |
| C1 issue | Keep public website independent of managed channels | Stop/roll worker to Layer B | Preserve resource ownership rows; do not delete channels from the dashboard |

If signed diagnostics fail after Railway rollback, the C5 dashboard must remain
offline/degraded until Vercel is also rolled back. That is an intentional
fail-closed boundary.

## Incident and data-loss guardrails

- Stop the Railway worker before investigating a suspected duplicate gateway owner.
- Preserve operator, listing, notification, market content, role sync, and audit
  rows. Do not “repair” by deleting queues or resetting attempts.
- Do not manually delete managed Discord content unless the reviewed rollback for
  that exact owned resource requires it.
- Do not retry permanent DM suppression or dead jobs from generic SQL. Resolve the
  safe error code and authoritative website state first.
- Record source SHA, deployment time, safe error codes, and rollback boundary.
  Never paste secrets, raw Discord payloads, emails, wallets, or private IDs into
  incident notes.
