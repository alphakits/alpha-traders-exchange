# Alpha Traders Production Security Audit

Audit date: 2026-08-13

## Scope and Method

This is a read-only review of Next.js routes, middleware, server-side auth and store layers, database schema/repository, worker configuration, deployment manifests, production HTTP responses, DNS, and existing regression coverage. Representative unauthenticated production requests were made only to non-mutating or rejected paths.

## Production Checks

| Check | Result |
| --- | --- |
| `www.alphatraders.co.il` DNS | Direct Vercel CNAME; no Cloudflare proxy found |
| Production server | Vercel |
| HSTS, CSP, nosniff, frame, referrer, permissions headers | Present |
| `/api/testing/alpha-exchange-state` without support header | 404 |
| `/api/debug/cookie-test` | 404 |
| Unauthenticated seller settings, notifications, trade bank details, evidence, and admin data | 401 |
| Unauthenticated setup/clean test-account routes | 403 |
| Unauthenticated Discord marketplace event | 401 |
| Unsigned, empty Twilio callback | 500; remediation required |

## Endpoint Inventory

The API surface is implemented under `src/app/api`. Route handlers use server session lookup through `requireApiUser`, role checks through `requireApiAdmin`, `requireApiOwner`, and seller workspace guards, or dedicated integration authentication. Object ownership for exchange resources is enforced by store-layer actor checks rather than client-provided IDs.

| Surface | Endpoints | Auth and authorization | Data and abuse controls |
| --- | --- | --- | --- |
| Auth | `/api/auth/login`, `logout`, `me`, `register`, `profile`, `profile/photo`, `reset/request`, `reset/confirm`, `verify-email`, `verify-email/resend`, onboarding routes | Session token is server looked up; profile actions use current user | Secure/httpOnly/lax auth cookies, password hashing, generic reset response, login/register/reset rate limits |
| Marketplace public | `/api/alpha-exchange/listings` GET, `marketplace-pulse`, `market-rate`, `/api/health`, `/api/contact` | Intended public browse/health/contact surfaces | Contact has honeypot and rate limit; public responses must remain free of bank and private contact data |
| Listings and seller workspace | `/api/alpha-exchange/listings/*`, `my-listings`, `seller-settings`, `seller-application`, `seller/compliance-payment`, seller profile routes | Authenticated actor plus approved seller/status checks where required; store derives seller ownership | Listing and bank-account validation; sensitive seller settings scoped to current user |
| Purchase, trade, evidence, bank | `/api/alpha-exchange/purchase-requests/*`, `trade-room/*`, `disputes`, `reviews`, `reports` | Authenticated participant or admin; phone gate for trading; store-layer participant check | Trade state validation, private/no-store evidence download, bank details only after eligible state, bank reveal audit record |
| Notifications and realtime | `/api/alpha-exchange/notifications/*`, `realtime`, notification preferences | Current user or seller workspace scope | Actor-scoped notification/realtime filtering |
| Phone/SMS | `/api/alpha-exchange/phone/*`, `/api/twilio/status` | Current user for OTP; signed Twilio webhook for status | Per-user OTP rate limits, status callback signature validation |
| Exchange admin | `/api/alpha-exchange/admin/**`, `admin-prep` | `requireApiAdmin` or `requireApiOwner`; identity from session | Store/audit logs for many high-impact operations; several bulk operations need rate limits |
| Academy admin | `/api/admin/bootstrap`, `export`, `import`, `lessons/**`, `media`, `versions`, Discord admin routes | `resolveAdminIdentity`: current session admin/owner and optional configured admin key | Admin media upload extension/size checks; content-byte verification missing |
| Discord | `/api/discord/identity`, `oauth/start`, `oauth/callback`, `marketplace-events`, listing Discord share | Session user for identity/OAuth; OAuth state bound to user and PKCE; shared key for marketplace events | Marketplace-event signature is optional when the API key is supplied; should be made mandatory after caller compatibility is confirmed |
| Test/debug/maintenance | `/api/testing/*`, `/api/debug/*`, `/api/admin/setup-test-accounts`, `/api/admin/clean-test-accounts` | Debug routes return 404 in production. Testing routes require `x-alpha-test-support: enabled` and production flag `ALPHA_ENABLE_TEST_SUPPORT=1`. Setup/clean use `x-setup-secret`. | Setup and clean routes are high-impact and outside the established test-support dual gate |

## Existing Protections

