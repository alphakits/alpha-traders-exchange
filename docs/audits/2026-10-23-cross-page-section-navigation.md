# Cross-page section navigation

## Observed failure (D117)

On production `5231646f688d59568fe31b5891ce8405ba451dab`, clicking the persistent header's Create Listing button from `/en/trades` changed the URL to `/en/usdt-exchange#create-listing` but left the viewport at the top. The header button retained focus, while the mounted form began approximately 5,160 pixels below the viewport. No listing, trade, payment, or review was submitted.

The same control, when invoked from the exchange page, focused `#create-listing` and revealed the form. This isolates the observed failure to carrying an explicit section request across a route transition. It is separate from D115's moving target during smooth scrolling and does not establish the cause of D95's intermittent required-action focus failure.

## Cause and change

`PageSectionNavigation` correctly avoids stealing focus during initial hydration. However, its route-change effect applied the same rule to the persistent header button that initiated an explicit navigation. `CreateListingQuickLink` only pushed the destination URL, so the destination restorer could not distinguish that request from an unrelated focused control.

The section controller now retains a short-lived explicit request before a router push. The destination consumes it only when the locale, pathname, query, and section match, and focus still belongs to the initiating control or the document. A newer pointer, keyboard, scroll, touch, different-focus interaction, or browser history change cancels the request. Requests expire after ten seconds. The initial-hydration focus protection and existing section-controller cancellation remain intact. Cross-page section links also record their explicit intent through the shared navigation listener.

## Verification

- Two new English/Arabic component regressions failed against the released source: focus remained on the header button instead of the delayed form. The previous 31 cases passed.
- In the latest revision, all 53 navigation component tests pass, including interaction/history cancellation, expiry, route/query/locale/hash mismatch, cross-page links, initial hydration, and deferred form mounting.
- Root TypeScript checking, targeted source lint, and diff whitespace checks pass locally using the existing matching test dependencies. CI must independently install and verify the exact candidate.
- Eight loopback-only browser cases cover seller/owner, English/Arabic, and pointer/keyboard activation from My Trades. They assert destination URL, focused form, viewport position, and an empty amount field. Candidate Chromium/WebKit and all required release checks remain necessary before deployment.

No retry, flaky-test policy, financial invariant, durability setting, or latency threshold changes are included.

## CI1144 focus race follow-up

The first full candidate run on `a0834442` failed its strict flaky-test gate: the Arabic owner keyboard case failed to focus the form on its first attempt and passed its configured retry. Seven other new cross-page cases passed on their first attempts. The failed trace and artifact `12475004855` are retained; a retry success is not acceptance.

Four additional deterministic component cases exposed two gaps in the pending focus request: refocusing its initiating header could cancel the restoration frame, and router focus on the exact destination could cancel stabilization before hydration replaced that element. All four fail against `a0834442`. The request now recognizes those two focus owners while preserving cancellation for a different control, including an input inside the destination. Initial page-hydration focus remains protected. This reproduces specific lifecycle gaps; the original trace alone does not prove which focus event caused its failure.

All 50 component cases pass locally after the repair. The eight browser cases now retain bounded event diagnostics, and the WebKit release job repeats them three times with zero retries before its full group. The complete revised candidate and merged-source gates remain required.

The same CI1144 database attempt also failed its unchanged one-second timing threshold (14 of 270 actions, maximum 1,121.253 ms), while correctness and recovery passed. Its original evidence remains retained; no database code, durability setting, or performance threshold was changed.

## CI1145 controller lifetime follow-up

The 24-case zero-retry WebKit preflight on `cd121048` passed 15 cases, then the second Arabic owner keyboard case failed; eight remaining cases were not run. Event diagnostics in artifact `12475264590` show one Enter action, then an explicit `create-listing` event before the form mounts. No further pointer, keyboard, wheel or touch action follows. At failure, focus remains on the header and the form is 4,802.859 pixels below the viewport.

The route effect's cleanup unconditionally cancelled the global section controller. Two deterministic regressions reproduce lost restoration when the pathname hook catches up after a streamed mount and when the restorer remounts on the same route. Both fail against `cd121048`; the prior 51 cases pass. Effect cleanup now removes only its own scheduled frame and listeners. The shared controller retains its existing route guard, interruption handlers, ownership transfer and ten-second expiry. All 53 component tests pass, including a different-page cancellation case. The complete browser preflight and release gates still must verify this revision.

CI1145's separate database attempt also failed the unchanged threshold: three `funds_received` actions exceeded one second, maximum 1,022.073 ms. Their entry/read phases took 995–1,015 ms and writes about 5 ms. Eight recorded slow commits during that burst totalled 768.118 ms while the financial lock remained held. This identifies a queue-latency contributor, not sole causation or representative production performance. All original evidence remains retained.
