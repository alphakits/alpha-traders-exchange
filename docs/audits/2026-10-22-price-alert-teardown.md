# Price-alert browser teardown — 22 October 2026

CI1126's English price-alert case exceeded its 30-second test budget on its
first attempt and passed on retry. The strict flaky-test gate correctly failed
WebKit group 4 and aggregate release acceptance. The other seven jobs passed,
including 5,921 unit/integration tests and the 270-action database timing gate.

The retained trace separates this failure from an application assertion:

- Saving through the visible buyer controls, private response shape, persisted
  values, rejection of a forged account field, reload persistence and viewport
  fit all passed within 25.874 seconds of the test starting.
- Screenshot capture then took 3.919 seconds. The final fixture-reset request
  began at 29.806 seconds, leaving less than 200 ms of the shared test budget.
  The test timed out during that final cleanup operation.
- One disclosure action spent 7.697 seconds waiting for the browser's stability
  check. The trace does not establish a production latency or rendering cause.

Screenshot capture and synthetic preference restoration now run in a scoped
`afterEach` hook. The buyer journey keeps the original 30-second deadline and
every existing functional assertion. Cleanup runs in `finally`, even if the
journey or screenshot fails, and now asserts both a successful response and the
confirmed disabled preference. Its request is bounded to five seconds.

The two English/Arabic journeys pass locally in WebKit without retries (19.7
and 9.9 seconds including their hooks). The existing production build and
synthetic loopback accounts were used; no production account, alert or trade
was changed. This repair does not establish physical-device acceptance.

A separate local fault-injection run deliberately failed immediately after
confirming the saved preference. The runner reported that one intended failure;
the teardown reset and both cleanup assertions still passed. The temporary
failure injection was removed before publication.

The CI1126 failure is retained, not relabeled as a pass. Candidate and merged
release gates remain required. The earlier first-edit loss and variable
database timing findings also remain open; no assertion, flaky-test policy,
financial lock, durability setting or transaction threshold is relaxed.
