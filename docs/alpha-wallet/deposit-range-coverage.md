# Bounded native deposit range coverage

This is a separate **simulation-only** range reader and exact replay contract. It extends development evidence beyond the existing finite list of already-known event candidates. It does not install a product route, record an inbox command, advance a durable cursor, credit a balance, or contact a signer. This change configures no real provider; verification uses explicitly injected synthetic native responses.

The certificate's assurance is deliberately `configured-synthetic-response-completeness-only`. It establishes that the supported, complete responses from the two declared synthetic sources were exhaustively traversed for one explicit range and immutable assignment scope. It does not authenticate a blockchain, reconstruct a receipt/transaction trie, recompute block IDs, verify validator signatures, prove real organizational independence, or establish ownership of a receiving address. Two sources supplying the same fabricated or identically truncated history cannot be detected solely by this contract.

## APIs and scope

`createAdmittedDevelopmentRangeReader` captures an existing closed inbox manifest, one admitted worker, one admitted source set, matching separately supplied endpoint commitments, and an explicit synthetic fetch function. It has no ambient fetch, credential discovery or arbitrary transport parameter. Runtime guards refuse production, hosted, signing-enabled and mainnet-enabled environments. Reentrant or concurrent scans poison the reader even when an injected callback swallows the second failure.

The returned `read({ fromBlock, throughBlock, previousBlockHash })` method takes exact decimal heights and the exact immediate predecessor hash. It captures its input before the first native await. A request cannot select tokens, recipients, beneficiaries, purposes, provider sources, amounts or subsets of assignments. The scope includes **every assignment admitted to this worker on the source set's chain**, with the original manifest, worker, source set, chain and assignment digests.

The start boundary only identifies the immediate predecessor. A first certificate for blocks 100–102 does not claim that blocks 1–99 were scanned. Heights remain decimal strings; BSC uses exact `bigint` conversions and TRON retains its existing safe native-number boundary.

`verifyDevelopmentRangeCoverage` captures a closed portable certificate and replays its exact native read sequence and semantic clock positions with the supplied immutable manifest. It recomputes the complete block, receipt, log-classification and candidate projections. Removing a candidate, empty block, receipt, native read or ignored log cannot be concealed by recalculating the outer checksum. Reordered, extra, unconsumed, substituted or wrong-ID JSON-RPC reads are rejected. Native JSON with duplicate fields and inexact TRON integer literals is rejected before projection.

`compareDevelopmentRangeCoverage` accepts only original process-branded replay results. Exact duplicate evidence returns `identical-evidence` without any progress claim. A `contiguous-extension` requires the next requested height, the exact previous covered block, unchanged immutable scope, a non-regressing checkpoint, agreement with all overlapping recorded blocks and no re-inclusion of previously covered transactions. This is a pure compatibility result. It is not a durable cursor or a store-history credential.

All certificates and replay/comparison results retain `creditAuthority: false` and `cursorAuthority: false`. No old inbox command, financial envelope or recovery format is broadened to consume them.

## What the scan checks

1. Validate both declared chain identities and native genesis responses. Pin an explicit BSC `finalized` or TRON solidified head and check its recorded-time freshness.
2. Read the exact predecessor, every requested block and every intermediate block through the pinned checkpoint from **both** sources. Compare the full supported native records, ordered transaction membership and hashes. Require contiguous heights, exact parents, increasing timestamps and no duplicate block or transaction identity in the span.
3. Read every transaction receipt in every requested block from both sources, including failed transactions and transactions with no relevant token transfer. Bind exact block placement and native transaction order. No filter, event indexer, pagination or caller-supplied candidate list selects which receipts are inspected.
4. Validate and classify every receipt log. Preserve other assets, other events, other recipients and zero-value transfers in the receipt projection. Only positive transfers to an admitted assignment of the exact admitted asset become discovered `DepositInboxCandidate` values. Every discovered candidate also passes the original unchanged complete-receipt transfer decoder for both sources.
5. On BSC, require the block-wide log sequence to start at zero and continue across all receipts, including ignored logs. This detects missing earlier or middle logs even when the next receipt exposes the omitted native index. On TRON, retain original unfiltered receipt-local offsets. Both chains compare complete receipt content and ordered logs across sources.
6. Re-read every fixed block and every covered receipt on both sources before completion. Require the final explicit checkpoint to remain unchanged. A regressing or conflicting head is refused; an advancing head is held for a complete retry. No partial certificate escapes after a failed read or a changed source view.

