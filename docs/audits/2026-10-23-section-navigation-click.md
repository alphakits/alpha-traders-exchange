# Section navigation and the next click

Reliability Shield 1138 retained a first-attempt Chromium failure in
`navigation-hardening.spec.ts`: after My Trade Requests focused its section,
the first Browse Sellers click did not leave `/en/dashboard`. The retry passed,
and the strict flaky-test gate correctly blocked the release.

Artifact 12469678426 has SHA-256
`abd1bfa78dcd085f9f7f4687de544f9e39445c185109e697dab89ad4edd57a59`.
The click was aimed at (145, 580.86). Frames at 486284.252 and 486438.697 ms
show the target moving upward during the click; the latter snapshot records
79 pixels of document scroll. No marketplace navigation followed. The earlier
pointerdown cancellation did not prevent this recurrence: it cannot protect
coordinates selected before pointerdown is dispatched.

Section navigation now moves the viewport immediately before focusing its
destination. Deferred-section mounting, layout realignment, focus ownership,
and cancellation on newer interaction remain intact. Financial behavior,
browser assertions, retry policy, and the one-second database gate are unchanged.

`scripts/check-section-navigation.mjs` runs the real production controller in
an isolated browser document. It focuses a section, selects the next button's
coordinates, leaves a deliberate 160-ms pointer interval, and checks that the
first click actually opens the destination. Both text directions run in
Chromium and WebKit through their existing release-blocking jobs. The source
option allows an unchanged earlier controller to be checked separately.

Validation is recorded in the corresponding CI run. Original CI1138 evidence
is retained; this repair does not establish the separate D95 WebKit focus cause
or full physical-device acceptance.
