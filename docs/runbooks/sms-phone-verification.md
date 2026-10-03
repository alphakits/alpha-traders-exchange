# Buyer and seller SMS and WhatsApp verification rollout

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

### SMS sender and member choice

Twilio error `21266` means the sending and receiving numbers are the same. A
member's personal WhatsApp number must not also be used as their SMS sender.
Configure one valid SMS identity, in this priority order:

1. `TWILIO_SMS_MESSAGING_SERVICE_SID`: an existing `MG...` Messaging Service with
   an approved sender pool and the required destination permissions.
2. `TWILIO_SMS_FROM`: an account-owned SMS number or an alphanumeric identity
   supported and enabled for the destination country and account.
3. `TWILIO_PHONE_NUMBER`: legacy SMS number, retained for older deployments.

An invalid explicit identity fails closed instead of falling back to the
personal number. A sender equal to the normalized recipient is rejected before
replacing a verification challenge. SMS configuration does not change the
registered WhatsApp sender or migrate a personal WhatsApp account.

Web settings, verification, onboarding, and native settings let members choose
`sms` or `whatsapp`. The server returns only boolean channel capabilities and
checks readiness again on each request. Unavailable channels are shown as
unavailable. An omitted channel retains the configured legacy default; a
supplied invalid channel is rejected. Delivery attempts never switch transports
automatically. Both choices use the same canonical verification challenge,
expiry, resend limits, and buyer/seller access policy.

### Twilio WhatsApp configuration

Use an already registered WhatsApp Business sender and approved Content
Templates. Do not delete, migrate, or reset a personal WhatsApp account while
configuring delivery.

| Variable | Value |
| --- | --- |
| `ALPHA_EXCHANGE_WHATSAPP_PROVIDER` | `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Existing account's server-only credentials |
| `TWILIO_WHATSAPP_FROM` | Registered sender in E.164 format |
| `TWILIO_WHATSAPP_CONTENT_SIDS` | JSON mapping template names to approved English and Arabic `HX...` Content SIDs |
| `ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED` | `true` after authentication delivery is ready |
| `ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED` | `true` after actual authentication template approval |
| `ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED` | Preserve the genuine approval state |
| `ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE` | Genuine recorded approval reference |
| `ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED` | Independent existing trade-notification switch |

The authentication template is `alpha_phone_verification`. Its English and
Arabic Content Templates must both exist; variable `1` holds the six-digit
code. Template sends use `ContentSid` and `ContentVariables`, without a freeform
`Body`. Authentication delivery can be enabled while trade notifications remain
disabled.

Trade notification templates are `alpha_new_request`, `alpha_request_accepted`,
`alpha_request_declined`, `alpha_trade_update`, `alpha_trade_room_message`,
`alpha_trade_room_reminder`, `alpha_request_completed`, and
`alpha_request_cancelled`. Configure both language SIDs for every template
before enabling the utility outbox. These alerts retain the existing consent,
deduplication, locale, retry, and privacy rules; they do not contain bank details,
credentials, or copied Trade Room messages.

Configure the registered sender's incoming-message webhook as a POST to
`https://www.alphatraders.co.il/api/twilio/whatsapp/webhook`. Outbound template
requests also specify this URL for status callbacks. `NEXT_PUBLIC_SITE_URL`
must match the exact public URL Twilio signs. The handler verifies the Twilio
signature and account before applying delivered/read/failed status updates or
revoking notification consent for recognized STOP messages. It never imports
ordinary incoming WhatsApp messages into Trade Room chat.

Prove each enabled channel with an actual received code and successful website
confirmation. A Twilio acceptance or queued status alone does not prove receipt.
Repeat English and Arabic delivery, persistence after login, expiry, and access
for a buyer and seller before enabling mandatory verification.

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
`/verify-account`; email verification remains required. Only the owner's three
explicitly approved account emails are exempt from the phone requirement.
An owner/admin role alone grants no exemption. Support, legal, account deletion,
and verification endpoints remain reachable.
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
authorization, the three explicit account exemptions, unverified admin/owner
roles, non-exchange student access, recovery
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

The browser boundary also hides exchange content after canonical verification
is revoked or a cached page is restored. Authenticated listing, seller-profile,
and marketplace-pulse reads enforce the same phone rule before reading data.
Exemption is a separate server-resolved policy result: exempt accounts are not
marked as having a verified phone, and no exception list is sent to the browser.

Run `npm run test:e2e:phone-verification` for the isolated mandatory-gate profile.
It enables the phone requirement with all provider sends disabled and checks
five non-exempt roles, the three exact email exceptions, genuine verified buyer
and seller access, recovery access, and revocation after a phone change.
These browser checks do not prove SMS receipt or authorize production activation.
