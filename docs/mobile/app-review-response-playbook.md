# Apple App Review response playbook — full Exchange

Use this playbook for every Apple Developer enrollment, App Store Connect, or
App Review question about Alpha Traders. It protects one product position: the
submitted app openly includes the same complete peer-to-peer USDT Exchange as
the website. It is not legal advice, proof of a licence, or a promise that Apple
will approve the app.

## Evidence status snapshot

Update this table in the private release record before relying on any answer.
Do not put the underlying private documents or credentials in this repository.
Start from `docs/mobile/app-review-private-record-template.md`, but populate only
an approved access-controlled copy outside Git.

| Evidence area | Current status on 2026-09-08 | Release consequence |
| --- | --- | --- |
| Full Exchange source behavior | Locally verified by automated gates | Rerun on the exact release commit |
| Ten-trade concurrent lifecycle | Locally verified with fictional in-memory data | Regression evidence only; not a production-capacity claim |
| Apple Developer membership and identity | Enrollment pending | No signed submission until Apple activates the team and resolves the name record |
| Account Holder identity and residence | Pending reconciliation in the controlled private record; no personal details belong in this repository | Supports enrollment evidence only; it is not a cryptocurrency-service permission |
| Submitting legal entity | Pending owner/legal confirmation | Submission blocked |
| Country-by-country permission | Pending qualified legal review and signed territory matrix | Full Exchange blocked in every territory not affirmatively supported |
| Historical operations and seller vetting | Owner-attested; private evidence not yet reconciled | Do not send the four-year or 30-plus-seller claim until indexed evidence supports the exact wording |
| Live backend and reviewer accounts | Not created for the final release yet | Submission blocked until the exact deployed commit and fictional accounts pass |
| Signed build, native push, and device matrix | Pending Apple membership/signing | Submission blocked |
| Economic calendar | Planned after the first release | Do not describe or show it in first-release metadata or review answers |

## Response rules

1. Preserve Apple's exact message, cited guideline, case or submission ID,
   build number, storefronts, and UTC receipt time in the private release record.
2. Answer every question directly and briefly. Identify the exact submitted
   build and production behavior; do not reply from memory or a development
   build.
3. Link each factual sentence to source, signed-build, deployed-backend, or
   private documentary evidence. Mark owner statements as owner-attested until
   they are reconciled.
4. Do not improvise a legal conclusion. Licensing, territory, entity, AML/KYC,
   sanctions, tax, and regulatory questions require the responsible owner and
   qualified legal/compliance reviewer.
5. Never hide, remotely delay, rename, or remove the Exchange to make review
   easier. Metadata, screenshots, reviewer access, backend, and released app
   must all disclose the same full Exchange.
6. Never claim “licensed,” “government approved,” “guaranteed,” “risk-free,”
   “insured,” “escrow,” or “global” unless current evidence proves that exact
   statement for the exact legal entity and territory.
7. Do not upload seller identity documents, WhatsApp exports, member lists,
   bank details, wallet secrets, payment evidence, reviewer passwords, session
   tokens, or production-user records to Git or ordinary Review Notes. If Apple
   asks for sensitive evidence, confirm its designated secure channel and send
   only the minimum approved material.
8. Only the Account Holder or designated release owner sends the final answer.
   Archive the exact sent text, attachments, sender, timestamp, and Apple result.

## Question-and-evidence matrix

The “response core” is a starting point, not permission to send it without the
listed evidence. Replace bracketed fields only from the controlled release
record.

