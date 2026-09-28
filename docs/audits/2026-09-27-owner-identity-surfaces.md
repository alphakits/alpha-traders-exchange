# Owner identity visibility follow-up

The owner now sees a member's canonical private full name next to the AT identifier on listing cards, seller profiles and trade-message labels. Owner dashboard audit, notifications, requests and commission seller labels resolve from all accounts, including buyers and suspended sellers. Seller applications use the same owner projection. The primary `owner` role now receives the exchange owner capability; an ordinary administrator does not.

Private names originate from canonical server-resolved users. Normal participant responses omit the private actor-label map. Disabled users and forged caller roles do not gain access. Public owner identity remains unchanged. No password, token or credential access is added. Presentation defaults to hiding private identity and handles long English/Arabic names with wrapping and bidirectional isolation.

Production trade-room reads retain their targeted snapshot. An enabled owner can trigger one additional parameterized primary-key lookup for actors actually present in that trade; ordinary participants do not. No full account scan, schema migration or customer mutation is needed.

## Verification

- 188 focused tests passed across 19 suites: identity presentation and privacy, owner/non-owner API projections, disabled/forged-role rejection, targeted repository reads, seller routes, offer lifecycle, concurrent trades, trade actions and stream handling.
- Type checking, affected-file lint and `git diff --check` passed.
- The targeted SQL was checked against the configured database using an empty ID array; zero customer rows were read or changed.
- Existing commission logic remains included: 2% total trade fees and the controlled ±1 USDT checkout adjustment with independent receipt verification.

Authenticated owner/browser acceptance and installed iOS/Android device acceptance are not established by these tests. No live customer payment was initiated. Reviews and store submissions remain outside this change. Universal zero-failure or 24/7/365 availability is not claimed.
