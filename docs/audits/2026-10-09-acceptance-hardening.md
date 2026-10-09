# Acceptance gap hardening — 2026-10-09

The acceptance audit found an available upstream Next.js patch and an
observability weakness: a healthy probe could appear healthy after the scheduler
had missed multiple intended observations.

## Changes

- Pin Next.js 15.5.27 and its matching locked compiler/environment packages.
  This removes the package's two cache-poisoning advisories from the audit. The
  upstream advisories describe Pages Router SSG/ISR exposure; they are not
  evidence of an exploit on this Vercel deployment.
- Block unreviewed moderate advisories as well as high and critical findings.
  The exact legacy decoder advisory is accepted only after the existing
  source-hash backport checks pass. Unknown advisories, changed severity,
  changed identity and registry failures still block release.
- Observe the journal sign-in redirects in both languages and require private,
  no-store 401 JSON responses from signed-out journal/news APIs. No cron
  endpoints, authenticated mutations or provider sends are invoked.
- Compare each scheduled observation with the previous completed observation.
  A gap over 15 minutes, missing evidence or invalid timestamps is a monitoring
  incident even when the new public checks pass. Deduplicate repeated incidents
  and report recovery once timely observations resume.
- Keep collecting fresh evidence when the previous report file is missing,
  truncated or malformed. Report the unavailable history as a monitoring
  limitation rather than aborting before the first production check.

## Qualifications

The registry still lists braces 3.0.3 and node-forge 1.4.0 as their latest
releases. Keep their reviewed, hash-checked security backports. Do not downgrade
Expo, change package version metadata or suppress audit output to make counts
look clean. Expo Router's legacy decoder is also backported; upgrading its
router across an SDK major is a separate compatibility change.

Cadence checks detect a missed interval when the runner resumes. They cannot
detect a scheduler that has stopped forever without an independent observer.
The existing hourly health watch must also inspect the age of the latest
completed public-health report. Reliable multi-region monitoring and alert
receipt still require a separately verified monitoring service.

WhatsApp remains intentionally unavailable. This change does not enable it or
send any real payment, notification or customer message.

## References

- https://github.com/advisories/GHSA-4jqv-mc3x-m676
- https://github.com/advisories/GHSA-mcj8-r9mp-w47p
- docs/security/dependency-security-backports.md
- scripts/test_production_health.py
- src/__tests__/dependency-advisory-gate.test.ts
