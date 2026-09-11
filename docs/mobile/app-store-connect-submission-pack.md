# Alpha Traders App Store Connect submission pack

This is the controlled handoff for the full Alpha Traders iPhone app. It keeps
source readiness separate from Apple-account, legal, signed-build, and
real-device evidence. Do not submit an Academy-only build or remove the
Exchange without an explicit product decision.

## Reviewed feature consistency

The owner has made the full Exchange a non-negotiable part of the app. The
reviewed build, metadata, screenshots, reviewer accounts, and production
backend must therefore expose and describe the same complete USDT marketplace.
Do not submit an Academy-only presentation, hide or disguise the Exchange, or
enable it remotely only after approval. If Apple-account, legal-entity,
licensing, storefront, or reviewer evidence is incomplete, delay submission.

Use `docs/mobile/full-exchange-app-review-evidence.md` as the evidence dossier.
Use `docs/mobile/app-review-response-playbook.md` for every Apple information
request or review objection; it separates verified answers from legal and
account-holder questions that must be escalated.
Create the controlled evidence/case record from
`docs/mobile/app-review-private-record-template.md`; never populate the
repository template with credentials, identity documents, or user data.
The requested high-impact economic-calendar feature is planned separately in
`docs/mobile/economic-calendar-post-release-plan.md` and is not part of this
first stable release candidate.

## Release identity

| Field | Value |
| --- | --- |
| App name | Alpha Traders |
| Version | `1.2.0` |
| iOS bundle ID | `com.alphakits.alphatraders` |
| EAS project ID | `e5dbc3ba-25fb-4373-8ded-c8c80cadc147` |
| URL scheme | `alphatraders` |
| Primary category | Finance |
| Secondary category | Education |
| Support contact | `support@alphatraders.co.il` |
| Support URL | `https://www.alphatraders.co.il/en/support` |
| Privacy URL | `https://www.alphatraders.co.il/en/privacy-policy` |
| Account deletion URL | `https://www.alphatraders.co.il/en/account-deletion` |

The exact English and Arabic listing copy is machine-checked in
`apps/mobile/store-metadata.json`. Copy it without adding claims that Alpha
Traders, a seller, or a trade is government-approved, licensed, guaranteed,
risk-free, or custodial unless current documentary evidence supports that exact
claim.

## App Review notes

Paste the following into App Review Information, then replace only the bracketed
review-account instructions inside App Store Connect. Never commit reviewer
passwords, verification codes, session tokens, or identity documents.

> Alpha Traders is a bilingual education and peer-to-peer USDT workflow. The
> submitted iPhone app renders the complete production Alpha Traders product so
> website and app users receive the same marketplace rules, Trade Room state,
> safety copy, Arabic RTL experience, and account controls. Native iOS features
> add a branded installed experience, lock-screen push notifications, badge
> synchronization, safe notification routing to the correct authorized trade,
> app-switcher privacy masking, connectivity recovery, mandatory-version
> enforcement, camera/photo receipt selection, and a system-controlled review
> prompt after a verified completed trade.
>
> Alpha Traders formalizes a manually moderated community workflow. The digital
> product replaces scattered manual coordination with controlled listings,
> recorded Trade Rooms, in-platform communication, evidence, disputes,
> notifications, reviews, and account enforcement. Any claim about operating
> duration or participant counts must be added only after it is reconciled in
> the controlled private release record.
>
> Alpha Traders does not custody principal funds. Buyers and sellers settle
> directly using the agreed real-world payment method and blockchain network.
> The app does not sell cryptocurrency or digital content through Apple In-App
> Purchase. Seller service commissions relate to completed peer-to-peer
> marketplace transactions, not digital content consumed in the app.
>
> User-generated content controls are available in the app: contact details and
> outside-contact links are filtered from marketplace and Trade Room content;
> users can submit an abuse report, block or unblock another account, and open a
> dispute; blocking hides the account's listings and prevents future trades;
> verified-purchase reviews can be moderated; and Alpha Traders can restrict or
> suspend accounts. Existing active Trade Rooms remain available after a block
> so financial records, evidence, and dispute access are not destroyed.
>
> Review access: use the two fictional accounts supplied in the secure Username
> and Password fields. [BUYER ACCOUNT] can browse listings, open its pre-seeded
> Trade Room, chat, view status, report/block its counterparty, and view account
> deletion. [APPROVED SELLER ACCOUNT] can manage listings and complete the seller
> side. No real person, bank account, wallet, or transaction data is used.
>
> Suggested path: launch → choose English or Arabic → sign in as buyer → Exchange
> → open the marked review listing/Trade Room → Notifications → Profile/Settings
> → Account Deletion. Sign in as the approved seller to inspect seller listing
> controls and the opposite side of the same fictional trade. Native push must
> be tested on the signed build after notification permission is allowed. The
> iOS review prompt is controlled by the operating system and may not display on
> every attempt.
>
> Support: support@alphatraders.co.il. The production backend and reviewer
> accounts will remain available throughout review.