| Area | Existing protection | Missing | Risk | Action |
| --- | --- | --- | --- |
| Authentication | Opaque random session tokens, server session lookup, scrypt password hashing, secure/httpOnly/lax cookies, login/reset rate limits | Rate limiting is process-local | HIGH | Move limits to shared durable/edge storage before relying on multi-instance protection |
| Authorization | Session-derived roles, admin/owner guards, store-layer participant checks | Legacy admin display identity accepts client headers | MEDIUM | Derive actor/role only from session after UI compatibility review |
| Bank privacy | Public listing sanitization, trade-state gate, participant/admin access, reveal audit | No external independent penetration test yet | MEDIUM | Keep and expand negative BOLA regression tests |
| Phone privacy | Request sanitization and notification/email redaction | Structured logs do not redact phone/bank-like metadata | HIGH | Harden structured-log redaction and add regression coverage |
| Evidence | Participant checks, private/no-store download, filename sanitization, allowed MIME list, size policy | Uploaded content bytes are not verified against declared type | HIGH | Introduce byte-signature validation after compatibility review for current media/evidence formats |
| Input/output | Length/enum checks in many routes, React escaping, parameterized PostgreSQL access | Some handlers return raw error messages | MEDIUM | Normalize unexpected errors at route boundaries incrementally |
| Webhooks | Twilio signature verifier, Discord shared key and optional HMAC | Empty malformed Twilio callback returns 500; Discord HMAC optional | MEDIUM | Reject malformed Twilio payload safely; require Discord HMAC after caller migration |
| Test surfaces | Production test support needs both header and `ALPHA_ENABLE_TEST_SUPPORT=1`; debug routes 404 | Setup/clean test-account endpoints rely on separate shared secret | HIGH | Re-gate or remove from production only after confirming test-account operations |
| Security headers | HSTS, CSP, nosniff, referrer, frame and permissions policies active | CSP includes `unsafe-eval`; no nonce/hash CSP | MEDIUM | Build production CSP from actual script requirements before removal |
| Edge/DDoS | Vercel hosting and app limits | No Cloudflare evidence, WAF/rate/bot configuration unavailable | HIGH | Place domain behind Cloudflare or equivalent edge controls after account/plan review |
| Secrets | Environment variables server-side; no common plaintext credential pattern found in tracked files | `recovery-codes.txt` is tracked and was committed in `e83ea3f` | CRITICAL | Rotate affected recovery codes immediately, revoke related sessions, then remove from tracking without history rewrite |
| Database | Server-only PostgreSQL repository, TLS validation checks, foreign keys, actor checks | Snapshot-style persistence has limited explicit row-locking for concurrent business transitions | HIGH | Add transactional row-level/optimistic concurrency controls for trade/listing-critical mutations |
| Logging | Structured event log and trade/bank reveal audit events | PII metadata not comprehensively redacted | HIGH | Harden redaction; avoid raw `console` logs of user fields |

## OWASP API Top 10 Mapping

| OWASP area | Assessment |
| --- | --- |
| API1 BOLA | Store-layer participant/owner checks are present for sampled trade/evidence/bank paths; expand route-level regression matrix |
| API2 Broken Authentication | Strong session and password basics; shared, in-memory limits are insufficient across instances |
| API3 Broken Object Property Level Authorization | Request serializers protect sampled buyer contact and bank fields; logging remains a leak path |
| API4 Unrestricted Resource Consumption | Many targeted limits exist; admin bulk operations and multi-instance limits need hardening |
| API5 Broken Function Level Authorization | Session-derived admin gates exist; maintenance routes use a separate shared-secret scheme |
| API6 Sensitive Business Flows | Trade state store rules exist; concurrency controls require further hardening |
| API7 SSRF | No user-controlled server fetch target found in sampled paths; keep URL allowlists for future external integrations |
| API8 Misconfiguration | Direct Vercel edge, permissive CSP directives, tracked recovery-code file |
| API9 Inventory Management | Debug and test support are gated; setup/clean maintenance routes require consolidation |
| API10 Unsafe API Consumption | Twilio signature verification exists; malformed input handling and mandatory Discord HMAC need improvement |

## Required Manual Decisions Before Higher-Risk Changes

1. Rotate the exposed recovery codes immediately. A normal commit can prevent future tracking but cannot revoke a previously exposed code or erase GitHub history.
2. Confirm whether `ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION=1` is enabled in production. Disabling it can block legitimate marketplace users who cannot currently receive OTPs.
3. Confirm the intended production use of setup/clean test-account routes. Re-gating them may interrupt the current test-account workflow.
4. Confirm Discord marketplace-event callers can send HMAC signatures before making signatures mandatory.
5. Confirm accepted admin and evidence formats before enforcing byte-signature validation and disallowing active SVG uploads.
6. Review available Cloudflare account/plan capabilities. The application domain is currently directly served by Vercel, and no Cloudflare configuration is available in this workspace.

## Safe Immediate Changes

- Redact phone and bank-like fields from structured security logs.
- Return a controlled client error for malformed Twilio callback bodies before signature processing.
- Add focused regression tests for both changes.

## Follow-up Application Hardening

- Added a PostgreSQL-backed atomic fixed-window limiter for authentication, OTP/SMS, upload, contact, marketplace creation, trade, dispute, commission, and privileged bulk/admin operations. Production fails closed for these protected flows if the shared limiter cannot reach its required database; local test/dev environments retain an in-process fallback.
- Validated evidence, profile photos, academy media, and academy imports against their actual content bytes. SVG is no longer accepted for admin media uploads, and stored media MIME types are derived from validated content rather than browser input.
- Closed previously public notification runtime diagnostic routes behind admin authorization, durable rate limits, and `no-store` responses.
- Removed client control of legacy academy admin audit identity headers; the actor and role now derive from the authenticated server session.
- Cloudflare, DNS, WAF, recovery codes, credentials, Git history, commits, pushes, and deployments were not changed.
