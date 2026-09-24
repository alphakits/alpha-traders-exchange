# Two-sided marketplace fee verification

Scope: PR #263, `feat/buyer-seller-1pct-fees`.

## Agreed behavior

New trades after rollout: buyer pays 1% through the selected trade payment method to the seller. Seller pays their own 1%, and forwards both components to Alpha. Buyer receives the full agreed USDT amount. Both parties see the fee disclosure; seller and owner see separate components. This is payment detection, not an automatic withdrawal from customer accounts.

A request's `buyer_seller_1pct_v1` policy is frozen when it is created after the buyer reviews the disclosure. Existing requests, including still-open trades, retain seller-only fees. Existing paid/pending commission records are not migrated or retrospectively increased.

## Corrections

- Fixed the overescaped buyer fiat validator.
- Shared integer-arithmetic payment math across server, web, and native clients.
- Cash is the inclusive ATM total. USDT is derived from that fixed cash amount and the agreed rate; cash does not grow by 1% after the buyer prepares a code.
- Round the inclusive total once; allocate its rounding in the displayed fee line. This preserves every 100-ILS increment from 100 through 10,000, including 5,000, which is not representable if the base is rounded before adding the fee.
- Preserve fee policy during counteroffers and amount corrections.
- Do not treat all trades completed after release as new-policy trades.
- Require the fee-policy acknowledgment on public create APIs. Old web clients receive a refresh/review response; old native clients receive APP_UPDATE_REQUIRED.
- Separate seller's own fee, collected buyer fee, combined base amount, and the existing exact payment reference amount. Automatic settlement still requires a verified matching receipt and remains idempotent.

## Verification

- Full local suite: 375 files, 3,012 tests passed.
- Focused fee/trade/receipt/API suite: 10 files, 223 tests passed.
- Native TypeScript check passed.
- ESLint passed.
- Production Next build passed during this work; final-tree build is recorded in the PR follow-up.
- Tests include legacy completions, all three payment methods, exact ATM totals, new-policy request creation, rejecting an underfunded ATM request, simultaneous completion, and combined-fee receipt verification without double settlement.

## Release gates

Keep this change in draft until the exact preview commit passes the hosted checks and browser walkthrough. The native build must be coordinated with the API acknowledgment requirement: publishing the server alone would require installed older native clients to update before starting another trade. Do not silently start charging old clients that did not display the fee.

Production receipt discovery observed at 2026-09-24 23:25 UTC: TRC20 and Binance history scans complete; Binance covers an unsupported BEP20 explorer plan. No new payment was verified in the observed runs. A base-amount-only unmatched deposit was reported. Do not mark it paid, change matching safeguards, or request a second payment without reviewing its original payment record.

No live customer trade or money transfer was made for testing. No claim of 100% live payment verification is supported by these local tests.