| Likely Apple question | Truthful response core | Evidence required before sending | Owner/status |
| --- | --- | --- | --- |
| What does the app do? | “Alpha Traders provides bilingual trading education and a structured peer-to-peer USDT marketplace. Approved sellers create reviewed listings; buyers and sellers use a staged Trade Room with in-platform chat, evidence, notifications, disputes, reporting, blocking, and verified reviews.” | Signed build, metadata, reviewer walkthrough | Product/release; source verified, signed build pending |
| Is this a cryptocurrency exchange? | “Yes. The app openly includes the peer-to-peer USDT Exchange described in its metadata and Review Notes.” | Matching build, screenshots, metadata, backend | Release; pending final build |
| Does Alpha Traders hold money or USDT? | “The current workflow does not custody principal funds or USDT. The buyer and seller settle directly using the selected payment method and blockchain network; Alpha Traders coordinates and records the workflow.” | Current architecture, Terms, transaction walkthrough | Product/legal; verify again before sending |
| Is it escrow or guaranteed? | “No custodial escrow or guaranteed settlement is represented. The app provides staged controls, evidence, disputes, and enforcement, but users remain responsible for direct settlement.” | User-facing risk copy, Terms, live journey | Product/legal; pending final reconciliation |
| Who provides the regulated service? | “The service provider and App Store submitting entity are [EXACT LEGAL NAME]. Supporting registration and Apple team records are attached.” | Entity registration, Apple team type, D-U-N-S if applicable, counsel sign-off | Account Holder/legal; blocked until complete |
| Where will the Exchange be available? | “The Exchange is enabled only in [EXACT COUNTRIES/REGIONS]. The attached matrix states the documentary legal basis, storefront setting, and matching backend restriction for each.” | Signed territory matrix, current law/permission evidence, backend test | Legal/release; blocked until complete |
| What licence or permission supports it? | State only the exact instrument, issuing authority, holder, number, scope, territory, and validity date shown in approved documents. If counsel concludes no licence is required, describe that conclusion only with the written analysis Apple is permitted to review. | Current instrument or written qualified legal analysis | Legal; blocked until complete |
| How are sellers admitted? | “Seller access is restricted. An applicant submits the required information, an authorized owner reviews the application, and only an approved seller can publish a listing; listings also require owner review.” | Live role gates, current written vetting procedure, redacted aggregate evidence | Operations/compliance; procedure must be reconciled |
| Do you perform KYC, AML, or sanctions screening? | Describe only the controls actually operating for the submitted service, the responsible party, record retention, escalation path, and supported territories. Do not rename ordinary profile review as KYC. | Current approved policies, vendor contracts if any, operational samples, legal sign-off | Compliance/legal; blocked until complete |
| How does a trade work? | “An approved seller publishes a reviewed listing; a buyer requests an amount; the seller accepts; bank details are revealed only after acceptance; both parties communicate in the authorized Trade Room; evidence and staged confirmations record direct settlement; the buyer confirms receipt; the listing remainder reopens; and a verified review becomes available.” | Fictional signed-device walkthrough and automated rehearsal output | Product/release; local source verified |
| How does Alpha Traders earn money? | “The current product records a seller service commission after a completed peer-to-peer marketplace transaction. It is not a purchase of digital content or cryptocurrency through the app.” | Current fee schedule, Terms, commission workflow, tax/legal and App Review interpretation | Business/legal; verify before sending |
| Why is Apple In-App Purchase not used? | Explain the exact real-world financial service and fee flow, then answer any cited payment guideline directly. Do not characterize the model to avoid a guideline. | Current business model, transaction/commission evidence, legal and release-owner approval | Business/legal; escalate before sending |
| How are scams, abuse, or harmful content handled? | “Outside-contact content is filtered; users can report and block accounts; blocking prevents new interaction and hides listings; active Trade Rooms preserve records and dispute access; verified reviews can be moderated; and administrators can restrict or suspend accounts.” | Rehearsal, signed-device captures, moderation procedure, monitored support contact | Safety/release; source verified, device proof pending |
| What happens in a dispute or refund request? | Describe the actual dispute intake, evidence preservation, responsible moderator, response target, and any remedy the Terms genuinely provide. Never promise reimbursement or reversal that Alpha Traders cannot execute. | Terms, dispute procedure, support ownership, sample fictional case | Operations/legal; pending final procedure check |
| Can reviewers access everything? | “Yes. The secure App Review fields contain a fictional verified buyer and fictional approved seller. The production backend, marked listing, Trade Room, safety controls, and support path remain live throughout review; no real transfer or identity data is required.” | Tested credentials and fixture IDs in App Store Connect, live preflight, dry run | Release; pending deployment |
| Why is this more than a website wrapper? | “The signed app adds native lock-screen push and badges, authorized deep routing, app-switcher privacy masking, camera/photo evidence selection, connectivity recovery, mandatory-version enforcement, secure session migration, and the system-controlled post-trade review request.” | Signed-device video and matrix for every stated native behavior | Mobile/release; source verified, device proof pending |
| Do the website and app differ? | “They intentionally expose the same complete Exchange rules and account state. The iPhone shell adds native device capabilities; material product changes are submitted with accurate updated metadata.” | Exact frontend/backend commit, metadata, parity walkthrough | Release; pending final build |
| What data is collected and shared? | Answer from the final App Privacy worksheet and actual production providers, including third-party SDK and server practices. State purposes, account linkage, tracking status, retention, and deletion accurately. | App Store privacy answers, privacy policy, provider/data-flow reconciliation | Privacy/release; pending live-provider check |
| Can users delete their accounts? | “Yes. Account deletion is available in the app and on the public account-deletion page, subject only to the disclosed retention needed for legal, fraud, dispute, and transaction records.” | Live in-app path, public URL, policy and backend deletion test | Privacy/legal/release; device proof pending |
| Do notifications expose financial or personal data? | “No. Lock-screen copy is generic and excludes amounts, chat text, bank and wallet details, phone data, and evidence; taps still require an authorized session.” | Push unit tests plus foreground/background/terminated device captures | Mobile/privacy; source verified, device proof pending |
| How long has this operated and how many sellers exist? | After private reconciliation only: “The manually moderated workflow operated for [VERIFIED DURATION], and [VERIFIED SELLER COUNT] sellers were manually vetted.” | Signed responsible-owner statement, dated operational records, redacted aggregate seller-vetting evidence | Operations; private reconciliation required |
| Why do the Account Holder documents spell the name differently? | “My government-issued identity documents contain a legal-name spelling variation. Both refer to me, and I have not altered either record. I can provide the originals through the secure channel you specify.” | Original documents and Apple case record; send only when requested | Account Holder; Apple resolution pending |
| Do citizenship or residence establish permission in the requested territory? | “No. Citizenship or residence supports identity verification only; citizenship or residence alone is not authorization to provide the service. The service will be enabled only after [EXACT LEGAL ENTITY] and the territory-specific legal basis are documented.” | Identity evidence only if Apple requests it; entity record; qualified local legal analysis; permission and backend-territory evidence | Account Holder/legal; service permission pending |
| Does the first release include an economic calendar or news alerts? | “No. That feature is not present in this submitted version. If added, it will use a licensed data source, user-controlled notifications, accurate metadata, and a separate reviewed update.” | Submitted build and metadata | Product/release; deliberately post-release |

