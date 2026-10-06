# Dependency security backports

On 2026-10-06, `source-map-js` was updated from 1.2.1 to the upstream fixed
release 1.2.2 for GHSA-68fv-2mgg-jv7q. The lockfile retains the registry integrity
hash. Regression cases reject unsafe and excessive cumulative section offsets
and preserve a valid indexed mapping. See the
[upstream release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2).
This update needs no local backport. The remaining version-based audit findings
for the guarded dependencies below and the legacy Expo URI decoder are still
reported by npm; they are not presented as a clean audit.

The locked Expo toolchain currently includes `braces@3.0.3` and
`node-forge@1.4.0`. Their advisories have no published fixed version as of
2026-10-04. `npm audit fix --force` proposes incompatible framework downgrades.
Keep the supported toolchain and apply the narrowly scoped guards below.

| Dependency | Advisory | Guard | Source |
| --- | --- | --- | --- |
| braces 3.0.3 | GHSA-vfj7-8cjw-p6xm | Bound string/AST nesting to 100, respect smaller limits, preserve escaping, reject cyclic parent chains | [Upstream PR 72](https://github.com/micromatch/braces/pull/72), commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660` |
| node-forge 1.4.0 | GHSA-86w9-cpqp-85rv | Reject extra DigestAlgorithm children and malformed nonempty NULL parameters during RSA signature verification | [Upstream PR 1152](https://github.com/digitalbazaar/forge/pull/1152), commit `ceba34402e329f0365134f23fe19898756527d65`; additional NULL-value regression guard |

`patches/security-dependencies.json` records the original and patched SHA-256
hashes, exact edits, versions, source commits, and original license identifiers.
The installed packages keep their original license files and version metadata.
Copies of the upstream license notices are retained in `patches/licenses/`.
The backports do not imply that npm has published a patched package: npm audit
continues to report those version-based advisories.

`npm ci` runs `scripts/patch-dependency-security.mjs` after the existing Expo URI
decoder backport. It checks every hoisted, nested, and workspace dependency
copy, validates all source before writing, and applies only the exact reviewed
transformations. Repeating it is safe. Missing dependencies, new versions, or
unexpected source block installation for review.

The release gate also runs the script with `--check`. It rejects unpatched or
changed source rather than silently changing the installed files during release.

The regression suites exercise excessive depth, cyclic AST parents, valid
patterns, OpenSSL signature interoperability, malformed signed structures,
multiple installed copies, source drift, version changes, and release rejection.
The compatibility audit additionally runs the libraries' Node test suites from
their original release tags with the patched files.

The 2026-10-04 audit passed 764 braces tests and 828 node-forge tests. Four
pre-existing node-forge cases remain pending in that upstream suite. Its release
tag also contains a `describe.only` marker in the jsbn test; the isolated test
checkout removes that marker and runs with `--forbid-only` so RSA, ASN.1,
certificates, encryption, and the upstream security regressions all execute.

When a fixed upstream release becomes available, review its advisory and source,
update the lockfile, replace or remove the corresponding descriptor, and run the
complete release gate. Do not bypass the integrity check or alter package
versions just to hide audit metadata.
