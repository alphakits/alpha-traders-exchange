# Alpha Exchange Final Performance Sprint

**Base:** `origin/main` at `745bf28c7f37da4876ea791f416022b81b7691c9`  
**Protocol:** isolated detached base worktree versus the performance branch, fresh warmed Next.js development servers, identical local fallback data, Chromium at 1365x900 and mobile emulation at 390x844. Each API result is the median of seven authenticated requests.

## Results

| Surface | Before | After | Result |
| --- | ---: | ---: | --- |
| Homepage ready / LCP | 1,809 / 1,104 ms | 1,727 / 1,024 ms | 4.5% / 7.2% faster |
| Marketplace desktop ready / LCP | 4,273 / 2,152 ms | 4,044 / 2,016 ms | 5.4% / 6.3% faster |
| Marketplace mobile ready / LCP | 3,380 / 1,636 ms | 3,414 / 1,720 ms | within run variance |
| Marketplace mobile long-task time | 2,156 ms | 1,760 ms | 18.4% lower |
| Buy modal form mount, desktop | 242.1 ms | 214.5 ms | 11.4% faster |
| Buy modal form mount, mobile | 228.8 ms | 196.9 ms | 13.9% faster |
| Seller dashboard ready | 3,283 ms | 3,260 ms | 0.7% faster |
| Listing-form navigation | 1,376.3 ms | 681.6 ms | 50.5% faster |
| Seller profile ready / LCP | 1,738 / 956 ms | 2,001 / 952 ms | LCP neutral; ready-time variance regressed |
| Admin dashboard ready / LCP | 1,610 / 1,592 ms | 1,555 / 848 ms | 3.4% faster; LCP improved in this run |

The marketplace critical window dropped from 13 to 11 API requests on both desktop and mobile. One duplicate `/api/market/center` request was removed permanently; the seller-profile refresh now starts after the Buy form paints rather than competing with the interaction. Marketplace resources dropped from 29 to 28.

| Authenticated API | Before median | After median | Payload |
| --- | ---: | ---: | ---: |
| Seller profile | 76.3 ms | 62.1 ms | 1,472 B |
| Marketplace listings | 61.8 ms | 52.9 ms | 2,463 B |
| Marketplace Pulse | 47.3 ms | 61.2 ms | 591 B |

The Pulse implementation was not changed; its result is recorded as run variance rather than presented as an improvement. Production build route sizes remained unchanged at the displayed precision: marketplace and seller dashboard 241 kB first load, seller profile 126 kB, admin 193 kB, and shared JS 102 kB. Total emitted static JS changed from 2,645,863 to 2,646,701 bytes (+838 B, 0.03%).

## Ranked bottlenecks and disposition

1. **Duplicate market feed polling** — fixed by sharing the existing feed with the marketplace market-center view; removes one startup request and one 45-second poller.
2. **Repeated seller-profile database reads and trust aggregation** — fixed by reusing one database snapshot and one computed trust map through the route.
3. **Seller profile request competing with Buy modal paint** — fixed by starting the freshness request after the modal transition begins and aborting superseded seller requests.
4. **Marketplace hydration/DOM size (about 2,000 nodes)** — retained; safe reduction requires a larger component-boundary change without sufficient sprint evidence.
5. **TradingView/development resource weight (about 6.5 MB encoded in the local trace)** — retained to preserve live charts and production behavior.
6. **Seller dashboard DOM size (about 2,250 nodes)** — retained; existing deferred panels already limit initial work and broader virtualization was not safely measurable here.
7. **Notification, presence, workspace, and Pulse startup requests** — retained to preserve freshness, real presence, privacy, and reliability semantics.
8. **Marketplace Pulse full-state aggregation** — investigated but not changed because the measured endpoint was already 47-61 ms and no stable gain was demonstrated.
9. **Admin client bundle (193 kB first load; 143 kB route chunk)** — retained because role tools are tightly coupled and speculative splitting risked behavior changes.
10. **External seller/profile images** — retained because changing optimization and host handling could change delivery behavior; no image was the measured LCP on the tested fixtures.

## Validation and constraints

- Production build passed: 134 app routes; route sizes above.
- ESLint passed.
- Vitest passed: 40 files, 192 tests.
- Focused performance regressions passed: 6 files, 15 tests.
- Marketplace Playwright passed: 31 tests, 3 credential-gated skips.
- Full Playwright reached 51 passed and 9 credential-gated skips; one auth-only invalid-login assertion failed because this environment has no Supabase auth configuration and returns the configuration error instead of an invalid-credentials message. Authentication code and behavior were intentionally untouched.

Lighthouse against a production-mode local server was not valid because required Supabase/database/service-role credentials are absent and the production runtime correctly rejects requests. No Lighthouse score or production credentialed route timing is invented. Objective browser navigation, LCP, CLS, long-task, resource, request, payload, and interaction timings are reported instead. Listing creation persistence profiling is likewise database-credential constrained; the listing-form interaction was measured, while correctness remains covered by existing integration and Playwright lifecycle tests.

## Behavior guardrails

The changes do not alter pricing, listing/trade logic, wallet logic, trust ordering, Pulse privacy, presence, activity, audit history, authentication, notification freshness, responsive layouts, or modal content. The Buy modal still refreshes live seller data; it now paints from the already-enriched listing first and ignores/aborts stale responses when selection changes.
