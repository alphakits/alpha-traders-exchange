# Alpha Traders

## Requirements

- Node.js 20+
- npm 10+

## Authentication & roles

Role hierarchy is multi-role and additive:

- `guest` (default for every new account)
- `student`
- `buyer`
- `pending_seller_approval`
- `approved_seller`
- `admin`
- `owner`

### Permission model

- **Guest**: browse public marketplace/academy content and manage profile basics.
- **Student**: academy premium access.
- **Buyer**: marketplace purchase actions and seller contact.
- **Approved seller**: listing management and seller workspace.
- **Admin**: administrative exchange and moderation tools.
- **Owner**: immutable superuser role (`jozenmark834@yahoo.com`) with automatic owner+admin restoration on login.

All API authorization is server-side and derived from the authenticated session user. Client-supplied roles are ignored.

### Buyer verification flow

1. Guest chooses **Become a Buyer** in onboarding.
2. User submits profile fields + Israeli phone.
3. OTP is sent through provider abstraction (`src/lib/sms-provider.ts`).
4. OTP verify grants `buyer` role only after successful provider verification.
5. Duplicate verified phone usage is blocked.

### Seller approval flow

1. Only buyers can submit seller applications.
2. Seller application enters `pending_seller_approval`.
3. Admin review approves/rejects.
4. Approved users receive `approved_seller` capabilities.

### Owner protections

- Owner cannot be suspended, reactivated, demoted, or profile-state mutated by admin APIs.
- Owner role is re-applied on login by canonical owner email.

### Security and observability

- Structured server logs are emitted for permission denials, buyer OTP send/verify, and seller admin actions.
- Sensitive values (passwords/tokens/OTP/secrets) are redacted from structured logs.

## First install

```bash
npm install
```

## Normal development

```bash
npm run dev
```

Starts the Next.js dev server on `http://localhost:3000`.
If another dev server is already running for this repo, the command now exits early with a clear message to prevent chunk-cache corruption.

## Clean rebuild (recommended after runtime/chunk issues)

```bash
npm run clean
npm run dev
```

Or run both in one command:

```bash
npm run dev:clean
```

`clean` removes generated runtime directories:
- `.next`
- `.next-dev`
- `.next-runtime`
- `.next-runtime-build`
- `.next-stale`

If `npm run dev` starts but `/en/login` or `/` returns missing-manifest or chunk errors
(`Cannot find module './5611.js'`, `routes-manifest.json`, `prerender-manifest.json`,
or `clientReferenceManifest`), stop every repo-local Next process, run `npm run clean`,
then restart with `npm run dev:clean`.

## Production build

```bash
npm run build
npm run start
```

`npm run build` now refuses to run if a repo-local `next dev` process is active, preventing shared `.next` corruption.

## Test workflow

- Unit tests: `npm run test`
- E2E tests: `npm run test:e2e`

E2E credentialed login/seller lifecycle checks are opt-in and require seeded accounts:

- `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`
- `E2E_BUYER_EMAIL`, `E2E_BUYER_PASSWORD`
- `E2E_SELLER_EMAIL`, `E2E_SELLER_PASSWORD`

Without these variables, credential-dependent E2E cases are skipped and public/auth-guard infrastructure checks still run.

## Vercel deployment

### Runtime compatibility

- The Next.js app itself is compatible with Vercel's Next.js runtime.
- `next.config.ts` is production-safe for Vercel: default `.next` output, app-wide security headers, local image optimization, and no custom `distDir`.
- Static images under `public/` and the founder MP4 under `public/files/founder/` are Vercel-compatible and will be served over HTTPS through Vercel's CDN.

### Discord gateway infrastructure

Vercel remains the Next.js web/API host and never starts a Discord gateway
client. Vercel serverless instances cannot guarantee eager startup, one global
client, durable gateway ownership, reconnect continuity, or graceful shutdown.
The gateway therefore runs as one dedicated long-lived Railway worker from this
same repository.

Apply `supabase/migrations/20260807190000_discord_seller_resources.sql`, then
`supabase/migrations/20260807210000_discord_resource_reconciliation_lease.sql`,
then `supabase/migrations/20260808070000_discord_channel_topology.sql` before
deploying this worker version. The lease upgrade is not rolling-safe
with the first Layer A worker: scale the Railway worker to zero, apply the lease
migration, deploy the new image, then start exactly one replica. The required
Layer A channel permission bitset is `93200`; combined with the existing Manage
Roles permission, authorize the bot with exact bitset `268528656` and do not
grant Administrator.

The Railway worker owns the process-global `discord.js` singleton, login,
Discord-managed reconnect/resume, application-ID verification, forced guild API
fetch, managed channel reconciliation, and graceful `SIGINT`/`SIGTERM`
shutdown. The 13 managed resources use stable database keys and persisted
Discord IDs. The worker repairs owned names, parents, deterministic child
ordering, and permission bits without deleting or replacing unrelated guild
resources. It preserves non-conflicting overwrite bits while removing legacy
untrusted visibility or posting allows that would bypass Approved Seller,
bot-only, or buyer-support boundaries.

