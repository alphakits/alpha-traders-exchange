# Trade Room automatic-guidance focus race

Reliability Shield #1031 on `a801e6e` failed release acceptance. WebKit group
4 recorded one flaky Trade Room Poke journey; its first attempt timed out and
the retry passed. The failure remains part of the audit evidence.

The first-attempt trace shows the buyer filling the chat field, followed by an
empty field and a disabled Send Message button. The active element was the
automatic action-guidance panel. The queued guidance callback only checked
editing when it was scheduled; it did not observe a later focus change and
did not listen to `focusin`. A deterministic component regression reproduced
focus leaving the chat field after the scheduled frame ran.

Automatic guidance now yields when focus changes and rechecks the active
editor immediately before revealing a target. Inputs, textareas, selects and
editable content keep focus. Explicit Chat/Current step controls still use
their existing navigation behavior. Trade authorization, chat validation,
idempotency, recipient selection and cooldown checks are unchanged.

The browser journey now also asserts the filled draft and focus before Send.
The WebKit release job additionally repeats the complete Poke journey three
times with retries disabled. Existing full-suite fail-on-flaky enforcement is
retained. Hosted verification results must be checked before release.

The first-attempt runner log also contains native WebKit/Mesa warnings and a
malloc diagnostic. Those messages are preserved; they are not sufficient to
attribute the observed empty draft to a renderer crash or dismiss the failure.
