# Initial hash restoration must yield to newer input

Reliability Shield #1032 rejected candidate `43318f1b067dc3f0090248688f74d1e81fea5e67` because the Arabic profile keyboard journey passed only on retry. The first attempt selected the Alerts tab after End, but the tab no longer held focus. The retained trace shows the notification preferences section outlined instead. The original failure and successful retry remain evidence.

The layout schedules initial hash restoration in an animation frame. Its user-interaction cancellation previously started only inside `revealPageSection`, after that frame ran. Keyboard navigation or focus established before the frame could therefore be overridden by a late restoration of the original `#notification-preferences` destination.

Six deterministic cases reproduced this before repair: five input/focus events before the initial frame, and focus chosen before the restorer mounted. Each lost focus to the notification section.

Initial restoration now listens for newer pointer, keyboard, wheel, touch and focus input immediately, cancels the queued frame on those events, and respects existing focus when the frame executes. The listeners are removed when restoration runs, is cancelled, receives explicit hash/history navigation, or unmounts. Explicit links and browser-history section navigation retain their existing behavior.

The focused component suite also verifies that an explicit history navigation still works after cancelling initial restoration. The hosted WebKit job now repeats the existing Arabic keyboard journey three times with retries disabled after its full browser group. This changes neither production permissions nor financial behavior, and keeps the fail-on-flaky release gate in place.
