# Full Exchange App Review dry run

Use this run on the exact production backend and exact signed build intended
for Apple. Its purpose is to give the reviewer a complete, truthful, repeatable
path through the full Exchange. It does not guarantee approval and it must not
use real money, USDT, bank details, wallet secrets, identity documents, or
production-user data.

## Prerequisites

- The release commit passed `npm run mobile:review-rehearsal`,
  `npm run mobile:scale-rehearsal`,
  `npm run verify:release`, and `npm run mobile:store-readiness`.
- That exact backend commit is deployed and `npm run mobile:review-surface`
  passes against `https://www.alphatraders.co.il`.
- The iOS build is signed from the same commit and its build number is recorded.
- A fictional verified buyer and fictional approved seller exist in production.
- The seller has one clearly named App Review listing and the two accounts have
  a non-financial review Trade Room. No real user record is reused.
- Credentials are stored only in App Store Connect's secure review fields.
- Push delivery is configured for the signed build, and the support inbox is
  monitored throughout review.

## Automated rehearsal boundary

Run `npm run mobile:review-rehearsal` before any deployment or signed build. It
executes the real Exchange domain logic against an in-memory repository with
non-deliverable `example.test` identities and email/SMS disabled. It proves the
fictional listing and approval, buyer price offer, staged bank-detail access,
two-sided Trade Room chat and Seen state, evidence controls, complete
settlement-state machine, listing remainder, commission record, verified
review and seller response, block/unblock, outside-contact rejection, report,
participant authorization, and dispute escalation.

The automated rehearsal never connects to the production database and never
creates production users, listings, trades, evidence, messages, or
notifications. It also does not prove deployed authentication, native push,
camera/photo permissions, signed-build behavior, accessibility, or Apple
approval; those remain mandatory rows in the signed-device journey below.

Run `npm run mobile:scale-rehearsal` alongside it. This second isolated test
uses ten fictional buyers and ten fictional approved sellers to verify that
concurrent chat, evidence, status transitions, completion, commissions,
listing reopening, reviews, and seller responses remain complete and
participant-isolated. It does not establish public traffic capacity; production
load and operational monitoring remain separate evidence.

Create the two production reviewer accounts only through ordinary production
registration, email verification, seller application/approval, listing
creation, and owner approval. Never enable or use
`/api/admin/setup-test-accounts` or any `/api/testing` route for App Review;
those routes are production-disabled and must remain so. Use only clearly
fictional, non-financial values, keep credentials in App Store Connect's secure
review fields, and record fixture identifiers only in the private release
record.

## Exact reviewer journey

Run the journey once in English and once in Arabic. Capture the build number,
commit SHA, device/OS, backend deployment identifier, UTC time, outcome, and a
short screen recording with only fictional data.

| Step | Reviewer action | Required result |
| --- | --- | --- |
| 1. Install and launch | Fresh-install the submitted build and open it on a physical iPhone | Branded launch completes without a blank screen, crash, debug menu, or beta-only instruction |
| 2. Public disclosure | Before login, open the Exchange description, Terms, Privacy, Safety & Trust, Support, and Account Deletion | USDT and direct settlement are described accurately; every page works inside the app |
| 3. Buyer login | Sign in with the fictional buyer | Login succeeds without OTP from the owner; the complete Academy and Exchange are visible |
| 4. Marketplace | Open the review listing and approved seller profile | Price, limits, methods, network, seller signals, reviews, and risk copy render correctly |
| 5. Buyer request | Start the fictional request and acknowledge the safety guidance | Validation works and the exact seeded Trade Room opens without sending payment |
| 6. Trade Room | Inspect timeline, chat, evidence, dispute, report, and block controls; on a reset fictional request, rapidly press two competing lifecycle controls | The reviewer can inspect every safety path; outside-contact content is rejected, only one competing mutation begins, the room reconciles to the server state, and no real financial action is required |
| 7. Evidence picker | Open receipt evidence, test photo-library/camera denial, then allow access with a harmless fixture | Permission copy names active-trade evidence, denial is recoverable, and no microphone permission appears |
| 8. Seller login | Sign out, then sign in with the fictional approved seller | Seller workspace and the same Trade Room are available without owner intervention |
| 9. Seller controls | Inspect listing availability and permitted Trade Room actions | Role restrictions and current stage are clear; no action implies custody or guaranteed settlement |
| 10. Native push | With the app foregrounded, backgrounded, and terminated, send privacy-safe review notifications; during a cold launch, tap notification A and then notification B | Delivery uses no amount, chat, bank, wallet, phone, or evidence content; the newest trusted tap opens once, and a later ordinary relaunch must not reopen either notification |
| 11. Native badge | Create/read fictional notifications | App icon badge matches unread state and clears after the web session reports zero |
| 12. Privacy mask | Open the fictional Trade Room, then background the app and view the app switcher | The native Alpha Traders privacy surface covers account and trade content before the app is inactive |
| 13. Recovery | Disable/re-enable connectivity and relaunch after terminating the web content process | The bilingual offline/error surface appears, retry recovers, and no trade action is queued offline |
| 14. Support and safety | Send one harmless support test, submit a fictional abuse report, block/unblock the fictional counterparty, and start account deletion without finalizing it | Each action is discoverable in-app and reaches the expected monitored workflow |
| 15. Accessibility | Repeat critical screens with large text, VoiceOver, and Arabic RTL | Controls remain readable, labeled, reachable, and ordered correctly |

The system-controlled rating prompt is triggered only after a verified completed
trade and may not be displayed every time. Record that the native request path
was reached, but never describe the prompt's visible appearance as guaranteed.

## Evidence record

Keep the following in the private release record, never in Git or ordinary App
Review notes:

- the public preflight output and UTC timestamp;
- exact signed build URL, build number, commit SHA, and backend deployment ID;
- the completed bilingual journey table and device matrix;
- redacted recordings of push routing, evidence permission, privacy masking,
  reporting/blocking, support, deletion initiation, and recovery; and
- confirmation that reviewer credentials, listing, Trade Room, and support
  inbox will remain available for the full review period.

Seller identity documents, WhatsApp exports, member lists, bank details, wallet
secrets, payment evidence, passwords, signing credentials, and production-user
records do not belong in this package. If Apple requests personal or regulated
evidence, use Apple's specified secure channel and provide only the minimum
material approved for that request.

## Pass-or-block decision

Any failed or unreproducible row blocks submission. Fix the issue, deploy a new
backend or signed build as applicable, rerun the source gate and public
preflight, then repeat the affected row plus one complete smoke journey. Submit
only when the full Exchange shown in the build, screenshots, metadata, legal
evidence, and Review Notes is the same product users will receive.