## Stop and escalate

Do not send a final response or submit a replacement build when any of these is
unresolved:

- Apple asks for a licence, regulator permission, supported-country rationale,
  legal entity, KYC/AML, sanctions, tax, or fee-model conclusion;
- the requested country is not affirmatively supported by the signed territory
  matrix and production backend restriction;
- Apple asks for real seller, customer, identity, financial, WhatsApp, or
  transaction records;
- Apple reports behavior that cannot be reproduced on the exact submitted build
  and backend;
- a requested change would hide, defer, or materially reduce the Exchange;
- the reviewer credentials, backend, support contact, or required URL fails; or
- the answer would require any unsupported superlative or approval claim.

The release owner records the question, stops the submission clock if needed,
assigns the evidence owner, obtains legal/account-holder approval where
required, tests any fix on a new exact commit, and only then answers. A legal or
account blocker is not solved with copy changes.

## Response templates

### Request clarification or time

> Thank you for the message regarding build [BUILD NUMBER] and Guideline
> [GUIDELINE]. We are validating the requested point against the exact submitted
> build and supporting records. To ensure our response is accurate, please
> confirm whether you require [SPECIFIC QUESTION OR DOCUMENT]. We will reply in
> this thread with the verified information and will not change the reviewed
> feature set outside the review process.

