# WebKit API transport and diagnostic fixture isolation

PR415's first complete run, Reliability Shield 1089 (`39394473731`), passed the SQL, unit/build, Chromium and phone gates. WebKit groups 3 and 4 failed. The original failure artifacts remain retained.

Group 3 completed the marketplace performance assertions, then its `afterAll` snapshot GET failed with `ECONNRESET` after 51 ms. Retrying the serial file replayed successful cases against the same global buyer, eventually exhausting the existing 24 logins per account/IP per ten minutes. The 320px and countdown cases had both passed initially. Group 4 completed the Cardless ATM UI journey, then its explicit duplicate-completion PATCH failed with `ECONNRESET`; the retry passed but the strict flaky-test gate correctly blocked release.

The serial marketplace file now provisions an ordinary verified buyer with a unique identity per worker, alongside its already isolated sellers/admin. Cleanup includes that buyer and checks the response; request contexts dispose in `finally`. Login now makes one request and asserts its result rather than making three immediate attempts. Production authentication limits and test-wide retry/strict-flaky settings are unchanged.

The loopback-only test server now receives Next's documented `--keepAliveTimeout 65000`. Playwright pools API sockets while browser interactions run; extending idle connection retention reduces exposure to idle-close races. This changes neither request/test deadlines nor application logic, and adds no automatic replay of financial actions. The trace establishes connection resets but does not establish their precise upstream cause; this transport mitigation needs the complete CI result and must not be described as a proven production networking repair.

References: https://nextjs.org/docs/app/api-reference/cli/next#keep-alive-timeout and https://nodejs.org/download/release/v24.17.0/docs/api/http.html#serverkeepalivetimeout.

Local validation and the exact candidate's required CI results are recorded in the continuation audit. Local WebKit execution is unavailable because required system libraries cannot be installed in this runtime; no local browser pass is claimed. Hosted WebKit remains a mandatory release gate.
