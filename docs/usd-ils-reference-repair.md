# USD/ILS reference repair — 9 October 2026

Status: draft implementation; not activated in production. An authorized real-time source is not configured. This change deliberately prevents ILS listing publication, repricing, renewal and resumption without a usable quote. Do not merge until the source is connected and verified; otherwise those actions will be unavailable. Pause/delete and existing trade amounts are unaffected.

## Confirmed incident

The production `/api/market/center` response returned `3.068082`, `status: live`, `stale: false`, and a fresh response timestamp. The source was `open.er-api.com/v6/latest/USD`, whose quote timestamp was `2026-10-09T00:02:31Z` and next update was the following day. The UI hid that source under `derived`. This is daily data, not live FX. Fetching it more frequently cannot fix the discrepancy.

The user's TradingView screenshot shows approximately `3.05437`. Its provider is cropped out. `FX_IDC:USDILS` is a candidate, not a confirmed choice. Forex providers can have different quotes. USD and USDT are distinct; this platform intentionally uses USD/ILS as a benchmark for USDT/ILS listings.

## Implemented

- Remove daily and hardcoded USD/ILS fallbacks from the pricing path.
- Share a source-identified quote between `/api/market/center` and web/native listing validation.
- Validate the pair, configured symbol, finite price, provider timestamp, freshness, and market state.
- Bound open-market quote age at 60 seconds. Never replace source time with fetch time. A closed market requires the provider's next-open time and has a maximum 96-hour quote lifetime.
- Poll every five seconds with shared browser requests, bounded server caching and three-second provider timeouts. This is polling, not tick-synchronous streaming.
- Retain a failed quote only as explicitly stale display data; never authorize a listing write with it.
- Show five decimal places, source and quote time, and an explicit USD/ILS benchmark label.
- Use one cent-rounded-down maximum for UI and API: `floor((USDILS + 0.35) * 100) / 100`. At `3.05437`, the listing ceiling is `3.40`, not `3.41`.
- Validate mobile listing resumption, which previously skipped the cap.
- Return an unavailable response before writes when the FX reference cannot be verified. Do not block ILS quotes solely because BTC/ETH failed.

## Feed connection still required

TradingView's widget documentation says it has no data API for this purpose. Its standard market-data terms restrict non-display uses such as price referencing/order verification. The implementation does not scrape its scanner, extract widget data, or claim that widget access is a pricing-feed license.

Official references:
- https://www.exchangerate-api.com/docs/free
- https://www.tradingview.com/widget-docs/faq/data/
- https://www.tradingview.com/policies/

Connect a licensed provider or authorized adapter, with rights for website display and server-side price validation. Confirm the provider/symbol against the user's full TradingView chart. Neither a subscription purchase nor a specific provider has been authorized or completed in this change.

Server-only configuration:

| Variable | Purpose |
| --- | --- |
| `ALPHA_FX_REFERENCE_URL` | HTTPS URL of the authorized normalized quote endpoint |
| `ALPHA_FX_REFERENCE_SYMBOL` | Required, exact expected provider symbol |
| `ALPHA_FX_REFERENCE_TOKEN` | Optional bearer token, entered directly into deployment secrets |

No endpoint defaults to TradingView or another vendor. The provider-specific adapter is still to be connected; this schema is Alpha Traders' integration contract, not an assertion that ICE or TradingView implements this API.

Illustrative response schema (the example is not a current quote):

```json
{
  "base": "USD",
  "quote": "ILS",
  "symbol": "FX_IDC:USDILS",
  "price": 3.05437,
  "quotedAt": "2026-10-09T07:05:00.000Z",
  "marketState": "open",
  "changePercent": -0.29
}
```

For `marketState: closed`, require `nextOpenAt` as an ISO timestamp. Missing, expired, malformed, wrong-source or future-dated quotes fail closed. The provider's timestamps must be actual market timestamps, never synthetic times assigned by the adapter. Redirects are rejected so bearer credentials cannot be forwarded to a different host.

## Release requirements

1. Confirm the exact TradingView provider and licensed display/non-display access.
2. Connect its adapter and configure the three server-only settings in a preview.
3. Verify real provider responses, market-open and market-closed behavior, source timestamp latency, rate limits, cache recovery, and same-time comparison against the selected TradingView symbol.
4. Exercise creating, editing, renewing and resuming at/above the ceiling on desktop and phone; confirm a feed outage refuses writes but permits pause/delete and existing trade completion.
5. Run the full repository release gate and production build before merging. Verify native UI separately and ship its app update as required; server validation covers existing app versions but cannot replace their installed UI.
6. After production release, confirm the deployed commit, provider symbol, live response, quote timestamp and listing ceiling. No production release or real-feed end-to-end verification has occurred in this draft.

## Local verification

83 targeted tests pass across provider parsing/timeouts, shared quote and freshness handling, cap boundaries, listing create/update/resume routes, paused listing behavior, shared browser polling, and market UI rendering. Web and native TypeScript validation and changed-file ESLint pass. Tests use explicit synthetic fixtures; they are not evidence of a live provider integration. Full production build/release gate and device/browser end-to-end checks remain for feed activation.
