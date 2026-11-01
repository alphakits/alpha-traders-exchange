# Marketplace response masking performance

Marketplace listing enrichment rebuilt the same full identity matcher for every seller profile. The matcher now belongs to the response and is passed to each profile projection. The listing-text matcher remains separate because it includes historical seller display names. Standalone seller profiles retain their existing default matcher.

No matcher is cached globally or across requests. A regression checks a three-listing public response, an owner response, and a later public response after account names and authored fields change in the same input object. All current names remain masked, while authorized owner text remains visible.

Isolated Node 24.19.0 benchmark on four vCPUs: 550 synthetic accounts, 50 listings, mocked presence, three warmups and 15 measured calls per variant. Baseline median 94.902 ms (range 88.675–150.219); candidate median 7.478 ms (range 5.504–9.213). Selected listing/profile output hashes match. These sequential single-run samples measure in-memory response processing, not database, browser, provider or production latency. An earlier candidate sample overlapped other tests and is retained as diagnostic evidence rather than the matched comparison.

Validation: 35 tests in three focused suites, plus TypeScript and changed-file lint. The first added regression fixture retained an obsolete alias after renaming its account; the fixture was corrected to update all authored fields. No production behavior was changed to accommodate that fixture. Required CI results are tracked on the pull request.
