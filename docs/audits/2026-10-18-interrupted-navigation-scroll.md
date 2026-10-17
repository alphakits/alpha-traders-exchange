# Interrupted navigation must stop the browser animation

Reliability Shield #1044 recorded one intermittent Chromium failure in the
buyer workspace navigation journey. After My Trade Requests focused its
section, the next Browse Sellers click completed without navigating. The
route remained `/en/dashboard` throughout the unchanged five-second check.

The retained trace shows the browser pressed at (145, 580.86). Its frames at
500760.378 ms and 500841.428 ms show the Browse Sellers button moving upward
between press and release. There was no subsequent marketplace navigation
request. The section-navigation cancellation handler removed timers and
observers but left the browser's native smooth-scroll animation running.

User pointer, keyboard, wheel or touch interaction now cancels that animation
by immediately holding the current viewport position. The event remains
unblocked, and no cancellation scroll is sent when reduced-motion navigation
has already used an instant scroll. Existing focus, route, delayed content and
replacement-section behavior is retained.

Four interruption regressions failed before the change and all 31 focused
navigation tests pass after it, including a reduced-motion control. The
original browser journey and timing threshold are unchanged. Its hosted
retest is required; local WebKit could not launch with the missing host
libraries. A retry passing on the old source was not treated as a repair.

The CSSOM View scrolling algorithm specifies that a new scroll aborts an
ongoing smooth scroll; `behavior: "instant"` preserves the current position
without starting a replacement animation. Reference checked during this audit:
https://drafts.csswg.org/cssom-view/#perform-a-scroll
