# Reviewed dependency security backports

These changes address the reported failure paths until maintained npm releases
are available. They run during every root `npm ci`/`npm install`, including EAS
builds. The package-lock versions are unchanged and npm audit findings are not
suppressed or relabelled as patched upstream releases.

- `braces@3.0.3`, GHSA-vfj7-8cjw-p6xm: the five production-file changes from
  [micromatch/braces#72](https://github.com/micromatch/braces/pull/72), by FSDevelop,
  commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`. Parsing and AST traversal
  enforce at most 100 nesting levels, and expansion rejects cyclic parent
  chains. The upstream MIT licence is retained in `braces-LICENSE`.
- `node-forge@1.4.0`, GHSA-86w9-cpqp-85rv: the `lib/rsa.js` change from
  [digitalbazaar/forge#1152](https://github.com/digitalbazaar/forge/pull/1152), by
  Krysthyan, commit `ceba34402e329f0365134f23fe19898756527d65`. PKCS#1 v1.5
  verification rejects unconsumed nested DigestAlgorithm elements. The upstream
  BSD licence is retained in `node-forge-LICENSE`.

`patches.json` pins the original and resulting SHA-256 of each file. The patcher
checks both installed and locked versions, patches every locked installation,
accepts already-patched files, and rejects unknown source. It validates every
file before writing any. Regression tests exercise malicious patterns, normal
Metro/ESLint glob behavior, legitimate RSA signatures, omitted/NULL digest
parameters, nested digest garbage, and the installer's rejection/idempotence.

Neither proposal was an upstream release as of 2026-10-04. On upgrading either
dependency, review the new advisory status, remove its backport when appropriate,
and keep the regression tests. The existing Expo URI-decoder backport remains.
