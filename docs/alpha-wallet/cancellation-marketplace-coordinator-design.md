# Authenticated initial cancellation successor

This document defines the private development integration of the existing V4
financial cancellation and canonical prepayment cancellation mechanics. It is
limited to **one existing, originally accepted initial-cohort mapping**. It
installs no public route, chain adapter, signer, notification sender or production
migration. Verification status belongs to the exact-source report, not this
design document.

## Profile and transition

| Contract | Value |
| --- | --- |
| Predecessor | `alpha_wallet_initial_marketplace_simulation`, one activation, acceptance and publication |
| Successor namespace | `alpha_wallet_cancellation_marketplace_simulation` |
| Successor profile | `canonical-initial-cancellation-cohort-v1` |
| Financial engine | Existing closed V4 envelope: continuation, initial cancellation and pause |
| Combined backup | `alpha-wallet-cancellation-marketplace-simulation-backup`, format 1 |
| Nested financial scope | `cancellation-marketplace-v4-ledger`, wallet format 4 |

An owner must call `upgradeRequest` explicitly with
`acknowledgeVersionUpgrade: true`. A cancellation never migrates a database
implicitly. Admission verifies the original V3 history, exact accepted canonical
poststate, initial activation/acceptance/publication and complete financial
mapping. Correction-cohort state and an initial-cohort restored copy are refused.

The continuation, dedicated financial migration, new coordination tables, SQL
hook replacement and immutable transition record commit in one SERIALIZABLE
transaction. Deferred checks reject a continuation without its transition.
Original initial rows and functions remain retained evidence; their mutation
hooks are replaced only inside this explicit successor transition. Existing
source files and historical receipt meanings are not changed.

The upgrade physically versions the mapped request and listing using identical
values, then increments the canonical runtime version exactly once while
preserving its timestamp. This prevents a stale writer from overlooking the
profile transition without changing the accepted trade. A paused V3 source can
be upgraded for inspection and export; its inherited pause remains effective.

## Current authority and transaction ownership

The web and mobile constructors expose the same four operations:

| Operation | Current authority | Inputs beyond credentials |
| --- | --- | --- |
| `upgradeRequest` | Owner membership | Request ID, operation ID, explicit upgrade acknowledgement |
| `cancelRequest` | Actual retained buyer or seller | Request ID and operation ID |
| `inspect` | Owner membership | Request ID |
| `pause` | Owner membership | Request ID and operation ID |

Authentication uses the fixed stored web-session or mobile-session/device
readers. Account validity, email/phone/adult requirements, session expiry,
credential version and device rules remain intact. The request's normalized
columns and payload must identify the same retained participants. An unrelated
owner cannot cancel. An existing party's ability to cancel is independent of
eligibility to create a new purchase or sale; a disabled account still fails.
Owner membership may be one of several roles rather than the primary role.

Every attempt first obtains the request advisory fence, global canonical fence,
runtime row and mapped listing lock. It then reads current stored authority and
only afterward accesses the wallet head. All participants receive the same
guarded SQL handle, bound to the earliest physical transaction identity. Every
query and DDL operation checks that original identity and simulation contract
before and after awaited work. Failure cleanup can abort only that same original
transaction; a replacement transaction cannot become a nested cleanup owner.

Authority is rechecked after awaited writes and at the final boundary, including
retries returning a previously committed receipt. Serialization failures are
retried by the real outer store using the whole decision. Public errors are
sanitized after those retry rules run.

## Deriving the cancellation

The caller cannot choose the actor, amount, wallet destination, accepted terms,
fees, checkpoint or cancellation time. The coordinator derives them from the
authenticated principal, complete locked canonical basis, original activation,
original acceptance and verified V4 snapshot.

The bounded policy is ordinary initial-style Bank Transfer or Face-to-Face on
the supported simulated assets, with unchanged accepted terms, an unexpired
listing and no competing reservation. Payment progress, evidence, unsupported
disputes or commissions, Wise/Cardless/demand flows and adjusted terms are
outside this profile. The existing buyer bank-disclosure restriction applies.
The scalar historical actor role is event metadata, not account authority.

The pure financial command commits one balanced return of the **entire original
reserved principal to its original listing**. For the standard fixture, listing
and trade balances change from 300/200 to 500/0. No withdrawal, payout, provider
submission or new commission is created. The canonical listing's retained
`availableAmount` is validated against the wallet's available-plus-reserved
inventory and is preserved; it is not incremented a second time.

