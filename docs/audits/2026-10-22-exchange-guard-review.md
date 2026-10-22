# Exchange guard review — 22 October 2026

Read-only production database and source review at commit `76d973204942f7a427b5692bb7fb09ec9e68b059`. No customer trades, balances, commissions, grants or schema were changed. This checkpoint does not certify every production action.

## Evidence

**Live** means aggregate SELECT/catalog/log inspection in this session. **Source** means code/test assertions inspected. **CI** means [Reliability Shield 39649304050](https://github.com/alphakits/alpha-traders-exchange/actions/runs/39649304050), exact reviewed commit, successful 21 October 18:28:45 UTC: all nine jobs passed (PostgreSQL races/recovery/performance, unit/lint/build, Chromium, phone gates, four WebKit shards, release acceptance). Those unchanged suites were not rerun for this review. Controlled CI performance does not establish production/provider latency.

## Guard matrix

| Requirement | Source and regression evidence | Live scope / remaining |
| --- | --- | --- |
| Maximum three active seller trades; inventory reservation | `src/lib/alpha-exchange-store.ts:1396` asserts cap 3 and unreserved stock; invoked at lines 10800, 11065, 14218, 15100, including canonical commit. `marketplace-concurrency-scale.test.ts:256` races 75 acceptances. | Source+CI. Zero open requests at inspection; live contention not exercised. |
| Atomic lifecycle/retries | Repository line 2547 acquires advisory transaction lock 61422917 before canonical reread; snapshot save line 3900 fails closed on production lock errors. `trade-lifecycle-transaction.test.ts` covers lock/read order, unchanged retries, rollback and write scope. | Source+CI real PostgreSQL races/recovery. No production fault injection. |
| Maximum two adjustments | `updateTradeTerms` lines 10532–10569 validates participants, frozen terms, latest version, quote and inventory; increments submitted proposals. Contracts preserve legacy count. | Source+CI: `face-to-face-trade-completion.test.ts:572,596,619` cover two turns, concurrent final turn and legacy records. Live counts above 2: zero. |
| Adjustment cutoff | `src/lib/trade-amount-lock.ts:5` locks non-pending trades, acceptance/disclosure markers and irreversible history. | **Discrepancy:** current seller-proposal/buyer-approval contract freezes at acceptance, earlier than requested payment/code/cash cutoff. Reconcile requirements; do not silently relax financial guards. |
| Final adjusted amount; 1% each | Completion lines 14806–14846 uses final `next.usdtAmount`, one commission per request, separate 1% shares and 2% total under current fee policy. | Source+CI covers all rails 600→150 and 150→600 (test line 409). Live: both six-decimal-policy commissions match rounded 1% + 1% USDT and component sums. Legacy terms remain versioned. |
| Party/stage authorization and cancellation | Store lines 13974–13996 restricts party actions/completion; lines 14115–14177 enforces stage allowlists and rejects cancellation after payment, evidence/shared code. Buyer bank disclosure locks buyer cancellation. Owner uses verified reasoned paths. | Source+CI covers all rails, outsiders, seller-only completion, payment/cancel races and owner exceptions. Provider journeys not repeated. |
| Receipt tolerance/attribution | Live DB tolerance function returns 2,000,000 micros; matcher checks network, receipt time and competing checkouts. | Live catalog+source; no new on-chain payment. |

## Live integrity and access

Four active listings: valid min/max/available bounds. Zero request/trade status mismatches, JSON projection mismatches, duplicate commission request links, or trades without requests.

Exchange schema denies USAGE to anon/authenticated/service_role; anon/authenticated table grants empty; RLS enabled. No-policy INFO advisories do not establish public exposure. Performance advisors retain 24 unindexed foreign keys and 5 journal-policy initialization warnings; no changes made.

Three PostgreSQL errors in the inspected prior 24-hour window came from management-API queries, not identified application requests. This limited evidence is not an uptime guarantee.

## Preserved open findings

- **D98:** ten historical completed/review-open requests lack commission rows; nine also reference absent historical listings. No backfill or ledger repair.
- **D95:** historical intermittent WebKit funds-received focus failure remains open per `docs/trade-room-navigation-ownership-audit.md`; current controlled CI does not close it.
- **D105:** production latency remains above 1 second. Deployment review reports low-sample p95 for 21 October 20:00–22 October 00:00 UTC: purchase requests 1,587 ms (4 samples), notifications 1,238 ms (6 samples), stream 1,137 ms (7 samples), login 1,092 ms (1 sample). Separate telemetry, not this DB test.
- Physical devices, live provider execution, production load consistency and adjustment timing reconciliation remain outside full certification.

## Repair candidate verification

The accompanying change closes an open buyer dialog only after a valid marketplace refresh confirms that its selected listing is absent. HTTP failures and malformed responses preserve the entered amount. Existing seller replenishment and custom-limit behavior remains covered in English and Arabic.

The five notification read/archive/delete mutations now use the existing nine-table notification dependency set for both their initial read and canonical rebase. They still persist the complete notification collection under the existing transaction lock, publish only after a durable commit, and invalidate the complete-store cache after a scoped write.

Pre-release verification in an isolated checkout:

- The removed-listing regression failed against the unchanged production build: the obsolete dialog stayed open. Earlier browser-library setup failures were excluded from this evidence.
- Six focused unit/persistence suites passed: 120 tests, including 19 new tests for mutation scope, concurrent notifications/receipt bytes/sessions, failed commits, recipient authorization, and empty operations.
- A fresh production build with both repairs passed compilation and type checks.
- All four listing refresh browser regressions passed in Chromium without retries, covering English/Arabic replenishment, explicit caps, temporary failures, malformed responses, and confirmed removal without a purchase POST.
- ESLint passed for the changed source and unit test. The existing nine-job Reliability Shield remains the release gate; these focused checks alone are not production certification.

The notification optimization removes unnecessary reads of unrelated store collections. It does not establish a new production latency measurement or close D105.
