# Listing management repair — 2026-09-21

Base: `alphakits/alpha-traders-exchange` main, `6ba225ffdab8aa8a640cf0cee249bb9184100534`.
Branch: `codex/fix-listing-actions`.
Status: validated; publishing through the approved GitHub browser flow.

## Confirmed cause

The public marketplace response showed partially sold listings whose maximum trade still exceeded their remaining balance: 35,000 versus 33,709.67742 USDT, and 7,000 versus 2,011.285267 USDT. Both the web PATCH route and shared listing store revalidated these old limits on unrelated operations, rejecting pause/resume and edits. The edit form also loaded the old maximum. Numeric formatting differences could wrongly require an edit reason.

The Arabic workspace could replace an English failure with success text. Removal errors were rendered behind the removal dialog. Pause/resume ignored the returned listing and waited for unrelated workspace reads before updating the UI.

## Changes

- Pause uses a status-only path while preserving authentication, seller authorization, ownership, active trade locks, enforcement restrictions and audit writes. It no longer fetches market quotes or revalidates unchanged bank/quantity fields.
- Resume and edits use the remaining balance when an old maximum was not explicitly changed. Explicit invalid new limits remain rejected.
- Completed partial sales persist a maximum no greater than the remaining balance; the below-minimum remainder rule remains in force.
- Web edit defaults and mobile seller responses expose an effective maximum consistent with remaining inventory. Formatting-only numeric changes do not require a new reason.
- Manage Listing expands the selected listing, including dashboard links.
- Pause/resume immediately apply the saved server response. Reads started before that mutation cannot restore old listing rows. Repeated submissions are blocked while the action is pending.
- Removal failures appear inside the removal dialog and workspace. Removal retries are idempotent without duplicate audit entries. No trade history is deleted.
- The Arabic workspace preserves failure text instead of substituting a success claim.

## Verification

- 76 focused tests passed across the web route, shared lifecycle/audit logic, partial sale preservation, mobile seller API, numeric reason validation and mobile/desktop React controls.
- The existing 100-trade lifecycle regression also passed during the earlier full partial-sale suite; it was not repeated in the final focused run.
- TypeScript checked the project successfully; ESLint passed for the changed production code and new UI test.
- `git diff --check` passed.
- `npm run build` completed successfully (Next.js 15.5.25).
- Live authenticated seller actions have not been retested; the browser is on the sign-in page. No customer listing was changed for testing.

## Release notes

GitHub and Vercel connector calls return HTTP 400 `Invalid MCP request metadata`. Public git reads work, but a dry-run push fails because authenticated write credentials are unavailable. The user approved publishing this prepared fix through the signed-in GitHub/Vercel browser. Production deployment status must be verified after merging; live authenticated seller verification still requires a seller session.
