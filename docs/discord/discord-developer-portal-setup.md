# Alpha Traders Discord Developer Portal Setup Guide

This guide sets up a brand-new Discord application and bot for your existing Alpha Traders Discord server, then runs the inspection workflow.

## Prerequisites

- You are server owner (or have Administrator) in your target Discord server.
- You are logged into Discord in a browser.
- Node.js and npm are installed locally.

## 1) Create the Discord Application

1. Open Discord Developer Portal:
   https://discord.com/developers/applications
2. Click New Application.
3. Name it: Alpha Traders Bot.
4. Open the General Information tab.
5. Copy and save Application ID. This value is your DISCORD_APPLICATION_ID.

## 2) Create the Bot User

1. In the left menu, open Bot.
2. Click Add Bot, then confirm.
3. Bot settings:
   - Disable Public Bot (if you only want private use).
   - Enable **Server Members Intent** before deploying Phase C4. This is the
     only privileged intent required and is used solely for genuine member-join
     welcome delivery.
   - Keep Presence Intent and Message Content Intent disabled.
   - Missing Server Members Intent is a deployment blocker. The worker reports
     `privileged_intent_required` and does not silently broaden access.
4. Click Reset Token (or Copy Token if newly created) and save the value securely.
   - This value is your DISCORD_BOT_TOKEN.
   - Never share this token.

## 3) OAuth2 Scopes and Bot Permissions

Open OAuth2 -> URL Generator.

Select scopes:
- bot
- applications.commands

Select only these bot permissions for the production role-sync and seller-resource
worker:
- Manage Roles
- View Channels
- Manage Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Messages

The Layer A channel permission bitset is `93200`. Combined with the existing
Manage Roles foundation, the exact production bot permission bitset is
`268528656`. Do not grant Administrator, Manage Server, moderation, member-ban,
or mention-everyone permissions.

Phase C4 does not change this bitset. Server Members Intent is configured on the
Developer Portal Bot page and is not an OAuth permission.

Before deploying Layer A, remove legacy Administrator, Manage Server, Manage
Threads, Manage Webhooks, View Audit Log, moderation, ban/kick, and
mention-everyone grants from the bot role. The worker reports
`excessive_bot_permissions` and leaves Discord resources untouched while any
high-impact excess permission remains.

If the existing production bot lacks a Layer A permission, regenerate and open
this authorization URL with the real application ID, select the configured
guild, and re-authorize the existing bot:

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=bot&permissions=268528656
```

Keep the Alpha Traders bot role above the three managed seller roles so Discord
permits role assignment and seller-channel overwrite management.

For website account linking, add this exact redirect URI under OAuth2:

```text
https://www.alphatraders.co.il/api/discord/oauth/callback
```

The website requests only the `identify` user scope. Store the OAuth application
ID as `DISCORD_CLIENT_ID`, the client secret as `DISCORD_CLIENT_SECRET`, and the
exact callback as `DISCORD_REDIRECT_URI` on Vercel only. The bot token is not an
OAuth client secret and must never be configured as one.

Notes:
- These permissions match the provisioning, moderation baseline, logging, and slash command setup.
- If you prefer least-privilege hardening later, you can reduce permissions after initial deployment.

## 4) Generate Invite URL and Invite to Existing Server

1. With scopes and permissions selected, copy the generated URL at the bottom.
2. Open the URL in your browser.
3. Choose your existing Alpha Traders server (do not create a new server).
4. Authorize the bot.
5. Complete Discord captcha if prompted.

## 5) Obtain DISCORD_GUILD_ID

1. In Discord app, enable Developer Mode:
   User Settings -> Advanced -> Developer Mode.
2. Right-click your target server icon.
3. Click Copy Server ID.
4. This value is your DISCORD_GUILD_ID.

## 6) Configure .env.local

Create or update .env.local in the repo root with:

DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
DISCORD_GUILD_ID=YOUR_EXISTING_SERVER_ID
DISCORD_APPLICATION_ID=YOUR_APPLICATION_ID
DISCORD_CLIENT_ID=YOUR_OAUTH_CLIENT_ID
DISCORD_CLIENT_SECRET=YOUR_OAUTH_CLIENT_SECRET
DISCORD_REDIRECT_URI=https://www.alphatraders.co.il/api/discord/oauth/callback
DISCORD_BLUEPRINT_PATH=scripts/discord/alpha-discord-blueprint.json
DISCORD_DRY_RUN=0

Optional report path override:
DISCORD_REPORT_DIR=docs/discord/reports

Important:
- Keep .env.local private.
- Never commit bot tokens.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_REDIRECT_URI` are
  required only by the website OAuth routes.

