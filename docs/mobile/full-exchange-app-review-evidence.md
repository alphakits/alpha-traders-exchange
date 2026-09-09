# Full Exchange App Review evidence dossier

This dossier defines the only acceptable public iPhone release for Alpha
Traders: the complete production product, including the Academy and the
peer-to-peer USDT Exchange. It is an evidence checklist, not a claim that Apple
has approved the product or that a particular licence is held.

## Non-negotiable release invariant

- The reviewed build must expose the same Exchange, listings, seller profiles,
  buyer and seller flows, Trade Room, chat, evidence, disputes, reviews,
  reporting, blocking, and account controls that users receive after release.
- App Store metadata and App Review notes must describe the USDT marketplace
  directly. The Exchange must not be hidden, dormant, renamed to disguise its
  function, or enabled remotely only after approval.
- The app must use the matching production backend commit throughout review.
  If the legal-entity, licensing, territory, or reviewer-access gate is not
  complete, delay submission rather than submit a reduced or misleading build.
- The future economic-calendar feature is a separate reviewed product update.
  It must not be silently introduced as a material post-review change.

## Apple review-risk matrix

| Review area | Alpha Traders evidence | Submission gate |
| --- | --- | --- |
| Guideline 2.1 — completeness | Signed build, live backend, two fictional reviewer accounts, seeded listing and Trade Room, full bilingual walkthrough | Reviewer completes both sides without real money, USDT, phone, bank, or identity data |
| Guideline 2.3 — accurate metadata | English and Arabic listing copy explicitly describe the USDT marketplace and full Trade Room | Screenshots, description, review notes, and installed behavior match |
| Guideline 3.1.5(iii) — cryptocurrency exchanges | Country-by-country licence/permission package and backend territory enforcement | Written responsible-owner and qualified-counsel sign-off before any storefront is enabled |
| Guideline 4.2 — minimum functionality | Native lock-screen push, badge sync, safe notification routing, app-switcher privacy masking, camera/photo evidence, offline recovery, mandatory updates, secure session migration, and system review prompt | Record these functions working in the signed build; do not rely only on screenshots of web pages |
| Guideline 1.2 — user-generated content | Direct-contact filtering, reporting, blocking, disputes, review moderation, support contact, and account enforcement | Capture evidence for filter, report, block/unblock, dispute, and moderation |
| Guideline 5.1 — privacy and regulated services | Public privacy policy, in-app account deletion, data-declaration worksheet, retention/provider reconciliation, legal-entity record | Exact live providers and submitting legal entity are confirmed before answering App Store Connect |

## Technical parity evidence

The following source evidence must point to the exact release commit:

| Capability | Evidence |
| --- | --- |
| Full production product | `apps/mobile/app/_layout.tsx` renders `WebsiteAppShell`; `apps/mobile/src/web/website-navigation.ts` pins the canonical HTTPS origin |
| Session continuity | Authenticated native tokens migrate into the canonical website session without exposing credentials to arbitrary documents |
| Native push | `apps/mobile/src/notifications/native-notifications.ts`, one-time cold-start routing in `apps/mobile/src/web/push-navigation-recovery.ts`, the native-web bridge, push subscription route, delivery service, and receipt handling |
| Trade evidence | Native camera/photo permission text is limited to active-trade receipts; microphone access is disabled |
| Safety | `src/components/account/user-safety-actions.tsx`, the user-block API, report form, dispute flow, contact filtering, and moderation controls |
| Release control | The isolated `npm run mobile:review-rehearsal`, ten-trade `npm run mobile:scale-rehearsal`, `scripts/verify-mobile-store-readiness.mjs`, the deployed-surface `npm run mobile:review-surface` preflight, and the full `npm run verify:release` gate |

## Established operating-history evidence

Do not place owner-specific history, community membership, or seller identity
details in this public repository. Before using any operating-duration,
participant-count, or historical-vetting claim in App Review, reconcile the
exact wording against evidence in the controlled private release record.

Suitable private evidence may include dated operational records, redacted
activity samples, the historical seller-vetting procedure, aggregate completed-
trade statistics, and a signed responsible-owner statement. Do not upload a
WhatsApp member list, conversation export, or seller identity document to Git,
App Store screenshots, or ordinary Review Notes. If Apple requests personal
evidence, confirm the secure submission channel and provide only the minimum
specifically requested material.

Once verified, the reviewer narrative may state:

> Alpha Traders formalizes a manually moderated community workflow with
> [VERIFIED OPERATING HISTORY]. The digital product was built to replace
> scattered manual coordination with approved seller access, structured
> listings, recorded Trade Rooms, in-platform communication, evidence,
> disputes, notifications, reviews, and enforceable safety controls.

Operating history supports product maturity and the reason for the safety
architecture. It does not by itself prove legal-entity status, regulatory
permission, or Apple approval.

## Fictional App Review scenario

Create these records only after the exact release backend is deployed. Store
credentials only in App Store Connect, never in Git or screenshots.

First run `npm run mobile:review-rehearsal`. That test uses only an in-memory
repository, non-deliverable identities, fictional evidence, and disabled
email/SMS channels. It verifies the complete happy path plus block, content
filtering, participant authorization, report, and dispute controls without
mutating production. It is source evidence, not a replacement for the live
signed-device walkthrough.

