# Development release consent overlay

## Scope

`src/lib/alpha-wallet/release-consent-model.ts` adds a private, versioned, simulation-only preparation journal beside the unchanged V1–V5 wallet. It retains the exact original claimed trade, admitted synthetic source observations, a seller's explicit reviewed consent, and withdrawal or stop decisions. It does not create a V6 wallet, change `trade.status`, attach old `trade.evidence` or `trade.authorization` fields, consume a credit, change any balance, create commission entries, or create a payout intent.

Every receipt, inspection, reviewed basis, state, and model error carries `executionAuthority: false` and `releaseAuthority: false`. `currentPreconditionsMatch` is a derived description at a particular current read and clock. It cannot be submitted to a ledger reducer or dispatch worker as permission. A future financial transition still needs its own versioned contract, current actor authentication, source revocation ordering, physical transaction enforcement, and payout policy.

The overlay preserves the original V5 buyer dispute and operator pause exits. Those commands change the retained V5 head and invalidate earlier consent when this overlay is inspected. Their reducers, command parsers, history, and SQL projections remain unchanged.

## One original claimed mapping

Enrollment requires a complete, independently replayable `PreparedTrustedPaymentEvidenceV1` and its original source manifest. The prepared V5 history must contain the original acceptance and buyer claim, a `payment_reported` trade, the full original principal reservation, and no evidence, authorization, or payout. Enrollment refuses a wallet already paused or disputed.

The immutable bootstrap contains:

| Field | Meaning |
| --- | --- |
| `sourceStoreId` | The original physical source identity, certified by the owning store. |
| `manifest` and `manifestSha256` | The exact frozen synthetic source admission. |
| `enrollingOwnerId` and `enrollmentOperationId` | The original enrolling platform actor and operation. |
| `createdAtMs` | The original enrollment decision time. |
| `initialPrepared` | The complete original preparation, including replayable V1–V5 history. |
| `initialBasis` | The locked wallet and canonical basis at enrollment. |

That preparation pins the request, trade, listing, seller, buyer, asset, full principal, full fiat amount including the buyer fee, payment method, original instructions, recipient binding, crypto destination digest, accepted terms, original acceptance receipt, original buyer claim receipt, admitted source, native payment identity, and original payment facts. This overlay accepts observations for only that native identity. Another native payment needs another explicitly reviewed cohort and is not silently substituted here.

A negative first observation is retained and quarantines the overlay. Pending, disabled, expired, or stale observations can be retained without enabling consent. No historical `eligibleForLaterVerification` flag is promoted to current readiness.

## Exact current basis

`ReleaseConsentCurrentBasis` is a closed structure:

```ts
type ReleaseConsentCurrentBasis = {
  walletCheckpoint: {
    revision: number;
    eventHash: string;
    stateHash: string;
    lastCommandAtMs: number;
  };
  walletTradeSha256: string;
  walletPaused: boolean;
  walletDisputed: boolean;
  canonicalBasisSha256: string;
};
```

`releaseConsentCurrentBasisFromHistory({ requestId, walletHistory, canonicalBasisSha256 })` replays bounded complete V1–V5 history, finds the actual original reservation and claim, checks the full principal hold and absent financial successors, and derives the wallet fields. The canonical digest is the owning coordinator's commitment to its actual locked canonical participant basis and the retained seller account row. The model does not authenticate a supplied canonical digest or certify a physical database read.

The same physical transaction must authenticate the current stored web or mobile principal, reread canonical rows and the actual wallet head, certify the original inspect context, and supply this basis. A request body, old journal receipt, detached prepared record, restored copy, or arbitrary snapshot is not a replacement for those reads. Source preparations must match that actual current wallet checkpoint, trade digest, pause flag, and dispute flag.

Later preparations must retain the original and previously observed wallet histories as exact prefixes. A self-consistent alternative history or rollback is retained as `payment-conflict-quarantined`. This closes the case where a different replayable buyer claim happens to produce the same source payment key.

## Unchanged source journal semantics

