# App Review information-request response — 2026-09-19

This is the controlled response package for the first public Alpha Traders iOS
submission. It answers Apple's Guideline 2.1 information request without
hiding or reducing the Exchange. Replace bracketed values only from the final
signed build and private release record. Never commit passwords, identity
documents, bank details, wallet secrets, or production-user data.

## Case identity

| Field | Value |
| --- | --- |
| App | Alpha Traders |
| Version rejected | `1.2.0` |
| Build rejected | `7` |
| Guideline | `2.1.0 Performance: App Completeness` |
| Submission ID | `0a2470dc-4f2a-4c7e-8d4f-1b0a8d46cbe2` |
| Submitted | 2026-09-16 02:38 (App Store Connect display time) |
| Submitted by | Mark Jozen |
| Last delivered build | `15` (replacement selection requires confirmation) |
| Build 15 source | `04ca88536a3236c6edf109cb177e893d87da2c3f` |
| Production deployment | `[VERCEL_DEPLOYMENT_ID]` |

## Evidence reconciliation — 20 September 2026 UTC

Build **1.2.0 (15)** was signed and uploaded to TestFlight. The owner reported
selecting it, but Apple authentication prevented independent confirmation of the
saved selection. The website approval correction is a later backend revision. Native application
source and contracts are preserved from build 15; its root layout shows the
canonical website on every route. Confirm the saved build and test that signed
build against the corrected backend. Do not substitute an older recording.
The original technical results remain in the [candidate verification record](../audits/2026-09-19-sdk57-candidate-verification.md).

The previously uploaded Israeli VAT business registration certificate has been
located and visually inspected. It is available in the private release evidence;
no identity number, address, certificate image, or private file locator belongs
in this repository. Its presence resolves the request to locate business
registration evidence. It does not establish the cryptocurrency permission
basis or Apple's submitting-entity eligibility.

The earlier review account was located in production. The current admin view
shows an active Buyer and a rejected seller application. Previous conversational
claims of approved-seller access do not establish its current state. Keep the
reviewer credentials and fixture placeholders below until both roles are tested
against the final backend.

