# Journal and mobile-session transaction recovery

The private journal and mobile-session repository could queue `ROLLBACK` after
a client-side query timeout and return that uncertain connection to the pool.
A timeout does not establish whether PostgreSQL finished the command. A failed
rollback was also ignored, allowing a broken transaction to be reused.

The tested Exchange transaction cleanup is now shared by these repositories.
Uncertain connections are destroyed without queuing another query. Ordinary
server-rejected statements roll back before reuse. A rollback failure destroys
the connection and preserves the original error. Every path releases once.
The operation is not reported successful when commit acknowledgement fails.

Before repair, corrected journal failure-injection tests produced 5 failures
and 2 passes; mobile issuance/refresh tests produced 4 failures and 2 passes.
The focused recovery suites passed after repair. These are controlled database
fault simulations; they do not demonstrate live provider or device behavior.
Journal row-level-security checks run separately against an isolated database.
