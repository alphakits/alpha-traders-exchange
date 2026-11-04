# Frozen Alpha Wallet v1 evidence

These synthetic fixtures were captured on 4 November 2026 from verified source commit `f3422f9267562522da93285193d21dc604f8f40e` (tree `488e5c2dd1b431ca516cabe8a86a7f92eea0f0a7`). The checkout was documentation-only successor `dfe8f1a`; capture checked that the ten engine/storage/schema source files were byte-identical to the verified commit before executing anything.

`settlement-and-held-withdrawal.backup.json` is an actual logical export of 41 commands committed to a temporary, explicitly created PGlite wallet. The deterministic clock starts at 12:00:00 UTC and advances one second per command. `settlement-and-held-withdrawal.state.json` preserves the final tagged state, including original field absence, exact integers, collection ordering and idempotency results. `provenance.json` records source and fixture SHA-256 values and the original checkpoint.

The history includes pending/final/duplicate funding, independent owner approval, 200 + 300 reservations, a settled 200-USDT trade with separately funded fees, and a retained 300-USDT reservation. A BSC trade freezes six-decimal fee rounding on eighteen-decimal token units. A large BSC withdrawal beyond JavaScript's safe integer range remains `submission_unknown`, with one raw unit left available.

`v1-compatibility.test.ts` reads these fixed files. It never regenerates expected history or hashes. It verifies semantic replay, exact state, restoration/reopening of the original rows before pause, original idempotent business results and refusal to replay a historical dispatch instruction. A provider lookup returning no result still permits no replacement submission.

Do not regenerate these fixtures to make an altered engine pass. Preserve the v1 parser/semantics and add separately reviewed fixtures for a new engine or explicit continuation boundary. No real identities, chain/provider calls, signing keys or funds were used. This is bounded compatibility evidence, not exhaustive v1 coverage or a completed migration design.