Empty covered blocks have an explicit empty membership projection. Blocks above `throughBlock` appear separately as `bridgeBlocks`; their headers and membership prove linked checkpoint continuity under this synthetic response profile, but their receipts are **not** covered. A reader cannot promote its bridge to scanned deposit progress.

## Closed supported native profile

The range decoder is deliberately separate from the frozen single-transfer decoder. It validates successful and explicitly failed receipts, empty log arrays and nonmatching events, all of which a range scan must account for. Unknown native fields such as pagination/truncation markers are refused instead of silently projected away. Optional native fields accepted by this profile participate in the full native-record digest; metadata differences can conservatively hold a scan.

**This is not yet a general-purpose real TRON block scanner.** The TRON range profile requires an explicit supported execution result and an explicit `log` array even for nonmatching or failed transactions. A missing result, protobuf-omitted execution state, absent log array or unfamiliar result is **unsupported and refuses the entire certificate**. Ordinary non-contract transaction response shapes can therefore prevent a whole range from receiving a certificate. They are not assumed to mean successful execution or absence of events. Official native semantics and actual provider fixtures must be validated before widening this profile or connecting testnet sources. Genesis defaults and an omitted TRON block transaction array retain their narrow native empty-block meaning; an explicit `null` transaction array is invalid. Increasing timestamp requirements are also explicit profile assumptions awaiting actual provider fixture validation.

## Resource and time bounds

| Complete operation | Maximum |
| --- | --- |
| Requested covered blocks | 8 |
| Blocks from the first covered block through the checkpoint | 16, also constrained by the admitted ancestry policy |
| Covered transaction receipts | 16 |
| Logs in one receipt | 256 |
| Logs across all covered receipts | 512 |
| Native reads | Existing transport limit of 160; the maximum supported span/receipt scan uses 138 BSC reads or 136 TRON reads |
| One native response | Existing 1 MiB bound |
| Aggregate retained raw request/response bytes | 16 MiB |
| Native read/session deadlines | Existing complete-response 5 seconds / session 30 seconds |

Every bound is a refusal boundary. There is no sampling, skipped receipt, truncated ancestry, shortened range or partial success. A large block requires a separately reviewed checkpoint/partition contract; a caller cannot claim it is complete by splitting an undisclosed subset of transactions.

Certificates preserve exact raw transcripts, native completion timestamps and the two semantic freshness-check clock samples. The native transport enforces actual monotonic read/session deadlines during collection. Offline replay checks wall-clock ordering, interval bounds and freshness at the captured semantic instants. This new range format does not include the preparation layer's per-read monotonic timing trace and must not claim to retrospectively prove that real elapsed intervals occurred. Copied timestamps and checksums do not authenticate a clock or provider.

## Remaining integration

This slice has no SQL schema, persistent command journal, unknown-COMMIT resolution or portable range-cursor recovery format. The existing durable inbox continues to accept its original prepared single-event observations and to track only finite candidate jobs. Discovered candidates may be reviewed and independently observed through that existing path; discovery alone has no admission, credit or durable-progress authority.

A future integration must atomically persist each complete certificate and its scope, preserve first range/transaction/block facts, consume every discovered event exactly once, couple the range cursor to those effects and retain unresolved conflicts. It must bind preparation to actual store history, define current-time admission freshness, handle retained-source/finality changes, preserve all evidence on recovery and never infer absence of source-side post-backup commands. It also needs broader real native transaction compatibility, exhaustive partitioning for high-activity blocks, actual provider/custody admission, chain-root/consensus trust policy, deposit-to-ledger authorization and external reconciliation.

The fixed-checkpoint requirement can repeatedly hold scans on a continuously advancing chain. Provider latency, scan liveness, actual transaction volume and a reviewed advancing-checkpoint continuation must be tested before treating this bounded synthetic reader as an operational scanner. Passing these tests does not close the real-provider or durable-coverage launch gates.

No live launch authority follows from successful synthetic range tests.
