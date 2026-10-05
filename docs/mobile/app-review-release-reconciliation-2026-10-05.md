# Release reconciliation — 5 October 2026

## Verified state

The latest website baseline is main commit `9bce9bc42c9128266e289d7625b9d2e2a0fa0d33` (PR 343). Its production deployment was READY and its unit/lint/build, mobile/desktop browser, and phone-gate CI checks passed. PRs 340–342 already provide the compact owner active-trade list and audited owner decisions after payment progress. These are not unfinished features.

The private release report records signed iOS 1.2.0 build 24 and passing installed-app automated checks. Those checks do not establish a physical two-account trade, real-device push/Remember Me, or an exact-build physical-iPhone review recording. Build 24 upload and selection in App Store Connect remain unverified. Do not label older build 16 recordings as a build 24 demonstration.

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

## Remaining external gates

- App Store Connect sign-in expired during this session. Updated review notes and replacement-build selection cannot be reported saved until authenticated and visibly confirmed.
- VPN enforcement is implemented but Production lacks a configured provider/key. Keep it off until the chosen provider is authenticated, its quota is sufficient, monitor results are reviewed, and real direct/VPN connections pass Preview tests. Missing credentials must not be replaced with a fake allow or a blind production block.
- A physical iPhone and the exact signed replacement build are required for the remaining real-device checks and continuous recording. Automated browser/installed-app checks are not substitutes.
- Confirm Apple's requested legal/permission evidence and legal-entity eligibility before another review submission. Product changes alone do not resolve those questions.
