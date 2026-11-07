# Independent fiat evidence preparation: development contract

This module prepares **synthetic evidence for a later payment-verification
profile**. It does not verify a real bank transfer or a real cash handover. It
does not change V1–V5, the marketplace, a balance, a reservation, or a payment
status. Every returned artifact explicitly carries `executionAuthority: false`
and `releaseAuthority: false`.

## What is implemented

`createDevelopmentTrustedPaymentReader` captures an immutable, explicit fixture
admission and trusted fixture-reader functions. Its only per-attempt input is
the retained request ID, source ID and native payment transaction ID. The
evidence source receives just its source identity, authority identity and native
transaction ID. It never receives an expected amount or recipient that it could
simply echo as verification.

The reader captures a bounded original wallet command history, replays all its
unchanged historical engines, and requires an actual V5 buyer-payment claim on
an original fully reserved trade. It derives the original parties, amount in
ILS minor units including the buyer fee, terms, acceptance, claim, principal,
crypto-destination digest and fiat-instructions digest from that replay.
Following the source read, it captures the retained history again and refuses
any change. This detects a pause, dispute or other wallet command committed
during preparation. It does **not** fence a command committed after preparation;
a future financial consumer must recheck current state inside its own certified
atomic transaction.

### Fiat recipient admission

Each source has an explicit mapping from the original seller and
`paymentInstructionsDigest` to an opaque `recipientAccountId`. For Bank
Transfer, the unchanged accepted-terms contract commits the original account
ID, selected provider and bank name, plus the retained account-holder, bank,
branch, account number and last-four snapshot. No current-account fallback or
buyer upload can select a different recipient. The public crypto destination
is a different field and never supplies the fiat recipient.

Bank evidence can only come from the `synthetic-bank-feed` fixture source kind.
Cash evidence can only come from
`synthetic-independent-cash-custodian`. Both are explicitly admitted simulation
authorities independent of the retained buyer and seller. Duplicate source
IDs, aliases of one authority, ambiguous account mappings and ambiguous
recipient-instruction mappings are refused. A seller's “received funds”
button remains a separate seller assertion. It is neither this independent
cash evidence nor a seller release authorization.

The reader also excludes every operator identity found in the fully replayed
wallet history. It retains that exact unique set in sorted order, bounded by
the 256-command history limit, and independently reconstructs it during archive
verification. Relabeling a recorded owner/operator as a bank source therefore
fails before a source lookup. A different unrecognized identifier is **not**
proof of real independence: source admission, account identity and ownership
remain unverified outside the explicit synthetic fixture.

### Observations, exceptions and freshness

An observation binds its source, authority, native transaction, revision,
original request/trade/acceptance/claim/terms, exact amount/currency, parties,
method and admitted recipient. It has occurrence, observation and optional
settlement timestamps. Unsupported fields, malformed numeric strings and
impossible chronology are rejected. Both one-minor-unit underpayment and
overpayment are rejected from this exact-match profile. Partial payment
aggregation, third-party payer approval, refunds and amount corrections need
separate reviewed exception policies; this module does not infer them.

`pending`, `settled`, `reversed`, `revoked` and `rejected` observations all produce
archivable records when the immutable binding is valid. Negative evidence is
not silently dropped. The artifact separately records whether the fixture
source reports settlement, the observation was fresh at preparation, the source
was enabled and within its validity interval, and the retained wallet was
unpaused and undisputed. All five must hold to set
`eligibleForLaterVerification`. That flag describes one historical preparation
and conveys no financial authority or assertion of irreversible bank finality.
Expired, disabled or stale observations, as well as evidence on paused or
disputed wallets, remain recordable with eligibility false.

The native identity is a domain-separated digest of the fixed admission,
source and transaction. It does not include a caller operation ID or an
observation revision. The immutable payment-facts digest excludes the mutable
status, revision, observation timestamp and optional settlement timestamp. This
allows a pending observation to acquire settlement evidence without inventing
a second payment. A later durable journal must enforce native-payment
exclusivity, revision ordering, immutable first facts, irreversible exception
holds and stable settlement time once first observed. This preparation module
does not own a journal or confer durable uniqueness by itself.

## Archive and replay

`PreparedTrustedPaymentEvidenceV1` retains the exact captured history and
observation, their derived binding, all consistency hashes and the preparation
time. `verifyPreparedTrustedPaymentEvidence` replays that archive through the
same original financial engines and independently recomputes all derived
fields. Rehashing an altered claim, amount, recipient, checkpoint, first-facts
digest or eligibility flag does not make it agree with its unchanged history.

These hashes establish consistency, not origin. Anyone able to invent an
entire coherent fixture history and fixture source can produce another
self-consistent artifact. Archived eligibility is not re-evaluated against a
live clock or a provider, and replay does not authenticate current source
authority, a user account, or ownership of a bank account. A restored record is
historical evidence only.

Data is captured without invoking data getters, proxy traps, `toJSON`, custom
iterators or thenables. Private adapter error text is not returned. One
preparation is bounded by 30 seconds across all reads. Each archive is bounded
by 4 MiB, 40,000 data nodes, 48 levels, 32 KiB strings and 256 wallet commands.
The runtime refuses production, hosted platforms, mainnet and signing flags,
including a switch during an awaited source read. The module itself performs
no network request, database write or wallet command.

## Exported implementation

- `src/lib/alpha-wallet/trusted-payment-evidence.ts`: strict admission,
  observation and archive schemas, source preparation, and independent archive
  replay.
- `src/lib/alpha-wallet/trusted-payment-fixture.ts`: replayable synthetic test
  fixture only. It is not an authentication or evidence source adapter.
- `src/lib/alpha-wallet/trusted-payment-evidence.test.ts`: exact bindings,
  independent bank/cash authority, amount mismatch, late reversal, pending to
  settled identity, dispute/pause/freshness, concurrent wallet changes,
  archival tampering, hostile data, private errors and runtime rejection.

## Remaining before payment verification or live use

1. Admit a concrete bank or independent cash-custody source with demonstrated
   provenance, account ownership, transaction identity, payer attribution,
   settlement/reversal semantics and current authorization. Fixture labels
   prove none of those properties. Unattended verification of ordinary
   face-to-face cash is unresolved without a genuine independent source.
2. Persist original and negative observations atomically, bind each native
   payment exclusively, quarantine conflicts/revocations, and recover that
   evidence without restoring financial authority. Admission rotation must
   preserve payment identity across manifests in a production design.
3. Add an explicit later financial profile with current trusted evidence,
   separate current seller consent, complete dispute/refund/unpaid-cancellation
   exits, atomic canonical/financial receipts and quarantined recovery. A
   source-reported settlement or historical artifact must never directly
   release USDT.
4. Integrate only the verified complete profile into authenticated website and
   mobile flows; then complete real provider/testnet, operational and
   independent review gates. Development approval grants no live deployment,
   funding or signing authority.
