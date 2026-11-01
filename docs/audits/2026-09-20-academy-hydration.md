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

## Production hydration and workbook verification

[PR #176](https://github.com/alphakits/alpha-traders-exchange/pull/176) merged as
`db1a548a85eeb3417f3f84a906031fb94f92e609`. Preview and production builds succeeded.
The live lesson loaded its new deployment-tagged bundle, restored saved reading
progress, and produced no React hydration error in the captured application logs.
The public review preflight passed 23/23. A fresh browser session also visually
verified the embedded Candles PDF after the separate framing correction in
PR #175. The earlier session's continued PDF failure cause is unconfirmed.

## Removal of the unused remote progress write

The bounded diagnostic added in PR #176 identified PostgREST `PGRST205` on the
legacy progress write. Source inspection established that web progress is read
only from browser storage. There is no remote read/restore path. The write used
an anonymous learner identifier and attempted to send notes to progress tables
that the deployed API did not expose.

[PR #177](https://github.com/alphakits/alpha-traders-exchange/pull/177) removes
that failing one-way write and its unused learner identifier. Existing local
notes, video position, workbook progress, completion, and summaries are retained.
The English/Arabic notes label now explicitly says it is saved in this browser.
Native Academy progress remains in its existing account-scoped device storage.
No database migration, access-policy change, or cloud-sync claim is introduced.

The two changed source files passed the same 15 focused tests, TypeScript, and
ESLint. The published tree exactly matches local verification:
`de58877c86a402b9bd71cbd563a526d6f0ee2ea7`.

The PR merged as `660949244072f9a6db4eb6442c5b6eaedcfa65f3`; both preview and
[production builds](https://vercel.com/alpha-kits/alpha-traders-exchange/GHxN15iM4pX47NDPw9vEzwxvVP6C)
succeeded. The live lesson loaded that deployment's bundle and displayed the
new label. Its originally empty notes field was given a temporary QA note, showed
the saved indicator, and restored the exact note after reloading and hydration.
The temporary note was cleared through the same UI and saved again. Captured
application logs contained no hydration or Supabase progress error; unrelated
browser-extension metadata errors were excluded from that app-specific result.
All **23 public App Review preflight checks** passed against this deployment.

This record does not claim App Review submission, approval, a physical-iPhone
run, or a new full-suite/hosted-CI run.
