# Trade Room feedback and layout update — 22 September 2026

## Scope

The shared Trade Room is updated for Bank Transfer, Cardless ATM Withdrawal, and Face-to-Face, for buyers and sellers, in English and Arabic. The current mobile root layout renders `WebsiteAppShell`, so these website screens are also the screens loaded by that app shell. This is not a new signed iOS binary or an App Store submission.

The recorded issues were repeated page scrolling after confirmations, success messages below the chat, duplicated mobile actions, premature progress labels, and a cached header still requesting action after completion/review.

## Changes

- Consolidate the current status and next action. Keep instructions, timeline, and repeated chat context expandable; keep active bank deadlines expanded. Add explicit Current step and Chat shortcuts.
- Keep one primary action across responsive layouts. Display confirmation and errors beside the action. Keep Copy and Poke results in chat.
- Keep the confirmed status visible while saving. Progress advances after acknowledgement, not during an optimistic transition. Bank uploads retain the chosen file after failure and stop waiting once the upload is acknowledged, independently of background refreshes.
- Replace competing delayed scroll attempts with one measured reveal that yields to user interaction and does not scroll an already visible result. Preserve typing focus. Remove the unconditional cash-room jump on app resume.
- Synchronize the cached header from a minimal actor-scoped snapshot, without polling or refreshing authentication. Hide redundant notices inside the same room and clear finished reminders after review/cancellation. Waiting participants no longer receive a false action-required reminder.
- Preserve bank evidence requirements, wallet visibility rules, server transitions, review submission, and duplicate-submission guards. No migration, production data mutation, financial transfer, or replay of a real trade is part of this change.

## Validation

- Targeted trade/UI, reminders, reviews, route/workflow, and public wording checks: **200 tests passed across 15 files**.
- Mobile pure-function regression checks: **116 tests passed across 21 files**, after supplying the repository's declared Expo 57.0.24 package in the isolated validation environment.
- Final complete unit/integration run: **2,238 tests passed across 318 files**. The initial run was not green because the isolated validation environment lacked Expo's TypeScript configuration and one wording assertion expected the removed duplicate status card; both were corrected before the complete rerun.
- Clean production build, including type checking: **passed**. An incremental build hit a generated-cache error; removing only this worktree's generated `.next` output and rebuilding succeeded.
- ESLint passes for changed application and unit-test files. Browser-spec lint also checks the new rehearsal.

## Browser and release limits

Three complete browser rehearsals were added, covering acceptance, buyer payment/code, seller cash/funds confirmation, bank evidence, wallet disclosure, USDT confirmation, buyer completion, both reviews, header cleanup, and 320/390/1440px overflow. They use local synthetic fixtures and the existing loopback-only in-memory test support.

The local browser run could not start Chromium: the execution sandbox denies its local socket (`Operation not permitted`). The requested sandbox escalation was rejected by the environment's approval policy. No browser pass, visual/device verification, or production release is claimed from that attempt.

Vercel's connected project lookup also returned 403 requiring reauthentication to the `alpha-kits` scope. The existing Git integration is the deployment path to check through the pull request. Keep the change in review until browser verification and the release checks succeed; then verify the deployed screens on the actual iPhone before recording an Apple review video. Existing completed trades/reviews do not need to be recreated to apply this UI update.

The first push was blocked pending explicit authorization for the public GitHub destination. The user subsequently authorized pushing and completing the release. After workspace maintenance removed the original worktree's Git metadata, all 14 changed files were recovered byte-for-byte into a fresh checkout of the same base commit (`fe24143c761941f60835079c130570e8aa788232`). Browser and deployment results remain separate release checks.
