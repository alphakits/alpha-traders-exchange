# Alpha Traders Google Play submission pack

This is the controlled Android handoff for the complete Alpha Traders app. It
keeps source readiness separate from Play Console access, legal review, signing,
review accounts, real-device evidence, and public-rollout approval. Never put a
Google service-account key, tester password, identity document, production user
record, or signing credential in this repository.

## Reviewed feature consistency

The Android build, Play listing, screenshots, reviewer access, and production
backend must expose and accurately describe the same complete bilingual product:
Academy, peer-to-peer USDT marketplace, seller workspace, Trade Rooms,
notifications, safety controls, and account management. Do not submit a reduced
review build, hide the Exchange during review, or enable it only after approval.

The shipping Android app renders the production website inside a restricted
first-party WebView and adds native push, deep-link recovery, app-switcher privacy
masking, connectivity recovery, mandatory-version enforcement, secure local
session handling, and native evidence selection. Those behaviors must match the
exact signed build used for screenshots and review.

## Release identity

| Field | Value |
| --- | --- |
| App name | Alpha Traders |
| Version | `1.1.0` |
| Android package | `com.alphakits.alphatraders` |
| EAS project ID | `e5dbc3ba-25fb-4373-8ded-c8c80cadc147` |
| URL scheme | `alphatraders` |
| Play category | Finance |
| Support email | `support@alphatraders.co.il` |
| Website | `https://www.alphatraders.co.il/en` |
| Privacy policy | `https://www.alphatraders.co.il/en/privacy-policy` |
| Account deletion | `https://www.alphatraders.co.il/en/account-deletion` |

The checked English and Arabic listing copy is in
`apps/mobile/store-metadata.json` under `googlePlay`. Copy it without adding
claims that Alpha Traders, a seller, or a transaction is licensed, approved,
guaranteed, risk-free, or custodial unless current evidence supports that exact
claim.

## Play review access

Create the reviewer identities only through the ordinary production registration,
verification, seller application, owner approval, listing, and listing-approval
flows. Never expose `/api/admin/setup-test-accounts` or `/api/testing` as a review
backdoor.

Provide Play Console with reusable English access instructions and two fictional
accounts. Credentials belong only in Play Console's protected App access fields.
They must not require a one-time code, expiring link, real phone number, transfer,
or real USDT settlement during review.

| Account | Required state | Reviewer path |
| --- | --- | --- |
| Buyer | Email verified, onboarding complete, no real personal/payment data | Login → Exchange → marked fictional listing/Trade Room → Notifications → Profile/Settings → Account deletion |
| Approved seller | Email verified, approved seller, one approved fictional listing | Login → seller workspace → opposite side of the fictional Trade Room → listing and availability controls |

Seed one non-financial scenario with stable fixture IDs. Record those IDs in the
private release record, not in source. Keep both accounts and the matching backend
available throughout review, then rotate or remove them after review.

## Store listing and graphics

Use the exact `googlePlay` copy from `apps/mobile/store-metadata.json` for English
and Arabic. The source gate enforces the current short-description and
full-description limits, production support/privacy/deletion URLs, USDT
disclosure, and Android-specific wording.

Create the remaining Play Console assets from the exact signed Android release
build:

- opaque high-resolution app icon from the checked production icon;
- feature graphic using current Play Console dimensions and content rules;
- phone screenshots for both English and Arabic, with correct RTL layout;
- screenshots covering Academy, marketplace, seller profile, Trade Room,
  notifications, safety controls, settings, and account deletion;
- release notes that truthfully match the submitted build.

Use one coherent fictional dataset. Do not show browser chrome, passwords, real
customer data, bank details, wallet addresses, payment evidence, private chat,
phone/email details, or a lock-screen notification containing sensitive trade
content.

## Data safety declaration worksheet

The Play Console Data safety form must be reconciled against the signed Android
binary, production backend, privacy policy, deletion behavior, and every SDK or
service provider immediately before submission. The table below is a review
worksheet, not a pre-approved set of Console answers.

| Data area | Current Alpha Traders behavior | Required or optional | Primary purpose |
| --- | --- | --- | --- |
| Personal information | Name, email, and verified phone/WhatsApp number where supplied | Account identity is required; additional profile/contact fields vary | Account management, fraud prevention, support |
| User-entered location | Country and city fields; no device-location permission | Optional unless a product flow explicitly requires the field | Marketplace context and account profile |
| Financial information | Seller bank details and buyer receiving-wallet address, revealed only at the authorized trade stage | Required only for the applicable trade role/state | Complete a peer-to-peer trade |
| Transaction history | Listings, requests, amounts, states, commissions, disputes, and reviews | Required when using the Exchange | App functionality, safety, records |
| User content | Profiles, listings, messages, evidence images, reviews, reports, and support requests | Feature-dependent | App functionality, moderation, support |
| Photos | Profile photo and optional trade evidence selected or captured by the user | Optional | Profile and active-trade evidence |
| Identifiers | Account ID, random installation/device ID, session records, and Expo push token | Required for authenticated/native functions; push is optional | Authentication, security, notifications |
| App activity | Lesson progress, notification state/preferences, and marketplace/Trade Room actions | Feature-dependent | App functionality and synchronization |
| Diagnostics | Request IDs, delivery state, and bounded technical/security logs | Generated during service use | Reliability, abuse prevention, security |

