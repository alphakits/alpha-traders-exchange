# Alpha Wallet development checkpoint

Updated: **5 November 2026, Asia/Jerusalem**, after the initial combined recovery gate passed.

## Active follow-on work

The owner's follow-up selects Trust Wallet as the receiving-wallet preference and asks development to continue without requiring them to choose routine technical details. [Custody direction](custody-decision.md) now records that choice and current official automation capabilities. No actual wallet, key, signer, account or receiving address has been created.

The [prepayment cancellation groundwork](prepayment-cancellation-design.md) is implemented and undergoing its own exact-source verification: frozen V3 evidence; strict V4 continuation/cancellation/pause; exact principal return and immutable receipt; guarded isolated SQL/storage/backup; and a separate canonical transaction participant preserving ordinary cancellation policy. **The existing initial coordinator/profile and its recovery format remain unchanged.** They still refuse cancellation and V4 standalone access. The next integration must add a successor authenticated coordinator, its writer fences and complete combined recovery; do not bypass the original guards or present synthetic companion-pause evidence as financial integration.

The prior verified source and evidence below remain the baseline until that new gate is recorded.

## Authorization and saved source

The user explicitly resumed development with: “continue working on alpha wallet till 100% ready lets goo”. Continued implementation, isolated testing and saving the wallet development branch remain authorized. This does not authorize a main merge, production deployment/migration, mainnet funding/signing or a real transfer. Do not send external messages or select/create a custody account on the user's behalf without the corresponding instruction.

Branch: `feature/alpha-wallet-dev-20261104` in `alphakits/alpha-traders-exchange`.

Verified application/SQL/workflow source: **`2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`**, tree **`bcafe92cea246f709987643d6213b2347ed73e41`**. Subsequent documentation records its verification; use the source hash when reproducing the gate. The two `PAUSED-*` documents remain historical and no longer instruct development to wait.

Latest evidence: [human report](initial-marketplace-recovery-verification-2026-11-05.md), [machine-readable report](initial-marketplace-recovery-verification-results.json), and [successful CI run 42108670720](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42108670720).

## Completed and verified

The distinct initial-cohort recovery format preserves an explicitly activated, paused source before or after its one original seller acceptance. It captures the original activation basis, all v1/v2/v3 commands, canonical rows, binding/receipt, deterministic events and publication. Current owners export through fixed stored web/mobile credentials. Atomic restore requires a fresh target, preserves the complete original unit, appends one pause, disables identities and restores no sessions or mobile authentication relations. Same-target inspection reconciles a lost COMMIT acknowledgement without overwriting history or creating an active copy.

The addition also fixes certified transaction cleanup and mutable registration/input capture in the older recovery/coordination paths. It leaves the original financial reducers, v1/v2/v3 migration contracts and frozen fixture bytes unchanged.

The exact-source gate passed **1,913 tests across 56 files** with zero failures/skips: **1,726 wallet**, **87 platform authentication**, and **100 marketplace/storage**. All **1,592 earlier wallet cases** remain, with **134 new cases**. Root TypeScript, all **eleven native PostgreSQL drills / 117 checks**, the offline demo and retained English desktop/Arabic mobile Chromium rehearsal passed. The new native drill contributes sixteen checks, including one successful restore and one rejection on two actual PostgreSQL backends. Both sources and both targets finish paused, preserving all 500 USDT of simulated principal and restoring no credentials.

