# Native purchase form refresh and pending-operation guards

## Reproduced behavior

On the PR428 source tree, an open native purchase form keeps a removed payment
method selected after its listing refreshes. The visible option disappears but
submission remains enabled. The server already rejects unsupported methods;
this defect produces a misleading client state rather than bypassing that guard.

Two native press callbacks delivered before React renders the pending state
invoke trade creation twice. The server's existing request and inventory guards
remain authoritative; the reproduction establishes duplicate requests, not
duplicate completed trades or charges.

Pending work was bound to a string containing account, listing and form mode.
Leaving and returning to that same string allowed an older response to populate
the cache and navigate the newer visit. A queued old callback could submit after
switching listings, and a response could navigate after the screen unmounted.

## Repair

- Require the current listing to support the selected payment method. Keep the
  entered amount and wallet, explain the change in English/Arabic, and require
  the buyer to choose an available method explicitly.
- Acquire a synchronous submission guard before calling the API. Release it on
  completion so an actual failed request can be retried.
- Give each form visit its own identity. Ignore callbacks, successes, errors
  and pending-state changes from replaced or unmounted visits. An older request
  cannot unlock a newer pending submission.

The server, fee calculations, request deduplication and financial transactions
are unchanged. An already submitted request is not canceled merely because the
screen closes; it remains discoverable through the buyer's trade workspace.

## Verification

Four new checks failed on unchanged source: removed-method submission,
same-render double press, old-visit completion, and a queued old callback.
Two additional unmount checks failed before adding the lifecycle guard.

The final coverage includes English/Arabic method changes, preserving a still
supported selection, retry after failure, account/listing/mode changes and
return, old completion during a newer pending request, current success, and
unmount success/failure. All 118 tests across the 17 native/source-route and
transaction suites pass locally. Native TypeScript and changed-file lint are
required before publishing the candidate; full CI remains a separate gate.

This is source-level native-app verification. Web deployment does not distribute
a new iOS or Android binary. Physical-device execution and store distribution
remain separate acceptance work.