## Railway worker deployment

Railway builds `Dockerfile.discord-worker` from the repository root. The
multi-stage image installs the lockfile-pinned package in `discord-worker/` and
copies only the Discord worker and its server-side dependencies. Public media,
Next.js client code, and the root dependency graph are not included.

Required Railway variables:

```text
DISCORD_BOT_TOKEN
DISCORD_APPLICATION_ID
DISCORD_GUILD_ID
DISCORD_WORKER_HEALTH_SECRET
DATABASE_URL (or SUPABASE_DB_URL)
```

Optional Railway display-name overrides:

```text
DISCORD_SELLER_CATEGORY_NAME=🛡️ Seller Lounge
DISCORD_SELLER_LOUNGE_CHANNEL_NAME=seller-lounge
DISCORD_SELLER_ANNOUNCEMENTS_CHANNEL_NAME=📢 seller-announcements
DISCORD_SELLER_UPDATES_CHANNEL_NAME=seller-updates
DISCORD_SELLER_CHAT_CHANNEL_NAME=💬 seller-chat
DISCORD_SELLER_GUIDES_CHANNEL_NAME=📚 seller-guides
DISCORD_SELLER_SUPPORT_CHANNEL_NAME=❓ seller-support
DISCORD_SELLER_SUCCESS_CHANNEL_NAME=🚀 share-your-success
DISCORD_MARKETPLACE_CATEGORY_NAME=💰 Alpha Exchange
DISCORD_MARKETPLACE_LISTINGS_CHANNEL_NAME=📢 marketplace-listings
DISCORD_MARKET_ACTIVITY_CHANNEL_NAME=📈 market-activity
DISCORD_LIVE_MARKET_PULSE_CHANNEL_NAME=🔥 live-market-pulse
DISCORD_BUYER_SUPPORT_CHANNEL_NAME=💬 buyer-support
```

Apply both `supabase/migrations/20260807000000_discord_identity_sync.sql` and
`supabase/migrations/20260807190000_discord_seller_resources.sql`, followed by
`supabase/migrations/20260807210000_discord_resource_reconciliation_lease.sql`,
and then `supabase/migrations/20260808070000_discord_channel_topology.sql`
before starting the new worker image.

For the Phase C4 upgrade, also apply these forward-only migrations in order:

1. `20260808030000_discord_listing_sharing.sql` (C2)
2. `20260808100000_discord_market_intelligence.sql` (C3)
3. `20260808140000_discord_community_interactions.sql` (C4)

Then enable Server Members Intent and deploy one Railway worker replica. A
rollback may restore the C3 worker while leaving the C4 tables in place. Do not
drop delivery, replay, rate-limit, or registry rows during rollback.

The lease migration was a stop-the-worker upgrade from the first Layer A image.
For the C1 upgrade from accepted Layer B, use this order:

1. Update any explicit display-name overrides to the C1 values above.
2. Apply `20260808070000_discord_channel_topology.sql`.
3. Deploy the new worker image.
4. Wait for signed resource readiness `13/13`.

The topology migration is forward-only and only widens the stable-key
constraint. Apply it before the C1 worker; it does not rename, delete, or
reassign existing Discord IDs. A rollback may restore the previous worker while
leaving the migration and new rows in place. Do not delete the accepted
`marketplace_listings` or Layer A rows.

The Railway worker provisions and reconciles the categories and channels; do
not run it from Vercel. Update any existing display-name overrides to the values
above before the C1 worker starts. Do not activate website linking until the
three website OAuth variables are configured on Vercel.

Permission profiles:

| Profile | Members | Approved Seller | Bot/staff path |
| --- | --- | --- | --- |
| Public bot-only | View and history; posting and threads denied | Same | Bot can publish embeds and reconcile; inherited trusted staff access is preserved |
| Buyer support | View, history, and messages; threads and moderation denied | Same | Bot can publish and reconcile; staff moderation remains inherited |
| Seller read-only | Hidden | View and history; posting denied | Bot can publish and reconcile; inherited trusted staff access is preserved |
| Seller writable | Hidden | View, history, and messages; threads and moderation denied | Bot can publish and reconcile; inherited trusted staff access is preserved |

