# Release reconciliation — 5 October 2026

## Verified state

The latest website baseline is main commit `9bce9bc42c9128266e289d7625b9d2e2a0fa0d33` (PR 343). Its production deployment was READY and its unit/lint/build, mobile/desktop browser, and phone-gate CI checks passed. PRs 340–342 already provide the compact owner active-trade list and audited owner decisions after payment progress. These are not unfinished features.

The private release report records signed iOS 1.2.0 build 24 and passing installed-app automated checks. Those checks do not establish a physical two-account trade, real-device push/Remember Me, or an exact-build physical-iPhone review recording. Authenticated App Store Connect inspection on October 5 found builds through 20 in TestFlight and build 20 selected for version 1.2.0. Build 24 is not available there and predates the current phone-badge and unpaid-commission acceptance fixes. It was not uploaded as the replacement. Do not label older build 16 recordings as an exact-build demonstration.

Expo sign-in was restored and the iOS build-and-submit workflow was launched at 20:43:57 UTC from tested source `bd9fe0c972f25a356f06e3b8cbedf1691cc0c0ee`. Workflow `01a10dcf-1407-7b8e-98ef-23c3692391fa` created build `e1f94b56-d360-42ed-88f0-d1f80385e901`; its latest observed state was waiting for concurrency, before compilation or TestFlight upload. No replacement build number or upload success is claimed. The later owner-notification fix changes server code and tests, not the native app sources.

The October 5 reviewed/rejected version was 1.2.0 build 20. The owner's clarification was sent to Apple at 22:37 Europe/Bucharest and independently verified in the review thread. It explains direct P2P settlement, commission revenue, sole-proprietor status and Israel-only scope, and asks Apple to clarify acceptable permission evidence and the submitting-entity requirement. Do not resend it or assert that Apple accepted an exemption. A tax certificate is not a cryptocurrency licence. Legal evidence and Apple's reply remain external requirements.

## Correct submission details

- Alpha Traders coordinates direct settlement and does not custody buyer fiat or seller USDT. Bank transfer, cardless ATM and face-to-face flows are supported.
- New-policy completed trades use 2% total commission: 1% buyer share plus 1% seller share; the seller remits both shares. Legacy records preserve their original fee policy. Verified unambiguous receipts may settle within the existing ±1 USDT tolerance; it never substitutes for receipt verification or payer attribution.
- Twilio SMS phone verification is active for ordinary accounts. Existing explicitly authorized account exceptions permit reviewer access without SMS; they do not imply that a phone was verified.
- Automated WhatsApp sending is off. Seller identity review via WhatsApp is a separate operational process.
- External services include Vercel, Supabase, Expo Push, Resend, Twilio, TRON/TronGrid, read-only Binance receiving history and the actual bounded media/market providers. Do not claim an optional provider is active without checking.
- News contains a weekly USD events calendar updated on Sundays, without live results or event alerts.
- Use the controlled review notes in `app-review-information-request-2026-09-19.md`, preserving credentials only in App Store Connect. Complete remaining placeholders and verify both fictional reviewer roles before resubmission.

## Owner follow-up alerts

The authenticated five-minute trade-reminder sweep also reconciles owner-only follow-up notifications using canonical operational incidents and commission state. Failed verification alerts immediately; pending matching alerts after 15 minutes from the submitted/issued payment intent (creation time for legacy records). The threshold is an operational follow-up interval, not a new trade deadline or proof of payment. Alerts open the specific trade or commission record, contain no receipt/wallet data, are deduplicated under the snapshot transaction lock, and archive on resolution or loss of owner access. Resolution does not trigger another push. Dismissal remains respected for the same episode while its notification is retained. No balance, commission, permission or trade state is changed by this sweep.

A regression test reproduced a rapid issue-transition race: notification deduplication could reuse a recent row for a new episode, then publish the previous episode's stale archive event last. Reconciliation now suppresses that stale event when the row has just been republished, keeping the current owner alert visible. The test asserts the final real-time event, current database row, and archive count.

## Remaining external gates

- App Store Connect sign-in was restored. Corrected 3,979-character review notes were saved and matched after a reload; existing reviewer access lines were preserved. They now state the 2% total fee, active Twilio SMS, reviewer exceptions, weekly News calendar and read-only Binance receiving checks, and reference the October 5 clarification. Build 20 remains selected. The replacement Expo workflow must finish and its binary must appear in TestFlight before selection or physical-device acceptance.
- VPN enforcement is implemented but Production lacks a configured provider/key. Keep it off until the chosen provider is authenticated, its quota is sufficient, monitor results are reviewed, and real direct/VPN connections pass Preview tests. Missing credentials must not be replaced with a fake allow or a blind production block.
- A physical iPhone and the exact signed replacement build are required for the remaining real-device checks and continuous recording. Automated browser/installed-app checks are not substitutes.
- Confirm Apple's requested legal/permission evidence and legal-entity eligibility before another review submission. Product changes alone do not resolve those questions.

## Verification of the follow-up change

PR 344 code at `cde810bb0c043bf5206117b9c60e69182d8483b6` passed the complete local release gate: 4,492 tests in 478 files, all 14 gate steps, production build, web/native TypeScript, lint, Expo configuration checks, 238 store source checks and iOS/Android exports. Public review preflight passed 23 checks; targeted network checks passed 108 cases. Preview deployment `dpl_AAkmMML8WYRPTNCceMTex5QyXmup` is READY and automated Vercel review passed.

Remote Reliability Shield run 37367581557 remained queued, then its quality job was cancelled without test steps and the dependent browser/phone jobs were skipped. GitHub's status page reported an Actions runner-assignment incident beginning October 5 at 19:11 UTC. The remote browser gate is not claimed as passed, and this feature is not claimed deployed to Production. Keep the PR available for the complete remote gate after recovery.

Run 37370183035 also ended before test execution. Its annotations report that a hosted runner could not acquire the job after multiple attempts and an internal server error. GitHub still reported the incident at its 20:39 UTC update. Do not bypass the required release checks to merge.

The notification race fix passed 46 focused tests. The complete Exchange home file passed all 53 tests after correcting test isolation: mocked navigation had left the real listing query string between cases, which could reopen a previous dialog and overwrite unrelated status messages. Each case now starts at the marketplace URL; timeout, duplicate-submission and late-response assertions remain intact. The complete release gate then passed all 14 steps in 318.9 seconds on the fixed source: 4,493 tests in 478 files, lint, web/native TypeScript, Expo checks, 238 store-readiness checks, production build and both native exports.

Live guest-browser checks confirmed the home page, Exchange sign-in redirect, Arabic RTL login, English LTR restoration and locale-correct return paths. The observed console errors came from the browser extension, not the app origin. Authenticated owner UI and physical-device acceptance are not claimed from this guest check. A subsequent Expo workflow refresh returned its server-side 504 page; the last confirmed build state remains queued, not failed or uploaded.

Read-only production reconciliation checks were performed. No production financial records were changed and no test payment was sent. Detailed operational counts remain in the private verification report.
