# Authentication fallback and recovery continuation

Supabase's production Site URL was `http://localhost:3000`. A deliberately
invalid recovery-token request reproduced a 303 redirect to that origin. The
Site URL is now `https://www.alphatraders.co.il`; all four existing redirect
allowlist entries remain unchanged. The same request now returns 303 to the
official website. No account, valid token, password change, or email delivery
was involved. This verifies the fallback destination, not a complete reset
journey with email delivery and a real account.

Recheck it without credentials:

```sh
python3 scripts/check_auth_redirect.py --output /tmp/alpha-auth-fallback.json
python3 -m unittest discover -s scripts -p test_check_auth_redirect.py -v
```

Eight regression checks cover the original localhost failure, unexpected
origins, ports and userinfo, incomplete responses, proxy header blocks,
provider outages, rate limits and redaction of redirect parameters. The live
check passed at 19:22 UTC on October 18. The command is an explicit operational
check; it has not been added to a recurring monitor.

## Recovery configuration

The isolated recovery project now matches production for leaked-password
protection (enabled), email OTP length (8) and limiting AAL1 session duration
(enabled). TOTP is enabled on both. Session expiry, refresh-token reuse
protection and the 2 GB Storage limit were compared. Both projects' security
advisors now report zero warnings/errors and 38 informational RLS-without-policy
findings on private server-accessed tables. No policy was weakened to remove
those informational findings.

Full service parity remains incomplete. Production enables Phone and GitHub
providers; recovery does not. No application or worker has been connected to
the recovery project. Provider credentials, email/SMS delivery and complete
recovery journeys remain separate acceptance work.

## Actual Storage bytes

The retained manifest contains 18 objects, including one empty placeholder,
totaling 2,724,591,047 bytes. Eleven objects now pass full authenticated download,
size and MD5 verification against the source manifest: all ten admin-media
entries plus the 821,228,164-byte founder video. Metadata or HEAD responses
alone are not treated as proof of restoration.

Further uploads were stopped after automatic approval review rejected the
production-to-recovery media transfer because it required explicit approval
for the sensitive data and destination. Read-only verification continued.
Five course videos and two private journal images still require byte recovery.
The duplicate public logo created by the browser upload test was removed;
original manifest paths were excluded from that cleanup.

`scripts/restore-audit-storage.py` accepts the separately retained manifest and
private credential-file paths. Without an action flag it only validates the
manifest. `--verify-only` performs recovery GET requests only, including denial
checks for private objects that exist. `--apply` may write only the fixed
recovery project, requires separate source/recovery service credentials, and
must not be used while the transfer approval is unresolved. Its existence does
not confer authorization. Credentials, customer object paths and file contents
are deliberately absent from this repository.

Five boundary tests verify production-write refusal, credential scoping,
manifest restrictions, header injection rejection and the inability of
read-only verification to upload missing files. They also pass with Python
optimization enabled, confirming that these guards do not depend on `assert`.

```sh
python3 -m unittest discover -s scripts -p test_restore_audit_storage.py -v
python3 -O -m unittest discover -s scripts -p test_restore_audit_storage.py -v
```

The audit remains incomplete. Separate buyer/seller/admin journeys, real
provider/SMS/payment evidence, physical Safari, hosted rollback/replay, all
role/control/alert states, live CSV bytes and representative latency still
need acceptance. The current HTML audit retains earlier failures and the
dated evidence for each observation.
