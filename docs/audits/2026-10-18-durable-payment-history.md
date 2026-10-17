# Receiving history resumes after the page limit

The five-page request budget previously restarted at page one on every run.
A busy receiving wallet could remain paused indefinitely. The legacy commission
scheduler also still submitted partial observations even though the checkout
runtime had already been repaired to reject incomplete receiving history.

Both schedulers now persist server-only history progress with an atomic version
check. TRON keeps its original timestamp range and fingerprint. BSC resolves a
fixed upper block, then continues the same page range. Binance keeps its fixed
time window and offset, including older 89-day windows. A provider failure
retains the last committed progress. Losing concurrent workers cannot publish
their observations or advance another worker's checkpoint.

Historical completion alone is insufficient. A scan resumed on a later run
catches up through a fresh common time horizon before exposing those receipts
to settlement. Identical observations are deduplicated; conflicting amounts
and networks remain visible. A completed cycle starts another full sweep so
late indexed receipts are not permanently excluded. Independent destination,
amount, finality, receipt reservation and seller attribution checks remain.
Binance's observed credit timestamp is only a narrowed search hint: the receiving
account is read again and its actual deposit ID, amount and network are verified.

The private progress table was installed as migration
`20261017212857_commission_deposit_scan_progress.sql`. Its RLS is enabled; anon
and authenticated roles cannot select it. The table was empty after installation.
Customer commission counts remained 57 paid and six overdue. Security advisors
showed no WARN or ERROR findings; the new private table adds one informational
no-policy notice. No customer payment or balance was rewritten.

Verification: 177 tests across eight provider, durable-history, checkout,
legacy-scheduler and payment-routing suites passed. Seven tests exercise the
actual migration and compare-and-swap statements in embedded PostgreSQL. They
cover seven-page restart recovery, newer competing receipts, outages, duplicate
observations, competing workers, earlier intent bounds, newly configured
providers, failed persistence and private-table access. The database CI job also
now races two checkpoint writers on real PostgreSQL. Type checking and focused
ESLint passed. Exact-head CI and deployed provider acceptance remain required.

Separately, all eight English/Arabic phone/desktop WebKit tests for the approved
fee explanation and carry-forward screens passed. Two test selectors were
corrected: the network combobox uses its accessible role, and the exact receiving
amount is scoped to its visible amount element rather than hidden help text.
The screenshots use synthetic payment data and block external financial calls.

Provider references checked during implementation:
- https://docs.etherscan.io/api-reference/endpoint/getblocknobytime
- https://docs.etherscan.io/api-reference/endpoint/tokentx
- https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/capital

This repair resolves the code portion of B12. It does not certify a live provider
failure/recovery exercise, a production backup restore, physical Safari, all
authenticated role journeys or a production application release.
# Batch release-gate follow-up

The c499513 preview gate found three outdated batch-scanner fixture failures.
Those tests did not provide the private history store introduced by this change,
so the scanner correctly failed closed. The fixture now provides the same isolated
checkpoint pool as the scheduler regression tests and asserts the bounded provider
window. All six batch integration checks pass without bypassing history persistence
or weakening receipt reservation and provider-failure assertions.

Reliability Shield #1042 passed the real PostgreSQL checkpoint race, transaction
recovery and all three controlled restore checks. Its strict performance gate
failed: 240 successful status actions measured median 320.84 ms, p95 1339.07 ms
and maximum 1718.85 ms. The failure remains recorded; no timing threshold or
workload has been relaxed. This is separate from the payment-history correctness
checks and still requires investigation before production acceptance.