## Phase C4 community interactions

All seven commands are reconciled at guild scope by the Railway worker. Every
response is ephemeral, so commands cannot create a public-message flood.

| Command | Data source | Behavior |
| --- | --- | --- |
| `/market` | C3 authoritative 24-hour aggregate | Privacy-safe summary |
| `/pulse` | C3 authoritative live pulse | Privacy-safe totals |
| `/profile [seller]` | C3 public profile builder | Excludes hidden, suspended, unapproved, or unsearchable sellers |
| `/listing [seller]` | Authoritative active approved listings | Read-only marketplace link |
| `/share` | Linked identity and existing website cooldown state | Website/My Listings link only; never publishes or claims cooldown |
| `/website` | Server-derived canonical HTTPS origin | Official website links |
| `/help` | Static locale-neutral help | Onboarding and command guidance |

Interaction validation binds the configured application and guild, rejects DM
context, defers within a bounded response window, and stores only the
interaction snowflake, Discord user snowflake, command name, outcome, and
expiry. It never stores interaction tokens or raw payloads. Per-user/per-command
rate limits allow five requests per minute. Replays return a safe ephemeral
response.

Welcome delivery is keyed by guild, member, and Discord join timestamp. Duplicate
gateway events and restarts therefore do not duplicate a DM. Delivery uses a
fenced two-minute lease, exponential retry, and a maximum of five attempts.
Discord's DM-disabled response is recorded as terminal `suppressed`, not retried.

Approved Seller congratulations are enqueued only when role sync actually adds
the managed Approved Seller role and an authoritative
`seller_status_changed`-to-approved outbox generation exists. The transition
outbox UUID—not the reconciliation job UUID—is the durable generation key. This
also covers the race where an older reconciliation job observes the newly
approved state and performs the grant before the transition job itself runs.
Periodic reconciliation and restarts cannot create a generation, and the unique
transition key prevents them from duplicating a prior delivery. Revocation and
unchanged approved state do not send a message. A deliberate later transition
out of and back into approved creates a new authoritative generation and may
send one new congratulations DM.

Terminal delivery rows are retained as compact dedupe records. Cleanup removes
expired interaction claims, stale rate-limit windows, and old aggregate audit
rows, but never deletes delivered/suppressed notification generation keys that
would allow a restart or later role repair to congratulate again.

DM examples are intentionally locale-neutral:

```text
Welcome to Alpha Traders. Connect your Discord account on the website to unlock
verified community access. Complete the website seller application to become an
Approved Seller.
```

```text
Approved Seller access unlocked. Your authoritative Alpha Traders approval is
active. Manage and share listings only from the website.
```

Signed readiness exposes only aggregate command registration and notification
delivery counts, the deterministic definition hash, timestamps, and safe error
codes. It never exposes Discord member IDs, interaction IDs, command payloads,
DM content, emails, wallets, buyers, or listing details.

Production enablement is intentionally manual: apply the C4 migration, enable
Server Members Intent, deploy one Railway replica, verify signed readiness, then
exercise commands in the configured guild. Roll back by restoring the C3 image;
the forward-only schema is safe to retain. Phase C4 does not include an admin
dashboard and must not be deployed or merged automatically.

## 7) Verify Bot Can Connect

Run:
npm run discord:verify

Expected result:
- Bot identity printed (username and id)
- Guild access confirmed for your DISCORD_GUILD_ID

## 8) Continue Automatically With Inspection

After verification succeeds, run:
npm run discord:post-setup

This command will:
1. Verify bot authentication and guild access
2. Run inspection
3. Generate migration reports in docs/discord/reports

Expected output files:
- discord-migration-report-<timestamp>.json
- discord-migration-report-<timestamp>.md

## 9) If You Get Errors

- Missing DISCORD_BOT_TOKEN:
  Confirm token exists in .env.local and terminal loaded env.
- Unknown Guild or Missing Access:
  Confirm bot was invited to the same server ID you copied.
- Missing Permissions:
  Re-open OAuth2 URL Generator, include required permissions, re-invite bot.
- 403 on integrations endpoint:
  Some integration details may require elevated rights; core inspection still runs.

## 10) Security Best Practices

- Rotate token if it was exposed.
- Store secrets in env vars only.
- Limit who can manage the bot application.
- After successful deployment, review and remove unnecessary permissions.
