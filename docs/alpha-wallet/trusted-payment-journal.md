# Trusted payment evidence journal — private development contract

This module records synthetic fiat evidence. It has no balance, payment-verification,
release, signing, or production authority. The current marketplace and V1–V5
wallet contracts are unchanged.

## What is recorded

The reader independently replays the retained V5 wallet history and captures the
admitted synthetic source response. A journal record retains the complete
prepared artifact, its original wallet history, exact original terms and claim,
source identity, native transaction identity, recipient-instructions commitment,
amount in minor ILS units, status, source revision, and observation timestamps.
The source lookup receives a source identity and transaction identity; it is not
given an amount or recipient to echo back as evidence.

The admission has one fixed immutable identity. Native payment identity is
independent of the marketplace request and operation ID, so changing either
cannot assign the same source transaction to another claim. Admission rotation
and cross-source aliasing still require a reviewed production-wide identity
contract; separate isolated journals do not establish global exclusivity.

Every prepared record is revalidated before it is appended. Matching operation
retries recover the exact original receipt. A second operation may corroborate
an already recorded source observation without assigning the payment twice.
Source revisions start at one and must be contiguous. Previously retained older
revisions may be corroborated; an unseen gap or contradictory revision stops
the journal. This is an explicit synthetic source revision contract, not an
assumption about an arbitrary future banking API.

## Conflicts, reversals and current authority

First payment facts remain immutable. A changed native-payment binding, changed
bytes at one source revision, skipped revision, source-time regression, changed
settlement timestamp after settlement, or settled-to-pending regression is
retained as a conflict and permanently quarantines recording. Reversed, revoked
and rejected observations are retained and quarantine the journal. Nothing
deletes the original receipt, reassigns the native transaction, or credits money.

A historical successful receipt is never a current eligibility certificate.
After pause, conflict, reversal or restore, an exact retry still returns its
original receipt while inspection reports the current stopped state. Receipts
always contain `executionAuthority: false` and `releaseAuthority: false`.
Recorded freshness flags describe the original preparation time only.

An isolated journal cannot prove that no reversal occurred concurrently with a
wallet transaction in another database. The later lifecycle must place current
source state and one-time evidence consumption in one certified transaction, or
use a separately reviewed fencing protocol. Copying a digest or receipt between
databases does not solve that race. A later bank reversal cannot undo an already
final blockchain payout; it needs an explicit incident and liability process.

## Durable recording and uncertain results

The private store uses a separate simulation namespace and refuses companion
wallet or marketplace schemas. Bootstrap is serialized. Commands, current head,
record hashes and state projection share a physical SERIALIZABLE transaction.
The participant verifies that the physical transaction did not change and poisons
only the same transaction on failure, so a swallowed participant error cannot
commit partial companion writes. Immutable-record and complete-head SQL checks
are additional safeguards; replay validates the semantic evidence.

The store requires an explicit clock and local simulation capability. These
internal capabilities do not represent account login, staff authorization or
production database permissions. No real payment API or credential is installed.

After an uncertain commit, reconciliation uses the same physical store, original
operation identity and expected pre-command checkpoint. A missing receipt from a
stale checkpoint or restored copy does not prove that the source never committed.

## Backup and restoration

Export requires a stopped original source. The portable format retains every
record, prepared artifact and original receipt. Restore requires an explicitly
fresh target with a distinct physical identity. Original records remain exact;
restore appends one quarantine record and never enables recording, credentials,
financial consumption or resume. Reopening the same target recovers committed
restore evidence instead of overwriting it.

Checksums prove internal consistency, not source authenticity. The caller must
still establish source fencing, authenticated encrypted retention and external
reconciliation before any production recovery design can resume authority.

The development bound is 128 records and 32 MiB, with earlier recording limits
that reserve two terminal records, one MiB and structural capacity for stop and
quarantine recovery. Growth refusal leaves the prior journal intact.

## Verification and remaining work

Focused tests exercise real replayable V5 histories, evidence substitution,
exact retries, native-identity conflicts, revision/status regressions, reversals,
stopped receipt recovery, malformed input, capacity, and portable recovery.
Storage tests and a native PostgreSQL drill cover transaction failures, reopening,
competing writers and uncertain commit/recovery. The exact execution outcome and
source identity belong in the milestone verification report; this design is not
independent security certification.

Before live use, complete the V6 lifecycle and atomic evidence-consumption
contract, actual current web/mobile authorization, real bank/cash-source
admission, recipient ownership, product integration, production storage roles,
monitoring, testnet signer/provider recovery and independent review. Ordinary
face-to-face cash has no independently observable bank event; this implementation
does not invent a cash-verification service or turn seller confirmation into
independent evidence.