The [design](initial-marketplace-recovery-design.md) and [runbook](recovery-runbook.md#initial-canonical-cohort-inspect-pause-export-and-restore) define the supported APIs and limits. Do not weaken old recovery formats or relabel their scopes to accept the new namespace.

## Exact next implementation

The integrated initial flow still exposes only owner activation/inspection/pause and seller acceptance. Its v3 command schema admits only `continueFromV2`, `acceptInitialSellerRequest` and `pause`. V3 invariants require initial trades to remain at their original reservation. The older isolated simulator's paid/cancel/dispute/release/payout actions are reference behavior, not an integrated initial lifecycle.

The next bounded financial slice is **prepayment cancellation for the existing single mapped initial trade**, through an explicit new continuation and coordination/recovery profile:

1. Freeze and test existing v3 history; preserve all original commands/results/state/event hashes and original acceptance receipts. New lifecycle semantics must not reinterpret v3.
2. Define strict cancellation business identity, exact principal return and immutable receipt. Return the full reserved principal; never infer a monetary refund from a manual canonical status change.
3. Extract a complete transaction-owned canonical cancellation participant using the real marketplace policy. Current status alone is insufficient: historical payment/release markers, stored/embedded evidence and disputes must be considered. Buyer-visible bank details block buyer cancellation separately from the seller's unpaid-cancellation rule. Preserve cancellation-specific participant authority, pending proposal withdrawal, listing expiry/unlock behavior and required durable trust effects. Exclude manual owner force-cancel from automatic custody release.
4. Couple current stored web/mobile authentication, canonical decision/write, financial command, immutable receipt and safe publication in one certified SERIALIZABLE transaction. Recheck authority after awaited work. Preserve original receipt recovery without granting fresh dispatch or cancellation authority.
5. Define SQL writer fences and complete recovery for the new version/profile before calling the slice complete. Existing isolated and combined formats must continue rejecting unsupported state.
6. Prove rollback and native cancellation races against payment claims, evidence, bank disclosure, disputes, expiry, revocation, retry and unknown COMMIT. Retain the entire current test inventory and all old financial/recovery semantics.

Relevant source: `src/lib/alpha-wallet/v3-commands.ts`, `v3-engine.ts`, `v3-durable.ts`, `initial-marketplace-coordinator.ts`, `initial-marketplace-coordination-store.ts`; `src/lib/trade-cancellation.ts`; `src/lib/alpha-exchange-store.ts` cancellation validation and commit-time rechecks; `src/lib/alpha-exchange-repository.ts` transaction participant patterns.

Buyer payment claims and dispute freezes can follow through their own explicit participants. Before widening to competing reservations, add complete canonical-to-wallet and wallet-to-canonical identity coverage. Equal aggregate amounts do not establish request, buyer, destination, price or asset ownership. Any persisted coverage registry needs its own schema and recovery compatibility; adding a table silently to the current exact-profile namespace is not backward compatible.

## Decisions and launch gates still open

Simulation development can continue without a custody provider. A truthful live-readiness conclusion still requires owner/account decisions about custody and key control, an eligible isolated provider test environment, supported real assets/networks and owned addresses, transaction approval/recovery ownership, and trusted bank/cash evidence with an exception policy. The reviewable custody directions are in [custody-decision.md](custody-decision.md); no provider, commercial plan, account or key has been selected.

The remaining engineering includes the integrated lifecycle, real web/mobile product boundary, step-up and limits, deduplicated delivery, provider/testnet drills, production permissions and migrations, authenticated/encrypted retention, cross-instance fencing and external reconciliation, controlled resume, monitoring, realistic load/checkpoint design and independent security review. The [launch-readiness checklist](launch-readiness.md) remains authoritative about these open gates. No percentage or green development test count substitutes for them.

## Reproduction boundaries

- Use Node `24.22.1` and the locked dependencies. The CI workflow creates only disposable PostgreSQL 17 fixtures and a local Chromium rehearsal; branch auto-deployment remains disabled in `vercel.json`.
- Use fixed UTC source/target database sessions. Accepted names are `UTC`, `Etc/UTC`, `GMT`, `Etc/GMT` and `Etc/GMT0`. A different timezone does not justify rewriting an original activation basis.
- The initial backup limit is 999 source commands, leaving room for the mandatory new pause; bytes/row limits and exact schema compatibility are also enforced.
- Preserve source financial history and pause. Internal inspection contexts and lock versions may advance. No source-leadership lease or authority re-entry exists.
- Guard coverage includes late canonical row writes and ordinary deferred detection of late mobile-authentication tables. Hostile privileged DDL after deliberately draining every deferred event is outside the protocol. Production role design remains open.
- The recovery format verifies known wallet history/projections and exact canonical/coordination table shapes, not every arbitrary object under the wallet namespace. It is not a general database dump.
- CI's browser check is the standalone synthetic English/Arabic rehearsal. Root TypeScript excludes the native mobile workspace and three existing test paths. No full production build, native mobile build or independent security audit is implied.
