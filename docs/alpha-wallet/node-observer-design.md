# Read-only node observations: development contract

Date: **6 November 2026, Asia/Jerusalem**. BSC and TRON observation with injected synthetic native responses. **Live launch remains off.** No actual provider, receiving address, key, signer or network endpoint has been connected by this milestone.

## Purpose and authority

The frozen `chain-evidence.ts` validates a supplied receipt and canonical ancestry. The new observers construct that evidence through an explicitly configured read transport. They enforce request identity, raw response parsing, expected network/genesis, two configured node views, bounded complete finality ancestry, freshness and fixed-evidence rereads. They call the unchanged frozen transfer decoder.

The exports are `createDevelopmentNodeTransport`, `observeBscNodeTransfer` and `observeTronNodeTransfer`. Observation context supplies an exact expected chain, token, recipient, transaction, raw amount and event index. It is captured and validated before IO. No default endpoint, credential discovery or global fetch is used.

Every observation contains `mode: "simulation-only"`, `creditAuthority: false`, `assurance: "configured-node-consistency-only"`, the frozen decoder's transfer result, source IDs, the pinned checkpoint time, immutable read transcripts and an observation SHA-256. Transcripts retain exact serialized requests and raw JSON responses with individual SHA-256 digests. They exclude configured endpoint URLs and credentials.

These checksums detect changed bytes; they do not authenticate a provider, prove separate operator ownership or establish consensus. Two agreeing malicious sources may fabricate consistent evidence. The code does not recompute block hashes, verify validators/witness signatures or grant credit authority. It invokes no accounting, listing approval, payout, key-generation or signing command.

Trust Wallet remains the selected receiving interface. Reading evidence for an approved public address is separate from proving its custody or configuring its signer. No Trust Wallet address is connected here.

## Closed transport

The factory requires explicit `simulation-only` mode, an injected fetch function and configured sources. Local development/test runtime gates run at creation, session entry, during reads and before sealing. Production/hosted runtime flags and mainnet/signing flags reject execution.

Each source supplies an ID, an operator-group declaration and an HTTPS DNS endpoint. URL credentials, literal IP hosts, queries, fragments and redirects are rejected. Execution and finality must have different IDs, hosts and declared groups. These are configuration checks; real independence and endpoint admission remain separate requirements.

| Family | Permitted reads |
| --- | --- |
| BSC JSON-RPC | `eth_chainId`; `eth_getTransactionReceipt` with one exact hash; `eth_getBlockByNumber` with an exact native hex height or `finalized`, and full-transactions flag `false` |
| TRON FullNode | `/wallet/getblockbynum`; `/wallet/gettransactioninfobyid` |
| TRON SolidityNode | `/walletsolidity/getblockbynum`; `/walletsolidity/gettransactioninfobyid`; `/walletsolidity/getnowblock` |

TRON bodies require exact native arguments and `visible: false`. Arbitrary calls, transaction construction, batch requests, send methods and signing methods are unsupported. Serialized requests use the schema's parsed data, so a hidden `toJSON` cannot replace the validated body.

HTTP requests use POST, omitted browser credentials/referrer, no cache and redirect refusal. Responses require HTTP 200, the exact configured request URL and UTF-8 `application/json`. Streaming byte bounds apply even without a Content-Length header or when that header understates the size. Invalid UTF-8, BOM, malformed JSON and duplicate keys—including escaped equivalent keys—fail before semantic projection. The existing frozen raw JSON parser supplies duplicate-key and nesting checks.

BSC envelopes require JSON-RPC 2.0, the exact generated string ID and exactly one result/error field. Provider errors never become evidence, and error text excludes raw provider messages and URLs. TRON error responses fail. A null/absent receipt cannot establish a definitive failed transfer or authorize a replacement send.

Reads are serial within a session. Invalid operation/source input, concurrency, runtime change, response failure, timeout or exhausted budget latches the session closed. A caller cannot catch a failure and seal an earlier partial transcript. There are no automatic node retries.

## BSC path

Both nodes must agree with the expected chain ID and genesis. The execution receipt identifies the containing block and requested transaction. Native blocks carry their exact height/hash/parent/timestamp and the full ordered transaction hash list, with duplicates rejected. The other source supplies the explicit `finalized` checkpoint, containing block and receipt.

Every connecting successor is fetched by exact height from both sources and must agree on the supported block fields. Its parent must match the prior full block hash, timestamps cannot move backwards, and block hashes cannot repeat. The complete ordered receipt/log data passes through the unchanged frozen decoder, which binds successful execution, contract, recipient, exact raw units, native transaction index and block-wide log index. Supported receipt fields are compared with normalized hex case and object-key order.

Both sources' fixed containing block, pinned checkpoint and original receipt are reread. A changed block, membership, receipt or log fails. The finality tag is reread as well: lower height, earlier timestamp or conflicting same-height block fails. If the head advances, every added parent link is corroborated through both nodes within the original total ancestry budget, ending at one captured newer head. The original proof checkpoint remains pinned; the observer does not chase a moving head indefinitely.