Before submission, archive redacted private evidence supporting the established
operating-history paragraph. Do not include WhatsApp member lists, conversation
exports, or seller identity documents in Review Notes.

Before submission, add concise notes identifying the exact fictional listing
and Trade Room IDs. Do not ask the reviewer to register, supply a real phone
number, transfer money, send USDT, or contact a real seller.

## Reviewer-account preparation

Create and verify two fictional production accounts only after the final backend
deployment. Store their credentials solely in App Store Connect's secure review
fields.

Before creating them, run `npm run mobile:review-rehearsal` and
`npm run mobile:scale-rehearsal`. Both rehearsals are in-memory source
verification only; they do not create or modify production accounts or trades.
Create the live reviewer identities through ordinary
registration and verification, then use the normal seller application,
owner-approval, listing, and listing-approval controls. Do not expose or use
`/api/admin/setup-test-accounts` or `/api/testing` endpoints in production.

| Account | Required state | Reviewer evidence |
| --- | --- | --- |
| Buyer | Email verified, onboarding complete, no real contact/payment data | Can open Exchange, notifications, profile, safety controls, and a fictional Trade Room |
| Approved seller | Email verified, approved seller, one approved fictional listing | Can open seller workspace and the seller side of the fictional Trade Room |

Seed one non-financial review scenario. The reviewer must not need to make a
bank transfer, blockchain transfer, commission payment, or phone verification
request. Record the account IDs and fixture IDs in the private release record,
not this repository. Remove or rotate the accounts after review.

## App Privacy declaration worksheet

This worksheet reflects the current source and must be reconciled with the live
production providers immediately before answering App Store Connect. All listed
data is used for app functionality and/or fraud prevention/security, is linked
to the user's account where stated, and is **not used for third-party tracking**.
The app does not request App Tracking Transparency permission and has no ad SDK.

| Apple data category | Current Alpha Traders use | Linked to user | Tracking |
| --- | --- | --- | --- |
| Contact info | Name, email, verified phone/WhatsApp number where supplied | Yes | No |
| Coarse location | User-entered country and city; no device-location permission | Yes | No |
| Financial info | Seller bank details and buyer receiving-wallet address needed for a trade | Yes; stage- and role-restricted | No |
| Purchase history | Listings, P2P trade requests, amounts, states, commissions, and dispute history | Yes | No |
| User content | Profile image/bio, listings, Trade Room messages, receipt evidence, reviews, reports, and support messages | Yes | No |
| Identifiers | Account ID, random installation/device ID, session records, and Expo push token | Yes | No |
| Usage data | Lesson progress, notification state/preferences, marketplace and Trade Room state changes | Yes | No |
| Diagnostics | Request IDs, delivery state, and bounded technical/security logs | May be linked for security | No |

Verify retention, provider processing, and deletion behavior against Vercel,
Supabase, Expo Push, email/SMS providers, and any production-only service before
submission. If production behavior differs, update both the public privacy
policy and App Store answers before uploading the build.

Account deletion is initiated inside the full app from the Account Deletion
page. It also remains available on the public web URL when the app has been
removed. The form explains verification, active-trade resolution, the normal
30-day completion target, and limited legal/security retention.

