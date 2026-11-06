# Payment claims and dispute holds: development contract

This is a private, simulation-only successor to the authenticated initial
cancellation cohort. It does not install a product route or authorize a live
payment, release, settlement, signer, deployment, or production migration.

## Scope and authority

An active, currently authorized owner explicitly enrolls one original V4
cancellation cohort into `canonical-initial-payment-cohort-v1`. Enrollment
requires both `acknowledgeVersionUpgrade: true` and
`acknowledgePaymentClaimOnlyProfile: true`. The latter acknowledges that this
development profile supports payment claims, dispute holds, inspection, pause,
and export. It does not support a new cancellation. Existing V4 cohorts retain
their cancellation contract until enrollment. A previously cancelled cohort may
be enrolled only as an archival state; it cannot regain a reservation.

The current retained buyer may report payment on the exact accepted trade. A
Bank Transfer claim supplies one validated, bounded attachment in the same
transaction. A Face-to-Face claim contains no attachment. The exact agreed
amount, currency, asset, parties, destination, price, fees, and original
acceptance are derived from retained records, never accepted as caller authority.

Only that current buyer may open a dispute, and only after this cohort's exact
payment claim. The normalized reason and exact buyer evidence remain private
canonical data. There is no seller dispute, prepayment dispute, owner override,
resolution, or release operation in this profile.

## Financial behavior

A claim changes the wallet trade from `reserved` to `payment_reported`. A
dispute marks that reported trade disputed. Both preserve all accounts, journal
entries, listing allocation, trade principal, fee state, independent payment
verification, release authorization, and payout state. A buyer attachment is an
unverified payment claim. It never becomes independent `PaymentEvidence` or an
entry in `evidenceOwners`.

The new closed V5 envelope contains only `continueFromV4`,
`claimInitialPayment`, `freezeInitialDispute`, and `pause`. New commands from
earlier versions remain fenced. Original command bytes, receipt identities,
uncertain payout state, pauses, and cancellations remain historical evidence.
Validation may reconstruct an earlier state to prove compatibility; that
reconstruction confers no new command authority.

## Canonical behavior

A claim advances the request and physical trade from `accepted` to
`payment_sent`, records the payment timestamp, and advances the locked listing
from `matched` to `in_trade`. It preserves the exact inventory, lock, expiry,
terms, parties, and disclosure fields. It archives prior action reminders,
clears reminder and inactivity state, appends deterministic timeline and audit
entries, and creates the seller's notification.

A dispute preserves `payment_sent` and `in_trade`, adds one open dispute tied
to that claim's evidence, archives active action reminders, and clears their
state. This stricter reminder freeze belongs only to the new private profile.
Neither action changes trust reconciliation or commission records.

Listing expiry by itself neither proves nonpayment nor releases reserved
principal. A claim may be recorded after listing expiry if the accepted request
and exact reservation still exist. This profile has no expiry transition.

## Atomicity and retry behavior

The coordinator uses the existing stored web or mobile authority readers.
Caller-supplied actor IDs, roles, amounts, evidence IDs, storage paths,
destinations, and timestamps cannot select authority. Authorization precedes
receipt recovery and is checked again before the transaction completes.

Every nested read and write uses the same earliest physical SERIALIZABLE
transaction certificate. Replacing a transaction cannot transfer authority or
make cleanup abort the replacement. Migration, canonical effects, immutable
financial receipts, coordination receipts, and safe publication commit
together. SQL independently rejects incomplete or inconsistent cohorts.

Business retry fingerprints bind the actual buyer, request, and normalized
evidence or reason independently of transport operation IDs. A matching retry
recovers the original receipt, including after pause or a lost COMMIT response.
Changed evidence, reason, or actor cannot claim that receipt. Public receipts
and publication contain no attachment bytes or dispute reason text.

## Recovery boundary

The combined backup has its own strict format and schema identity. It retains
the exact original initial and cancellation coordination evidence, V1–V5
financial history, and the private canonical evidence needed to reconstruct the
claim and dispute. It does not embed complete private account dependency reads.

Export requires a current owner and a paused source. Restore requires a fresh
target, replays each financial prefix with its original meaning, appends a V5
quarantine pause, disables restored users, omits credentials and sessions, and
seals the result. A restored copy supplies inspection and receipt evidence; it
does not authorize reenrollment, credential injection, or new wallet commands.
Checksums establish consistency, not authenticity of the source.

## Verification requirements

Capture independent V4 predecessor evidence before implementing V5. Preserve
all previously verified tests and frozen source contracts. Verify canonical and
financial atomicity, evidence substitution, invalid roles and credentials,
revocation and clock boundaries, direct SQL incompleteness, legacy writers,
competing decisions, late rollback, uncertain COMMIT recovery, and sealed fresh
restore. Native PostgreSQL drills must observe actual distinct backends and
lock waits for concurrency claims. Record the exact source commit and evidence
artifact before reporting this milestone complete.
