# PostgreSQL timeout recovery acceptance

Related incident: #294. This is a narrow connection-lifecycle mitigation, not a declaration that the production incident is resolved or that the application is bug-free.

The owner approved continuation of the proposed database-runtime repair after the isolated SEO/analytics scope was explicitly discussed. Application changes in this batch are limited to a query timeout guard installed on new clients in the existing shared pool. Other changes are regression checks, their build gate and this runbook.

## Behavior

For ordinary pg SQL/config calls, a client-side `Query read timeout` closes the affected client through pg's public `end()` API before forwarding the unchanged error. No SQL is rewritten or replayed. Both promises and callbacks are supported; callback configs are not mutated. Installation and closing are idempotent. Other clients remain available. Server SQL errors, including statement cancellation 57014, retain normal rollback/reuse behavior. Custom Submittable/cursor extension objects are deliberately unchanged.

A timed-out COMMIT has an unknown outcome: this layer never reports success or retries it. The database's existing transaction semantics remain responsible for commit/rollback; this mitigation adds no new retry logic, compensation, session reset, cancellation connection or backend-termination command.

## Validation

`npm run test:db-runtime` executes local module fixtures and the installed pg driver against a loopback-only PostgreSQL protocol fixture, plus the existing TLS security tests. The fixture reproduces an unclosed checked-out connection after the unmodified driver's query timeout, then tests socket disposal, fresh-client recovery, queued/concurrent reads, callback semantics, transaction ordering, normal server-error rollback and uncertain COMMIT responses with the guard. It never uses production credentials or records. Local `--unit-only` mode does not claim wire-test coverage; production builds do not use that flag.

All existing SEO and owner-analytics build gates remain. TLS verification, connection count, idle/checkout/query timeout limits, persistence requirements and the Vercel pool lifecycle hook remain unchanged. No authentication, account/role/seller approval, financial/business rules, database schema, database settings, customer data or unrelated branch is modified.

## Production acceptance

Inspect exact-head Vercel test/build results and review findings before merge. Confirm the merged production SHA and official aliases. Inspect deployment-scoped runtime logs and bounded read-only database wait diagnostics afterward. A READY deployment, an empty short log window or successful small SQL query is insufficient to close #294. Pooler/large-result behavior and the affected application reads still need sustained recovery evidence. Do not terminate sessions, increase paid capacity, retry writes or claim installed-device coverage. Public-domain checks must use ordinary unauthenticated HTTPS, independently of deployment-tool inspection.
