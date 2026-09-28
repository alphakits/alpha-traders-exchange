# Meta WhatsApp Cloud notifications

This integration sends fixed Utility and Authentication templates directly
through Meta's WhatsApp Cloud API. It does not require Twilio. It is
intentionally fail-closed: deploying the code or adding credentials cannot
send a message unless the relevant send switch, policy acknowledgement,
approval reference, and approved-template gate are all enabled.

## Current email-only baseline

Account verification currently uses email only. Keep
`ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED=false` and
`ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER=disabled` in production. Phone
verification endpoints and phone-code delivery remain unavailable in this
state.

Twilio is independently fail-closed. Keep
`ALPHA_EXCHANGE_TWILIO_SEND_ENABLED=false`; stored `TWILIO_*` credentials alone
cannot enable SMS or phone-code delivery. Remove unused Twilio credentials from
the production environment when operational access is available, but do not
treat credential removal as the kill switch.

## Policy gate

Do not enable consent collection or outbound delivery until Meta has provided
written clearance that explicitly covers the disclosed Alpha Exchange
peer-to-peer virtual-currency workflow and identifies the relevant Business
Portfolio and WhatsApp Business Account.

Retain the Meta case ID, decision text, approval date, Business Portfolio ID,
WhatsApp Business Account ID, phone-number ID, and approved-template evidence.
Record the case ID or decision reference in
`ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE`.

Neutral wording is used to protect user privacy on lock screens and shared
devices. It must never be described to Meta as a way to conceal the underlying
business activity.

## Utility templates to submit

Create these templates in WhatsApp Manager. They contain no variables and may
use a fixed **Open Alpha Traders** website button to the authenticated site.
Submit both `en_US` and `ar` translations.

| Template name | English body |
| --- | --- |
| `alpha_new_request` | You have a new request. Open Alpha Traders to review it. |
| `alpha_request_accepted` | Your request was accepted. Open Alpha Traders to continue. |
| `alpha_request_declined` | Your request was declined. Open Alpha Traders for details. |
| `alpha_trade_update` | Your active Trade Room has a new status update. Open Alpha Traders. |
| `alpha_trade_room_message` | A new message is waiting in your active Trade Room. Open Alpha Traders to read it. |
| `alpha_trade_room_reminder` | A participant is waiting in your active Trade Room. Open Alpha Traders. |
| `alpha_request_completed` | Your request is complete. Open Alpha Traders for details. |
| `alpha_request_cancelled` | Your request was cancelled. Open Alpha Traders for details. |

Keep the approved Meta templates synchronized with
`src/lib/whatsapp-platform.ts`. Do not add amounts, chat content, wallet or bank
details, contact details, or payment instructions.

## Authentication template to submit

Create `alpha_phone_verification` as an **AUTHENTICATION** template in both
`en_US` and `ar`. Use Meta's OTP **Copy Code** button, enable the security
recommendation, and set the code expiry to 10 minutes. The application supplies
only the six-digit code as the body and copy-button parameter; it never puts the
code in application logs or API responses.

This template is used only after an authenticated user explicitly requests
phone verification. It has its own activation switch so an internal OTP test
does not enable request or Trade Room notifications. Set
`ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED=true` only after both language
versions show as approved in WhatsApp Manager.

## Meta configuration

1. Add a WhatsApp account and sender number to the Alpha Traders Business
   Portfolio.
2. Configure the callback URL as
   `https://www.alphatraders.co.il/api/meta/whatsapp/webhook`.
3. Set a new random verify token and subscribe the app to the `messages`
   webhook field.
4. Use a System User access token with the minimum WhatsApp permissions needed
   for the approved account. Store every credential only as a server-side
   Vercel environment variable.
5. Keep the Graph API version pinned and update it deliberately before Meta's
   version retirement date.

Required variables are documented in `.env.example`. The safe activation
order after written approval is:

1. Apply
   `supabase/migrations/20260912023000_alpha_exchange_whatsapp_notifications.sql`
   to the production database before deploying or enabling either feature
   switch. The application does not create these tables at runtime.
2. Add all `META_WHATSAPP_*` credentials and the approval reference.
3. Set `ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED=true`.
4. Verify the webhook challenge and delivery-receipt callbacks.
5. Confirm both `alpha_phone_verification` language versions are approved, then
   set `ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED=true`,
   `ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED=true`, and
   `ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER=whatsapp`. Only after those
   checks pass and phone verification is deliberately approved for release,
   set `ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED=true`. Leave
   `ALPHA_EXCHANGE_TWILIO_SEND_ENABLED=false`.
6. Deploy and have one internal account explicitly request a code. Confirm it
   arrives once through WhatsApp, expires after 10 minutes, and verifies the
   same phone. A timeout is not retried automatically; request a new code under
   the normal rate limit instead.
7. Set `ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED=true`, deploy, enrol the
   internal verified account, and confirm the stored consent proof.
8. Set `ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED=true` and deploy.
9. Run one request-status test, one Trade Room message test, one receipt test,
   and one `STOP` revocation test before broader enrolment.

Retries and post-commit recovery run independently every five minutes through
`/api/cron/whatsapp-delivery`; they do not depend on trade maintenance or
reminder jobs succeeding first.

## Runtime safeguards

- Only the authenticated user's verified E.164 phone can be enrolled.
- Trade recipients are derived from the canonical buyer and seller records.
- Every user starts opted out; existing profile or verified phone values are
  never backfilled into WhatsApp consent.
- Consent is versioned and tied to a fingerprint of the verified phone.
- A phone change, Settings opt-out, or inbound `STOP` revokes delivery.
- The SQL outbox deduplicates application publications by notification
  revision and retries transient failures. Provider/network timeouts are
  inherently ambiguous, so delivery is best-effort at-least-once and a rare
  duplicate remains possible. It records only template/status metadata—never
  message content or a raw phone number.
- Webhook bodies are accepted only after an app-secret HMAC check. Inbound
  WhatsApp messages cannot update trades; only recognized opt-out commands are
  acted on.

## Emergency stop and rollback

Set `ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED=false` and redeploy to stop Utility
notifications while leaving audit and consent records intact. Set
`ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED=false` to restore email-only account
verification, and set `ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED=false` to stop
WhatsApp phone-code delivery independently. Keep
`ALPHA_EXCHANGE_TWILIO_SEND_ENABLED=false` to block all Twilio sends even if
credentials still exist. If the consent experience must also be hidden, set
`ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED=false`. Rotate the access token and
webhook token after any suspected credential exposure.