The model calls the existing `createTrustedPaymentJournalArchive` and `appendTrustedPaymentJournal` functions without altering their contracts. A derived source journal is cached only for internally produced, deeply frozen archives. Serialized overlay data contains each prepared record once, plus the reproduced source state and checkpoint; it does not duplicate the full source archive inside every overlay record.

Deserialized verification rebuilds the derived journal from the original enrollment preparation and every retained observe command. Its immutable first facts, native identity, source revision ordering, receipt rules, negative outcomes, and structural limits are therefore the original journal's rules:

| Observation | Retained result |
| --- | --- |
| First revision 1 | Original payment facts and revision retained. |
| Exact current revision and bytes | `corroborated`; the observation deadline does not move. |
| Exact older known revision | `stale-corroboration`; the latest source revision does not move backward. |
| Contiguous later revision | Original facts preserved; latest revision advances. |
| Changed original facts | Permanent payment conflict quarantine. |
| Changed bytes at the same revision | Permanent revision conflict quarantine. |
| Missing native revisions | Permanent revision gap quarantine. |
| Backward observation time, changed known settlement time, or settled to pending | Permanent status regression quarantine. |
| Reversed, revoked, or rejected observation | Retained adverse evidence and permanent quarantine under the original journal's ordering rules. |

Every new source revision invalidates the previous reviewed consent, even if it remains settled. Exact corroboration can preserve matching because the reviewed digest excludes incidental source-journal delivery revisions and preparation timestamps. The actual observation bytes and original observation deadline remain fixed.

The standalone source journal's receipt is never accepted as an overlay command. Only a complete prepared record reverified against the exact admission and current physical wallet basis can be observed.

## Seller review and expiry

The reviewed basis commits to the original parties, asset, principal, full fiat amount, instructions and destination digests, accepted terms, acceptance and claim receipts, admission, native identity, original payment facts, latest source revision, exact observation digest, and actual current wallet and canonical basis. It also includes the source's original validity deadline and permanently false authority fields.

The digest is:

```ts
walletDigest([
  "alpha-wallet-release-consent-reviewed-basis-v1",
  reviewedBasis,
]);
```

The public product intent is only an operation identity and the exact digest the seller reviewed. The coordinator derives the retained seller and current authenticated session expiry; it does not accept a caller-supplied amount, role, recipient, source authority, or artificial deadline.

A new consent is accepted only when the overlay is recording, the current V5 wallet is unpaused and undisputed, the latest source preparation matches the actual current wallet, the source reports settled, its admission is enabled and currently valid, and the observation is still fresh at the current decision clock. The current reviewed digest must exactly match the seller's submitted digest. Only the exact retained seller can consent or revoke.

The immutable consent deadline is the earliest of:

1. The original observation time plus the source's admitted maximum observation age.
2. The source admission's `validUntilMs`.
3. The currently authenticated seller session's original expiry.

There is no added live-payment TTL. Freshness and expiry use exclusive upper boundaries. At the exact deadline, matching is false. A later inspection always reevaluates these bounds; an earlier prepared eligibility flag or consent receipt cannot keep them true.

The model additionally excludes every admitted source authority ID from the enrolling owner and later recorded platform actors. The coordinator must perform the wider stored-platform-user exclusion before enrollment and each operation; the pure model cannot discover other database users.

## Commands and historical retries

| Public command | Required model fields | Result |
| --- | --- | --- |
| `observe` | `operationId`, `actorUserId`, full `prepared` | Retains the current source delivery using the unchanged source journal. |
| `consent` | `operationId`, retained seller `actorUserId`, `reviewedBasisSha256`, authenticated `sessionExpiresAtMs` | Appends explicit revocable consent to the exact reviewed basis. |
| `revoke` | `operationId`, retained seller `actorUserId`, `consentOperationId` | Records withdrawal of that exact consent without deleting it. |
| `pause` | `operationId`, `actorUserId`, `reasonCode` | Permanently stops new overlay commands. |

