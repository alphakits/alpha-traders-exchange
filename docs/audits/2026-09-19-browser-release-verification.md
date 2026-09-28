# Alpha Exchange release verification — 19 September 2026

## Result

Source commit: `91dbb078506d791243cd2ec617b8518eb4fcf548`. Parent: `e548c874967c5bc6d437b2c75c2a6ea1069f6922` (PR #173's last remote head).

- Chromium full run: **147 / 148 passed**, with automatic retries disabled and no skips. One Arabic-header page-load timeout passed unchanged on an isolated rerun. All 148 cases have a passing result across the two runs, but the full run was **not fully green**.
- Unit/integration: **1,893 tests in 293 files passed**; the only subsequently changed unit test file was rerun and both tests passed.
- Production web build, including its type check: passed.
- ESLint for changed application files and Playwright configuration: passed with no warnings.
- Mobile store source readiness: **238 checks passed**. These are source checks, not App Store approval.

The full browser run started at `2026-09-19T23:01:03.132Z` and took 267.1 seconds including server startup. Per-test outcomes and attempt durations are in [the normalized browser report](2026-09-19-browser-results.json). Runtime: Node 24.19.0, Playwright 1.61.1, Chrome for Testing 149.0.7827.55. Next build ID: `ZZite9_qtD3_xD8b30a_P`.

## Changes completed

1. Removed the background seller redirect from the marketplace to an existing active trade. It could race a notification click and replace the requested chat destination with a plain Trade Room URL. Explicit Continue Trade actions and successful acceptance navigation remain available.
2. Reconciled optimistic chat bubbles against their exact server-confirmed send-attempt IDs, scoped to sender and trade. A live snapshot arriving before the POST acknowledgement now replaces the temporary bubble without briefly displaying two copies. Separate messages with identical text remain separate.
3. Finished the pending keyboard-focus and Trade Room deep-link positioning fixes. Focus can recover after asynchronous workspace rendering, and Trade Room sections are positioned below the actual sticky header while yielding to user input. The deep-link effect also waits for the initial loading skeleton to unmount, so a live snapshot arriving before the initial fetch cannot consume the link before its target exists.
4. Updated stale browser assertions to the current cash-trade confirmation text, exact commission-payment amounts, authenticated hourly reminder sweep, stable admin listing identifiers, and the actual “Open Trade Room” Poke notification label. The reminder assertions check the intended recipient and persisted cooldown state.

The preceding full browser run passed 147 tests and failed the Poke test because its selector used the obsolete “Continue Trade” label. A trace confirmed the actual button is “Open Trade Room”. Only the browser selector and corresponding unit-test fixture changed afterward; the focused Poke check then passed, followed by a passing result in the complete run reported above.

The Poke browser regression uses two independently authenticated users, a committed chat message whose first response is deliberately lost, the actual notification-bell action, server cooldown checks, and mobile/desktop viewport checks. It does not substitute a direct URL for clicking the notification.

## Intermittent browser failure retained

The final full run timed out in `header-brand-lockup.spec.ts` while `page.goto('/ar')` waited for the `load` event at 360px. The captured page snapshot already contained the Arabic header, but the test did not reach its layout assertions. The exact same test and production build then passed all assertions in 0.879 seconds on an isolated rerun. No source or test change was made to obtain that result. Its cause was not established; a local runner delay coincided with the failure, which is an observation rather than proof of an infrastructure cause. Keep this recorded as an intermittent navigation issue for the next hosted/device validation. Do not describe this as a clean full-suite pass or deployment approval.

## Scope and release boundaries

This was a **local production-mode browser run**, with synthetic fixtures and the in-memory repository. It did not execute financial transfers, exercise the live production PostgreSQL deployment, deliver real email/native push, or run on a physical iPhone. The source tree was clean during the final run. The production build was created from `d79b6d3acc237e3bda6ad83f4467d2e018193c72`; the final source differs only in those two test files. The final browser runner inherited all settings from `playwright.config.ts` and replaced its rebuild command with `npm run start -- -H 127.0.0.1 -p 3000` to test the already verified build. This evidence is not a guarantee of zero bugs or uninterrupted uptime.

The local run has no hosted workflow URL. Existing signed-release approval flags remain unset. Hosted GitHub/EAS CI and its earlier billing/quota blockers were not changed. The raw run is summarized here without copying account credentials, session cookies, identity documents, chat contents, or browser traces into the repository.

Automatic approval review rejected pushing the new commit to `github.com/alphakits/alpha-traders-exchange`, citing export of potentially sensitive source code without explicit authorization for this payload and destination. No workaround was used. The new commit and this evidence remain local pending approval to update the existing PR branch. No production merge/deployment or Apple submission was performed.

## Production rollout consideration

PR #173 also intentionally denies seller privileges to legacy approved-seller records that lack the required server-recorded identity/video/contact/rules attestation. Before production cutover, an authorized reviewer must reconcile those existing sellers against actual verification evidence. Do not bulk-mark them verified or fabricate attestations. The current run uses synthetic sellers with complete fixture attestations; it does not establish readiness of existing production sellers.

## Apple resubmission remains pending

The existing [information-response package](../mobile/app-review-information-request-2026-09-19.md) remains the submission checklist. Still required: the exact submitting legal entity and Israel-specific exchange licensing/permission evidence; the fresh signed build and matching production deployment; working fictional reviewer accounts and non-financial fixtures; exact-build screenshots and a physical-iPhone recording; and completion of the external release approval record. Seller ID/video verification is not a replacement for regulatory evidence. Real seller IDs/videos were not uploaded.

Apple's [crypto exchange rules](https://developer.apple.com/app-store/review/guidelines/#cryptocurrencies) and [legal-entity rule](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage) were checked on 19 September 2026. This report makes no legal conclusion about the operator's authorization.
