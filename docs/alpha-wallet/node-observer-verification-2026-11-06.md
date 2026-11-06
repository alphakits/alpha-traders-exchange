# Alpha Wallet read-only node-observer verification

Date: **6 November 2026, 20:19 Asia/Jerusalem**. Scope: development and synthetic fixtures only. **Live launch remains off.**

The rebuilt BSC/TRON observer layer, bounded read transport and eight MiB attachment correction passed the complete development CI gate. The corrected source is saved on `feature/alpha-wallet-dev-20261104`. The gate passed **3,130 tests across 83 files**, **18 native PostgreSQL drills / 212 checks**, repository TypeScript, the offline demonstration and the retained English desktop / Arabic mobile Chromium rehearsal. These results establish this development milestone; they do not establish a complete live wallet.

## Exact source and evidence

| Item | Verified identity |
| --- | --- |
| Corrected implementation commit | [`c2f078aa5960f835f82840977307dbfaedd096f2`](https://github.com/alphakits/alpha-traders-exchange/commit/c2f078aa5960f835f82840977307dbfaedd096f2) |
| Tested source tree | `89694b4a2db33f5f2b0ed7f5c92f3b44b2011e0b` |
| Initial rebuilt implementation | `c6b2ad6d8f0d18074d8e774a0011c388663599f7`; later correction changes one parameterized test table only |
| Saved predecessor checkpoint | `7f6118af1bb70670991aae65e5e7775abd1c7f36` |
| Previous fully verified implementation | `621beaad00715ea81c7eb48b07a63c6137599314`; historical V5 run `42195918584` |
| Complete current CI | [Run 42267049554](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42267049554), attempt 1, job `128061714038`; completed `2026-11-06T18:16:58Z` |
| Downloaded artifact | `13529210555`; `alpha-wallet-simulation-evidence-c2f078aa5960f835f82840977307dbfaedd096f2`; 2,120,342 bytes |
| Artifact ZIP SHA-256 | `1d75dc19286e55e981eb424c14b4b8c64443b270cc744f7901e5110cbeed1484`; matches GitHub's artifact digest |
| Extracted evidence | 54 files; every extracted file matches the verified ZIP member bytes |

The [machine-readable evidence](node-observer-verification-results.json) retains complete file/case inventories, native result payloads, workflow steps, artifact and log hashes, source-file hashes, and the comparison with the saved predecessor report. The report compares historical inventories and native payloads retained in that verified report; it does not claim that the predecessor ZIP was downloaded again during this continuation.

The earlier local-only observer commits were unavailable when work resumed. This code was rebuilt from the saved remote baseline and verified afresh. The [workspace recovery record](workspace-recovery-2026-11-06.md) distinguishes reconstruction from byte-identical recovery. Initial rebuilt CI run `42266497317` was cancelled when the test-fixture correction advanced the branch. No result from that cancelled run, the unavailable old implementation, or its prior local runs contributes to this report.

## Test results and retention

| Scope | Passed cases | Files | Comparison |
| --- | ---: | ---: | --- |
| Wallet unit and local persistence | 2,943 | 74 | All 2,599 saved V5 cases retained; 344 added |
| Platform authentication | 87 | 5 | All previous cases retained |
| Marketplace and storage regression | 100 | 4 | All previous cases retained |
| **Current CI test total** | **3,130** | **83** | **Zero failed, skipped, pending or todo cases** |
| Native PostgreSQL drills | 212 checks in 18 drills | Separate harnesses | Every ordered predecessor check string retained; each containing CI step passed |
| Frozen source contracts | 75 | Separate SHA-256 comparison | Every saved byte digest unchanged |

Retention uses the exact multiset of repository-relative test path and full test name. The pre-existing duplicate test identities retain their original multiplicities. There are no removed cases or newly duplicated identities. The audit therefore checks more than aggregate totals.

The four focused files pass **400 distinct checks**: BSC 65, TRON 90, shared transport/common 177 and payment canonical 68. The 344 additions comprise 332 new observer checks and 12 new attachment checks. The other 56 focused cases are retained canonical-validator coverage. All 400 are explicitly verified as a subset of the final CI inventory and are not added to its total. Local repository TypeScript and lint for all nine changed/new TypeScript files also passed.

The first local audit found that an empty array in a parameterized table was interpreted as a zero-argument row, duplicating `undefined`. The corrected table uses explicit labels and two-element rows, so the final gate tests `null`, `undefined`, array, number and string independently.

## Implemented behavior

### Closed native read transport

The transport requires an explicitly injected fetch function, `simulation-only` mode and configured sources. It has no default provider, credential discovery or global-fetch fallback. It allows only the named BSC read methods and TRON FullNode/SolidityNode paths, with closed arguments. Source IDs, DNS hosts and declared operator groups must differ between the two selected views; those declarations do not prove actual organizational independence.

The implementation rejects redirects, URL credentials/queries/fragments, literal IP endpoints, wrong HTTP/content types, invalid UTF-8, malformed or duplicate-key JSON, mismatched JSON-RPC IDs and unsupported operations. One response is limited to 1 MiB; a session is limited to 16 MiB, 160 reads and less than 30 seconds. Default per-read time is five seconds with a ten-second upper bound. Wall and monotonic checks enforce elapsed limits even when timer callbacks are delayed. Failure, concurrency and reentrant callbacks close the session permanently, preventing a partial transcript from being sealed as success. Unread and late response bodies are cancelled.

Transcripts retain serialized requests and exact response bytes with hashes. Typed failures avoid copying provider messages or endpoint URLs. Successful results carry `creditAuthority: false` and `assurance: "configured-node-consistency-only"` and call no accounting, approval, payout or signing operation.

### BSC and TRON observations

BSC verifies both configured views' network/genesis identity, full supported containing-block and receipt semantics, exact transaction/log placement, execution success, token, recipient and raw units. It requires explicit `finalized` state, checks every connecting parent link through both sources, and rereads fixed evidence. An advancing finalized head requires the entire bounded extension; the original proof stays pinned.

TRON verifies native block/header and transaction identities, FullNode and SolidityNode containing-block/receipt agreement, explicit successful execution and exact original log positions. Connecting ancestry uses the SolidityNode view; both sources corroborate the containing block and receipt. Height prefixes, parent links, increasing timestamps, fixed-evidence rereads, solidified-head nonregression and complete bounded continuation are checked. Its native JSON profile rejects fractional, exponent, negative-zero and unsafe numeric tokens before parsing can round them into apparently valid integers.

Both observers verify one expected recent event under a maximum 64-successor ancestry policy. They do not scan complete chain ranges or silently truncate older proofs. The [observer contract](node-observer-design.md) records the API, profiles and limits.

### Payment attachment boundary

The saved predecessor's repeated-group base64 regex could exhaust the Node/V8 stack for a valid 8,388,608-byte attachment. A bounded linear ASCII/padding scan replaces it. Canonical decode/re-encode, maximum bytes, signature checks, hash binding and financial receipt meanings are preserved.

Regression cases cover exact eight MiB PNG/JPEG/PDF signature-bearing payloads, the first oversized byte, malformed large inputs, invalid padding and noncanonical padding bits. Signature validation is not malware scanning or evidence that fiat payment settled.

## Database, recovery and browser evidence

All eighteen retained native drills executed against disposable PostgreSQL in the new job. They retain all 212 ordered checks covering transaction coupling, competing backends, current authority, revocation, duplicate commands, late rollback, unknown COMMIT outcomes, exact prior receipts, paused exports and quarantined fresh-target restores. The workflow and relevant native/browser/demo harnesses remain byte-identical to the saved baseline.

One known PostgreSQL client queued-query deprecation warning remains in the payment-coordinator test harness. Its observer connection is separate from the participating transaction clients. The fresh native audit accepted only the previously recorded warning with a changed process ID; all other native stderr logs are empty. This is a future driver-compatibility task, not a failed financial assertion.

The offline demonstration still delivers 500 simulated USDT of principal while funding and recognizing 10 simulated USDT of commission separately. The browser uses Chromium `149.0.7827.55`, a 1440-pixel English desktop and a 390-pixel Arabic RTL mobile viewport. All seven retained browser assertions passed, with no console errors or horizontal mobile overflow. Interrupted reservation and withdrawal responses recover the same request and revision after reload; withdrawal recovery retains one payout and zero provider submissions. Both browser report copies agree, and all six screenshots are valid decoded PNGs.

These browser results cover the retained standalone synthetic rehearsal. They do not verify new authenticated product routes, the proposed deposit inbox, a native mobile build or a live custody provider. The screenshots show funding/submission/settlement views, not separate recovery-state screenshots.

## Next development slice and live gates

The [durable deposit-observation inbox contract](deposit-observation-ingestion-design.md) is complete as a proposal. Its first implementation stage is immutable synthetic admission and attribution, admitted preparation with an additional timing trace, and exact transcript replay. The later stages add a separate durable store, event/transaction/block anchors, absorbing conflict quarantine, candidate progress and independent paused backup/restore. None of that inbox implementation is claimed by this verification.

Current copied transcripts do not retrospectively prove every monotonic deadline or authenticate their clocks. The proposed timing trace must be captured by a future admitted wrapper; it cannot be invented for existing observations. Candidate progress is also separate from exhaustive block coverage and historical backfill.

Live readiness still requires authenticated providers and actual custody attribution, durable ingestion/reconciliation, trusted fiat verification, seller release authority, dispute resolution, complete unpaid cancellation through an explicit successor, actual web/mobile integration, signer/testnet recovery, production roles and operational recovery, and independent review. The V5 claim/dispute profile still moves zero principal and supplies no new cancellation or release authority.

Development and saving this branch are authorized. **No live launch is authorized.** Automatic Git deployment remains disabled for the exact branch. No main merge, production deployment/migration, real provider/key/signer connection, funding or transfer occurred. A green development gate does not authorize any of those actions. The [launch-readiness record](launch-readiness.md) remains open.
