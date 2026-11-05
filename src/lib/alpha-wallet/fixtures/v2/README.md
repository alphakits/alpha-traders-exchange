# Frozen Alpha Wallet v2 history

These synthetic fixtures were captured on 5 November 2026 from verified source commit `47f0fc18f33c0f307da53726281db18055a76855` (tree `eea3bee815707d3fc62a0d68c69d301bad0ab079`). The checkout was documentation-only successor `6dc63a8997532759727bd8b6691a780d373b6276`. Capture compared all 33 source paths listed in `provenance.json` byte-for-byte with the verified Git objects before opening a database.

`corrections-and-settlement.backup.json` is an actual logical export of 41 commands committed through the existing durable APIs into one fresh temporary PGlite wallet. The fixed clock starts at 12:00:00 UTC and advances one second per command. `corrections-and-settlement.state.json` preserves the resulting complete tagged state, including exact integer units, original field absence, collection order, idempotency records, terms bindings and acceptance receipts. `provenance.json` records the source hashes, file hashes, original checkpoints and correction receipts.

## Recorded history

| Revisions | Recorded behavior |
| --- | --- |
| 1–15 | Original v1 funding, two approved listings, buyer-authored reservations and a 25-USDT withdrawal whose one dispatch remains `submission_unknown` |
| 16 | Explicit operator-authorized v1 → v2 continuation bound to the original checkpoint |
| 17–19 | Operator enrollment of the existing TRON reservation; buyer accepts an increase from 200 to 300 USDT and then a decrease to 250 USDT |
| 20–21 | Operator enrollment of a separate BSC reservation; buyer accepts the same 1.00005-USDT amount with no principal journal |
| 22–31 | Full 250-USDT TRON delivery followed by separate 5-USDT commission funding and recognition |
| 32–41 | Full 1.00005-USDT BSC delivery, preserving six-decimal fee rounding on eighteen-decimal token units, followed by separate 0.020002-USDT commission funding |

The increase and decrease consume the existing two-proposal allowance on the TRON trade. The zero-delta correction belongs to the second trade and does not create a third proposal for the first. Enrollments and the continuation move no principal. Both settled payouts retain one dispatch; the earlier withdrawal deliberately remains unresolved.

The final TRON custody is 355 USDT: 250 listing inventory, 75 seller availability, 25 held for the unresolved withdrawal and 5 separately funded platform revenue. The buyer received the full 250-USDT principal. BSC listing inventory is 8.99995 USDT and separately funded revenue is 0.020002 USDT; its buyer received the full 1.00005-USDT principal.

## Compatibility boundary

`v2-history-compatibility.test.ts` reads these fixed files. It never runs the capture script or regenerates expected hashes. It pins the complete original provenance and fixture bytes, and checks that the 21 financial engine, command and contract source files retain their captured bytes. All 33 hashes in `provenance.json` describe the source used at capture time; they are historical evidence, not a requirement to keep transport durability wrappers permanently unchanged. Transport hardening may evolve under historical replay tests. In particular, rejecting a runtime guard failure must also prevent a transaction from committing when its caller catches the error and restores the environment.

The tests verify mixed-engine replay, the exact saved state, increase/decrease/zero-delta receipts, separate fees, restore and reopen, original idempotent results and suppression of historical dispatch authority. They also refuse seller/operator reinterpretation of the buyer-authored `reserveTrade` command and reject unimplemented future command envelopes. Neither transport changes nor future engine work may rewrite the recorded capture hashes, original command identities, results, times or checkpoints.

The capture script is retained at `scripts/alpha-wallet/capture-v2-history-fixture.ts` for provenance review. It requires an explicit capture argument, refuses to overwrite these files and refuses any changed source among the pinned paths. Do not remove these checks or regenerate the fixtures to make a modified engine pass. A new financial authority contract requires a separately reviewed command/engine version and its own storage and recovery contract.

This fixture exercises the standalone v2 ledger, which permits the two explicit fixture enrollments. It does not activate the separate single-cohort canonical marketplace coordinator, authenticate platform users, establish initial seller acceptance, invoke a provider, sign a transaction or move live funds. The canonical request snapshots supplied by `createV2TermsFixture` are explicit synthetic planner inputs, not independent evidence of customer consent. No usable web/mobile credentials are present.
