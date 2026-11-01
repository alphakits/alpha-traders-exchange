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

## Container runtime boundary

The initial standalone repair still used the pinned Node 22.18.0 base image.
An npm audit cannot assess the Node executable or its bundled dependencies;
overriding the npm Undici package does not replace Node's built-in fetch client.
Node's October 21 security release supplies Node 22.23.4 and bundled Undici
6.29.1, alongside DNS, TLS, Brotli and other runtime corrections. This is a
separate audit finding, D133; live exploitation has not been established.

Both Docker stages now use the official `node:22.23.4-alpine` image index
`sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`.
The registry response digest was independently recomputed from its bytes.
Its Linux amd64 manifest is
`sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284`;
the content-verified image configuration declares Node 22.23.4.

The official Linux x64 Node 22.23.4 archive was checked against the published
SHA-256 `1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce`.
Under that runtime all 17 consumer checks pass, the bundled worker passes the
syntax check, and the actual Node/built-in Undici version assertion passes.
This local glibc-binary check does not replace the Alpine image build in CI.

The image gate verifies the actual final image's Node and built-in Undici
versions and parses the bundled worker with that runtime. It retains the 17
consumer checks in the build stage and the final Python/curl/monitor checks.
No worker process or external delivery provider is started by these checks.
Independent CI must validate this new runtime before release. Neither a clean
npm audit nor these checks constitute a complete operating-system image scan.

Upstream references:

- https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685
- https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/colinhacks/zod/pull/6652
- https://nodejs.org/en/blog/release/v22.23.4
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
