# Trade Room action placement and live recovery

The 2:33 iPhone recording shows successful completion, both reviews, and a signed-in return to the marketplace. It also shows the seller retaining a previous stage after backgrounding, and an earlier cash-handover success message remaining visible on the completed trade. The owner requested that important actions be visible near the start of every Trade Room.

## Changes

- Use a compact trade identity, amount, connection indicator, and progress bar. Place the current step and its single main action immediately after this summary in all payment methods and both languages.
- Keep bank receipt/proof selection with that action. Preserve file selection after an upload failure. Existing notification links to upload evidence now reveal the current action, rather than the historical evidence panel.
- Put pending terms decisions and completion reviews first. Keep payment details and wallet copy controls ahead of optional adjustments. Make the wallet QR expandable; retain trade details, safety/report controls, and progress history below the current step. Provide a return-to-current-step shortcut in chat.
- Scope success feedback to the server-confirmed trade stage. Later counterparty updates remove obsolete feedback without suppressing a new action's acknowledgement.
- Close the suspended stream when the page becomes hidden. On foreground, focus, restored-page, or online events, restart it and reconcile with a no-store room read; coalesce duplicate wake events. Treat a received snapshot, rather than socket opening alone, as connected.
- Reconcile a quiet visible room after ten seconds of snapshot inactivity (checked every five seconds). Avoid overlapping background reads and skip them while hidden or while a trade mutation is pending. Ignore late events from replaced streams.

The change does not modify payment APIs, server transition rules, evidence requirements, wallet disclosure permissions, authentication, commissions, or existing trade data. No real trade is replayed. This updates the website consumed by the existing mobile WebsiteAppShell; it is not a signed native binary or an App Store submission.

## Verification

Behavioral regressions cover all three payment methods: one pending mutation, unchanged progress until acknowledgement, failure/retry, foreground recovery, late old-stream events, quiet-stream reconciliation, hidden-page suspension, stage-scoped feedback, and action placement. English and Arabic pending-terms decisions and the position of the completion review are also covered.

Browser rehearsals additionally assert that acceptance and receipt-confirmation buttons are in the viewport, and preserve legacy upload notification URLs. They have not been executed here: the earlier Chromium launch was blocked by the environment's socket restriction and its escalation was rejected. GitHub-hosted checks are separately blocked by the account billing lock. Neither is represented as a passing browser run.

The complete `npm run verify:release` gate passed all 12 steps in 284.9 seconds: 2,249 unit/integration tests in 318 files, App Review and ten-trade rehearsals, ESLint, web/native TypeScript, 21 Expo configuration checks, 238 mobile source-readiness checks, a clean production build, and iOS/Android bundle exports. The browser rehearsal file separately passed ESLint with `--no-ignore`. Production deployment status is tracked on the release pull request; the local gate does not claim an authenticated live-device or browser test.
