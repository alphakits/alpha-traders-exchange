# Owner trade action and message recovery

Trade-specific owner controls previously had no transport deadline or persistent uncertain-result marker. An interrupted response could invite a second completion, closure or dispute action even when the first had already committed. HTTP success was not validated against the route acknowledgement, and a failed parent refresh was presented as an action failure.

Each trade action now persists opaque recovery metadata before a single bounded request. A fetch or body timeout leaves an unknown result, never a rollback claim. Other controls for the same trade stay locked through navigation and remount. Saved actions require a fresh authorized trade read; completion, closure and dispute resolution must agree with the returned state. Unknown results require checking trade/audit history and explicit acknowledgment before read-only recovery can unlock controls. No mutation is replayed. Reasons and private names are never stored in recovery metadata. Access loss hides this action panel.

The existing endpoints and financial/review state transitions are unchanged. Dispute acknowledgements validate the exact resolved dispute. Ordinary-admin cancellation still uses its existing route. Shared transport protection applies to the existing review-unlock control without changing review rules.

Owner chat now uses a deadline covering fetch and body parsing. Its draft clears only after a matching saved message acknowledgement (trade, message reference, owner role and text). Explicit retry of an unchanged draft uses its existing server-deduplicated reference. Confirmed delivery is distinguished from a failed history refresh. There is no automatic message retry.

## Validation

- 143 tests passed across ten suites, including server chat deduplication, route behavior, trade actions/streams, owner privacy, cross-surface locks, remount/navigation, malformed success, stalled fetch/body, matching readback, storage failure and message retry/refresh outcomes.
- Type checking, affected-file lint and whitespace checks passed.
- No real customer action, message or payment was used as a test.

Browser authentication/device acceptance, real-payment acceptance and previously recorded CI/provider issues remain separate gaps. This does not guarantee universal uptime or zero bugs.