Owner eligibility for observe, pause, export, and enrollment is the coordinator's fixed stored-auth responsibility. The pure model verifies the exact seller identity for seller commands and source independence for every platform actor; it does not treat an arbitrary owner string as stored authentication.

Supported pause reasons are `manual-review`, `source-unavailable`, and `maintenance`. There is no resume. After an overlay stop or restore, only exact historical receipt recovery remains available. A stopped overlay already makes every consent nonmatching; it does not accept a new withdrawal command after that terminal fence.

Operation identity spans all overlay command types. `inputHash` commits to the exact closed command. An exact retry returns its original receipt before the stop fence, without a new record or a new deadline. Changed intent under a previously used operation is retained as an operation conflict and permanently quarantines the overlay. The result identifies the original command type and actor so that the owning coordinator can authenticate before historical lookup.

The original session expiry stays inside a consent command. After a fresh login or renewal, a matching public retry must recover the archived command's expiry after authenticating the same current seller and checking the same public operation and reviewed digest. It must not replace that expiry with the new session's later expiry.

Seller withdrawal leaves the old consent and receipt intact. A retry of that old consent returns the historical `consented` receipt while `currentPreconditionsMatch` remains false. Another explicit consent operation can be accepted against a newly reviewed current basis. Withdrawing or retrying an earlier superseded consent never withdraws the new consent by implication.

## Immutable replay and recovery

The first record is an internal enrollment command bound to the complete bootstrap digest. The public parser does not expose enrollment or restored quarantine commands. Each subsequent immutable record stores the command, actual current basis, time, previous event hash, result, and state commitment. The event hash is:

```ts
walletDigest({
  revision, operationId, inputHash, currentBasis, occurredAtMs,
  previousEventHash, stateHash, disposition, status,
});
```

`verifyReleaseConsentArchive` replays the original source preparation, all source-journal transitions, all reviewed consents and withdrawals, and all outer states and receipts. A recomputed outer checksum cannot hide a changed receipt, omitted enrollment, altered source projection, changed consent expiry, or alternative current basis. Checksums establish consistency and do not establish provider authenticity or historical actor authentication.

The overlay backup is a component of complete same-store recovery. It may be created only from a stopped original overlay and retains its exact full archive. The database recovery owner must also export the complete canonical and V1–V5 recovery evidence, including original coordination rows, and must quarantine credentials in the recovered target. An old V5-only exporter must continue refusing an unrecognized overlay namespace rather than silently omit it.

`restoreReleaseConsentArchive` verifies that component, preserves every original record byte for byte, requires a different target store identity, and appends a permanent `restored-quarantined` record. It cannot resume, execute, reexport as an original, renew consent, prove the original source has no later history, or reconcile an unknown original commit by examining the restored copy. Fresh physical target certification and same-source unknown-commit handling remain storage responsibilities.

The archive bound is 128 records and 32 MiB, with bounded inert JSON structure. Ordinary growth leaves two terminal records, one MiB, and structural headroom for a stop, backup envelope, and restored quarantine. The original source journal's independent bounds also remain in force. Inputs reject getters, proxies, executable fields, custom prototypes, sparse arrays, unsupported numeric values, excessive depth, and oversized serialized data before they can run callbacks or mutate retained state.

## Exported API

The new module exports `createReleaseConsentArchive`, `appendReleaseConsent`, `inspectReleaseConsent`, `releaseConsentCurrentBasisFromHistory`, `releaseConsentCommandDigest`, `findReleaseConsentReceipt`, `verifyReleaseConsentArchive`, `createReleaseConsentBackup`, `verifyReleaseConsentBackup`, and `restoreReleaseConsentArchive`, together with the corresponding closed types and public input schemas.

`release-consent-model.test.ts` covers both simulated assets and both payment methods, exact frozen source-journal projection compatibility, original V5 dispute/pause exits, source revocation and ordering, wrong actors and altered terms, canonical/account commitment changes, source and session expiry boundaries, exact historical receipt recovery, withdrawal and explicit renewed consent, immutable replay, hostile input, bounded terminal recovery, and permanent fresh-copy quarantine.
