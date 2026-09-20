# Academy hydration correction — 20 September 2026 UTC

Production inspection on release `94c385c` logged React hydration error 418 on
the Candles lesson. Returning learners had browser-local saved progress that
the server could not include in its initial HTML. The lesson, Academy roadmap,
and student dashboard read that storage during their first render.

The regression tests reproduced the mismatch before correction. The components
now render the same initial snapshot on server and browser, then restore saved
progress after mounting. Notes, video position, workbook progress, completion,
and dashboard summaries remain available. The lesson is keyed by ID so navigation
starts a new component state for the new lesson.

Validation after the workspace recovery:

- 15 targeted tests passed across three files, including eight hydration cases
  covering English and Arabic, incomplete/completed lessons, roadmap completion,
  and dashboard notes.
- Tests retain the server-rendered lesson heading, restore the saved state,
  and confirm initialization does not overwrite notes or send a progress write.
- TypeScript and changed-file ESLint passed; the diff is whitespace-clean.
- Native app and contract source are unchanged. Signed iOS build 13 does not
  need rebuilding for this web-only correction.

The Supabase failure message now includes a bounded provider error code to aid
diagnosis. This is not a fix or a passing claim for remote progress persistence.
The embedded PDF observation also remains separate: direct PDF viewing worked,
but the cloud browser's embedded viewer remained blocked despite corrected
same-origin response headers. No storage, identity, or framing policy is relaxed
by this change.

This record establishes local verification only. Deployment and live browser
results must be recorded separately once available. It does not claim App Review
submission, approval, a physical-iPhone run, or a new full-suite/hosted-CI run.