Railway probes `GET /health/live`, which returns only generic process liveness.
Detailed `GET /health/ready` diagnostics require a short-lived HMAC signature
from the Vercel server, including a timestamp and one-use nonce. The signing
secret is never transmitted and must not reuse the Discord bot token. The
website's existing owner/admin-only
`GET /api/admin/discord/diagnostics` endpoint proxies to that fixed HTTPS worker
origin with a three-second timeout. It cannot accept a request-controlled URL
or initialize a local client, and reports explicit degraded state for missing
configuration, timeout, unavailable worker, failed authentication, or invalid
responses.

Ready-session uptime resets whenever the gateway disconnects or starts
reconnecting. A healthy ready/resume event clears a prior transient gateway
error so diagnostics recover without restarting the worker.

### Railway Discord worker deployment

Create one Railway service from this repository; do not create a second
application or copy Discord logic. The root `railway.json` builds
`Dockerfile.discord-worker`, which installs the dedicated lockfile-pinned worker
package without public media or website client code. Railway uses `/health/live`
for deployment health and restarts the worker on failure.

Set these Railway service variables:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_WORKER_HEALTH_SECRET` (a dedicated random value of at least 32 characters)
- `DATABASE_URL` or `SUPABASE_DB_URL`

Railway provides `PORT`; do not hardcode it. Generate a public Railway HTTPS
domain after the first deployment. Startup is successful only after the bot
login, configured application ID, and configured guild are verified. A failed
configuration, login, identity check, or guild fetch exits non-zero so Railway
can restart according to policy.

Set these Vercel server-only variables, then redeploy the web app:

- `DISCORD_WORKER_BASE_URL` (the Railway HTTPS origin only, with no path)
- `DISCORD_WORKER_HEALTH_SECRET` (the same dedicated value configured on Railway)
- `DISCORD_CLIENT_ID` (the website OAuth application ID)
- `DISCORD_CLIENT_SECRET` (website server only; never expose it to the browser)
- `DISCORD_REDIRECT_URI` (the exact registered HTTPS callback)

Do not configure `DISCORD_BOT_TOKEN` or `DISCORD_GUILD_ID` on Vercel.
`DISCORD_APPLICATION_ID` remains the worker's bot-identity setting and is not a
substitute for `DISCORD_CLIENT_ID`. Rotate `DISCORD_WORKER_HEALTH_SECRET` on
both services if it is exposed; readiness signatures expire after 30 seconds
and cannot be replayed within a worker process.

### Required environment variables

Set these in Vercel for every environment that should build successfully:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` — **must be the Supabase connection pooler URL, not the direct host URL.**

> **CRITICAL — `SUPABASE_DB_URL` must use the connection pooler.**  
> Vercel serverless functions cannot resolve `db.<ref>.supabase.co` (direct host).  
> Using the direct host causes `getaddrinfo ENOTFOUND db.<ref>.supabase.co` at login.  
>
> **Correct format (Transaction Mode pooler, port 6543):**  
> ```
> postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
> ```
>
> **How to get this URL:**  
> Supabase Dashboard → Project Settings → Database → **Connection Pooling** tab → Transaction mode → copy URI  
>
> **Wrong (direct host — do not use on Vercel):**  
> ```
> postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
> ```

Set this in the **Production** environment so metadata, canonical URLs, `robots.txt`, and `sitemap.xml` use the custom domain instead of a preview hostname:

- `NEXT_PUBLIC_SITE_URL=https://www.alphatraders.co.il`

Optional environment variables:

- `NEXT_PUBLIC_FOUNDER_VIDEO_URL` — **Required in production.** The Supabase Storage public URL for the founder introduction video. Vercel does not pull Git LFS objects, so the video must be uploaded to Supabase Storage separately.
- `AUTH_COOKIE_SECURE=true`
- `ADMIN_ACCESS_KEY`
- `ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD`
- `ALPHA_EXCHANGE_EVIDENCE_MAX_SIZE_MB`
- `ALPHA_EXCHANGE_STALE_TRADE_TIMEOUT_MINUTES`
- `SUPABASE_ADMIN_MEDIA_BUCKET=admin-media`
- `SUPABASE_DB_SSL=true` (default behavior; only set `false` for local trusted Postgres)
- `BUYER_OTP_EXPIRY_MINUTES=10`

Rate limits are configurable per limiter key with environment overrides:

- `RATE_LIMIT_<KEY>_MAX`
- `RATE_LIMIT_<KEY>_WINDOW_MS`

Example for buyer OTP verify key (`auth:buyer-otp-verify`):