Owner direction on 2026-09-20 supersedes the additional on-site attestation
controls introduced by [PR #174](https://github.com/alphakits/alpha-traders-exchange/pull/174).
Preserve application on the website, identity-document and video review through
WhatsApp, and the ordinary authorized approve/reject decision on the website.
No retrospective verification entries or additional website identity checks are
required. Earlier inspection found 36 approved applications and created no
verification attestations. This observation is not independent review of their
private WhatsApp identity evidence.

The physical-iPhone recording, current reviewer access, and appropriate service
permission/content-rights evidence remain outstanding. The reply below is an
unsent template and must not be presented as a completed-evidence statement.

## Apple policy basis verified on 2026-09-20

- **Guideline 2.1 — App Completeness:** the submitted build must be final,
  tested on-device, backed by live services, and supplied with full demo access.
- **Guideline 3.1.5(iii) — Cryptocurrency exchanges:** transaction or
  transmission functionality may be offered only in countries or regions where
  the app has the appropriate licensing and permissions.
- **Guideline 5.1.1(ix) — Highly regulated services:** crypto-exchange apps
  should be submitted by the legal entity providing the service, not an
  individual developer account.
- App Store Connect permits a reply with supporting attachments while an issue
  is unresolved. The response and evidence must be sent through **Reply to App
  Review**, then the corrected build is resubmitted only after every gate below
  is complete.

Official sources:

- <https://developer.apple.com/app-store/review/guidelines/>
- <https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/reply-to-app-review-messages/>
- <https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information>

## Apple's six requested items

| Request | Required response evidence |
| --- | --- |
| 1. Physical-device demonstration | One continuous recording of the exact signed replacement build on a physical iPhone running the latest publicly released iOS supported by the build. Begin by launching the app, as Apple requested. Identify the app version and build during the capture and include device-model/iOS-version evidence. Show buyer access, approved-seller access, Exchange, a seeded non-financial Trade Room, safety controls, native push/deep link, privacy mask, support, and account deletion. |
| 2. Purpose, audience, problem, and value | Use the product explanation below. Target audience is adults 18+ in Israel who use Arabic or English trading education and a structured direct-settlement P2P USDT workflow. |
| 3. Setup and feature access | Keep two fictional accounts live: a verified Buyer and an Approved Seller. Put credentials only in App Store Connect. Seed a clearly named review listing and non-financial Trade Room; Apple must not register, provide identity data, transfer fiat, or send USDT. |
| 4. External services | Disclose Vercel, Supabase, Expo Push, Resend, TRON/TronGrid, and the bounded Academy media providers actually active in production. A live lesson was observed loading its video from Supabase Storage; its workbook is served by the first-party site. Reconcile optional Discord, Twilio, or Meta services against production before sending. |
| 5. Regional differences | App Store availability is Israel only. English and Arabic expose the same feature set. The native app presents monetary values in USD/USDT; ILS-denominated listing and settlement values are normalized with the live USD/ILS reference before display. Payment methods are the supported Israeli bank-transfer, cardless-ATM, and face-to-face flows. No post-review remote feature unlock is used. |
| 6. Regulated service / protected content authorization | Attach the exact submitting-entity record and the counsel-approved Israeli licensing/permission basis for the P2P USDT model. A tax/business registration may be included as entity evidence but must not be described as a cryptocurrency licence. Attach a signed content-rights statement for Academy material if requested. |

## Reply to App Review

Paste this into **Reply to App Review** only after every bracketed value is
resolved and the named attachments have been checked.

> Thank you for reviewing Alpha Traders 1.2.0 and for requesting additional
> information under Guideline 2.1. We have prepared replacement build
> [FINAL_BUILD_NUMBER] and expanded the App Review Information so every core
> feature can be reviewed without using real money, cryptocurrency, identity
> documents, or customer data.
>
> 1. Physical iPhone demonstration: We attached one continuous recording of
> the exact signed replacement build on a physical iPhone. It shows fresh
> launch, English and Arabic, Buyer and Approved Seller access, the Exchange,
> the marked fictional listing, both sides of the non-financial Trade Room,
> chat and safety controls, native notification routing, privacy masking,
> support, and account deletion.
>
> 2. Purpose and audience: Alpha Traders is for adults 18+ in Israel who use
> Arabic or English trading education and a structured peer-to-peer USDT
> workflow. It replaces scattered coordination with reviewed seller listings,
> purchase requests, a staged Trade Room, in-platform messages, evidence,
> notifications, disputes, reporting, blocking, and verified post-trade
> reviews. Alpha Traders does not custody buyer fiat or seller USDT; the two
> users settle directly.
>
> 3. Access: The secure review fields and Review Notes contain two fictional,
> pre-verified accounts: one Buyer and one Approved Seller. A clearly marked
> review listing and non-financial Trade Room are already prepared. The
> reviewer does not need to register, provide a phone number, submit identity
> documents, contact a real user, make a bank payment, or transfer USDT.
>
> 4. External services: Vercel hosts the first-party application and APIs;
> Supabase provides authentication, PostgreSQL, and object storage; Expo
> provides native push delivery; Resend provides transactional email; and
> TRON/TronGrid is queried read-only to verify submitted commission transaction
> IDs. Academy videos use the bounded media providers disclosed in our privacy
> and review records. The app contains no advertising SDK and does not use
> cross-app tracking.
>
> 5. Regions: This release is offered only in Israel. English and Arabic expose
> the same functionality. The native app presents monetary values in USD/USDT;
> ILS-denominated listing and settlement values are normalized with the live
> USD/ILS reference before display. The available payment workflows are the
> supported Israeli bank-transfer, cardless-ATM, and face-to-face methods. There
> is no hidden or post-review feature activation.
>
> 6. Authorization: The submitting service provider is [EXACT_LEGAL_ENTITY].
> We attached [ENTITY_DOCUMENT], [COUNSEL_OR_PERMISSION_DOCUMENT], and
> [CONTENT_RIGHTS_STATEMENT]. These documents identify the entity, Israel-only
> scope, legal basis, and rights to the Academy material. Our direct-settlement
> design is described accurately and is not presented as custody or escrow.
>
> The production backend, support contact, review listing, Trade Room, and both
> reviewer accounts will remain available throughout review. We respectfully
> request review of build [FINAL_BUILD_NUMBER], and we are ready to answer any
> specific follow-up question.

## App Review Notes (4,000-character field)

The text between the markers is machine-checked for Apple's 4,000-character
limit. Add credentials only in App Store Connect immediately before submission;
do not put them in this file.

<!-- APP_REVIEW_NOTES_START -->
Alpha Traders 1.2.0 build [FINAL_BUILD_NUMBER] is a final public iPhone app for adults 18+ in Israel. It combines bilingual Arabic/English trading education with a structured direct-settlement peer-to-peer USDT marketplace. Approved sellers publish owner-reviewed listings; buyers submit requests; both sides use a staged Trade Room with in-platform chat, evidence, status guidance, notifications, disputes, reporting, blocking, and verified post-trade reviews. Alpha Traders does not custody buyer fiat or seller USDT. The parties settle directly. A 1% seller service commission is recorded only after a completed marketplace trade; the app does not sell digital content or cryptocurrency through Apple In-App Purchase.

The Academy material available in this build is not sold or unlocked inside the app. There are no In-App Purchase products or paid digital-feature unlocks in this version.

REVIEW ACCESS — NO REAL FUNDS REQUIRED
Buyer account: use the Username and Password fields above.
Approved Seller account: [ENTER_SELLER_USERNAME_AND_PASSWORD_ONLY_IN_APP_STORE_CONNECT].
Both accounts are fictional, email-verified, fully onboarded, and contain no real identity, bank, wallet, or customer data. Open Exchange > the listing named “[REVIEW_LISTING_NAME]” > Purchase Requests/Trade Room “[REVIEW_TRADE_REFERENCE]”. The prepared Trade Room lets you inspect both roles, timeline, chat, evidence UI, report/block, and dispute controls without making a bank payment or sending USDT. Do not register a new account or contact a real seller.

Suggested path: launch > English or Arabic > sign in as Buyer > Exchange > marked review listing > prepared Trade Room > Notifications > Profile/Settings > Support > Account Deletion. Sign out and use the Approved Seller account > Seller Workspace > My Listings/Purchase Requests > the same prepared Trade Room. Native push, badge routing, camera/photo evidence permissions, offline recovery, update enforcement, and app-switcher privacy masking are demonstrated in the attached physical-iPhone recording. The iOS rating prompt is requested only after a verified completed trade and iOS decides whether to display it.

External services: Vercel (first-party app/API hosting); Supabase (authentication, PostgreSQL, object storage); Expo (native push); Resend (transactional email); TRON/TronGrid (read-only verification of submitted commission transaction IDs); and bounded Academy video hosting. No advertising SDK or cross-app tracking is used. Website market references use Binance/Coinbase and open.er-api/Frankfurter; charts use TradingView. SMS and automated WhatsApp sending were inactive at the last production check. Recheck optional Discord before submission.

Region: Israel storefront only. English and Arabic have the same features. The native app presents monetary values in USD/USDT; ILS-denominated listing and settlement values are normalized using the live USD/ILS reference before display. Supported payment flows are Israeli bank transfer, cardless ATM, and face-to-face. No feature is hidden or remotely enabled after review.

Regulated-service evidence: submitting provider [EXACT_LEGAL_ENTITY]. Attached: [ENTITY_DOCUMENT], [COUNSEL_OR_PERMISSION_DOCUMENT], and [CONTENT_RIGHTS_STATEMENT]. A business/tax registration is entity evidence and is not described as a cryptocurrency licence. The full non-custodial workflow and Israel-only scope are shown in the recording and attachments.

Support: support@alphatraders.co.il. The production backend and reviewer fixtures will stay available throughout review.
<!-- APP_REVIEW_NOTES_END -->

## Required attachment manifest

| Attachment | Must show | Status |
| --- | --- | --- |
| Physical-iPhone recording | Device model; current iOS version; exact app version and replacement build number; continuous Buyer and Approved Seller journey; no edits that hide a failure; no real user or financial data | `[required]` |
| Submitting-entity record | Exact legal provider name matching the Apple team and submission | `[required]` |
| Israel permission/legal analysis | Exact P2P USDT model, commissions, direct settlement, territory, issuing authority or qualified legal conclusion, date, and validity | `[required]` |
| Content-rights statement | Owner authorization for every Academy course/video/document included in the build | `[required]` |
| Redacted operational sample | Canonical Trade Room export with immutable reference, timestamps, payment method, lifecycle, completion state, and commission reconciliation; no direct identifiers, bank data, wallet address, chat, location, or evidence media | `[optional support; never a legal substitute]` |
| Redacted seller-approval process | Website application; government-ID review and live-video identity match through WhatsApp; ordinary admin approval/rejection audit trail; listing authorization; monitoring; suspension; and appeal stages using a fictional or permanently redacted example. Include no raw seller identity document or video. | `[optional support]` |
| Optional architecture summary | Direct-settlement diagram and list of providers, with no secrets or customer data | `[recommended]` |

### Operational-evidence boundary

A recent real trade may support a narrow statement that the platform has an
operating, timestamped workflow only after its screenshot, canonical Trade Room
record, stored price/amount/currency, payment method, completion state, and
commission record are reconciled. A cash photo, a commission-payment screen, or
an owner-written note does not independently establish the trade amount,
currency, parties, payment method, or completion. Never use a real trade as the
review fixture, and never expose a customer or seller merely to demonstrate
that the marketplace operates.

Every transfer receipt in an optional operational sample must use the expected
network and destination, be independently confirmed on-chain, and reconcile to
the canonical delivered quantity after explicitly documented fees. A screenshot
marked **Pending** or **Evidence Missing** cannot prove completion. If requested
and delivered quantities differ, state the exact discrepancy; never round it
away or use chat wording in place of the authoritative receipt and platform
ledger.

Seller identity documents demonstrate that a review input exists; they do not
prove regulatory approval and should not be uploaded to App Review by default.
Use a fictional seller or a permanently redacted approval-log example. If Apple
specifically requests a real identity document, stop and obtain privacy/legal
approval for the exact disclosure and secure channel before sending it.

## Do-not-resubmit gate

Do not select **Resubmit to App Review** until all of these are true:

- the replacement build number, release commit, and matching production
  deployment are recorded;
- the exact build passes the source gate, public preflight, and English/Arabic
  physical-iPhone journey;
- the 148-flow Chromium reliability suite passes against the exact replacement
  commit, and the immutable workflow run URL plus report/artifact are archived;
- the Buyer and Approved Seller credentials work without owner intervention;
- the marked listing and non-financial Trade Room are visible to both roles;
- the physical-iPhone recording is attached and contains no sensitive data;
- every quantitative operational claim is reconciled to a dated canonical
  export, and no real transaction is used as Apple's review fixture;
- any optional completed-trade sample has a final completed platform state and
  confirmed chain receipts whose exact total reconciles to the delivered amount;
- the required App Store screenshots show the actual signed app in use (not
  title art, a login page, or a splash screen) and App Store Connect no longer
  reports zero screenshots;
- App Review Notes contain no bracketed placeholders and remain below 4,000
  characters;
- the exact legal entity and Israel-specific permission/legal basis are
  attached and approved for sending;
- the content-rights statement is signed and attached if Apple expects it;
- App Store availability is limited to the signed-off storefront and matches
  the backend release decision; and
- the old exposed reviewer password is rotated before the credentials are
  entered again.

Apple's 2.1 information request can be answered with this package, but Apple's
cryptocurrency rule remains an independent gate: an Exchange build may be
offered only where the submitting provider has the appropriate licensing and
permissions. Technical tests and an ordinary business registration cannot
replace that evidence.
