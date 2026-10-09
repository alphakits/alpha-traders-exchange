# USD/ILS reference repair — 9 October 2026

Status: draft implementation; not activated in production. An authorized real-time source is not configured. This change deliberately prevents ILS listing publication, repricing, renewal, resumption, owner approval, expiry extension and added inventory without a usable quote. Do not merge until the source is connected and verified; otherwise those actions will be unavailable. Pause/delete and existing trade amounts are unaffected.

## Confirmed incident

The production `/api/market/center` response returned `3.068082`, `status: live`, `stale: false`, and a fresh response timestamp. The source was `open.er-api.com/v6/latest/USD`, whose quote timestamp was `2026-10-09T00:02:31Z` and next update was the following day. The UI hid that source under `derived`. This is daily data, not live FX. Fetching it more frequently cannot fix the discrepancy.

The full screenshot supplied at 10:28 confirms **`SAXO:USDILS`**, displaying `3.05272` at that moment. This is the required provider; another broker or `FX_IDC:USDILS` must not be silently substituted. The screenshot value is historical evidence, not a rate to hardcode. Forex providers can have different quotes. USD and USDT are distinct; this platform intentionally uses USD/ILS as a benchmark for USDT/ILS listings.

## Implemented

- Remove daily and hardcoded USD/ILS fallbacks from the pricing path.
- Share a source-identified quote between `/api/market/center` and web/native listing validation.
- Pin the pair and configured symbol to `SAXO:USDILS`; validate finite price, provider timestamp, freshness, and market state using the same contract on web, native and server.
- Bound open-market quote age at 60 seconds. Never replace source time with fetch time. A closed market requires the provider's next-open time and has a maximum 96-hour quote lifetime.
- Poll every five seconds with shared browser requests, bounded server caching and three-second provider timeouts. This is polling, not tick-synchronous streaming.
- Retain a failed quote only as explicitly stale display data; never authorize a listing write with it.
- Show five decimal places, source and quote time, and an explicit USD/ILS benchmark label.
- Use one cent-rounded-down maximum for UI and API: `floor((USDILS + 0.35) * 100) / 100`. At the screenshot rate `3.05272`, the listing ceiling is `3.40`, not `3.41`.
- Validate mobile listing resumption, which previously skipped the cap.
- Recheck the actual stored terms inside the listing store for create, price/currency changes, resume, renewal, owner approval, expiry extension, added inventory and resubmission. Concurrency retries recheck the quote. Description-only changes, inventory reductions, pause/delete, rejection and existing trade progression do not depend on FX.
- Normalize web/native settlement prices before cap comparison. Show the native form its actual ILS price and maximum; preserve an untouched existing ILS price when the reference refreshes.
- Recheck source expiry after other market providers finish, so a slow crypto response cannot cause an expired FX quote to be labelled live.
- Return an unavailable response before writes when the FX reference cannot be verified. Do not block ILS quotes solely because BTC/ETH failed.

## Feed connection still required

TradingView's widget documentation says it has no data API for this purpose. Its standard market-data terms restrict non-display uses such as price referencing/order verification. The implementation does not scrape its scanner, extract widget data, or claim that widget access is a pricing-feed license.

Official references:
- https://www.exchangerate-api.com/docs/free
- https://www.tradingview.com/widget-docs/faq/data/
- https://www.tradingview.com/policies/
- https://www.developer.saxo/excel/user-guide/enabling-market-data
- https://www.developer.saxo/openapi/learn/direct-clients-request-for-openapi-application-credentials-for-the-live-environ
- https://www.developer.saxo/openapi/referencedocs/trade/v1/infoprices/get__trade
- https://www.developer.saxo/openapi/learn/pricing

Connect an authorized Saxo feed/adapter with rights for public website/app display and server-side listing validation. Saxo's published OpenAPI terms restrict standard market data to non-commercial personal use unless Saxo permits other use in writing. No Saxo connection, LIVE application credentials or permission for marketplace distribution were available in the inspected configuration. Provider choice is now confirmed; no account opening, subscription purchase or vendor agreement has been completed.

Saxo's authenticated InfoPrices endpoint supplies `LastUpdated`, `Quote` and instrument identity. The adapter must resolve the actual USDILS FxSpot instrument (do not guess its UIC), reject errors/delayed quotes, preserve `LastUpdated`, and confirm the price field against the TradingView chart. Account/amount-dependent bid/ask quotes must not be assumed identical to the public chart. A SIM token or periodically pasted test token is not a production connection. This draft does not implement OAuth or pretend that the normalized endpoint is already available.

Server-only configuration:

| Variable | Purpose |
| --- | --- |
| `ALPHA_FX_REFERENCE_URL` | HTTPS URL of the authorized normalized quote endpoint |
| `ALPHA_FX_REFERENCE_SYMBOL` | Required: `SAXO:USDILS`; any other provider fails closed |
| `ALPHA_FX_REFERENCE_TOKEN` | Optional bearer token, entered directly into deployment secrets |

No endpoint defaults to TradingView or another vendor. The provider-specific adapter is still to be connected; this schema is Alpha Traders' integration contract, not the native Saxo API schema and not an assertion that TradingView implements this API.

Illustrative response schema (the example is not a current quote):

```json
{
  "base": "USD",
  "quote": "ILS",
  "symbol": "SAXO:USDILS",
  "price": 3.05272,
  "quotedAt": "2026-10-09T07:05:00.000Z",
  "marketState": "open",
  "changePercent": -0.35
}
```

For `marketState: closed`, require `nextOpenAt` as an ISO timestamp. Missing, expired, malformed, wrong-source or future-dated quotes fail closed. The provider's timestamps must be actual market timestamps, never synthetic times assigned by the adapter. Redirects are rejected so bearer credentials cannot be forwarded to a different host.

## Release requirements

1. Provider confirmed: `SAXO:USDILS`. Obtain/verify authorized access for website/app display and server-side use.
2. Connect its adapter and configure the three server-only settings in a preview.
3. Verify real provider responses, market-open and market-closed behavior, source timestamp latency, rate limits, cache recovery, and same-time comparison against the selected TradingView symbol.
4. Exercise creating, editing, renewing, resuming, owner approval, extending expiry and adding inventory at/above the ceiling on desktop and phone; confirm a feed outage refuses writes but permits pause/delete and existing trade completion.
5. Run the full repository release gate and production build before merging. Verify native UI separately and ship its app update as required; server validation covers existing app versions but cannot replace their installed UI.
6. After production release, confirm the deployed commit, provider symbol, live response, quote timestamp and listing ceiling. No production release or real-feed end-to-end verification has occurred in this draft.

## Local verification

415 targeted tests pass across 20 files, including provider parsing/timeouts, wrong-provider rejection, shared source age/cap rules, web/native create/update/resume routes, store-level publication/renewal/approval/extension boundaries, commission restrictions, partial inventory, concurrent marketplace activity, bank/cardless/face-to-face and negotiated-offer trade flows, browser polling and market rendering. Price rejection/outage checks verify no listing, audit or notification writes occur. Web and native TypeScript validation and changed-file ESLint pass. Tests use explicit synthetic fixtures; they are not evidence of a live provider integration. Full production build/release gate and device/browser end-to-end checks remain for feed activation.