### Provide requested documents

> Thank you. For build [BUILD NUMBER], the legal entity providing the service is
> [EXACT LEGAL NAME], and the Exchange is enabled only in [EXACT TERRITORIES].
> We have attached [DOCUMENT NAMES], which identify [HOLDER, AUTHORITY, SCOPE,
> TERRITORY, AND VALIDITY]. The production backend enforces the same territory
> decision. These documents are provided through the channel you specified and
> contain only the minimum information requested.

Use this template only after the legal and territory gates are complete.

### Enrollment identity spelling

> My Apple Developer Program enrollment is pending. My government-issued
> identity documents contain a legal-name spelling variation. Both documents
> refer to me, and I have not altered either record. I can provide the originals
> through the secure channel you specify. Please tell me which exact printed
> spelling and supporting documentation you require for the enrollment record.

If Apple asks about citizenship or residence, add only after checking the exact
private identity record and Apple Account details:

> I can provide the citizenship, residence, and address evidence you specify
> through Apple's designated secure channel. Please confirm which document and
> exact legal-name format you require for this enrollment. I will use the
> spelling exactly as printed on the selected document and will not alter any
> government record.

### Reviewer-access problem

> Thank you for reporting the access issue for build [BUILD NUMBER]. We verified
> the production backend at [UTC TIME] and tested the fictional [BUYER/SELLER]
> account using the same path in Review Notes. [STATE THE EXACT RESOLUTION OR NEW
> CREDENTIAL LOCATION; NEVER INCLUDE A PASSWORD IN THIS MESSAGE.] No real payment,
> USDT transfer, phone number, or identity document is required. Please retry,
> and let us know the exact screen or error if the issue continues.

### Guideline rejection or information request

> Thank you for identifying Guideline [GUIDELINE] for build [BUILD NUMBER]. We
> understand the concern as [ONE-SENTENCE RESTATEMENT]. The submitted app
> [EXACT VERIFIED CURRENT BEHAVIOR]. Supporting evidence is available at
> [REVIEW PATH] and in [ATTACHMENT OR REVIEW NOTE]. [IF FIXED: We corrected the
> issue in build NEW BUILD NUMBER; the previous build is no longer submitted.]
> We have retested [AFFECTED PATHS] against backend deployment [IDENTIFIER]. We
> respectfully request review of the verified build and are ready to answer any
> remaining specific question.

Never argue that operating history or effort entitles the app to approval.
Answer the cited concern with the exact product behavior and evidence.

## Response assembly checklist

- Apple message and every subquestion copied exactly into the private case log
- exact build, version, commit, backend deployment, and enabled storefronts
- short answer checked against the live submitted behavior
- evidence status identified for every factual claim
- legal/compliance and Account Holder approval recorded when applicable
- no hidden Exchange behavior or post-review remote switch
- no credentials or private user/seller evidence in the response body
- requested attachments minimized and sent only through Apple's named channel
- reviewer credentials retested without owner intervention or real transfers
- final answer, attachments, sender, and UTC timestamp archived

## Official Apple sources

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  — including review completeness, accurate metadata, user-generated content,
  cryptocurrency exchanges, minimum functionality, privacy, and regulated
  services.
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
  — App Store Connect privacy answers must reflect the app and third-party
  partners and remain accurate.
- [Apple Developer Program enrollment](https://developer.apple.com/help/account/membership/program-enrollment)
  — identity/legal-name requirements, organization legal-entity and D-U-N-S
  requirements, and conversion from an individual to an organization account.
- [EU Markets in Crypto-Assets Regulation, Article 59](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R1114)
  — EU crypto-asset services generally require an authorized legal person or
  another undertaking permitted by the Regulation; citizenship or residence
  alone is not authorization.

Apple can request additional evidence or reach a different conclusion after
reviewing the specific entity, territories, business model, build, and account.
The correct response is a complete, truthful, reproducible record—not a promise
that rejection is impossible.