`safe`, `latest`, elapsed time and confirmation counts do not substitute for explicit finality. BNB Chain documents the tags in its [finality API](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/); native receipts and quantities follow [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/). Envelope identity follows [JSON-RPC 2.0](https://www.jsonrpc.org/specification).

## TRON path

The execution view uses FullNode reads; the finality view uses the SolidityNode namespace. Both genesis block IDs must match the expected network identity. Both sources' containing block IDs, normalized native headers and ordered `transactions[].txID` lists must agree. The SolidityNode receipt is required as well as its solidified checkpoint.

Receipts must identify the requested transaction and explicitly report inner `receipt.result: "SUCCESS"`; an optional top-level result must agree. Original log-array positions are retained without filtering, sorting or deduplication. Complete ordered log semantics are compared after the frozen decoder checks their native shape and the selected transfer. A present receipt block timestamp must agree with the containing header.

Every connecting solidified block is read through the configured SolidityNode view. It must advance exactly one height, name the preceding full parent ID and have a strictly increasing timestamp. Block and parent IDs must encode their expected heights in the first eight bytes. Both containing-block views, the pinned checkpoint and both receipts are reread before success.

The solidified head is reread to detect retraction. An advancing head requires every intermediate parent link from the original checkpoint to one captured newer head under the same total ancestry budget. The proof stays pinned. Unlike BSC's paired successor reads, TRON's connecting ancestry uses the SolidityNode view; both TRON sources corroborate the containing block and receipt.

The native HTTP profile accepts only safe JSON integer literals and refuses fractional, exponent, negative-zero and out-of-range numeric tokens before rounded parsing could disguise them as integers. Heights and timestamps additionally require nonnegative values; quoted hexadecimal/string fields are unaffected. Known proto3 zero-genesis scalar omissions are normalized only for an explicitly requested genesis block. Omitted empty transaction arrays are supported; an omitted containing transaction still fails inclusion. No missing execution success or non-genesis scalar is invented. Optional native header fields are retained for source/fixed-header comparisons.

Primary references: [TRON block format](https://developers.tron.network/docs/block), [solidified transaction receipt](https://developers.tron.network/reference/gettransactioninfobyid-1), [native protocol](https://github.com/tronprotocol/protocol/blob/master/core/Tron.proto), and java-tron's native [JSON serialization](https://github.com/tronprotocol/java-tron/blob/develop/framework/src/main/java/org/tron/core/services/http/JsonFormat.java) and [HTTP utility](https://github.com/tronprotocol/java-tron/blob/develop/framework/src/main/java/org/tron/core/services/http/Util.java).

## Bounds

| Resource | Development limit |
| --- | --- |
| Decoded response | 1 MiB maximum; caller may reduce it |
| Complete session response bytes | 16 MiB |
| Reads per session | 160 |
| One response including body/parsing | Five-second default; configurable up to ten seconds |
| Entire session | Less than 30 seconds under wall and monotonic clocks |
| Complete connecting ancestry | 64 successor blocks maximum/default; caller may reduce to zero |
| Checkpoint age | Two-minute default; maximum ten minutes |
| Future clock tolerance | Five-second default; maximum thirty seconds |
| Native transactions/logs | At most 4,096 entries under the supported decoder profile |

Monotonic elapsed checks supplement timer callbacks so delayed callbacks cannot let an expired read succeed. Empty non-final byte chunks fail. Freshness is checked again after required reads before sealing. These deliberately bounded recent-transfer observers do not scan arbitrary historical ranges. Older evidence requiring more ancestry needs a separate backfill implementation; required data is never truncated to fit.

## Payment attachment correction

The current private V5 upload validator had an eight MiB byte limit, but its repeated-group base64 regex could exhaust the Node/V8 stack at that valid boundary. A bounded linear ASCII/padding scan replaces the regex. Existing canonical decode/re-encode, maximum bytes, file-signature validation and SHA-256 remain in force.

Regression tests cover exact eight MiB PNG/JPEG/PDF signature-bearing bytes, the first oversized byte, malformed large base64, padding placement and noncanonical padding bits. Oversize and malformed inputs must produce the intended typed validation error. This is signature validation, not malware scanning or bank-settlement verification. Receipt identities and financial behavior retain their existing meanings.

## Next integration gate

The [proposed durable observation inbox](deposit-observation-ingestion-design.md) defines the next development slice. Its immutable admission wrapper, additional timing trace and replay validator, isolated schema/recorder, candidate cursor and independent backup are design only. Current observer transcripts retain start/completion and per-read completion times; they do not retrospectively prove all elapsed-time checks or authenticate copied clock data. The planned inbox still grants no credit authority.

Before any observation can support a live deposit, define approved provider admission/authentication, actual independence, exact token registry and receiving-address attribution, durable event uniqueness, restart/backfill checkpoints, cross-observation conflict quarantine, source leadership/fencing and custody/liability reconciliation. A checksum alone is not source authentication, and a second successful function call is not another credit authorization.

The existing lifecycle also needs trusted fiat evidence, current seller release authority, dispute resolution, complete unpaid cancellation through an explicit later profile and actual web/mobile product integration. Signer/testnet recovery and launch require their own concrete evidence. Current verification status belongs to the checkpoint/report, not this design contract.
