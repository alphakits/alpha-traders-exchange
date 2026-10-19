# Monitoring history and commission acceptance recovery

The October 19 scheduled Reliability Shield run 39190789860 failed strict
acceptance after the Arabic desktop commission test passed only on retry.
307 other browser cases passed. The original trace shows the fee explanations
passing, followed by all three concurrent `boundingBox()` calls remaining pending
until the 60-second test deadline. The final captured frame contains the correct
100 USDT receive amount and network-fee explanation. This establishes a browser
measurement stall; it does not establish a financial-calculation failure.

The test now captures the instruction card with one bounded Playwright locator
screenshot. Its fee, receipt, previous-payment balance, 102 USDT next total,
network control and overflow assertions remain. CI also repeats all four
English/Arabic phone/desktop cases three times with retries disabled. The normal
strict fail-on-flaky release gates remain enabled.

The Railway monitor previously held only in-memory history. Restarting its
process discarded the evidence needed to cover delayed GitHub scheduling.
The worker now saves sanitized summaries in the existing database, restores the
latest 24 observations, and recalculates continuity. It retains historical
failures, reports unavailable storage, and does not claim coverage over missing
periods. A private RLS-enabled table denies browser-role access. No new hosting
service or credential is required. Apply the included migration before release.

Verification includes actual PostgreSQL-compatible storage roundtrips,
idempotent append, retention, denied browser-role reads, corrupt history,
restart restoration, gaps, storage failures and recovery, and the commission
component tests. Production/provider settlement and physical devices are
separate acceptance boundaries; passing these checks does not certify them.
