# Dependency advisories and release enforcement — 2026-10-07

Final production-build review exposed two additional advisories that were not
covered by the existing source-verified backports:

- `sharp@0.35.4`: GHSA-wq5f-xc86-pv6w, high, fixed upstream in 0.35.5. Upgrade the
  direct dependency and its platform binaries to 0.35.5. Next.js already permits
  this version range. The fix ships the updated librsvg dependency.
- `shell-quote@1.10.0`: GHSA-pqg4-j6r4-53mv, critical, fixed upstream in 1.11.0.
  Pin the compatible upstream 1.12.0 release with an override; its current parent
  accepts the 1.x version range. No production command-injection incident was
  observed, and the severity is not evidence that the public trade API is exploitable.

The pre-update `npm audit --omit=dev --json` reported 19 affected dependency
entries: 15 high, one critical and three moderate. Entries include parent chains;
they are not 19 independent root advisories. The known braces, node-forge and
legacy Expo decoder findings remain visible in npm's version-based audit.

`npm run verify:dependencies` now obtains a fresh registry audit and blocks any
unreviewed high/critical root advisory. The only high-severity exceptions are the
exact braces and node-forge advisories already covered by checked source hashes
and regression tests. Their backport integrity must pass first. A new advisory,
different package, higher severity, malformed response, inconsistent totals,
unresolvable graph or unavailable registry blocks the release. Moderate findings
and guarded findings remain printed; passing this gate does not mean zero audit
findings. The release safety gate runs this check before application tests.

The exception is tied to actual source verification, not an ignored exit code or
a changed package version. Do not use `npm audit fix --force`, suppress audit
metadata, or remove the existing backport integrity checks to obtain a green run.

References:
- https://github.com/advisories/GHSA-wq5f-xc86-pv6w
- https://github.com/advisories/GHSA-pqg4-j6r4-53mv
- `docs/security/dependency-security-backports.md`