The canonical participant cancels the request and physical trade, unlocks the
listing, clears action reminders, withdraws a pending proposal, archives the
matching buyer reminders, records trust-reconciliation intent and appends the
deterministic timeline event, two notifications and reopen audit. Its complete
before/after basis is rechecked. Canonical and financial effects, the immutable
cross-system receipt and publication intent all commit together.

## SQL independence and immutable evidence

The SQL bundle validates the real accepted prestate, original accepted terms,
actor relationship, clocks, disclosure and unsupported progress independently
of the supplied canonical result. It reconstructs the exact permitted request,
listing, physical trade, notifications, reminder updates and audit rows. The
financial receipt must match the original command result and financial
projection. Deferred checks require the entire coupled result at commit.

Old initial writers, standalone V4 writers and old combined exporters refuse the
successor. Scoped legacy payment/evidence/dispute/listing writers cannot mutate
the mapped listing through the old lifecycle. This profile deliberately freezes
those unsupported transitions; it does not implement their future participants.
Unrelated canonical work still receives the runtime version fence. Tables use
row-level security and deny public/client access; simulation fixture privileges
are not a production role design.

The private complete canonical basis includes current account data and is
hashed, but it is not copied into immutable cancellation evidence or backups.
The stored cancellation basis contains only the target request, listing,
physical trade, matching reminders and historical actor role. Public receipts
contain explicit safe identifiers, amount strings, timestamps and wallet
references. They do not serialize the principal, credential data, bank data or
full canonical rows.

## Business retries and publication

Upgrade and cancellation fingerprints bind their operation kind, authenticated
actor ID and canonical request ID. Transport operation IDs are separate. A
retry from the same currently authenticated party returns the original
cancellation receipt, including after pause or across web/mobile transports.
A different party cannot adopt the original cancellation identity. Revoked or
expired credentials cannot recover it through the authenticated API.

The deterministic publication ID is
`cancellation-wallet-publication-${cancellationKey}`. Its exact payload contains
the request/listing/trade/wallet-trade IDs, buyer/seller and actual actor,
acceptance/cancellation identities, wallet revision/event hash, accepted-terms
digest, notification IDs, audit ID and timeline event ID. SQL reconstructs that
payload. It is one durable publication intent; no external message delivery is
performed by this implementation.

## Complete combined recovery

Export requires current stored owner authority and a durably paused successor.
Web and mobile exports use the same envelope. The envelope retains canonical
rows, original initial-cohort evidence, the successor transition, any
cancellation/publication, all original V1–V4 commands and all three financial
continuations. A paused V3 source followed by a V4 continuation remains a valid
paused source even when its final command is not a new pause.

Parsing validates checksums and semantic cross-references, not merely JSON
shape. It verifies original acceptance and continuation history, reconstructs
the cancellation through the unchanged pure canonical planner, validates exact
poststate and events, and rejects injected credential material or inconsistent
normalized/payload relationships. Timestamp precision, large integer strings,
binary evidence representation and deterministic ordering remain preserved.
The checksum is an integrity commitment, not proof of source authenticity or
current authority.

Restore requires a separately retained expected checksum, explicit fresh-target
acknowledgement and one fresh-target advisory claim. It replays every original
financial version through its original API before installing the coordination
namespaces, appends exactly one V4 quarantine pause, restores the complete
canonical and immutable evidence, and writes a completion receipt in the same
transaction. The completion receipt binds the source/restored checkpoints and
canonical, predecessor and successor digests.

Restored identities are disabled stubs with no login credentials. The target
permits unbound inspection contexts and necessary read locks only; canonical
mutations, new financial commands, credential injection, authority re-entry and
resume remain sealed. After an uncertain COMMIT reply, same-target inspection
verifies the original history plus that one quarantine command. Another restore
cannot overwrite a claimed target. Recovery does not activate a second copy.

## Development verification and remaining product work

The development workflow retains the existing wallet, authentication,
marketplace, TypeScript, native SQL and Chromium gates. Added native drills use
explicitly fresh loopback databases to verify late rollback, actual committed
response-loss recovery, visibly blocked distinct PostgreSQL backends, whole
decision retries, revocation, legacy-writer fencing and combined restoration.
Injected response loss is not a real network partition, and reopening a
connection is not a production failover exercise.

The existing Chromium rehearsal remains the standalone synthetic wallet UI.
This coordinator has no production route or native mobile interface yet. Buyer
payment claims, dispute freezes, release and settlement need separate versioned
participants and matching recovery contracts before a complete product flow can
be connected. Trust Wallet remains the selected receiving preference; this
internal principal return neither connects that wallet nor sends funds to it.
