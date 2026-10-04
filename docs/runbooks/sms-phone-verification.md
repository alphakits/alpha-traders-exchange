# Mandatory buyer and seller SMS verification

Production buyers and sellers must verify a unique phone before using Alpha Exchange.
On 4 October 2026 the owner explicitly authorized exceptions for three existing
accounts: `alphatradersai@gmail.com`, `claudiahttps11@gmail.com`, and
`jozenmark834@yahoo.com`. Exceptions require both the exact existing immutable
account ID and the canonical email, resolved from the server's account record.
Email alone, aliases, recreated accounts, roles, cookies, client booleans, and
user-editable auth metadata cannot grant an exception. Email verification and
normal account, role, seller-approval, and commission restrictions still apply.

Every other unverified account goes to `/verify-account` after login; marketplace
pages, reads, actions, and native APIs enforce the same canonical policy.
The private session DTO reports the authorization result as a boolean and does
not fabricate `verifiedPhone` or `phoneVerifiedAt` for an exempt account.

Production enforcement does not depend on
`ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED` or
`ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED`. Missing or false values cannot
remove the requirement. Those switches and the skip flag remain useful only
for isolated local fixtures; Vercel deployments reject test-runtime bypasses.

## SMS delivery configuration

Use the existing Twilio account and a valid SMS sender. Keep credentials in the
server environment, never in source, logs, screenshots, or review notes.

| Variable | Value |
| --- | --- |
| `ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER` | `twilio` |
| `ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED` | `true` when SMS sending is ready |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Existing server-only credentials |
| `ALPHA_EXCHANGE_TWILIO_SEND_ENABLED` | Independent trade-notification setting |

The OTP switch permits a member-requested verification code independently of
trade-notification SMS. It does not subscribe members to notifications.

Choose a valid SMS identity in this priority order:

1. `TWILIO_SMS_MESSAGING_SERVICE_SID`: an `MG...` service with an approved sender
   pool and the required destination permissions.
2. `TWILIO_SMS_FROM`: an account-owned SMS number or an alphanumeric identity
   supported for the destination country and account.
3. `TWILIO_PHONE_NUMBER`: the legacy SMS number.

An invalid explicit sender fails closed. Twilio error `21266` means sender and
recipient are the same; that combination is rejected before replacing a
challenge. Sender configuration does not migrate a personal WhatsApp account.

## WhatsApp currently unavailable

Only SMS can deliver verification codes. English, Arabic, onboarding, account
settings, and native settings show WhatsApp as unavailable. The server reports
`whatsapp: false` even when WhatsApp credentials and templates are configured.
Explicit WhatsApp requests, older-client requests, and a legacy WhatsApp default
cannot send a verification code or silently switch transport.

New challenges record `phoneOtpChannel: sms`. Confirmation rejects a pending
WhatsApp challenge or an older challenge without a recorded channel; the member
must request a fresh SMS. Already verified numbers retain their canonical
verification. There is no production data reset or fabricated verification.

This verification policy is independent of the trade-notification system. Its
provider instructions remain in `whatsapp-cloud-notifications.md`.

## Security and recovery

Verification uses a salted one-way digest, a ten-minute expiry, five wrong-code
attempts, and consumption on success. Resend cooldown is sixty seconds and the
account send limit is five per day, checked against the latest canonical user
under the transaction lock. Phone ownership is unique across accounts. Web,
onboarding, and mobile endpoints share account rate limits. Ambiguous provider
sends are not automatically retried.

Registration checks the normalized private phone before provider signup and
rechecks against current accounts under the repository write lock. New regular
accounts and contact changes cannot reuse a saved or verified phone belonging
to another user. The three authorized accounts may share a private contact,
while verified OTP ownership remains unique even for them.

The `unique_exchange_phone_ownership` database migration enforces an expression
unique index over canonical verified numbers and a contact-write trigger.
Israeli local, international, punctuation, Arabic-digit, and Eastern Arabic-digit
formats resolve to the same key. Concurrent writes cannot claim two verified
owners. Later legacy duplicate verifications are retired; the first verification
and all accounts, contact fields, sessions, trades, and history are preserved.
Original retired verification values are retained in an inaccessible private
reconciliation table, and the runtime version advances to invalidate stale writes.

Changing the saved contact number clears verification and requires another SMS.
A forged phone cookie, stale exception boolean, client field, or restored page
cannot authorize marketplace access. Actual verification persists across
logout/login and preserves buyer and seller roles.

Verification, recovery, support, legal, and account deletion remain reachable.
Student browsing outside exchange pages remains available. An SMS delivery
outage leaves unverified exchange access blocked. Disabling OTP sends pauses
sending; feature flags do not relax production account access.

## Validation

The implementation is covered by production-switch, canonical authorization,
exact-account-exception, wrong-ID, phone-cookie, client-boundary, expiry, replay, concurrency,
unique-number, resend, number-change, delivery-selection, and mobile tests.
The web production build, web/mobile TypeScript checks, and affected ESLint
checks must pass before publishing.

The isolated production-mode HTTP rehearsal uses local accounts and local SMS
challenges with provider sending disabled. It checks login, redirects,
verification-screen HTML, WhatsApp unavailability, wrong-code rejection,
confirmation, replay prevention, persistence, and number-change revocation.
It does not establish carrier delivery to a real phone.

Live Twilio receipt and code confirmation must be verified separately. A Trust
Hub approval, queued message, or successful automated test is not proof of
carrier receipt.

Validation for the 3 October 2026 release: all 438 Vitest files / 3,829 tests
passed; web and mobile TypeScript, affected ESLint, and the production build
passed. The built-server rehearsal passed 107 HTTP assertions for buyer,
approved seller, pending seller, admin, owner, and a formerly exempt account.
Browser-engine execution was unavailable because Chromium is not installed;
rendered HTML and component interaction checks passed instead. No real SMS or
production account mutation was used for this rehearsal.
