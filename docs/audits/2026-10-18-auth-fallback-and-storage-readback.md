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

Full service parity remains incomplete. Production enables custom SMTP, Phone
and GitHub providers; recovery does not. No application or worker has been
connected to the recovery project. Provider credentials, email/SMS delivery
and complete recovery journeys remain separate acceptance work. No provider
credential was changed and no email or SMS was sent during this continuation.

## Actual Storage bytes

The retained manifest contains 18 objects, including one empty placeholder,
totaling 2,724,591,047 bytes. All 18 now pass full authenticated download, size
and MD5 verification against the source manifest. Metadata or HEAD responses
alone are not treated as proof of restoration. The last seven files completed
on October 18, following the owner's explicit approval at 19:33 UTC.

Both private journal images pass privileged retrieval and deny requests without
credentials, through public URLs and with the valid anonymous API key. All 18
paths, sizes, content types, cache controls and ownership values match the
production inventory. Empty custom metadata is normalized from null or an
empty object; multipart upload ETags and restoration timestamps may differ.
Actual file integrity is established by the full downloaded checksums. Bucket
visibility, limits and MIME restrictions match, and Storage RLS remains
enabled on both projects. Temporary credential files and downloaded source
cache were removed after verification. No new credentials were created.

Earlier checkpoint: automatic approval review stopped further uploads after
11 objects because the sensitive data and recovery destination needed explicit
approval. The owner subsequently approved the remaining five course videos
and two private journal images, and that transfer is now complete. The duplicate
public logo created by the browser upload test was removed; original manifest
paths were excluded from that cleanup. Earlier failures remain dated evidence
in the HTML audit rather than being discarded.

`scripts/restore-audit-storage.py` accepts the separately retained manifest and
private credential-file paths. Without an action flag it only validates the
manifest. `--verify-only` performs recovery GET requests only, including denial
checks for private objects that exist. `--apply` may write only the fixed
recovery project and requires separate source/recovery service credentials.
`--indices` restricts the operation to the explicitly approved manifest subset;
the completed continuation used indices 11 through 17. Any future transfer
must have authorization for its scope. The script's existence does not confer
authorization. Credentials, customer object paths and file contents are
deliberately absent from this repository.

Seven boundary tests verify production-write refusal, credential scoping,
manifest restrictions, header injection rejection and the inability of
read-only verification to upload missing files, plus exact subset selection
and rejection of invalid subsets. They also pass with Python optimization
enabled, confirming that these guards do not depend on `assert`.

```sh
python3 -m unittest discover -s scripts -p test_restore_audit_storage.py -v
python3 -O -m unittest discover -s scripts -p test_restore_audit_storage.py -v
```

The website and Railway worker both run release `f5e43eb8`. All nine main
CI1077 jobs passed on their first attempt and post-release worker monitoring
is healthy. This audit continuation did not deploy the application.

The full platform audit remains incomplete. Separate buyer/seller/admin journeys, real
provider/SMS/payment evidence, physical Safari, hosted rollback/replay, all
role/control/alert states, live CSV bytes and representative latency still
need acceptance. The current HTML audit retains earlier failures and the
dated evidence for each observation.
