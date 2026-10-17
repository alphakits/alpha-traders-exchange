# Release test contracts and deterministic receipt time

Two release-test defects were reproduced during the continuation audit.

## Signed-out session discovery

Reliability Shield #1044's first WebKit group and Chromium run failed the
logout assertion on all three attempts: `/api/auth/me` returned 200 where
the test required 401.
That endpoint intentionally returns `{ "user": null }` with status 200 to
signed-out clients. Private account endpoints still require authentication.

The browser test continues to click the visible Sign out control, await the
logout response and home navigation, check the control disappears and require
the academy destination to redirect to login. It now verifies the public
session response and separately requires the private account-session endpoint
to return 401. No application authentication behavior was changed.

The 26 selected session, cookie, navigation and remembered-login checks pass.
The local WebKit attempt could not launch because system libraries are absent;
dependency installation was denied by the execution environment. This is not
a browser pass. The corrected journey still requires the hosted browser gate.

## Receipt timestamp at the scan boundary

The complete local suite passed 5,641 tests but failed the network-switch
checkout test. The fixture placed the receipt one millisecond after issuance,
then immediately scanned to the current time. Fast execution put the receipt
outside that scan's time horizon. A focused rerun passed, but freezing the
clock reproduced the same failure deterministically.

The test now controls `Date.now()`, first confirms the future receipt is not
settled, advances time one second, then confirms verification, seller access
restoration and duplicate-scan idempotency. All 34 checkout runtime tests pass.
No production receipt filter, provider verification or payment rule changed.

The complete suite passes 5,647 tests across 537 files after this correction
and the separate navigation-scroll repair. Changed-file lint passes. The
production compilation is being rebuilt with a fresh generated cache after
Webpack rejected an old context hash. The hosted release gate remains
required for the exact source.
