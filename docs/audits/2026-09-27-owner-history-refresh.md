# Owner trade history refresh recovery

The history page had separate initial-history and message-only reads. Background reads lacked a response deadline and retained displayed private data on denied access. A hung transport could leave the polling lock set indefinitely. Message-only refreshes did not update counterpart names, staff identities, evidence, disputes or audit history.

The page now reads one complete server-authorized history snapshot for initial load and refresh. Fetch and body parsing have a 15-second deadline even if the transport ignores cancellation. Updates never overlap, and stale responses after navigation, retry or background cancellation cannot replace current data. A 401, 403 or 404 immediately clears private history and stops automatic reads until explicit retry. Temporary network errors retain the last confirmed history and retry reads automatically. Offline and hidden tabs pause; reconnecting or returning refreshes the snapshot. Unsent drafts survive ordinary refreshes and are scoped to the current trade. No mutation is replayed by this recovery path.

## Evidence

- 62 tests passed across six suites, including stalled fetch/body cancellation, access revocation, full transcript retention, refreshed private names/audit, offline/background recovery, draft preservation and late-response rejection.
- Existing owner-history privacy, trade action and stream regression suites passed in the same run.
- Type checking and affected-file lint passed.
- No live customer trade, message, payment or account was changed by verification.

Authenticated browser acceptance and installed-device acceptance remain separate gaps. This change does not claim universal uptime or a newly verified real commission payment. Reviews remain aside.
