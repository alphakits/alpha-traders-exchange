# Alpha Wallet development checkpoint

Updated: **6 November 2026, Asia/Jerusalem**. Exact-source verification completed `2026-11-05T23:06:24Z`.

**Development continues. Live launch remains off.** Authenticated initial-trade cancellation and its complete combined recovery are implemented and saved. The clean CI gate passed **2,404 tests across 70 files**, zero failures/skips; **15 native PostgreSQL drills / 166 checks**, root TypeScript, offline simulation and retained English/Arabic Chromium rehearsal. See the [verification report](cancellation-marketplace-verification-2026-11-06.md) and [machine-readable evidence](cancellation-marketplace-verification-results.json).

## Authorization and source

The user authorized continued implementation, isolated testing and saving the development branch, and selected Trust Wallet as the receiving-wallet direction. Routine engineering choices do not need another questionnaire. No main merge, production migration/deployment, real signing/funding/transfers, provider purchases or external messages are authorized by that development instruction. The historical `PAUSED-*` files do not instruct development to wait.

Repository: `alphakits/alpha-traders-exchange`. Branch: `feature/alpha-wallet-dev-20261104`.

| Evidence | Exact source and status |
| --- | --- |
| Verified implementation | `3122fdbf38f5149fa4f85c73e9fd82ad4d603d2e`; tree `439689dd28e18f21e3980c582362ce9560e4bf78` |
| Clean CI | [Run 42125265166](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42125265166), job `127587701636`, attempt 1; success at `2026-11-05T23:06:24Z` |
| Full suite | 2,217 wallet / 61 files; 87 authentication / 5 files; 100 marketplace / 4 files; zero failures/skips |
| Retention | All 2,045 previous wallet cases plus 172 new; all 13 old native drills/139 checks retained; 75 frozen source contracts unchanged |
| Previous verified source | `73970284b87fdce6d1daf97b6b3ebefa757825f3`, [2,232-test V4/canonical groundwork](prepayment-cancellation-verification-2026-11-06.md) |
| Earlier complete initial recovery | `2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`, [1,913-test initial recovery](initial-marketplace-recovery-verification-2026-11-05.md) |

Downloaded artifact `13461137044` matches GitHub's ZIP SHA-256 `42c2505ad0466c181aa0d28c3fdfa62afe838a85a899037492b312575c0ef2a1`. The machine report records all 48 extracted file digests, the decoded job-log digest, complete native results and case inventories. Later documentation commits leave this tested source unchanged.

## Completed integration

- **Explicit successor admission.** `alpha_wallet_cancellation_marketplace_simulation`, profile `canonical-initial-cancellation-cohort-v1`, upgrades exactly one original accepted initial mapping under current owner authority. Original activation/acceptance/publication and V1–V3 history remain immutable. Empty preparation, incomplete migration and missing transition cannot commit. Inherited pause survives.
- **Current stored authority.** Fixed web/mobile readers verify current accounts, sessions, devices and expiry. Actual retained buyer/seller participation supplies cancellation authority independently of new-sale capability. Disabled accounts fail; an unrelated owner cannot cancel. All components share the earliest physical transaction certificate.
- **One coupled cancellation.** Exact accepted terms, canonical evidence, financial checkpoint and original receipt determine one full-principal return to the original listing. Standard balances change from 300/200 to 500/0. Canonical effects, financial/cross-system receipts and safe publication commit together; public inputs cannot choose identity, amount or destination.
- **Original receipt recovery.** Current valid same-party retries recover the original receipt across web/mobile and after pause. Revoked credentials and changed actor identities fail. Late errors roll back the entire effect. SQL reconstructs the exact canonical result and independently checks notifications, archives, audit and publication.
- **Complete combined recovery.** Paused accepted/cancelled sources export canonical rows, predecessor/successor evidence and all four financial histories together. Fresh-target restore adds one quarantine pause, restores disabled credential-free identities, seals further writes and supports same-target uncertain-COMMIT inspection. Source and target remain paused; no credentials, delivery, re-entry or resume are restored.
- **Native proof.** Separate backends visibly contend; cancellation retries for the original receipt, legacy payment writes refuse, and prior account revocation prevents a return. Five restore rollback stages, committed-response loss and competing fresh-target restores pass. These are synthetic disposable fixtures.

The [successor design](cancellation-marketplace-coordinator-design.md) and [recovery runbook](recovery-runbook.md) describe the implementation. Original correction/initial/standalone APIs and recovery formats retain their meanings. Standalone V4 still refuses coordinated state. A raw canonical `cancelled` flag is never financial receipt authority.

## Exact next engineering slice

Implement an explicit **payment/dispute lifecycle successor** for the accepted mapped trade before connecting a complete public product flow. Begin with the frozen V4/coordinator history and independent predecessor fixtures; do not widen an old reducer or profile silently.

1. Define supported buyer payment claims, exact evidence linkage, dispute holds and their ordering against cancellation, disclosure, expiry and revocation. Claims do not authorize release or move principal.
2. Specify the required financial continuation/canonical profile, admission proof, immutable receipts and complete migration/recovery contract. The cancellation-only profile currently fences those later writes intentionally.
3. Implement current stored participant authority, one owned transaction, independent SQL completeness, safe publication and cross-transport original receipt recovery for each supported transition.
4. Prove native competing/direct-writer and revocation races, late rollback and uncertain-COMMIT recovery; retain every old case and frozen receipt/fixture meaning.
5. Add actual web/mobile account/trade/receipt flows and deduplicated delivery only against complete private lifecycle contracts. The retained browser rehearsal currently covers the standalone synthetic UI.

Release/settlement requires trusted bank/cash evidence and actual seller authorization, with full principal and separate fees. Owner force-cancel, expired inventory handling, later proposals and competing reservations need explicit contracts too. Broader reservations require complete canonical/wallet request, buyer, asset, destination and quote identity coverage; matching totals alone is insufficient.

## Receiving direction and launch gates

**Trust Wallet remains selected.** No real receiving address, wallet key, provider account or chain-connected signer/testnet environment is connected. An internal cancellation return does not send money to Trust Wallet. TWAK remains a candidate automation component whose send-once/recovery suitability requires evidence. Continue deterministic accounting and read-only adapter work independently of signing; see [custody-decision.md](custody-decision.md) and [chain-adapter-contract.md](chain-adapter-contract.md).

Live launch additionally needs complete actual product integration, trusted fiat evidence and exceptions, exact network/token/address configuration, signer/testnet recovery evidence, step-up/spend limits, production SQL roles/migrations, authenticated encrypted retention, source leadership/fencing, controlled authority re-entry, monitoring, realistic load/recovery exercises and independent review. The [launch checklist](launch-readiness.md) remains the gate record. Complete a concrete release and its evidence before asking for launch authorization.

## Working constraints

Use Node 24.22.1, the locked dependencies, UTC and disposable loopback PostgreSQL 17 fixtures. Branch auto-deployment remains disabled. Never merge/deploy or connect real funds as a consequence of a green development gate. Preserve unrelated untracked `e2e/cardless-counter-offer.spec.ts`; it is outside this work. The local `node_modules` is a shared workspace symlink, so do not run local `npm ci`; the clean CI checkout installs the lockfile. Root TypeScript retains its existing native-mobile/test exclusions; no production or native-mobile build or independent audit is implied.