## User-generated content safety evidence

Capture reviewer evidence for each control; a source implementation alone is
not enough.

| Control | In-product path | Required evidence |
| --- | --- | --- |
| Content filtering | Marketplace profiles/listings and Trade Room chat | Attempted phone, email, WhatsApp, social handle, and outside-contact link are rejected/redacted |
| Report | Any user profile or Trade Room → Report user | In-app report form accepts target reference, trade/listing ID, time, and description |
| Block/unblock | Any user profile or Trade Room → Block user | Block hides listings and prevents a new trade; unblock restores eligibility |
| Active-trade safety | Block inside an existing Trade Room | Existing record/evidence/dispute access remains; no new match can start |
| Review moderation | Verified post-trade review and admin moderation | Only eligible completed trades review; hidden review is absent publicly |
| Enforcement/contact | Report Abuse, Support, and admin controls | Published support contact works; abusive account can be restricted/suspended |

## Screenshot capture plan

Use the exact signed release build and the current device sizes requested by App
Store Connect. Capture native status bars and safe areas; do not paste the
website into a phone frame, stretch images, show browser chrome, or use real
customer/trade data. Keep one coherent fictional dataset across every screen.

| Order | English screenshot | Arabic counterpart | Native/review value shown |
| --- | --- | --- | --- |
| 1 | Branded home and learning entry | Arabic home with correct RTL | Installed brand and bilingual product |
| 2 | Academy catalog/lesson | Arabic lesson | Education beyond the marketplace |
| 3 | Active seller listings and filters | Arabic marketplace | Full responsive marketplace |
| 4 | Seller profile, trust signals, reviews | Arabic seller profile | Verified feedback and safety actions |
| 5 | Guided Trade Room timeline | Arabic Trade Room | Core workflow, role/state clarity |
| 6 | Trade Room chat/evidence/dispute controls | Arabic equivalent | UGC safety and evidence handling |
| 7 | Notification center plus a privacy-safe iOS notification | Arabic equivalent | Native push, badge, and deep-link value |
| 8 | Profile/settings/account deletion | Arabic equivalent | Account control, privacy, and deletion |

Do not include a notification containing amount, message text, bank details,
wallet address, phone/email, evidence, or counterparty contact data.

## Age-rating and compliance answers

Answer the current questionnaire from actual behavior; do not choose a lower
rating for marketing reasons.

- User-generated content: yes (profiles, listings, messages, evidence, reviews,
  reports).
- Messaging/chat: yes, limited to participants in a Trade Room.
- Gambling/contests: no.
- Advertising: no current ad SDK or behavioral advertising.
- Unrestricted web access: no; in-app document navigation is restricted to the
  Alpha Traders production origin and a bounded Discord authentication flow.
- Financial/crypto activity: yes; describe the non-custodial P2P USDT workflow
  and provide the licensing/territory evidence below.
- Camera/photo access: optional and used only for active-trade evidence.
- Encryption export compliance: the app declares no non-exempt encryption.

## Licensing and territory gate

Public submission is blocked until qualified counsel or the responsible legal
owner provides a written storefront list and documentary basis for offering the
USDT marketplace in every enabled country or region. Apple states that
cryptocurrency exchange functionality may be offered only in countries or
regions where the app has appropriate licensing and permissions.

An ordinary business or tax registration does not, by itself, prove
authorization to operate a cryptocurrency exchange. Do not select **All
Countries or Regions**, describe Alpha Traders as licensed, or rely on a
seller's approval badge as regulatory approval without specific current
evidence.

| Country/region | Marketplace mode | License/permission and issuing authority | Evidence file/date | Counsel/owner sign-off | Storefront enabled | Backend restriction verified |
| --- | --- | --- | --- | --- | --- | --- |
| `[required]` | Education only / full P2P marketplace | `[required]` | `[required]` | `[required]` | Yes/No | Yes/No |

Education/community distribution may have a different legal analysis from the
USDT marketplace. Any territory-specific feature restriction must be enforced
by the production backend as well as App Store storefront selection; storefront
selection alone is not a user-location control. That is a legal/product release
decision and is not silently enabled by this source package.

