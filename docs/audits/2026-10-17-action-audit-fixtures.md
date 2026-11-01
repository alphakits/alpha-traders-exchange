# Application action audit fixture scope

Reliability Shield #1033 rejected candidate `5682e0e` because the static action-wiring scanner included two intentionally isolated tab buttons in `page-section-navigation.test.tsx`. Those controls are test fixtures; they are not website actions. The run recorded 5,595 passing tests and one failing scanner assertion. Its original result remains evidence.

The scanner now excludes `.test.tsx` and `.spec.tsx` files while recursively checking application TSX files. A temporary-directory regression contains both test fixture formats, a nested unwired application button and a correctly wired button. It requires exactly the real unwired application button to be reported. The production-action assertion is unchanged; no live control is allowlisted and no application behavior, timeout, retry or error classification changes.

The initial-hash focus regression tests and both no-retry hosted focus gates remain intact. This is a test-tooling correction, not another claimed website defect repair.
