# Alpha Wallet transaction-owned mobile authority verification

Date: **5 November 2026, Asia/Jerusalem**. **Verification status: passed on the exact saved source. Live launch remains withheld.**

This milestone adds private mobile authentication to the existing bounded canonical marketplace/wallet coordinator and paused-source owner export. The full saved-source pipeline passed, and the downloaded evidence archive matched its published size and SHA-256. It adds no public wallet route, mobile screen, token issuer, real provider or signer.

## Exact source and retained evidence

| Item | Verified value |
| --- | --- |
| Tested source commit | `47f0fc18f33c0f307da53726281db18055a76855` |
| Tested source tree | `eea3bee815707d3fc62a0d68c69d301bad0ab079` |
| Development branch | `feature/alpha-wallet-dev-20261104` |
| CI run | [42025324859](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42025324859) — **completed, success** |
| CI job | `127237970624` |
| Completed | **5 November 2026 at 14:28:36 Asia/Jerusalem**; 2026-11-05 12:28:36 UTC |
| Evidence artifact | **13414975409 — `alpha-wallet-simulation-evidence-47f0fc18f33c0f307da53726281db18055a76855`** |
| Actual downloaded bytes / accepted archive paths | **2,019,867 / 32** |
| Artifact SHA-256 | **`612ed97ba29bbb85d2c8aaf09f125f20ec42b8cebdc199dcd42ad0aed2eccf00`** |
| Download verification | **Actual archive size and SHA-256 match GitHub metadata; exactly 32 allowlisted files extracted and hashed** |
| Runtime | Node **24.22.1**; npm **11.19.1**; PostgreSQL **17.11**; Chromium **149.0.7827.55** |

The [retained verification results](marketplace-mobile-verification-results.json) contain each test outcome, all seven native reports, browser assertions, CI metadata, archive-file hashes and hashes of the tested source changes. Hosted artifact expiry is `2026-11-19T12:28:29Z`. The results remain with the development branch. A subsequent documentation-only save is distinct from the application source that executed this pipeline.

The [previous combined-recovery report](marketplace-recovery-verification-2026-11-05.md) retains its original source and evidence. Its historical claims are not rewritten as results of this milestone.

## Executed verification

| Group | Inventory | Result on the saved source |
| --- | --- | --- |
| Wallet unit, persistence and integration | 1,016 tests / 32 files | **1,016 passed; zero failed or pending** |
| Targeted platform authentication regressions | 87 tests / 5 files | **87 passed; zero failed or pending** |
| Targeted marketplace/storage regressions | 100 tests / 4 files | **100 passed; zero failed or pending** |
| Total automated tests | **1,203 tests / 41 files** | **1,203 passed; zero failed or pending** |
| Full-project TypeScript | `--noEmit --incremental false --pretty false` | **Passed** |
| Native PostgreSQL | **Seven drills / 66 checks** | **All passed** |
| Existing Chromium rehearsal | English desktop 1440 px; Arabic mobile 390 px, RTL | **Passed; no console errors or mobile horizontal overflow** |

The new mobile inventory adds **122 cases across three files**: 86 principal-reader cases, 22 coordinator/export cases and 14 recovery-compatibility cases. The 57 existing web-reader cases passed without modification. The full local wallet run also passed all 1,016 cases using two workers; local full-project TypeScript and changed-file lint passed. Local checks supplement the exact-source CI evidence. The native launcher smoke test reached expected argument validation without opening a database.

The targeted platform suites are not the whole platform test inventory. Browser evidence is the retained standalone synthetic rehearsal, including response-loss/reload recovery, separate principal/fees, RTL layout, console-error checks and overflow checks. It does not establish a new customer-facing mobile wallet flow.

TypeScript ran against the repository root `tsconfig.json`, whose configured exclusions include the separate `apps/mobile` workspace. The retained results record those exclusions. This milestone does not include a new native-app build or a separate mobile workspace typecheck.

## What changed and why

The earlier standalone mobile wallet resolver performs session/account rereads through separate application stores. Those rereads do not hold authentication authority inside the financial transaction. The new `createDevelopmentMobileMarketplaceWalletCoordinator` resolves the actual mobile device session and account through the financial transaction's supplied SQL connection. It exposes the same four existing operations: owner enrollment of an already reserved trade, buyer acceptance of the existing amount correction, owner inspection and owner pause.

The fixed reader checks the real access-token and device hashes, stored platform, current minimum app version, revocation, exact access expiry and canonical account eligibility. Session and account rows remain locked through the outer commit or rollback. The reader binds the retained session identity, token family/generation, hashes and timestamps, then rechecks authority after awaited work and actual marketplace persistence. A swallowed authorization failure cannot commit prior financial work inside a certified transaction.

The existing web constructor and typed inputs remain supported. Both readers share the original account eligibility rules, including email, phone evidence or the exact account exemption, adult self-attestation, disabled state and roles. Each constructor accepts its own strict credentials and uses its fixed reader. Client-supplied actors, financial values and authentication callbacks are not authority inputs.

Access expiry remains independent of refresh-family expiry: a final valid refresh can issue an access token whose lifetime extends beyond the refresh deadline. Device matching follows the retained installation-binding contract and is not hardware attestation. An upgraded app may use a still-current session while satisfying current version policy.

