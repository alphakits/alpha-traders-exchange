# Face-to-Face meeting location — implementation and verification

Base: 904aca3aab2a3088f201ae3d02b38e352787404f (alphakits/alpha-traders-exchange)
Date: 2026-11-04. Status: implemented in isolated development sandbox, NOT deployed to production.

## Scope
- Website Trade Room, Arabic and English, desktop and mobile browsers.
- Only actual buyer/seller of the selected accepted, unfinished Face-to-Face trade may send a location.
- Bank Transfer, Cardless ATM, pending/unaccepted, completed and cancelled trades reject new location messages server-side; their UI has no location control.
- Single explicit geolocation request, separate preview and confirmation, map or manual-coordinate alternative.
- Canonical structured coordinates, no client URL/label/contact fields, generated HTTPS Waze and Google Maps destinations.
- Existing phone/WhatsApp protections, trade amount, payment confirmations and commissions remain unchanged.
- Existing durable transaction, message acknowledgement and idempotent retry are reused. Location retries have a separate pending attempt from text messages.
- New locations limited to five per participant per minute. Generic notifications/emails carry no coordinates.
- GPS permission remains blocked globally; only locale Trade Room documents permit first-party geolocation. A page entered through SPA navigation from a denied document offers an explicit reload or manual-point alternative.
- On-demand OpenStreetMap picker uses visible tiles, browser caching, attribution and origin-only Referer. Received location cards do not load external maps. Opening navigation shares coordinates with the selected provider.
- Authorized platform staff retain existing Trade Room visibility. Location is not public profile data or live tracking.
- Existing native app binaries do not gain GPS UI: mobile DTO is backward-compatible, with a message directing native users to the website. A separate app release would be needed for native controls.

## Completed verification
- First focused server/contract/API run: 125 passed.
- Initial UI regression run: 190 passed.
- Broad run: 8,170 passed / 19 failed across 653 files (8,189 tests). All failures were in dependency-security-guards and mobile-query-string-compat because npm ci was intentionally run with --ignore-scripts in the new sandbox.
- Reviewed and ran the repository's own postinstall patches. Re-ran both failing files plus all changed chat/location integration suites: 349 passed, 0 failed, eight test files. The full 8,189-test suite was not re-run after the environment correction.
- Final TypeScript noEmit: exit 0.
- Final targeted ESLint: exit 0, no warnings.
- npm run build completed successfully, including Next optimized compilation and route generation. No production database credentials were loaded.
- Real Chromium browser preview: 11 checks passed, including mobile 390x844 and desktop 1440x1000, Arabic/English, no automatic GPS or tiles, preview before send, Waze coordinate URL, no horizontal overflow, hidden bank/cardless controls, map selection without GPS and no page exceptions.
- Browser GPS was simulated and map tiles stubbed in automated checks; no real participant's location was collected. Actual iPhone/Android permission dialogs and Waze app handoff have not been manually verified.

## Preview
The isolated demo uses the real new UI components and local browser-memory messages only. It has no accounts, database connection, or real trades. This is not a signed-in, production end-to-end test. It is served from the named Vercel sandbox face-to-face-location-20261104, project prj_LW6qHJPjr4Ih9SGthgytKEliH8EH.

## Release / rollback
Review/apply this commit to a feature branch, check for newer upstream changes, run the standard repository checks and a preview deployment against non-production test accounts. Verify actual mobile browsers and navigation app handoff before production promotion. No schema migration is required. Do not use real active trades for automated QA.
Rollback by reverting this feature commit; new optional message data remains stored and old clients can still show the generic message text. Do not delete trade history or weaken contact/access policies.

## Follow-up QA after owner preview feedback — 2026-11-04

The user reported the preview working and requested additional assurance and clear user instructions. No production release was authorized in this follow-up and none was performed.

Two added regression tests first reproduced the stale map-center bug: selecting GPS or manual coordinates after opening the map could leave the picker centered at the previous point. The picker now derives its center from the selected point. External GPS/manual selections also reset its view to a detailed zoom. Real-browser testing exposed an independent horizontal/vertical scaling mismatch caused by the bordered responsive canvas; the pointer conversion now uses each actual viewport dimension separately.

Additional usability safeguards: map/zoom are disabled while sending; editing manual coordinates clears the old preview; visible Arabic/English steps explain choose, preview, confirm; success is displayed only after the message callback acknowledges success. The Face-to-Face eligibility and location throttling messages now have Arabic wording.

Final follow-up verification after all these changes:
- 328 tests passed, 0 failed across location contract, chat store, message API, security headers, composer, map regressions, real Trade Room UI integration and chat regressions.
- TypeScript --noEmit exit 0; targeted ESLint exit 0, no warnings.
- Updated isolated preview bundle built and served successfully.
- Real Chromium preview tests passed: GPS selected after opening map; selected pin equals the expected synthetic coordinates; acknowledgement-only success; Arabic instruction visibility; no horizontal overflow at widths 320, 375, 390, 768 and 1440; no page exceptions.
- The new coordinates were simulated. Navigation links were checked but no real native Waze handoff or signed-in production trade was executed.
- Full-suite and full production-build results above belong to the previous implementation pass; they were not rerun for this small follow-up.
- No production data, payment, commission, account or deployment was modified.
