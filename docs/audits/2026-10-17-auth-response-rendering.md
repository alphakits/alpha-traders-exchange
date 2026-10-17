# Authentication response rendering

The deployed audit candidate `e162800` displayed the global critical-error
screen after an owner sign-in attempt. The browser reported React error 31:
an object with `message` and `code` keys reached a text render. A fresh page
did not confirm an authenticated candidate session. The source of that
upstream response remains unconfirmed; no authentication or deployment
protection was relaxed.

The login form assumed every `error` field was a string. A controlled component
test reproduced the same crash with a structured rejection. Login, verification
email resend and password-reset request feedback now accept only nonblank text
from their web response contract. Unexpected objects use existing fallback copy;
their internal fields are never stringified or displayed. The form and retry
remain available. Response types now express those fields as unknown.

Local verification passed 65 tests across login, native remembered login,
request recovery and password-reset request components. The new regression
failed before the repair. Focused ESLint and diff checks passed. Browser
regressions cover the same rejection and retry in English and Arabic and are
part of the existing Chromium and WebKit release jobs. The repaired commit
requires a new CI run and deployed acceptance before production promotion.

During the same audit continuation, Vercel's production Deployment Checks were
expanded from three to all nine Reliability Shield jobs: unit/lint/build,
Chromium, phone gates, PostgreSQL recovery, four WebKit groups and final release
acceptance. The final acceptance check was visibly marked Blocking. This is
configuration evidence, not an intentional failed-production release rehearsal.