Before entering answers, verify:

1. whether each provider is acting only as a service provider or meets Play's
   definition of data sharing;
2. required versus optional collection across every distributed app version;
3. encryption in transit and the handling of evidence/media at rest;
4. retention and deletion behavior across Vercel, Supabase, Expo Push, email/SMS,
   and any production-only provider;
5. that the public privacy policy and in-app deletion flow match the Console
   declaration exactly;
6. that no advertising or tracking SDK is present in the signed dependency and
   permission report.

Any difference requires updating the form, privacy policy, or product behavior
before release. Passing the source gate does not answer provider/legal questions
on the release owner's behalf.

## Financial features and territory gate

Complete Play Console's Financial features declaration using the app's actual
behavior. The app includes a non-custodial peer-to-peer USDT marketplace; do not
assume that direct buyer/seller settlement removes the app from Google's
cryptocurrency or local financial-services requirements.

Public distribution is blocked until qualified counsel or the responsible legal
owner approves the exact developer identity, marketplace model, countries, and
documentary basis. Google publishes country-specific requirements for
cryptocurrency exchanges and may request licensing or compliance evidence.

| Country/region | Product mode | Documentary basis and authority | Counsel/owner approval | Play country enabled | Backend restriction verified |
| --- | --- | --- | --- | --- | --- |
| `[required]` | Education only / complete P2P marketplace | `[required]` | `[required]` | Yes/No | Yes/No |

Do not select every country by default. Store country selection alone is not a
backend location control. If a territory is restricted, enforce the same decision
in production and verify it before review. Never improvise a licensing conclusion
or upload identity/licensing material outside the channel requested by Google.

Also complete the current content-rating, target-audience, user-generated-content,
app-access, ads, account-deletion, permissions, and payments declarations from
actual behavior. Alpha Traders has profiles, listings, Trade Room messages,
evidence, reviews, and reports, so reviewer evidence must show content filtering,
reporting, blocking, moderation, and enforcement paths.

## Signed build and testing

Build the exact approved commit with the EAS `production` profile and confirm the
result is a signed Android App Bundle for `com.alphakits.alphatraders`. Keep all
Google, Expo, and signing credentials in their managed consoles; never copy a
service-account JSON file or keystore into source.

Upload first to the Play internal testing track, record the build URL/version code
and tester group privately, then run the Android rows of the real-device matrix in
`docs/mobile/private-beta-release-runbook.md`. Complete the Play pre-launch report
and resolve every reproducible crash, accessibility, security, or compatibility
failure. Complete the Data safety form before moving beyond any track for which
Play requires it.

The release owner must approve managed-publishing behavior, release countries,
monitoring, support coverage, staged rollout size, pause conditions, and rollback
response before production.

## Final submission sequence

1. Verify the Play Console developer account, agreements, developer identity, and
   `com.alphakits.alphatraders` app record.
2. Complete legal review and the country/backend availability matrix for the exact
   full Exchange.
3. Merge and deploy the exact release commit; record its SHA and Vercel deployment.
4. Run `npm ci`, `npm run verify:release:full`, `npm run mobile:verify`, and
   `npm run mobile:review-surface` on that commit.
5. Create the signed EAS Android production App Bundle and place it on the internal
   testing track.
6. Run the bilingual real-device matrix, notification/relogin/deep-link tests, and
   Play pre-launch report; fix and rebuild on any failure.
7. Enter the checked English/Arabic listing copy, graphics, release notes, support,
   privacy, and deletion URLs.
8. Complete App access, Data safety, Financial features, content rating, target
   audience, ads, UGC, account-deletion, permissions, and country declarations.
9. Put reusable fictional buyer/seller credentials and exact English instructions
   only in Play Console.
10. Set the Android release-owner confirmations printed by
    `npm run mobile:store-readiness:submission:android` and rerun that gate.
11. Promote the exact tested bundle through the approved test/production tracks;
    use managed publishing and a staged rollout with active health monitoring.
12. Keep the production backend, reviewer accounts, support channel, and rollback
    owner available throughout review and rollout.

## Official Google Play references

These links were rechecked on 2026-09-10. Re-open them immediately before a public
submission because Play policies and Console forms can change.

- Store listing guidance: https://support.google.com/googleplay/android-developer/answer/13393723
- Data safety form: https://support.google.com/googleplay/android-developer/answer/10787469
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Cryptocurrency country requirements: https://support.google.com/googleplay/android-developer/answer/16329703
- Review login/app-access requirements: https://support.google.com/googleplay/android-developer/answer/15748846

Passing the automated gate proves source/configuration consistency. It does not
activate Play Console, sign a build, complete legal review, answer Data safety or
financial declarations, pass real-device review, or authorize public release.