Then run `npm run mobile:scale-rehearsal`. It independently takes ten fictional
buyers and ten fictional approved sellers through simultaneous request,
acceptance, two-sided chat, buyer evidence, seller confirmation, release
evidence, buyer completion, listing reopening, commission creation, verified
review, and seller-response paths. It also verifies participant isolation and
privacy-safe notification copy. It is a deterministic concurrency regression
gate, not a capacity claim or production load test.

1. Create an email-verified fictional buyer with completed onboarding through
   the ordinary production registration flow.
2. Create an email-verified fictional seller through ordinary registration and
   seller application, approve it through the owner interface, then create and
   approve one clearly marked review listing. Use no real bank, wallet, phone,
   or identity details.
3. Seed one non-financial Trade Room whose status allows the reviewer to inspect
   the timeline, send a harmless message, inspect evidence controls, report the
   counterparty, and open a dispute without sending funds or USDT.
4. Provide the buyer and seller credentials in Apple's secure review fields.
5. Keep the production backend, listing, Trade Room, support contact, and both
   accounts available for the full review period.
6. After review, rotate or remove the credentials and preserve only the private
   release record required for audit purposes.

Do not expose, re-enable, or use `/api/admin/setup-test-accounts` or any
`/api/testing` endpoint to prepare production review data. These maintenance
surfaces are unavailable in production by design.

## Legal-entity and territory evidence

The following table must contain evidence, not marketing statements. A general
business registration, tax file, platform-approved seller badge, or
non-custodial architecture must not be described as a cryptocurrency licence.

| Required item | Evidence owner | Status before submission |
| --- | --- | --- |
| Apple team type and seller identity | Account Holder | Apple membership active; submitting identity resolved |
| Legal entity providing the regulated service | Business/legal owner | Exact registered name, entity status, address, and D-U-N-S record confirmed where applicable |
| Cryptocurrency permission | Qualified lawyer/compliance professional | Licence, regulator permission, or other documented legal basis for each enabled jurisdiction |
| Storefront list | Legal owner + release owner | Only signed-off countries selected; no default worldwide release |
| Backend territory enforcement | Engineering + release owner | Same country decision enforced by the service, not only App Store storefront settings |
| AML/KYC and sanctions process | Compliance owner | Current policy, responsible person, escalation path, and operational evidence |
| Direct-settlement explanation | Product owner | Accurate workflow diagram and reviewer explanation; no custody or escrow claim if none exists |
| Data/privacy reconciliation | Privacy owner | Supabase, Vercel, Expo Push, email/SMS, evidence storage, retention, and deletion behavior confirmed |

If counsel concludes that a particular licence is not required in a territory,
retain the written legal analysis and any relevant authority confirmation. Apple
may still request additional evidence or decline the territory; do not convert
that legal opinion into a claim that Apple has approved the Exchange.

## Reviewer answer building blocks

Use these only when supported by the live build and attached evidence.

### What does Alpha Traders do?

Alpha Traders provides bilingual trading education and a structured
peer-to-peer USDT marketplace. Approved sellers publish listings, buyers open a
request, and both parties use a recorded Trade Room with staged actions,
in-platform chat, evidence, notifications, disputes, and verified post-trade
reviews.

### Does Alpha Traders custody funds or USDT?

No. Alpha Traders coordinates and records the workflow. The buyer and seller
settle directly using the agreed real-world payment method and blockchain
network. Do not call this custodial escrow.

### What makes the iPhone app more than a web clipping?

The signed app provides native lock-screen notifications, badge state, secure
deep routing to the authorized trade, app-switcher privacy masking, native
camera/photo receipt selection, connectivity recovery, version enforcement,
secure session migration, and an operating-system review prompt after a
verified completed trade. Demonstrate each deterministic feature on the signed
build; the operating system decides whether to display the review prompt.

### How is abusive content handled?

The service filters outside-contact content, accepts reports, lets users block
and unblock accounts, prevents new interactions between blocked users, keeps
existing trade evidence available for disputes, moderates verified reviews,
and lets administrators restrict or suspend accounts.

### Where is the Exchange permitted?

Answer only from the completed territory matrix. Name the exact legal entity,
enabled territories, documentary basis, and backend restriction. Never answer
“global,” “licensed,” or “government approved” without documents supporting
that exact statement.

## Evidence capture package

Before submission, preserve a private release record containing:

- exact Git commit, build number, EAS build URL, TestFlight build, and backend
  deployment identifier;
- Apple membership/team type and the resolved Account Holder spelling;
- evidence supporting any submitted claims about four-plus years of operation,
  the existing community, seller vetting, and aggregate activity;
- signed legal-entity and territory matrix with supporting document dates;
- bilingual iPhone screen recording of the complete reviewer scenario;
- push tests from foreground, background, and terminated states;
- screenshots of report, block/unblock, dispute, review moderation, privacy,
  account deletion, and support paths;
- timestamps for backend health, reviewer-account verification, and production
  support-email delivery; and
- the exact App Store metadata, privacy answers, age rating, Review Notes, and
  screenshots submitted with the build.

No checklist or automated test guarantees App Review approval. This dossier
exists to remove preventable ambiguity and give Apple a complete, truthful,
reproducible review path for the full Exchange product.
