# Wise synthetic staging tools

These tools prepare and audit the fixed, protected **preview** project
`prj_2ZrlYsszRDNyll1lkZ69BYs9tHpL` and Supabase staging reference
`ntnehgenzsooxwznrzzx`. They cannot substitute production or a different project.
The local source is this checkout; generated packages and sanitized journals go
under the ignored `tmp/wise-staging` directory. No credentials, fixture manifests,
or historical audit results are shipped here.

On 28 October 2026 the connected Vercel and Supabase APIs returned not found for
those recorded staging resources. Restore access or review replacement identifiers
in code and rerun all guards before hosted work. The tools do not silently create
replacement infrastructure.

Use Node **24.22.1**, installed repository dependencies, and Vercel CLI **65.2.0**.
The package preparer needs Python available as `CODEX_PRIMARY_RUNTIME_PYTHON`,
`PYTHON`, or `python`. Configure these variables locally in a trusted runner:

| Variable | Meaning |
| --- | --- |
| `ALPHA_WISE_STAGING_VERCEL_CLI` | Absolute path to the installed `vercel/dist/index.js` |
| `ALPHA_WISE_STAGING_VERCEL_CONFIG` | Absolute path to the already authenticated Vercel CLI profile directory |
| `ALPHA_WISE_STAGING_DATABASE_URL` | Dedicated staging database connection string, injected as a secret |
| `ALPHA_WISE_STAGING_DATABASE_CA_FILE` | Absolute path to the reviewed, pinned database CA |
| `ALPHA_WISE_STAGING_FIXTURE_DIR` | Absolute directory outside this checkout containing the existing synthetic fixture manifests/progress files |

Never paste secrets into command arguments or commit them. The database adapter
requires the original staging pool hostname, port, database, tenant username, and
CA fingerprint. Database audit queries use verified TLS and read-only transactions.
The CLI uses the explicit profile; ambient Vercel tokens do not select an account.

Run the offline guard tests:

```text
node --test scripts/wise-staging/deploy.test.mjs scripts/wise-staging/adapters.test.mjs scripts/wise-staging/audit/guards.test.mjs
```

Read cloud configuration and prepare the exact **clean committed** source:

```text
node scripts/wise-staging/deploy.mjs inspect-config
node scripts/wise-staging/deploy.mjs prepare <40-character-final-commit>
```

Preparation verifies the source/package/upload hashes, replaces only the three
browser-public Docker ARG declarations with staging values, and keeps all container
test gates. It handles both bare ARG declarations and the released public defaults.
It creates no deployment or encryption secret. The CLI exposes only inspect and
prepare; exported deployment operations require the exact prepared manifest and a
fresh zero-push read-only database proof. Existing encryption keys are never rotated.

For the bounded hosted audit, fill a copy of `audit/contract.template.json` under
`tmp/wise-staging/audit`. Bind the ready preview deployment, final commit, sanitized
runtime proof, five helper hashes, and exact synthetic fixture hashes. `repoPath`
must be this checkout's absolute path. `executionAuthorized` defaults to false.
The templates contain no usable account credentials.

```text
node scripts/wise-staging/audit/run.mjs --preflight <absolute-contract-path>
node scripts/wise-staging/audit/run.mjs --execute <absolute-contract-path>
```

An uncertain write stops and journals reconciliation information; never rerun it
with a new run ID to bypass that stop. The audit does not send real funds, contact
Wise, reset fixtures, replay customer notifications, or delete financial history.

A passing bounded audit does **not** certify a live release. Hosted feature-off
resolution, cross-instance races, key rotation/recovery, physical-device acceptance,
ownership-evidence operations, and provider eligibility still need evidence.
Wise's cryptocurrency policy currently prohibits P2P cryptocurrency payments:
https://wise.com/help/articles/2v3OMcg97Z7gObSifJbjsu/understanding-wises-position-on-cryptocurrency
