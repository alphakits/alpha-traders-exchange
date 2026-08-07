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
3. Optional but recommended:
   - Disable Public Bot (if you only want private use).
   - Enable Presence Intent if you plan to use presence-based features later.
   - Keep all privileged intents disabled for now unless your future bot logic needs them.
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
DISCORD_SELLER_CATEGORY_NAME=ALPHA SELLER SUITE
DISCORD_SELLER_LOUNGE_CHANNEL_NAME=seller-lounge
DISCORD_SELLER_ANNOUNCEMENTS_CHANNEL_NAME=seller-announcements
DISCORD_SELLER_UPDATES_CHANNEL_NAME=seller-updates
DISCORD_SELLER_GUIDES_CHANNEL_NAME=seller-guides
DISCORD_SELLER_SUPPORT_CHANNEL_NAME=seller-support
DISCORD_MARKETPLACE_LISTINGS_CHANNEL_NAME=marketplace-listings
```

Apply both `supabase/migrations/20260807000000_discord_identity_sync.sql` and
`supabase/migrations/20260807190000_discord_seller_resources.sql`, followed by
`supabase/migrations/20260807210000_discord_resource_reconciliation_lease.sql`,
before starting the new worker image.

The lease migration is a stop-the-worker upgrade because the first Layer A
image used a different lock. Do not use a rolling deployment:

1. Scale the Railway Discord worker to zero replicas.
2. Apply `20260807210000_discord_resource_reconciliation_lease.sql`.
3. Deploy the new worker image.
4. Start exactly one Railway replica and wait for resource readiness `7/7`.

The Railway worker provisions and reconciles the category and channels; do not
run it from Vercel. Do not activate website linking until the three website
OAuth variables are configured on Vercel.

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
