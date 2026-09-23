# Marketplace email recovery and Cardless ATM key rollout

## Durable marketplace email

All `sendMarketplaceEmail` callers save a frozen provider request in
`alpha_exchange.marketplace_email_outbox` before sending in database-backed
runtimes. Existing side-effect preparation still follows the business mutation;
this is durable delivery once enqueued, not a transactional outbox spanning every
trade mutation. Authentication emails and the existing admin campaign system keep
their separate delivery paths.

- A unique idempotency key, 60-second lease, and fenced completion prevent duplicate
  workers from completing the same record. Interrupted attempts are reclaimed.
- A shared PostgreSQL gate spaces marketplace attempts by at least 1.1 seconds at
  claim time. Provider throttling sets a shared cooldown, including quota failures.
  Other email systems on the same Resend account remain outside this gate.
- The once-per-minute `/api/cron/marketplace-email-delivery` endpoint requires the
  existing `CRON_SECRET`; comparisons are constant-time and responses are uncached.
  Each run attempts at most 40 jobs within a 45-second work budget, with a 120-second
  function limit for bounded database/provider cleanup. Transactional events have
  priority over listing/news announcements.
- Retryable failures stay pending. Invalid recipient/payload rejections stop.
  Failed credentials and daily/monthly quotas pause for recovery. No historical
  customer email is replayed during rollout.
- Retries preserve the exact serialized body and provider idempotency key across
  deployments. Unsent jobs expire after 23 hours, before Resend's 24-hour key
  retention window can permit an ambiguous send to be duplicated. Expired and
  exhausted deliveries become explicit failures; they are not silently resent.
- Each attempt checks that the original account exists, is enabled, and still owns
  the same email. Actionable trade emails are suppressed after the relevant status
  passes. Account deletion cascades to queued delivery data.
- Bodies and recipient addresses are erased after sent, failed, or suppressed
  outcomes. Remaining records preserve deduplication and status. RLS denies client
  access; there are no public policies. The runtime performs an additive, locked
  schema bootstrap, following the existing server-managed repository pattern.

Watch `marketplace_email_delivery_cron` aggregate `backlog` and `failedTotal`, and
`marketplace_email_outbox` outcomes. A rising backlog, permanent failures, or
`retry_window_expired` needs investigation. API acceptance is not proof of inbox
delivery; Resend remains the source for bounces and delivery confirmation.

## Cardless ATM encryption

`ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET` is the server-only primary encryption
material. Generate 32 random bytes or more, save it as a sensitive Vercel variable,
and never put it in source control or a `NEXT_PUBLIC_` variable.

The existing AES-256-GCM format and request/message AAD binding stay unchanged.
Readers try a bounded key ring: active/staged primary, optional previous primary,
and the existing server-only fallback materials. Duplicate-code HMAC checks use
the same compatibility ring. Incorrect ciphertext, tags, or request/message IDs
still fail authentication. Redeemed credential erasure is unchanged.

### Initial production migration

1. Validate and deploy this compatible implementation with existing key material.
2. Set the dedicated secret and `ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_ACTIVATE_AT`
   to the same explicit UTC timestamp at least 24 hours ahead, scoped to production
   and any previews using the same database. Redeploy the compatible commit.
3. Before that instant, new writes continue with the current fallback key, while
   reads accept both keys. This gives the existing 12-hour skew-protection window
   time to drain. Verify the staged deployment is Ready with more than 12 hours
   remaining; otherwise move activation later and redeploy before switching.
4. At that instant the deployed code automatically writes using the dedicated key.
   Legacy credentials remain readable until redeemed. No bulk decrypt/export or
   rewrite of live payment credentials is needed.

Do not remove or rotate the old fallback materials while outstanding credentials
depend on them. After activation, roll back only to a commit that supports this
key ring. An old binary with only single-key decryption is not a safe rollback.

For a future dedicated-key rotation, preserve the current key in
`ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_PREVIOUS_SECRET` and plan an equivalent staged
rollout; the initial activation flag stages fallback writes and is **not** a generic
previous-key rotation controller. Never replace secrets without retaining the
appropriate decrypting material.

## Verification

The queue regression tests execute real PostgreSQL SQL with PGlite and mocked
provider responses. They cover deduplication, cooldowns, recovery, fencing, account
changes/deletion, expiry, stale trade states, schema bootstrap, and RLS. PGlite
uses one database connection and is not a multi-server load test. Crypto tests
include ciphertext built with the pre-migration algorithm, legacy fingerprints,
staging, later-key reads, tampering, and full cardless trade flows.

References: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Resend limits](https://resend.com/docs/api-reference/rate-limit),
[Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
