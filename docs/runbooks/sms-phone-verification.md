# Buyer and seller SMS verification rollout

The requirement stays off until a real carrier-delivery and code-confirmation
test passes. A Trust Hub business-profile approval alone does not verify the
sender, credentials, geographic permissions, or message delivery.

## Stage 1: delivery test

Configure the existing Twilio account credentials and SMS-capable sender in
Vercel's server environment. Do not put credentials in source, logs, or review
notes. Verify the account can send to the intended Israeli recipients.

| Variable | Delivery-test value |
| --- | --- |
| `ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED` | `true` |
| `ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER` | `twilio` |
| `ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED` | `true` |
| `ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED` | `false` |
| `ALPHA_EXCHANGE_TWILIO_SEND_ENABLED` | Preserve the existing trade-notification setting |

The OTP-only switch permits user-requested verification messages independently
of trade notification SMS. It does not subscribe members to notifications.

Use the existing profile phone settings or authenticated phone endpoints to
request one code. Check Twilio's message status, confirm receipt on the real
phone, and submit the code through the website. Check a fresh authenticated
read, then logout/login: the phone must remain verified. Repeat the buyer and
seller access flows before enforcement. A queued message is not proof of
delivery. No production test accounts or fabricated verification timestamps
are needed.

## Stage 2: mandatory verification

Only after Stage 1 passes, set
`ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED=true` in the reviewed production
deployment. Existing unverified buyers and sellers are directed to
`/verify-account`; email verification remains required. Owner/admin access,
support, legal, account deletion, and verification endpoints remain reachable.
Pure student/guest browsing outside exchange pages is unaffected.

Website marketplace actions, seller/buyer role helpers, and mobile marketplace
API routes check canonical account verification. A forged or stale phone cookie
does not grant access. The shared verification screen does not grant buyer roles
to an existing seller. Real previously verified numbers remain verified.

Codes use salted one-way digests, expire at ten minutes, allow five wrong
guesses per challenge, and are consumed on success. The sixty-second resend
cooldown and five-per-day send counter are checked against the latest canonical
user under the repository's transaction lock. Website, buyer onboarding, and
mobile endpoints share account rate-limit buckets. Ambiguous Twilio sends are
not automatically retried. Changing the saved contact number clears its old
verification. Contact numbers remain visible only to the member and owner.

## Rollback

Set `ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED=false` and deploy. This removes
the new account-access requirement while preserving genuine verification data.
Disable `ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED` as well if OTP delivery itself
needs to stop. Preserve the independent trade-notification setting.

## Validation

Focused tests cover requirement defaults and strict enablement, buyer/seller
authorization, owner/admin exemptions, non-exchange student access, recovery
routes, both phone endpoint flows, failed delivery, secure cookies, persistence,
code expiry and replay, simultaneous guesses, simultaneous duplicate-number
claims, resend limits, contact changes, mobile API enforcement, and OTP-only
delivery. Run the affected authentication and trade-route regressions, TypeScript,
ESLint, and the production build before publishing.

Actual Twilio carrier delivery and live enforcement must be recorded separately
after authenticated provider and deployment access are available. Automated
tests do not establish successful delivery to a user's phone.

Pre-rollout validation on 2026-10-01: 64 focused test files / 625 tests passed;
ESLint, TypeScript checks, and the production build passed. Isolated local
production-server HTTP checks passed for a buyer and an approved seller:
canonical redirects and screen rendering, rejection of a fabricated phone
cookie, invalid-code rejection, confirmation persistence, role preservation,
and access after logout/login. Those HTTP checks seeded only a local OTP
challenge with delivery disabled; they did not send an SMS or modify production
accounts. Real carrier delivery and production activation remain pending.
