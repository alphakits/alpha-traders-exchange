# App Review private release-record template

This repository file is a blank schema only. Copy it into an approved,
access-controlled business record before use. Never populate this repository
copy with passwords, session tokens, identity documents, seller/customer data,
bank or wallet details, payment evidence, WhatsApp exports, signing material,
or unredacted legal documents.

## Release identity

| Field | Controlled value |
| --- | --- |
| App version / build number | `[required]` |
| Git commit | `[required]` |
| Backend deployment ID / URL | `[required]` |
| EAS build ID / TestFlight build | `[required]` |
| Apple team / provider | `[required]` |
| Exact submitting legal entity | `[required]` |
| Account Holder citizenship/residence evidence | `[required — controlled locator only]` |
| Supported address evidence | `[required — controlled locator only]` |
| Exact legal name from selected government ID | `[required — controlled locator only; never copy the document here]` |
| Enabled storefronts | `[required]` |
| Backend-enabled territories | `[required]` |
| Account Holder | `[required]` |
| Release owner | `[required]` |
| Legal/compliance approver | `[required]` |
| Privacy owner | `[required]` |
| Support owner and coverage window | `[required]` |
| Record created / last verified UTC | `[required]` |

## Gate register

Use `not started`, `in progress`, `verified`, or `blocked`. “Verified” requires
the evidence locator, verifier, and UTC time—not a verbal assumption.

| Gate | Status | Evidence locator | Verified by / UTC | Expiry or recheck trigger |
| --- | --- | --- | --- | --- |
| Apple membership active | `[required]` | `[required]` | `[required]` | Team/account change |
| Identity-document and legal-name consistency reconciled | `[required]` | `[required]` | `[required]` | Apple requests another document |
| Citizenship/residence evidence reconciled | `[required]` | `[required]` | `[required]` | Identity, residence, address, or Apple Account change |
| Submitting entity eligible | `[required]` | `[required]` | `[required]` | Entity/team change |
| Territory/legal matrix signed | `[required]` | `[required]` | `[required]` | Law, service, or territory change |
| AML/KYC/sanctions procedure approved | `[required]` | `[required]` | `[required]` | Policy/vendor change |
| Operating-history claims reconciled | `[required]` | `[required]` | `[required]` | Submitted wording changes |
| Exact source gate passed | `[required]` | `[required]` | `[required]` | Commit changes |
| Exact backend deployed and healthy | `[required]` | `[required]` | `[required]` | Deployment/config changes |
| Fictional reviewer accounts tested | `[required]` | `[required]` | `[required]` | Credential/fixture/backend changes |
| Bilingual device matrix passed | `[required]` | `[required]` | `[required]` | Build or backend changes |
| Native push/privacy evidence passed | `[required]` | `[required]` | `[required]` | Build/push configuration changes |
| Store metadata and privacy reconciled | `[required]` | `[required]` | `[required]` | Provider/data/build changes |
| Support inbox monitored | `[required]` | `[required]` | `[required]` | Coverage/contact change |
| Response owners and escalation contacts ready | `[required]` | `[required]` | `[required]` | Personnel change |

## Territory and regulatory record

One row is required for every enabled storefront and backend territory. A blank
or ambiguous row means the full Exchange stays disabled there and the app is
not submitted to that storefront.

| Country/region | Exact service mode | Legal basis / instrument | Holder and authority | Scope / validity | Counsel approval | Storefront test | Backend restriction test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `[required]` | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |

## Claim-to-evidence index

Record the approved wording—not merely the underlying story. Evidence should be
redacted to the minimum needed and stored outside the source repository.

| Proposed claim | Status | Evidence description / controlled locator | Date range | Reconciled by | Approved wording |
| --- | --- | --- | --- | --- | --- |
| Operating-duration claim | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |
| Historical seller-count claim | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |
| Seller admission/review process | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |
| Direct-settlement/non-custodial workflow | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |
| Seller service commission model | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |

## Reviewer fixture register

Store credentials only in App Store Connect's secure review fields. This table
contains identifiers or controlled-vault references, never passwords, codes,
real financial data, or private customer data.

| Fixture | Identifier / secure locator | Required state | Last tested UTC | Tester | Result / cleanup date |
| --- | --- | --- | --- | --- | --- |
| Fictional buyer | `[required]` | Verified, onboarded | `[required]` | `[required]` | `[required]` |
| Fictional approved seller | `[required]` | Verified, approved | `[required]` | `[required]` | `[required]` |
| Review listing | `[required]` | Approved, clearly fictional | `[required]` | `[required]` | `[required]` |
| Non-financial Trade Room | `[required]` | Both roles can inspect safety paths | `[required]` | `[required]` | `[required]` |

## Technical evidence index

| Evidence | Exact artifact / locator | UTC | Result | Recheck trigger |
| --- | --- | --- | --- | --- |
| `npm run verify:release` | `[required]` | `[required]` | `[required]` | Commit changes |
| `npm run mobile:review-rehearsal` | `[required]` | `[required]` | `[required]` | Commit changes |
| `npm run mobile:scale-rehearsal` | `[required]` | `[required]` | `[required]` | Commit changes |
| Production review-surface preflight | `[required]` | `[required]` | `[required]` | Deployment/config changes |
| English signed-device dry run | `[required]` | `[required]` | `[required]` | Build/backend changes |
| Arabic signed-device dry run | `[required]` | `[required]` | `[required]` | Build/backend changes |
| Background/terminated native push | `[required]` | `[required]` | `[required]` | Build/push changes |
| Report/block/dispute/moderation | `[required]` | `[required]` | `[required]` | Build/backend changes |
| Account deletion and privacy URLs | `[required]` | `[required]` | `[required]` | Build/backend/policy changes |

## Apple correspondence log

Copy Apple's wording exactly. Keep one row per received message and link the
approved response/attachments in the controlled record.

| Received UTC | Apple case/submission | Build | Guideline / exact question locator | Evidence owner | Draft approval | Sent UTC / sender | Result / next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `[required]` | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` | `[required]` |

## Attachment release check

Complete this for every document or recording before sending it to Apple.

| Check | Result / approver |
| --- | --- |
| Apple specifically requested or needs this evidence | `[required]` |
| Designated Apple channel confirmed | `[required]` |
| Exact entity, territory, scope, and validity match the response | `[required]` |
| Unrelated personal and seller/customer data removed | `[required]` |
| Passwords, tokens, financial secrets, and signing material absent | `[required]` |
| Redaction visually inspected and irreversible | `[required]` |
| Legal/privacy approval recorded | `[required]` |
| Final filename, checksum, sender, and UTC time recorded | `[required]` |

## Final decision

| Decision field | Controlled value |
| --- | --- |
| Submit / respond / hold | `[required]` |
| Exact approved build | `[required]` |
| Unresolved blockers | `[required]` |
| Final approver and UTC | `[required]` |
| Apple result and follow-up | `[required]` |

If any mandatory gate is blocked, any approved claim lacks evidence, or the
build/backend differs from this record, the decision is **hold**. Create a new
record for a new build; do not silently overwrite history.