The financial operation, business fingerprint and immutable receipt remain shared across transports. After a committed acceptance loses its reply, a currently authenticated session for the same canonical buyer can recover the original receipt through app or web, including after owner pause. Revoked, expired, rotated or replaced credentials cannot retrieve that receipt. New transport request IDs do not create another acceptance or principal movement.

## Native PostgreSQL evidence

The new mobile drill passed **12 checks** using three different pre-created empty loopback development databases. It checked all targets before fixture writes. Its two source fixtures exercise iOS/English with Bank Transfer and Android/Arabic with Face-to-Face. These labels describe the credential/business fixtures, not native operating-system UI execution.

| Boundary | Observed result |
| --- | --- |
| Owner enrollment | A valid stored mobile owner enrolled the existing canonical reservation under the same financial contract as web |
| Expiry after persistence | Expiry injected after the actual canonical `UPDATE` rolled back wallet commands, canonical terms, receipts and publication together |
| Lost acknowledgement | A real mobile acceptance committed before a synthetic lost reply; current mobile and web sessions recovered one original receipt with one financial acceptance |
| Pause and retry | Mobile owner pause succeeded; current buyer sessions on either transport recovered the original receipt without another financial command |
| Credential-free recovery | Mobile and web owners exported byte-identical financial data; fresh restore omitted both mobile authentication tables and stayed paused |
| Stale logout | Logout committed after the first financial snapshot; **2 whole-transaction attempts** ended in rejection of the old token without financial changes |
| Stale rotation / replacement | Each concurrent credential update won the global lock before the locked read; **2 / 2 attempts** rejected the old authority without financial changes |
| Stale account disable | Disabling the account after the snapshot forced **2 attempts** and denied the operation without financial changes |
| Concurrent ordering | **Three distinct backend connections** exposed real row and advisory waits; acceptance preceded queued logout, and the web contender completed **2 transaction attempts** before recovering the same receipt |

The financial example retained **500 synthetic USDT = 300 reserved + 200 available**. Source and restored target both remained paused, with **zero payouts and zero provider submissions**. The native output retains separate original and restored checkpoints; restore added only its existing quarantine pause.

The prior six drills were rerun on this exact source: process concurrency (6 checks), standalone backup (6), shared marketplace SQL (6), v2 continuation/recovery (9), canonical coordination/web authentication (16), and combined recovery (11). With the new mobile drill's 12 checks, the executed total is **66**.

These races use the actual mobile session schema, hashing conventions and retained SQL lock/update contracts in explicit disposable fixtures. They do not call the ambient production mobile session issuer. Lost replies are injected after real COMMIT; this is not a physical network partition. A logout queued after authentication locks may commit after the earlier authorized operation; it does not retroactively cancel that operation. Expiry checks occur at defined authorization checkpoints, not at the arrival time of a COMMIT acknowledgement.

## Recovery compatibility and retained financial rules

`exportMobileMarketplaceWalletBackup` requires a current stored owner and an already paused source. It uses the same financial format and verification path as web export. Source inspection accepts either neither mobile authentication table or the exact known pair, with checked relation kind, columns, types and nullability. Partial pairs, malformed shapes and unexpected tables are rejected.

The capture/install map excludes mobile sessions and refresh history. Access/refresh hashes, installation IDs, token families and original profiles do not enter the recovery unit. The format and manifest remain unchanged. Restored identities remain exact disabled credential-free stubs, web sessions remain empty, and both mobile authentication relations remain absent. Deferred receipt validation checks that absence again at COMMIT, including when an empty table pair appears after the final application check.

Credential quarantine does not promise protection against an administrator who can rewrite arbitrary schema, accounts and application code. Supported APIs do not recreate account authority or provide resume. The same-target recovery diagnostic verifies quarantine and grants no web or mobile login authority.

Frozen v1 sources, the v2 financial engine/command/replay implementation, the existing financial backup manifest and canonical marketplace repository remain unchanged, as verified by the retained hashes for frozen v1 files and byte comparisons against the baseline. Full buyer principal, separate fees, existing eligibility and business fingerprints retain their contracts. No new lifecycle operation or external delivery was added.

## Launch decision and next work

**This is a verified private development milestone. It is not a live launch or a declaration of complete production readiness.** The development branch remains disabled for automatic Vercel deployment, and the connected deployment query recorded zero deployments for that branch. No merge to `main`, production migration, real keys/signing, provider activation or live funds movement was performed.

The bounded cohort still requires one clean, already reserved nonterminal trade globally and the only active reservation on its listing, with an existing supported amount correction and no unfinished payout. The temporary integration limit does not change the marketplace's general three-active-trades-per-seller policy.

Remaining work includes initial trade acceptance and the later proposal/payment/cancellation/dispute/release/completion lifecycle; actual web/mobile routes and account/trade interfaces; deduplicated external event delivery; real custody and independent chain/payment evidence; production permissions and capacity; authenticated/encrypted recovery retention, authority re-entry, source fencing and controlled resume; independent security and operational review. Live release still requires the user's separate launch decision.

See the [mobile authority design](marketplace-mobile-auth-design.md), [coordinator design](marketplace-coordinator-design.md), [recovery runbook](recovery-runbook.md) and [launch readiness](launch-readiness.md) for the supported private APIs and remaining gates.
