# Cross-page section navigation

## Observed failure (D117)

On production `5231646f688d59568fe31b5891ce8405ba451dab`, clicking the persistent header's Create Listing button from `/en/trades` changed the URL to `/en/usdt-exchange#create-listing` but left the viewport at the top. The header button retained focus, while the mounted form began approximately 5,160 pixels below the viewport. No listing, trade, payment, or review was submitted.

The same control, when invoked from the exchange page, focused `#create-listing` and revealed the form. This isolates the observed failure to carrying an explicit section request across a route transition. It is separate from D115's moving target during smooth scrolling and does not establish the cause of D95's intermittent required-action focus failure.

## Cause and change

`PageSectionNavigation` correctly avoids stealing focus during initial hydration. However, its route-change effect applied the same rule to the persistent header button that initiated an explicit navigation. `CreateListingQuickLink` only pushed the destination URL, so the destination restorer could not distinguish that request from an unrelated focused control.

The section controller now retains a short-lived explicit request before a router push. The destination consumes it only when the locale, pathname, query, and section match, and focus still belongs to the initiating control or the document. A newer pointer, keyboard, scroll, touch, or different-focus interaction cancels the request. Requests expire after ten seconds. The initial-hydration focus protection and existing section-controller cancellation remain intact. Cross-page section links also record their explicit intent through the shared navigation listener.

## Verification

- Two new English/Arabic component regressions failed against the released source: focus remained on the header button instead of the delayed form. The previous 31 cases passed.
- After the repair, all 43 navigation component tests pass, including cancellation, expiry, route/query/locale/hash mismatch, cross-page links, initial hydration, and deferred form mounting.
- Root TypeScript checking, targeted source lint, and diff whitespace checks pass locally using the existing matching test dependencies. CI must independently install and verify the exact candidate.
- Eight loopback-only browser cases cover seller/owner, English/Arabic, and pointer/keyboard activation from My Trades. They assert destination URL, focused form, viewport position, and an empty amount field. Candidate Chromium/WebKit and all required release checks remain necessary before deployment.

No retry, flaky-test policy, financial invariant, durability setting, or latency threshold changes are included.
