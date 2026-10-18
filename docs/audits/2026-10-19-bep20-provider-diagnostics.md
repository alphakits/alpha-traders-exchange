# BEP20 provider failure diagnosis

Production checkout and legacy history checkpoints at 2026-10-18 23:20 UTC
reported `bep20_index_block_unavailable`. Both cycles completed through the
existing Binance fallback; this did not identify the direct index failure.

The durable history scanner first asks Etherscan for a fixed upper block. That
lookup collapsed every provider rejection into one generic error, while the
subsequent transfer lookup classified plan, key and rate-limit rejections.
The initial lookup therefore hid the actionable diagnosis on every new cycle.

Both lookup stages now share a classifier that returns fixed, non-sensitive
codes. It preserves plan/key/rate diagnoses, distinguishes shared free quota
exhaustion from plan access, and identifies provider query timeouts. Unknown
or malformed responses retain a safe stage-specific error. Provider response
bodies, keys and URLs are never included in those codes.

The classifier follows Etherscan's documented response contract and failure
categories: https://docs.etherscan.io/common-error-messages

Verification:

- The two affected suites reproduced 11 failures out of 56 tests before repair.
- All 56 pass after repair. Including the existing BEP20 receipt verifier,
  all 68 focused tests pass.
- Durable-history checks verify the exact safe code is persisted, failed
  direct history does not supply receipts, and complete Binance fallback is
  still required when direct BEP20 history is unavailable.
- Focused ESLint and full TypeScript checking pass.

This changes diagnostics only. Payment attribution, amounts, tolerance,
confirmations, scan limits, provider credentials and release gates are
unchanged. The actual current provider cause must be read from a fresh
checkpoint after the tested release is deployed; successful live payment
settlement is not asserted by these tests.

## Release-gate finding: remembered-login request cleanup

CI1081 passed all 5,732 unit assertions but correctly failed on an unhandled
native remembered-login timeout after the test document closed. The initial
native lookup had unmount cancellation; checkbox-triggered clear requests and
the post-authentication save did not share that cancellation lifecycle.

The login form now uses its mounted native-request controller for load, clear,
and save. Closing the screen cancels pending requests and prevents a late
native save from navigating an abandoned screen. Native secure-storage writes
still require successful authentication and finish before normal navigation.

Two targeted regressions failed before this repair. All 65 login-form and
native-bridge tests pass after it, as do focused ESLint and TypeScript checks.
The original CI failure remains audit evidence; no release check, retry rule,
browser requirement, or performance threshold was relaxed.
