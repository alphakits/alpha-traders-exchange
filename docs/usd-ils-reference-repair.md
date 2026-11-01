# USD/ILS reference repair — 9 October 2026

Status: Wise connection implemented and verified against public provider responses; production release verification pending.

## Requirement and incident

The owner clarified at 11:24 Bucharest time that a current, genuine USD/ILS rate is required; Saxo is not required and Google or another source is acceptable. This supersedes the earlier draft's Saxo-only requirement.

Production used daily `open.er-api.com` data (`3.068082`, source time `2026-10-09T00:02:31Z`) while reporting a fresh fetch timestamp and `live`. The earlier code also used this daily provider. Older TradingView embeds covered BTC/ETH, not a connected USD/ILS pricing backend. Restoring those embeds would not repair seller limits.

## Connected source

The default source is Wise's documented unauthenticated illustrative quote endpoint:

`POST https://api.wise.com/2026Q4/quotes`

Request: `{"sourceCurrency":"USD","targetCurrency":"ILS","sourceAmount":1000}`.

No account, transfer, recipient, payment or credentials are created or supplied. The platform uses `rate` as an indicative USD/ILS benchmark for USDT listing limits. It does not use the fee-adjusted target amount or offer Wise execution/locked prices. USD and USDT remain distinct assets; using USD/ILS as the USDT listing benchmark is the platform's pricing policy.

Observed live response: `rate: 3.05395`, `rateTimestamp: 2026-10-09T08:28:01Z`, `createdTime: 2026-10-09T08:28:35Z`. These are evidence, never hardcoded rates.

- `rateTimestamp` is preserved as the source quote time. A new `createdTime` cannot refresh an old weekday rate.
- Open-market rates expire after two minutes, allowing the observed minute-scale publication cadence. Source/fetch timestamps, currency direction, quote status, price range and provider expiry are validated.
- Browser polling and the bounded server cache use five seconds. This is refreshed indicative pricing, not tick-synchronous TradingView data.
- Wise's published weekly closure is Friday 17:00 New York through Monday 09:00 Auckland. Both time zones account for daylight saving. During that closure, a rate from the closing period is labelled closed and requires a recent successful Wise response. Validity is bounded by reopening, provider expiry and the two-minute response freshness window. Older weekday rates and unconfirmed outages are not treated as closures. Unexpected holiday/feed gaps fail closed.
- A failed request never falls back to a daily or invented rate. Last-known values can remain visible only as stale and cannot authorize new listing terms.
- Optional server-only `ALPHA_FX_REFERENCE_URL`, `ALPHA_FX_REFERENCE_SYMBOL=WISE:USDILS`, and `ALPHA_FX_REFERENCE_TOKEN` support a normalized replacement adapter. None is required for the default Wise connection. The token is never sent to the public Wise endpoint.

References:
- https://docs.wise.com/api-reference/quote/quotecreateunauthenticated
- https://docs.wise.com/guides/product/send-money/quotes/unauthenticated-quote
- https://wise.com/help/articles/2448203/whats-a-guaranteed-rate
- https://www.google.com/intl/en/googlefinance/disclaimer/ (Google's currency data lists a three-minute delay)

## Shared listing rules

- Web, native and server share source/freshness validation and the cent ceiling: `floor((USDILS + 0.35) * 100) / 100`.
- At the observed `3.05395`, the ceiling is `3.40`; `3.41` is rejected. The UI shows the same permitted cent value the server enforces.
- Creation, price/currency changes, resume, renewal, owner approval, expiry extension, added inventory and resubmission check the actual stored listing terms at the mutation boundary. Concurrency retries recheck the quote.
- Native create/edit/resume enforce the same normalized settlement price. An untouched existing ILS price does not silently change when FX refreshes.
- Pause/delete, inventory reduction, rejection and existing trade progression do not require FX. BTC/ETH failures do not invalidate an otherwise usable USD/ILS quote.
- Display five decimal places, actual source and source time; chart candles are real samples collected since the page opened, not invented historical data.

## Verification and release

The updated implementation passed 436 targeted cases across 20 suites, with an additional default-provider timeout case checked separately (437 cases in total). Web TypeScript and changed-file ESLint pass. The Wise update adds coverage for actual rate timestamps versus fresh quote creation, provider expiration, wrong currencies, unavailable/malformed data, default requests without credentials, no daily fallback and closure/DST boundaries.

Release requires passing the updated provider/listing regression checks, web/native types and lint, a successful production build, and verification from the deployed endpoint. Test fixtures are synthetic; live provider probes and deployed observations are recorded separately. Native UI changes need an app release; server validation protects existing app clients after the web/backend deployment.
