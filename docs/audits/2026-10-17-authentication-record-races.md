# Canonical authentication record writes

Status: candidate change; production remains unchanged.

Nine controlled regressions exercised password changes, email verification and
the legacy local reset-token store. Seven failed before repair: simultaneous
password updates lost another account's change; a pending password write could
remove a newer restriction; email and reset tokens could each succeed twice;
an email token replaced before commit was still accepted; simultaneous reset
issuance lost another account's token; and a malformed reset expiry was accepted.
The two existing expired-link/reuse cases passed before repair.

These paths now share a canonical authentication mutation helper. Each action
reads current records, writes only its declared tables, and reruns the mutation
against canonical records under the existing database transaction lock whenever
its snapshot is stale. The returned result comes from that final mutation, so a
token already consumed or replaced reports invalid. Expiry is rechecked at commit
and invalid dates fail closed. No previous users collection is replayed over a
newer password, restriction or role change. Token issuance for one account keeps
other accounts' outstanding tokens.

The legacy normalization test previously used a no-op save mock and relied on
the application cache to pretend the token was saved. Its repository fixture now
persists the supplied snapshot and returns it on subsequent reads. This fixture
correction is recorded separately from the seven reproduced product failures.

The focused route/store tests and complete suite must be read from their actual
JSON results. The isolated PostgreSQL harness adds independent-process password,
single-use email-token and single-use reset-token checks. These checks do not
certify real email/SMS delivery or Supabase recovery-link behavior. The live reset
route continues to use its existing provider/session-revocation flow; its local
password-clear operation uses this canonical helper. No customer credentials or
notifications were used.
