# Messaging transaction recovery

Failure-injection checks reproduced 17 Discord failures across identity linking,
operator requests, denial-audit commits, role provisioning, role/listing jobs,
interaction claims and command-registration locks. Twelve WhatsApp transaction
scenarios reproduced eight failures across consent changes, inbound STOP,
delivery claims and changed-phone consent revocation. Ordinary server-cancelled
statements were already recoverable; uncertain connections and failed rollback
paths were not.

All these paths now discard uncertain connections, avoid queuing rollback or
unlock behind a timed-out driver query, and preserve the original operation
failure. Ordinary SQL failures roll back before connection reuse. Worker
wrappers recognize an uncertain database error inside an AggregateError/cause.
No failure is acknowledged as a successful provider delivery. Existing durable
leases retain retry/recovery behavior. A denial audit whose commit fails is
also treated as an unsuccessful transaction.

The focused Discord/WhatsApp run passed 88 checks after repair. Tests use
controlled pools and isolated SQL fixtures, with provider calls mocked. They do
not establish delivery through production WhatsApp or Discord accounts.
