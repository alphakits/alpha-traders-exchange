# Dependency audit — 2026-09-19

## Result

`npm audit --omit=dev --audit-level=high` reported **no high or critical
production vulnerabilities**. It reported 14 moderate findings from two
transitive dependency chains in the Expo toolchain.

## Findings and disposition

| Advisory | Dependency path | Runtime exposure | Disposition |
| --- | --- | --- | --- |
| `GHSA-vcc3-ghjq-m6fr` | `expo-router` → `query-string@7.1.3` → `decode-uri-component@0.2.2` | Expo Router can parse URI components. The shipping WebView bridge, resume URL, external navigation, and push destination boundaries accept only bounded first-party URLs; oversized URLs are now rejected before persistence or bridge navigation. | Monitored. Expo 57 currently pins the vulnerable CommonJS dependency. The fixed decoder is ESM-only, and npm proposes a breaking Expo Router change, so no forced override is accepted without upstream compatibility. |
| `GHSA-w5hq-g745-h8pq` | Expo config plugins → `xcode@3.0.1` → `uuid@7.0.3` | Build-time iOS project tooling only. The vulnerable UUID APIs with caller-provided buffers are not part of the application runtime. | Monitored. The current Expo config plugin pins the latest `xcode`, which still pins UUID 7. A forced major override is deferred until Expo validates it. |

## Release rule

Do not run `npm audit fix --force` for these findings: npm proposes breaking
Expo dependency changes. Recheck the audit on every release and adopt the
upstream Expo fix as soon as its supported dependency graph removes the
advisories. Any new high or critical production advisory blocks release.
