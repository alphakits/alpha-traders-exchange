# Academy administration response cache isolation

A signed-out production GET to `/api/admin/bootstrap` returned HTTP 401 with
`Cache-Control: public, max-age=0, must-revalidate` at 22:42 UTC on 17 October.
The response was a cache MISS. This establishes a cache-policy gap; it does not
establish that private content was leaked or a cached denial was reused.

The academy CMS uses its own `resolveAdminIdentity` guard, so the earlier shared
exchange authentication-header repair did not cover these routes. Its private
JSON responses and downloadable exports also lacked explicit no-store headers.

All nine academy administration route modules now wrap their responses with one
cache-isolation helper. Successes, validation failures, unauthorized responses,
rate-limit responses and CSV/JSON exports receive `private, no-store, max-age=0`
and vary by the session cookie and optional admin key. Existing content types,
download filenames, status codes, bodies, authorization and writes are retained.

Thirteen regressions failed before the repair: anonymous and authenticated GETs
for bootstrap, lessons, media, versions and export, plus all three export formats.
After the repair they pass, including checks that signed-out requests never read
private content and exports retain their contents and attachment headers.
The related authorization and lesson-write route tests also pass. Hosted release
checks and exact-version production response verification remain required.
