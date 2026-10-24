# Standalone worker dependency boundary

`Dockerfile.discord-worker` installs `discord-worker/package-lock.json` in its
own directory. The web workspace's Zod and Undici overrides do not affect that
installation. Both the deployed worker source `f3a3761a` and main `090e2f22`
retained Undici 6.28.1 and Zod 4.1.11 in the worker lockfile. Updating the worker
to `090e2f22` alone would therefore leave these dependency findings open.

The standalone manifest now pins Undici 6.x to 6.29.1 and Zod to 4.6.6. Only
those two resolved lock entries change. A separate fresh production audit runs
from the worker directory during the existing release gate, using the same
bounded transport and fail-closed report validation as the web gate. It does
not inherit the web installation's verified-backport exceptions.

The Docker build now runs 17 checks against its own installed consumers before
bundling the worker. They exercise the Discord REST/discord.js EventSource
resource limits, split UTF-8 and HTTP compatibility, and the Vercel dependency's
Zod collection bounds and normal validation. They also reject resolution from a
parent web installation. Tests use synthetic data and a loopback HTTP server;
they do not start the worker or contact Discord or other delivery providers.

Local validation:

- Original standalone lock: fresh production audit reports five high-severity
  affected package entries, rooted in Undici and Zod. The new consumer checks
  produce 12 failures and five passes.
- Patched standalone lock: fresh production audit reports zero vulnerabilities;
  all 17 consumer checks and the worker bundle build pass.
- The existing advisory assessment/transport tests plus four worker-scope tests
  pass: 34 total. They cover the independent lockfile, caller working-directory
  independence, rejection of root-only backport exceptions and incomplete reports.

These results establish the standalone package repair, not production rollout
or exploitability of every affected code path. Zod's upstream collection fix
requires explicit size bounds; it does not make unbounded input safe. Independent
CI and the actual Docker build remain required before this draft can be released.
No production deployment, environment value, financial rule or data changed.

Upstream references:

- https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685
- https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/colinhacks/zod/pull/6652
