# Trade Room navigation ownership audit

The site-wide hash restorer and the participant Trade Room both tried to focus
incoming notification sections. Legacy receipt links use `#evidence`, while the
current upload control belongs to `#action-required`. The generic restorer could
focus receipt history first, cancel the room's pending frame, and keep restoring
the obsolete destination.

The shared section event now allows a mounted page controller to claim the
request. It announces newly mounted targets too, so a dynamically loaded room
can claim a request that began before it mounted. The room waits for its
canonical snapshot, resolves the current action, and handles repeated explicit
history navigation. Newer typing and user interaction still cancel pending
automatic focus. Listener, observer and timer cleanup is retained.

## Reproduction and verification

- Released baseline: `f3a3761a82e03ca1ad58e3a1703cf9c4c3a2e578`.
- Two deterministic unit regressions failed before the patch, for buyer and
  seller receipt links: actual focus `evidence`, expected `action-required`.
- The production-build browser regression also failed before the patch in both
  Chromium and WebKit on history restoration. Serial execution skipped the two
  subsequent Arabic cases after the English failures; those are not baseline
  passes.
- Four focused unit suites pass all 193 checks after the patch, including
  delayed canonical loading, repeated explicit chat navigation and preserving
  newer typing. TypeScript and application-file lint pass.
- Browser and release-gate outcomes are recorded in the PR and saved audit.

## Scope

This is a reproduced legacy-notification navigation defect. It is not proof of
the cause of D95, the older intermittent WebKit `funds_received` focus failure.
The original CI1095 trace was inspected; three instrumented baseline matrix
runs passed all 21 state checks with retries disabled and did not reproduce
that failure. D95 remains open. No financial state, permissions, API contract,
test timeout or fail-on-flaky policy changes are included.