### EU candidate-territory route

Citizenship, residence, an identity document, or an ordinary business
registration is not itself permission to provide a cryptocurrency exchange.
Before selecting any EU storefront for the full Exchange:

1. Reconcile the Account Holder's exact legal name, identity documents,
   residence/address evidence, and Apple Account details privately; use the
   document spelling Apple confirms.
2. Identify the exact legal entity that would provide the service. Apple states
   that crypto-exchange apps should be submitted by the legal entity providing
   the service, not an individual developer.
3. Have qualified counsel in the candidate territory classify the actual Alpha
   Traders model,
   including listings, matching, staged workflow, communications, evidence,
   commissions, and direct settlement, under MiCA and applicable national law. Do not
   assume that absence of custody removes the service from regulation.
4. If authorization is required, obtain it for the exact entity and service or
   use another counsel-approved structure with an authorized provider whose
   role is accurately disclosed to Apple and users.
5. If the current Apple membership remains individual, contact Apple about
   conversion only after the qualifying legal entity and D-U-N-S record exist;
   do not start a second paid enrollment merely because another identity
   document is available.
6. Enable only signed-off storefronts and enforce the same decision in the
   backend. Any later EU cross-border availability must follow the authorization
   and notification process counsel confirms; it does not arise from
   citizenship or residence.

MiCA Article 59 generally prohibits providing crypto-asset services in the EU
unless the provider is an authorized legal person/other qualifying undertaking
or an eligible regulated financial entity. Whether Alpha Traders falls within
a defined crypto-asset service is a legal classification that source code and
identity evidence cannot decide.

## Apple enrollment identity record

Never put the Account Holder's name, citizenship, address, document numbers, or
document-specific spellings in this repository. If government-issued identity
documents use different legal-name spellings, reconcile them privately with
Apple Developer Support and attach only the documents Apple requests. A safe
response skeleton is:

> My Apple Developer Program enrollment is pending. My government-issued
> identity documents contain a legal-name spelling variation. Both documents
> refer to me, and I have not altered either record. I can provide the originals
> through the secure channel you specify. Please confirm which document and
> exact printed spelling you require for the enrollment record.

If Apple asks for citizenship or residence evidence, state only that the
requested evidence can be supplied through Apple's designated secure channel;
do not copy those personal details into source control.

Use the Apple-authorized spelling in agreements, tax, and App Store Connect
fields after Apple resolves it. Public app metadata should continue to use the
Alpha Traders brand.

## Final submission sequence

1. Wait for Apple Developer Program activation and agreement access.
2. Resolve any identity request from Apple without changing source or documents.
3. Complete and sign the licensing/storefront matrix.
4. Merge the exact approved release commit and deploy the matching backend.
5. Run `npm ci`, `npm run mobile:review-rehearsal`,
   `npm run mobile:scale-rehearsal`,
   `npm run verify:release`, and `npm run mobile:verify`.
6. Run `npm run mobile:review-surface` against production and archive its
   timestamped output with the deployment identifier.
7. Create the signed iOS production build and upload it to TestFlight.
8. Run the bilingual real-device matrix and exact App Review dry run, including background/terminated push,
   receipt capture, Trade Room roles, report/block, and account deletion.
9. Enter the checked metadata/privacy answers and upload release screenshots.
10. Put fictional reviewer credentials and fixture IDs only in App Store Connect.
11. Confirm the response owner, evidence owners, escalation contacts, and
    access-controlled Apple correspondence record.
12. Set every release-owner confirmation variable printed by the submission
    gate for that controlled shell session and run
    `npm run mobile:store-readiness:submission:ios`. Use the combined
    `npm run mobile:store-readiness:submission` only when the Android handoff is
    also ready from the same exact commit.
13. Submit the exact tested build; keep the backend and review accounts live.
14. Release only the behavior Apple reviewed. Submit later material features,
    including the economic calendar, with accurate update notes and access for
    review.

Passing the automated gate proves source/configuration consistency. It does not
represent legal advice, guarantee App Review approval, activate signing, or
replace real-device acceptance.
