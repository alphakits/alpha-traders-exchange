# Authenticated cancellation and combined recovery: exact-source verification

Date: **6 November 2026, Asia/Jerusalem**. Verification completed at **2026-11-05T23:06:24Z / 2026-11-06 01:06:24 IST**. Decision: **this development integration milestone passed. Alpha Wallet is not ready for live funds or production deployment.**

Verified implementation: [`3122fdbf38f5149fa4f85c73e9fd82ad4d603d2e`](https://github.com/alphakits/alpha-traders-exchange/commit/3122fdbf38f5149fa4f85c73e9fd82ad4d603d2e), tree `439689dd28e18f21e3980c582362ce9560e4bf78`, on `feature/alpha-wallet-dev-20261104`. The saved predecessor checkpoint is `c46ef1d35e6ddf0c002c4bb257449c77af8c0377`; the previous verified implementation is `73970284b87fdce6d1daf97b6b3ebefa757825f3`.

The [GitHub Actions run](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42125265166) and [verification job](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42125265166/job/127587701636) passed on attempt **1**. The [machine-readable report](cancellation-marketplace-verification-results.json) binds the exact source/tree, complete case inventories, native results, downloaded artifact and job-log digests, original contract hashes and new source hashes. Later documentation changes do not change the tested implementation.

## Executed results

| Gate | Result | Scope |
| --- | ---: | --- |
| Wallet tests | **2,217 / 61 files** | Financial, storage, current authority, canonical coordination and recovery |
| Platform authentication | **87 / 5 files** | Retained session source, expiry, device and enforcement contracts |
| Marketplace/storage regressions | **100 / 4 files** | Repository, transaction recovery, storage and completed-trade history |
| **Total** | **2,404 / 70 files** | **Zero failures and zero skips** |
| Root TypeScript | Passed | Existing root configuration; no emit |
| Native PostgreSQL | **15 drills / 166 checks** | PostgreSQL **17.11** |
| Chromium | Passed | **149.0.7827.55**, English 1,440-pixel desktop and Arabic RTL 390-pixel mobile |
| Offline simulation | Passed | Full principal delivery, separate fees and conservative uncertain-payout behavior |

Comparison of the downloaded current and preceding CI case inventories proves that **all 2,045 previous wallet cases remain**, with **172 new cases**. All 87 authentication and 100 marketplace/storage cases remain too. The comparison uses repository-relative file path plus full test name as a multiset, rather than inferring retention from aggregate counts. All 13 previous native drills and their 139 checks were retained. Every native stderr file and the root TypeScript log is empty.

### Added test files

| File | Passed cases |
| --- | ---: |
| `cancellation-marketplace-attempt.test.ts` | 2 |
| `cancellation-marketplace-auth.test.ts` | 40 |
| `cancellation-marketplace-backup-manifest.test.ts` | 44 |
| `cancellation-marketplace-backup.test.ts` | 25 |
| `cancellation-marketplace-coordination-store.test.ts` | 14 |
| `cancellation-marketplace-coordinator.test.ts` | 28 |
| `cancellation-marketplace-transaction.test.ts` | 19 |
| **Total new cases** | **172** |

The final source was frozen before the clean CI run. Local focused tests and review identified integration defects before saving; the result reported here comes from the complete clean checkout of the source above.

## One complete, authenticated cancellation

The [successor design](cancellation-marketplace-coordinator-design.md) introduces `alpha_wallet_cancellation_marketplace_simulation`, profile `canonical-initial-cancellation-cohort-v1`, for one original accepted initial mapping. Current stored owner authority must explicitly upgrade that mapping. Cancellation does not migrate a database implicitly. The original activation, acceptance, publication and entire financial history remain immutable evidence.

The upgrade, separate financial migration, V4 continuation, SQL hook transition and immutable transition record share one SERIALIZABLE transaction. A preparation-only attempt cannot leave an empty half-installed profile, and a financial continuation cannot commit without its corresponding transition. Upgrade physically versions the mapped request and listing without changing their data, increments runtime version exactly once and preserves runtime chronology. An inherited pause remains effective.

After explicit upgrade, a currently valid retained buyer or seller may cancel an unpaused, unexpired ordinary Bank Transfer or Face-to-Face trade within the unchanged initial scope. Bank-details disclosure blocks buyer cancellation; the seller may still cancel an otherwise supported unpaid trade. The coordinator derives the actor, original accepted terms, principal, wallet accounts, checkpoint, canonical digests and clock. Its public input cannot substitute a different amount, destination or identity. Current valid web and mobile credentials use the same business identity and coupled financial operation.

The standard native fixture returns **200 USDT from the trade reservation to the same listing**, changing listing/trade balances from **300/200 to 500/0**. Canonical listing inventory is validated and preserved; it is not incremented a second time. No cancellation payout, withdrawal, new commission or provider submission is created.

The cancellation commit cancels the request and physical trade, unlocks the listing, clears the relevant reminder state, archives matching buyer reminders, retains trust-reconciliation intent and appends the deterministic timeline event, two party notifications and listing-reopened audit. The reused planner retains its conditional proposal-withdrawal rule, but initial admission excludes a pending terms proposal and this successor fences later proposals; this milestone does not demonstrate a reachable proposal-withdrawal flow. The original financial cancellation receipt, immutable cross-system receipt and safe publication intent commit with those effects.

One acceptance has one cancellation identity. A retry by the same currently authenticated party recovers the original receipt, even with a new transport operation ID, across web/mobile, or after owner pause. The other party cannot adopt the original actor's cancellation identity. Revoked, expired or disabled-account credentials cannot recover a receipt through the authenticated API. A manually changed canonical status is never proof that a financial return occurred.

## Authority, original ownership and independent SQL

The fixed stored readers retain enabled-account, email/phone/adult, session, device and current app-version rules. Cancellation-specific policy checks actual participation in the retained trade; it does not require the ability to start a new sale or purchase. Suspended/rejected selling eligibility or absent new-purchase capability therefore does not strand an otherwise valid party's existing cancellation. A disabled account still fails. An unrelated owner cannot force-cancel; owner membership can be supplementary to another primary role.

Request, global canonical, runtime and listing fences precede stored authentication and wallet-head access. Authority is rechecked after awaited work and at the final transaction boundary. The store retries serialization failures using the complete decision. This does not claim that an already ordered, authorized transaction is cancelled by a revocation queued behind it.

The entire attempt uses one SQL handle bound to its earliest physical transaction certificate. Nested canonical, authentication, ledger and recovery components cannot independently adopt a replacement transaction. Two real transaction-replacement tests at coordinator handoffs and two at web/mobile recovery handoffs perform `ROLLBACK` and `BEGIN`, verify changed physical IDs, require refusal, and prove the replacement stays usable with no misplaced abort. Caught failures still abort prior companion work in the matching original transaction.

SQL reconstructs the exact permitted canonical delta from actual retained rows, original accepted terms, actor relationship, command and cancellation clock. It independently validates normalized columns and payloads, full-principal financial linkage, notification/archive effects, audit and safe publication. Deferred checks require the whole result at commit. Tests change a real persistence amount, listing inventory and trade creation time after the financial return and verify complete rollback; an independent corruption check also detects a missing committed cancellation notification.

Old initial/correction writer paths, standalone V4 access and old combined exporters cannot reinterpret the new profile. Original V1/V2/V3 implementations and all **75 frozen recorded source/schema/manifest files** remain byte-for-byte unchanged. The frozen V3 fixture bytes were not regenerated. The repository change adds a separate participant; existing standalone participant behavior remains intact.

The complete private canonical basis is hashed for the decision but not embedded into immutable financial/recovery evidence. Stored cancellation evidence contains only the target rows, matching reminders and historical actor role. Public receipts, inspection and publication are explicit safe data objects. The publication contains stable identifiers and receipt/event references; it is a durable intent, with **zero external deliveries**.

## Native PostgreSQL evidence

| Drill | Checks |
| --- | ---: |
| Independent-process concurrency | 6 |
| Standalone backup and paused restore | 6 |
| Canonical transaction groundwork | 6 |
| V2 continuation and recovery | 9 |
| Amount-correction coordination and writer/authentication races | 16 |
| Correction-cohort combined recovery | 11 |
| Mobile authority and cross-transport recovery | 12 |
| Initial canonical acceptance groundwork | 9 |
| V3 reservation and isolated recovery | 11 |
| Authenticated initial coordinator | 15 |
| Initial combined recovery | 16 |
| Isolated V4 cancellation and recovery | 11 |
| Canonical prepayment cancellation groundwork | 11 |
| **New authenticated cancellation successor** | 12 |
| **New cancellation combined recovery** | 15 |
| **Total** | **166** |

The new authenticated drill verifies both failure after actual successor/V4 migration work and a late failure before publication. Neither can leave a partial continuation, financial return, canonical cancellation or receipt. A lost response is injected after an actual COMMIT; valid mobile authority then recovers the original web cancellation with exactly one return and publication.

Two distinct web/mobile PostgreSQL backends contend for the same cancellation decision, and the observer sees the second waiting. That caller retries the entire transaction and recovers the original result. A direct legacy payment writer also visibly waits and is refused without changing the committed cancellation. In a separate database, account revocation wins the runtime fence first; the stale cancellation waits, retries under current authority, and returns no principal. The disabled account cannot bypass refusal through mobile credentials.

All sources in the two new native drills end paused. Opening a new PostgreSQL connection reconstructs the exact original paused state. These are disposable databases, synthetic identities and synthetic funds. Response loss follows a real COMMIT but is injected; it is not an actual network partition. Reopening a connection is not a process restart or production failover drill.

## Complete successor recovery

The new combined envelope is `alpha-wallet-cancellation-marketplace-simulation-backup`, format 1, with nested format-4 scope `cancellation-marketplace-v4-ledger`. It retains complete supported canonical rows, original initial activation/acceptance/publication, successor transition/cancellation/publication, all four financial command versions and all three continuations.

Export requires a durably paused source and current stored owner authority through either web or mobile. It supports an already-cancelled source and an accepted source whose V3 pause survives the V4 upgrade. Validation checks semantic relationships even when an attacker recomputes checksums: original accepted history, frozen listing/sibling basis, exact cancellation results, publication, row closure and source checkpoint must agree. Ordinary persisted JSON, timestamp precision, large integer strings and binary evidence representation retain their exact meanings.

Fresh-target restore acquires its claim, replays original commands through their original APIs, appends one new V4 quarantine pause, restores canonical and immutable evidence, installs successor guards and completes an immutable recovery receipt in one transaction. Five physical SQL rollback stages prove that incomplete restore work cannot claim the target. The completion receipt binds source/restored checkpoints and canonical, predecessor and successor digests.

The cancelled native source at revision **10** restores at **11**, retaining one cancellation with listing/trade balances **500/0 USDT**. The accepted inherited-pause BSC source at revision **9** restores at **10**, retaining **300 available / 200 reserved USDT** at eighteen-decimal precision and zero cancellations.

Two native backends visibly contend on one fresh-target advisory lock. Exactly one restore commits; the other cannot overwrite it. After actual COMMIT with injected acknowledgement loss, same-target inspection verifies the original history and the one appended quarantine. Both original sources remain paused and unchanged.

Restored identities are disabled, credential-free stubs. Web sessions, mobile authentication tables and historical transaction registrations are excluded. The target seals new commands, canonical writes, credential injection, authority re-entry and resume. Recovery cannot activate a second copy. A checksum demonstrates consistency; it does not authenticate a source or restore signing/account authority. The [recovery runbook](recovery-runbook.md) separates this format from all old formats.

## Retained browser and offline scope

The Chromium rehearsal passed in English desktop and Arabic RTL mobile with no console errors and no horizontal mobile overflow. Its existing fixture verifies full funding, independent owner approval, 200/300 partial reservations, separate buyer/verifier/seller/worker actions, uncertain provider-response recovery and separate fees. It delivers 500 USDT of synthetic principal with 10 USDT of separately funded commission. Interrupted HTTP responses retain the same operation across reload.

Those six screenshots and browser results belong to the retained standalone synthetic interface. They do not exercise a new cancellation product route, production marketplace flow or native mobile application. This milestone supplies private coordinator and recovery APIs; actual account/trade/receipt screen integration remains separate work.

## Artifact provenance and reproduction

- Verified commit: `3122fdbf38f5149fa4f85c73e9fd82ad4d603d2e`; tree: `439689dd28e18f21e3980c582362ce9560e4bf78`.
- Workflow run: `42125265166`, attempt `1`; job: `127587701636`.
- Artifact: `13461137044`, named `alpha-wallet-simulation-evidence-3122fdbf38f5149fa4f85c73e9fd82ad4d603d2e`.
- Downloaded ZIP: **2,084,865 bytes**, SHA-256 `42c2505ad0466c181aa0d28c3fdfa62afe838a85a899037492b312575c0ef2a1`, matching GitHub's artifact digest.
- Extracted evidence: **48 files**, each with byte count and SHA-256 in the machine report.
- Decoded job log: **488,568 UTF-8 bytes**, SHA-256 `165995640d1da308a177f8bf0a8030d3a6bb6eca3c581915005ea9596269314e`.
- Runtime: Node **24.22.1**, locked dependencies, UTC and disposable PostgreSQL **17.11**.

Reproduce the development-branch workflow at that exact source. It clean-installs the lockfile, runs the complete wallet/authentication/marketplace suites and root TypeScript, executes all 15 native drills against explicitly fresh loopback databases, and runs the retained Chromium rehearsal. Case retention and source-file hashes are in the machine report. Root TypeScript retains its existing excluded native-mobile and test paths; this gate is not a full production or native-mobile build.

## Readiness and next integration

**Trust Wallet remains the selected receiving-wallet preference.** No real receiving address, private key, provider account or chain-connected signer/testnet environment was created or connected. This internal listing-principal return performs no Trust Wallet transaction. The [custody decision](custody-decision.md) and [chain adapter contract](chain-adapter-contract.md) retain the reviewed receiving and automation requirements.

The bounded authenticated cancellation successor and its complete recovery are now implemented and verified. The supported profile still fences payment claims, evidence/dispute progress, release, settlement, expiry handling, later proposals and competing reservations. Their explicit financial/canonical participants and matching migration/recovery contracts are the next engineering slice, followed by actual web/mobile product integration and deduplicated delivery.

Live readiness additionally needs trusted bank/cash evidence and exception policy, exact network/token/address configuration, signer/testnet submission and recovery evidence, step-up and spend limits, production roles/migrations, authenticated encrypted retention, source leadership/fencing, controlled authority re-entry, monitoring, realistic load/recovery exercises and independent security review. The [launch checklist](launch-readiness.md) and [current checkpoint](development-checkpoint-2026-11-05.md) record these boundaries. No main merge, production migration/deployment, real signing or transfer occurred.
