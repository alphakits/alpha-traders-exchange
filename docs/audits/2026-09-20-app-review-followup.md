# App Review follow-up — 20 September 2026 UTC

## Production preparation

[PR #174](https://github.com/alphakits/alpha-traders-exchange/pull/174) was merged
as `70b155d470b247eb96acc7530271f1d5e542baa9`. Its
[production deployment](https://vercel.com/alpha-kits/alpha-traders-exchange/p4tzM8XLkMkDRS8ZVSux7G8G8UrG)
reported success. The authenticated Website Health screen independently showed
that release and **All systems healthy**.

The owner interface now exposes **Record Verification** for existing approved
seller applications. All five approved-application pages were inspected without
exporting seller identities: 8 + 8 + 8 + 8 + 4 = **36 applications**. Each offered
the new action; none showed a recorded verification marker. No attestations,
seller approvals, suspensions, role changes, or financial actions were performed.

The prerequisite passed **36 tests across five files**, TypeScript, and ESLint.
Its nine published blobs and complete tree matched the tested local commit.
The full enforcement release remains in PR #173 until the actual prior checks
are reconciled. See the [rollout procedure](../deployment/seller-verification-rollout.md).

## Academy correction

Live inspection of the Candles lesson found a public workbook iframe displaying
“refused to connect.” Its first-party PDF inherited both `X-Frame-Options: DENY`
and `frame-ancestors 'none'` from the global response headers.

[PR #175](https://github.com/alphakits/alpha-traders-exchange/pull/175) corrects
both headers for the public course PDF directory and the known course-notes HTML
file. Only same-origin framing is allowed. Application, admin, API, upload, and
unrelated file routes retain their existing framing prohibition.

**14 regression tests**, TypeScript, and ESLint passed. The tests evaluate the
actual Next.js header configuration on three course-document paths and six
protected/unrelated paths. The
[preview build](https://vercel.com/alpha-kits/alpha-traders-exchange/CSJRPS7RQm57qsuPcgBHeA14Saa2)
passed, and the PR was merged as `94c385c060a06fe1ae8949cc3c16fb0f8c2f43b3`.
Its [production deployment](https://vercel.com/alpha-kits/alpha-traders-exchange/Guuu5wq8CGZ9Kpvfn8GBUS915VZf)
succeeded. The authenticated health screen showed that release as healthy with
no operational issues, and the public App Review preflight passed **23/23**.

Live HTTP checks confirmed `SAMEORIGIN` and `frame-ancestors 'self'` on the
course PDF and known HTML workbook. Login, health API, and an unrelated upload
path retained `DENY` and `frame-ancestors 'none'`. The Candles PDF returned 200
with `application/pdf`; all 59,221 bytes matched the repository file. Its SHA-256
is `07b7d7c16d34b6b9adec67ee34e96df9a65eb6e715423f0067919bab97fcf8da`.

The earlier cloud session still displayed a blocked embedded PDF after reloading.
A fresh browser session subsequently rendered the full Candles workbook inside
the lesson: its PDF toolbar, page thumbnail, title, summary, takeaways, and
objectives were visually inspected. No additional header relaxation was needed.
The earlier session's failure cause is unconfirmed. This is a browser observation,
not a physical-iPhone result.

The React hydration error was separately reproduced with saved browser progress
on the lesson, Academy roadmap, and student dashboard. [PR #176](https://github.com/alphakits/alpha-traders-exchange/pull/176)
restores browser-local progress after the server/client initial render. It passed
**15 targeted tests**, including eight English/Arabic hydration cases, TypeScript,
and changed-file ESLint. All seven blobs and its complete tree matched the tested
local source. The preview passed and it was merged as
`db1a548a85eeb3417f3f84a906031fb94f92e609`.
Its [production deployment](https://vercel.com/alpha-kits/alpha-traders-exchange/8DhoiAWRvibLMCZnoBVwSG6jkvkR)
succeeded; the live lesson loaded its new deployment-tagged script and the public
review preflight passed **23/23** again. See the [focused verification record](2026-09-20-academy-hydration.md).

On a fresh post-deployment reload, the lesson restored the visible saved reading
position and no React hydration error appeared in the captured application logs.
The separate web persistence failure identified **PGRST205**. PostgREST
[documents this code](https://docs.postgrest.org/en/stable/references/errors.html#group-2-schema-cache)
as a requested table not found. Inspection confirmed that the legacy client
attempted anonymous writes to `lesson_progress_events` and `lesson_progress_state`
while restoring progress only from browser storage; it had no remote read/restore
path. [PR #177](https://github.com/alphakits/alpha-traders-exchange/pull/177) removes
this unused, failing write and labels notes explicitly as saved in this browser.
It preserves local progress and notes without sending them to an unused backend.
The signed native Academy keeps its existing account-scoped device storage.
No database migration, access-policy change, seller authorization change, or
cloud synchronization was introduced. The store disclosure worksheets now
distinguish local Academy progress from server-held marketplace activity.

PR #177 passed **15 focused tests**, TypeScript, and changed-file ESLint. Both
published blobs and tree `de58877c86a402b9bd71cbd563a526d6f0ee2ea7` exactly match
the verified source. Its
[preview deployment](https://vercel.com/alpha-kits/alpha-traders-exchange/AWQLxqLPYFL5GNTDDSbqNQhMtGUr)
succeeded, and it merged as `660949244072f9a6db4eb6442c5b6eaedcfa65f3`.
Its [production deployment](https://vercel.com/alpha-kits/alpha-traders-exchange/GHxN15iM4pX47NDPw9vEzwxvVP6C)
also succeeded. The live lesson loaded the new bundle and browser-local label.
A temporary note in the previously empty field saved and restored exactly after
reload and hydration; it was then cleared through the UI and saved again.
Captured application logs showed neither the hydration nor Supabase progress
error. Browser-extension metadata errors were separate from application logs.
The public review preflight passed **23/23** on this release.

## Review evidence reconciliation

- Build **1.2.0 (13)** remains the signed native candidate from application
  commit `1d7bbc14499ae00de62952f2276c91461c427169`. No native app or contract
  source changed in these follow-ups. The previously archived 1,893-test and
  148-browser-test results retain their original scope and provenance.
- The integrated follow-up passed **20 targeted tests** across seller
  reconciliation and course-document framing. These are additional checks,
  not a claim that hosted CI or the full browser suite was rerun.
- The earlier reviewer account was found. Production currently shows an active
  Buyer and a rejected seller application. Historic conversational claims of
  seller access were not used as live evidence. Credentials and a dedicated
  non-financial fixture still need verification on the final backend.
- The owner's previously uploaded Israeli VAT business certificate was found
  and visually inspected. It remains outside the repository. It documents
  business registration, not the cryptocurrency permission basis or proof of
  Apple's submitting-entity eligibility. No certificate or legal response was
  sent to Apple.
- A [content-rights schedule](../mobile/academy-content-rights-schedule.md) now
  inventories the five published native lessons and 29 distinct media assets.
  It is unsigned and requires actual ownership/license facts from the rights holder.
- The Candles video loaded from Supabase Storage with browser media ready state
  4 and no media error. This confirms that observed provider and loaded asset;
  it is not a claim that every lesson or native playback was tested.
- The optional Discord Management screen reported a Railway worker diagnostics
  timeout and unknown resource readiness. Successful Discord delivery is not
  established. The primary App Review journey must not depend on Discord.
- Apple's original uploaded information request explicitly requires a recording
  captured on a physical device, starting with app launch. The response package
  was corrected to preserve that opening sequence. The existing labeled browser
  QA video remains internal QA evidence.
- The App Store Connect session subsequently expired. A secure browser sign-in
  attempt returned `submission_failed` without a visible site error. No
  credential was entered through an alternate tool, and no reply or submission
  was made. The owner must complete the browser's manual sign-in handoff before
  App Store Connect work can continue.

The owner has authorized continued work. Missing identity-review facts,
physical-device evidence, credential validity, and regulatory/content rights
are not inferred from that general authorization. No final App Review reply or
resubmission has been made.