- `RATE_LIMIT_AUTH_BUYER_OTP_VERIFY_MAX=3`
- `RATE_LIMIT_AUTH_BUYER_OTP_VERIFY_WINDOW_MS=3600000`

#### Founder video — Supabase Storage upload (one-time setup)

The founder introduction video is stored in Git via Git LFS but Vercel does not fetch LFS objects during deployment. The video must be hosted on Supabase Storage:

1. Open Supabase Dashboard → Storage → **admin-media** bucket (already public)
2. Create folder `founder/` inside the bucket
3. Upload `public/files/founder/alpha-traders-founder-introduction.mp4` into that folder
4. The public URL will be:
   ```
   https://<project-ref>.supabase.co/storage/v1/object/public/admin-media/founder/alpha-traders-founder-introduction.mp4
   ```
5. In Vercel → Settings → Environment Variables, add:
   ```
   NEXT_PUBLIC_FOUNDER_VIDEO_URL = https://<project-ref>.supabase.co/storage/v1/object/public/admin-media/founder/alpha-traders-founder-introduction.mp4
   ```
6. Redeploy for the change to take effect.

Never set in production:

- `ALPHA_EXCHANGE_EXPOSE_RESET_TOKEN`

### Vercel project settings

- Framework preset: **Next.js**
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: **leave empty** (Vercel auto-detects Next.js output)
- Node.js version: **20** (`.nvmrc` is included)

### Custom domain DNS

For `alphatraders.co.il` on Vercel:

1. Apex/root domain `alphatraders.co.il` → `A 76.76.21.21`
2. `www.alphatraders.co.il` → `CNAME cname.vercel-dns.com`

After adding the domain in Vercel, wait for DNS verification and automatic SSL issuance before going live.

### Marketplace and admin CMS persistence

Marketplace/auth runtime persistence now uses PostgreSQL through `SUPABASE_DB_URL` instead of:

- `data/alpha-exchange-db.json`
- `data/alpha-exchange-evidence/`

Admin lesson/media/version persistence now also uses PostgreSQL plus Supabase Storage instead of:

- `src/data/lessons.json`
- `src/data/lesson-versions.json`
- `src/data/media-library.json`
- `public/uploads/admin/`

Apply these migrations before starting the app in any persistent environment:

- `supabase/migrations/20260720160000_alpha_exchange_runtime.sql`
- `supabase/migrations/20260720193000_admin_cms_storage.sql`

Trade evidence uploads are stored in PostgreSQL `bytea` rows in `alpha_exchange.evidence`.
Admin lesson/media uploads are stored in the Supabase Storage bucket `admin-media` by default, with metadata stored in `admin_cms.media_items`.

## Quality checks

```bash
npm run lint
```

## Discord infrastructure automation

This repository now includes a production-ready Discord provisioning package for Alpha Traders.

- Blueprint: `scripts/discord/alpha-discord-blueprint.json`
- Provisioning script: `scripts/discord/provision-alpha-discord.mjs`
- Slash command registration: `scripts/discord/register-alpha-slash-commands.mjs`
- Full operational documentation: `docs/discord/alpha-discord-blueprint.md`

Run provisioning after setting Discord environment variables:

```bash
npm run discord:provision
```

Register slash commands (optional bot expansion):

```bash
npm run discord:commands
```

## Common troubleshooting

1. **Cannot find module './<chunk>.js'**  
   Run `npm run dev:clean` and restart the server.
2. **Dev server behaves inconsistently after branch switches**  
   Run `npm run clean`, then `npm run dev`.
3. **Build works locally but runtime is stale**  
   Ensure no generated Next.js artifact folders are committed.
4. **Cannot find module './<chunk>.js' while multiple dev terminals are open**  
   Stop all existing `next dev` processes for this repo, then run `npm run dev:clean`.
5. **Cannot find module './<chunk>.js' after running build and dev at the same time**  
   Stop `next dev`, run `npm run clean`, then run either `npm run dev` or `npm run build` (not both concurrently).
6. **`ERR_CONNECTION_REFUSED` on `http://localhost:3000`**  
   No dev server is currently listening on port 3000. Start it with `npm run dev` and keep that terminal running.
7. **`getaddrinfo ENOTFOUND db.<ref>.supabase.co` on Vercel**  
   `SUPABASE_DB_URL` is pointing at the Supabase **direct host**, which Vercel cannot resolve.  
   Replace it with the **Transaction Mode pooler URL** (port 6543):  
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`  
   Get this URL: Supabase Dashboard → Project Settings → Database → **Connection Pooling** tab → Transaction mode → copy URI.

## Recommendation on custom `distDir`

The previous custom `distDir` setting was not required by the app itself and increased risk of stale artifact drift across multiple runtime folders.  
This project now uses Next.js default output (`.next`) for a more stable development workflow.
