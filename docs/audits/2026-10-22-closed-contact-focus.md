# Closed contact prompt focus — 22 October 2026

The private-contact prompt mounted its autofocus phone input even when its
native dialog was closed. A seller with a valid saved number therefore still
triggered an input focus call during the prompt's mount. This is unrelated to
whether that account needs to supply a private contact number.

The form now mounts only while the contact requirement is active. The dialog
and its existing open/close behavior remain available; a missing or invalid
number still requires completion, and failed saves, timeouts, account changes,
sign-out and essential support routes retain their existing handling.

Verification on the local production build:

- Two new English/Arabic regressions failed before the change: the closed
  prompt called input focus while a completed seller was editing another field.
- All 81 focused contact, recovery, navigation, feedback and numeric-input
  checks pass after the change. The production build and application/unit-test
  lint pass. The repository lint configuration excludes browser test files.
- The full WebKit bank-transfer listing scenario passes with zero retries,
  including Settings/history navigation, reloads, single/multiple bank-account
  selection, listing submission and public bank-data privacy. Added assertions
  verify the first amount remains entered and a completed profile has no closed
  contact input mounted. The scenario took 45.5 seconds locally.
- The local browser used synthetic loopback accounts and fixture market quotes;
  external provider requests were blocked. This is not live settlement or
  physical-device acceptance.

CI1124's original first-edit loss has not been causally attributed to this
closed-dialog focus call. It remains an open intermittent finding. Likewise,
CI1125's two completion calls above 1,000 ms remain failed performance evidence;
this change does not modify the transaction engine or relax either release gate.
Full candidate CI, merged-source CI and pinned deployed verification are still
required. No production data, financial policy or provider configuration changed.
