# Complete receiving history before automatic settlement

The audit reproduced a gap between provider discovery and reconciliation: a
scan could report incomplete receiving history while still passing its partial
receipts to settlement. A missing later page could contain a competing payment
option, so finality of one receipt alone does not establish safe attribution.
Three regressions reproduced premature settlement: TRC20, BEP20, and an internal
Binance deposit. A fourth reproduced an unrelated TRON outage marking an
otherwise complete BEP20-only scan as incomplete.

The runtime now calculates history coverage per payment network and only sends
receipts from covered networks to reconciliation. A configured but unavailable
or truncated Binance scan remains required because on-chain indexes cannot
enumerate internal Binance deposits. An unconfigured optional Binance reader
does not block public on-chain payments. Complete Binance history still covers
the unsupported BSC explorer plan. TRON coverage retains its independent chain
history requirement. Incomplete networks are included explicitly in the scan
result, causing the existing scheduler to report an incomplete observation.

No financial state is written for the paused network. A later complete scan
retries the receipt, then verifies and settles it once. Networks with complete
coverage can still progress. The exact-receipt, confirmation, destination,
attribution, replay, seller-unlock, and +/-2-USDT rules remain enforced.

## Executed verification

- Before repair: four new tests failed, 28 existing runtime tests passed.
- After repair: 194 tests across ten payment, provider, API, scheduler, clipboard,
  reservation and ledger files passed.
- Focused ESLint and the production build, including type validation, passed.
- Live signed-out GET checks: 21 web administration endpoints returned 401.
  Native administration first returned DEVICE_HEADERS_REQUIRED (400); after
  supplying valid synthetic device/app headers without any credentials it
  returned UNAUTHORIZED (401). These checks do not establish authenticated role
  permissions or deployed candidate acceptance.
- At 20:51 UTC, the read-only production log sample contained 15 consecutive
  successful checkout scans, with two pending checkouts, no new verified
  receipt, and no reported scan errors. A separate 30-minute error/fatal query
  returned no matching logs. These are bounded observations of the existing
  production release, not of this unreleased repair.

Provider timeout/five-page limits remain bounded. If a five-page history stays
incomplete, it stays paused and is not a successful recovery; durable history
pagination beyond that cap remains an explicit acceptance gap. The wider
candidate's prospective shortfall carry-forward policy is still unapproved.
Production release, controlled live transfers, separate deployed role sessions,
physical Safari and production backup/rollback acceptance remain open. No
production payment or account record was changed by this audit continuation.
