# Chain evidence adapter contract — development fixtures only

Status: 2026-11-04. The pure functions in `src/lib/alpha-wallet/chain-evidence.ts` validate supplied BSC ERC-20-style and TRON TRC-20-style transfer evidence. They have no RPC client, environment configuration, address or key generation, signer, provider connection, wallet command, or balance-credit operation. Their tests use repeated-byte synthetic fixtures.

Every call requires `mode: "development-fixture"`. The immutable result includes `creditAuthority: false` and `assurance: "supplied-fixture-consistency-only"`. The word **verified** means that the supplied records passed the checks below. It does not mean that a network, consensus proof, receipt inclusion proof, customer identity, or custody balance was authenticated.

## Inputs and identity

`verifyBscFixtureTransfer(context, receipt, proof)` and `verifyTronFixtureTransfer(context, receipt, proof)` accept unknown input and fail with `ChainEvidenceError` when required evidence is absent, unsupported, or inconsistent. An error never means that a chain transaction has definitively failed. It supplies no release or retry authorization.

The context fixes the expected chain, token contract, recipient, transaction ID, positive raw integer amount, and event index. It is a fixture expectation, not browser-supplied authority. All amounts and indices are canonical decimal strings. Raw amounts remain exact unsigned 256-bit values; zero transfers are outside this deposit-oriented fixture policy even though ERC-20 permits them. No floating-point scaling, symbol lookup, or inferred decimals occurs. [ERC-20 specification](https://eips.ethereum.org/EIPS/eip-20)

| Field | BSC supported encoding | TRON supported encoding |
| --- | --- | --- |
| Chain | Family `bsc`, decimal chain ID `56` or `97`, explicit genesis hash | Family `tron`, network `mainnet`, `nile`, or `shasta`, explicit genesis block ID |
| Transaction ID | `0x` plus 32 bytes | 32 bytes of native hex, no `0x` |
| Context token / recipient | `0x` plus 20 bytes | `41` plus 20 bytes, no `0x` |
| Native log emitter | `0x` plus 20 bytes | 20 bytes with the `41` prefix omitted |
| Topics / data | `0x`-prefixed byte strings | Unprefixed native byte strings |
| Event index | Decimal form of the log's **block-wide** `logIndex` | Decimal original index in the complete receipt's `log` array |
| Receipt height | Minimal hex JSON-RPC quantity | Safe nonnegative integer or canonical decimal string |

BSC IDs are checked against the [official endpoint documentation](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/). The fixture genesis is supplied independently and is not a shipped production network registry. Native TRON log encoding and address padding follow [TRON event documentation](https://developers.tron.network/docs/event); `visible=true` rewrites emitters into another address format, so it is unsupported here. [java-tron receipt reference](https://tronprotocol.github.io/documentation-en/api/http/block-and-tx-query/gettransactioninfobyid/)

Hexadecimal letter case is normalized. A deterministic `eventKey` combines chain family, chain ID or network, genesis, token, transaction ID, and event index. Block hash is retained separately so a later conflicting canonical observation can be detected without assigning the same logical event another credit identity. The module has no event database and does not itself deduplicate repeated calls.

## Receipt checks

Both decoders require the emitting contract and recipient to match the context exactly. A supported fungible `Transfer` has exactly three 32-byte topics: the signature, a zero-padded sender, and a zero-padded recipient. Its data is exactly one 32-byte unsigned amount. A different signature, NFT-style fourth topic, dirty address padding, extra data, missing data, or incorrect raw amount is rejected. The same signature can be emitted by unrelated contracts; the exact contract allowlist remains essential. [TRON event layout](https://developers.tron.network/docs/event)

**BSC:** execution must have `status: "0x1"`. The receipt's transaction, block, and transaction index must match the separate canonical block. Every log must have `removed: false`, matching transaction/block metadata, valid byte fields, and consecutive global log indices in the supplied complete receipt. Duplicate indices, gaps in the middle, reversed logs, pending/null identities, pre-Byzantium `root`, and unsupported aliases are rejected. Receipt `to` may be a router and is never confused with the token recipient. [JSON-RPC receipt and log definitions](https://ethereum.org/developers/docs/apis/json-rpc/)

**TRON:** the native `receipt.result` must be `SUCCESS`. A supplied top-level `result` must also be `SUCCESS`; the protobuf-default omission is allowed. Success and solidification are separate checks. Native logs must have only `address`, `topics`, and `data`; indexer `logIndex` and other aliases are rejected. Two identical log payloads at different original offsets remain distinct events. Filtering, sorting, or deduplicating the receipt array before this decoder would change event identity and is forbidden. [Solidified receipt semantics](https://developers.tron.network/reference/gettransactioninfobyid-1)

Recognized TRON resource/accounting and unrelated transaction metadata are ignored rather than used as evidence of transfer success. The supported top-level and execution-receipt field lists are explicit in the source. Unknown fields fail closed so a changed node or indexer schema requires deliberate review. BSC optional standard address, quantity, and bloom fields receive encoding checks when supplied. Neither decoder claims to validate all unrelated transaction metadata.

## Independent canonical/finality fixture proof

`CanonicalBlockFixtureProof` requires `mode: "independent-fixture-proof"`, matching chain identity, `canonical: true`, a containing block with its ordered transaction IDs, a contiguous successor-header path, and a checkpoint. BSC requires `finality: "bsc-finalized"`; TRON requires `finality: "tron-solidified"`.

The containing block must include the expected transaction exactly once. BSC's receipt transaction index must select it; TRON's index is derived from the block list. Each successor must increment height by one and name the previous full hash/ID as its parent. The last successor must equal the checkpoint. An empty path is accepted only when the containing block itself is the checkpoint. Repeated BSC block hashes, skipped heights, conflicting parents, different checkpoints, and duplicate transaction IDs are rejected.

TRON block IDs also encode the height in their first eight bytes; that prefix is checked for every block and checkpoint, and genesis must encode zero. The generic `hash` and `blockHash` property names contain a composite **block ID** on TRON. BSC heights are bounded to unsigned 64-bit integers; TRON native heights to nonnegative signed 64-bit integers. [TRON block format](https://developers.tron.network/docs/block) · [Native int64 fields](https://tronprotocol.github.io/documentation-en/api/http/block-and-tx-query/gettransactioninfobyid/)

The path check establishes consistency of the supplied ancestry. It does **not** recompute header hashes, verify validator signatures, authenticate transaction/receipt tries, or establish that either source is independent or honest. Flags and hashes supplied by one untrusted caller cannot create credit authority. Future adapters must obtain and authenticate the appropriate node views under a reviewed trust model. BSC distinguishes `safe` from `finalized`; a confirmation count or elapsed-time guess is not substituted here. [BSC finality API](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/)

## Raw JSON and supported limits

Use `parseChainFixtureJson(rawText)` **before any projection or ordinary parsing** when rehearsing serialized inputs. It rejects malformed JSON, duplicate keys at every nesting level, and equivalent escaped names such as `status` and `sta\u0074us`. Duplicate keys already discarded by a previous `JSON.parse` cannot be recovered. The decoder accepts plain JSON-shaped objects, not getters or class instances, and rejects sparse arrays.

Development bounds are 1,048,576 JSON characters, 64 nesting levels, 4,096 logs or transaction IDs per list, 1,024 ancestry headers, four topics per log, and at most 65,536 data bytes per nonselected log. Selected transfer data must be 32 bytes. These are fixture resource bounds, not claims about maximum valid network block sizes. A production scanner needs explicit streaming/backfill behavior for evidence outside these bounds; it must not truncate logs or silently skip required ancestry.

The JSON helper is not an HTTP or JSON-RPC transport. Correlating response IDs, rejecting mixed error/result envelopes, status codes, redirects, source authentication, timeout handling, response-byte limits, and retries belong to the future adapter. The receipt decoders reject an envelope passed as a receipt.

## Receiving-wallet preference — 2026-11-05

The owner selected Trust Wallet as the preferred interface for a new receiving wallet. No real receiving address, wallet, key or signing connection has been configured. The implementation remains fixture-only.

Wallet brand does not grant credit authority. An observation from a Trust Wallet data API, wallet history, notification or portfolio remains an external observation until the adapter verifies the configured chain, exact asset, destination ownership assignment, transfer event, raw amount and required finality. Deposit observation is read-only and independent of signing. Trust documents public-address balance queries and single-chain history without requiring a local signing wallet. [Address queries](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/balance.md) · [History and hash lookup](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/history.md)

The receiving-interface choice does not change token identity. A BSC Binance-Peg representation and a Binance exchange receiving account are separate concepts; the exact asset registry below remains required. TRON wallet support likewise does not establish a particular SDK's TRON signing, testnet or automation capabilities. The [custody decision](./custody-decision.md) records the current Trust Wallet capability review and unresolved payout-recovery requirements.

## Required before a testnet or live integration

No row below is implemented or enabled by these files. Testnet activity, real addresses, provider accounts, keys, signing, funded transactions, and any launch remain separate work under the user's approval.

| Area | Required implementation and evidence |
| --- | --- |
| Approved asset registry | Bind network/genesis, issuer or bridge provenance, exact token contract, decimals, native fee asset, and supported behavior. Binance-Peg representations must not silently inherit another network's USDT identity or decimals. Rehearse both 6- and 18-decimal raw-unit cases. Reject fee-on-transfer, rebasing, proxy, or upgrade behavior until explicitly supported and monitored. |
| Read-only node adapters | Configure approved authenticated sources; verify network/genesis; parse raw responses without duplicate-key loss; validate request/response binding and complete canonical block/receipt data. Keep expected recipient/account mapping server-controlled. |
| Finality source | Fetch BSC's finalized checkpoint or TRON's SolidityNode solidified view independently of execution success. Fetch the containing block and full connecting ancestry or implement a reviewed authenticated ancestry/inclusion proof. Hold on source disagreement, stale checkpoints, missing receipts, or unavailable finality. |
| Durable ingestion | Persist checkpoints, canonical block identity, complete evidence, and a unique event identity across scanner restarts and all credit directions. Quarantine conflicting observations. Reorg or finality-conflict handling must stop new commitments, reconcile exposure, and avoid silent reversal of already-spent balances. |
| Credit authorization | Authenticate the custody-owned destination and immutable deposit assignment. Exclude own-wallet sweeps, self-transfers, fee transfers, and unrelated/minted events from new customer credit. Reconcile actual custody assets and liabilities. A valid log, a buyer's paid-click, or this module's frozen result alone cannot reserve, credit, or release money. |
| Custody provider | Select a provider and exact supported asset IDs; document custody control, signer isolation, permissions, destination validation, spend policies, final receipt semantics, and full immutable-reference idempotency behavior. Provider status must bind the same chain, token, recipient, amount, transaction, and event identity. |
| Dispatch and recovery | Commit a unique immutable payout claim before calling a signer. On timeout or uncertain acceptance, retain the same identity and use lookup/reconciliation; never create another transfer solely because a response was lost. Establish provider-specific nonce, replacement, cancellation, and permanent-failure semantics. Retain reserved principal during ambiguous or failed settlement. |
| Operational rehearsal | Exercise partial funding, simultaneous reservations, pauses/disputes, reorg/source conflicts, duplicate notifications, outbox retries, lost acknowledgements, backup restore, and provider restart. Reconcile native gas/energy and commission accounts separately from principal. Keep restored instances paused until provider/chain reconciliation is explicitly completed. |

## Verification

The isolated suite covers success and adversarial inputs for both families, exact maximum uint256 units, BSC block-wide versus TRON receipt-local event positions, malformed ABI, execution/finality separation, canonical ancestry, contradictory identities, duplicated keys, unsupported schemas, and immutable outputs. It performs no network or signer operation.

```sh
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet/chain-evidence.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2017 --lib ESNext,DOM --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck src/lib/alpha-wallet/chain-evidence.ts src/lib/alpha-wallet/chain-evidence.test.ts
```
