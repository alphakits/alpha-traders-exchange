# Private development marketplace coordinator

Date: 5 November 2026 (Asia/Jerusalem). **Simulation only; no deployment or production migration.**

This milestone connects the actual focused marketplace SQL participant to the separately versioned wallet ledger. An authenticated buyer can accept an existing seller amount-correction proposal, and the canonical request, wallet principal adjustment, immutable receipt and publication intent commit together. The former production `updateTradeTerms` wrapper is not called or changed. There is no new public route, provider call, signer, worker registration or live cohort.

[Exact-source verification at `ecc3752`](marketplace-coordinator-verification-2026-11-05.md) passed 998 wallet/targeted platform tests, full-project TypeScript, five native PostgreSQL drills and the existing Chromium rehearsal. The coordinator's new native drill passed 16 checks, including both stale-authentication and legacy-writer races. The scope and recovery limits below remain in force.

## Deliberately bounded initial cohort

Enrollment is a separate, explicit owner operation. It requires an already accepted canonical request with an existing clean wallet reservation, the current ILS fee/calculation policies, and a valid pending `amount_correction` proposal at the locked request price. Bank Transfer and Face-to-Face are supported. Current canonical bank instructions are bound by a digest and remain private.

The target must be the only active canonical reservation on its listing and the only nonterminal wallet trade globally. No unfinished wallet payout may exist. Other pending, unreserved marketplace requests may exist on the listing, but their mutations become fenced too. This narrow development activation rule does not change the general wallet policy allowing three active trades for a seller. It prevents this milestone's global wallet fence from stranding another active test obligation.

Initial trade acceptance, subsequent proposal creation, counter-price negotiation, demand/buyer-offer quantity flows, Wise, cardless credentials, payment claims, cancellation, dispute changes, release, payout and completion are not connected. An enrolled fixture can accept its existing proposal, recover historical receipts, be inspected by the owner and be paused by the owner. It has no resume operation. Do not enroll a real marketplace record or describe this cohort as the complete wallet lifecycle.

## Typed entry points

`createDevelopmentMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock? })` owns each transaction through the supplied guarded development `WalletStore`. It does not initialize or upgrade a database. The separate explicit initializer installs `alpha_wallet_marketplace_simulation` only after verifying an existing v2 ledger with no prior terms enrollment.

| Operation | Caller supplies | Server derives and checks |
| --- | --- | --- |
| `enrollReservedTrade` | Web session token, canonical request ID, wallet listing/trade IDs, supported synthetic asset ID, transport operation ID | Stored owner authority; complete canonical listing inventory; pending proposal; existing funded/approved reservation; exact prior terms and immutable enrollment identity |
| `acceptAmountCorrection` | Web session token, canonical request/proposal IDs, expected binding revision, transport operation ID | Stored buyer authority and ownership; canonical proposal, amounts, price, fees, destination, payment locks and current wallet state; exact principal delta |
| `inspect` | Owner web session token and canonical request ID | Verified wallet replay/projections, current cohort terms and balances, pause status and safe marketplace status |
| `pause` | Owner web session token, canonical request ID and transport operation ID | Operator identity, the inherited typed pause command and its original historical result |

Inputs are strict: extra actor, authority, amount, fee or arbitrary command fields are rejected. A platform trade alias is not accepted in place of the canonical request ID. Public results expose a bounded set of IDs, revisions, hashes and exact amount strings. They omit receiving destinations, account numbers, bank snapshots, raw sessions, session hashes and private profiles. These server-only APIs are not HTTP routes and do not read ambient cookies or database URLs.

Unknown storage failures are sanitized after the transaction owner completes its retry handling. Driver query parameters and private error causes are not exposed. An unknown commit retains its dedicated error class/code with a sanitized cause; it still requires reconciliation of the original business identity.

## One transaction, including authentication

The outer guarded `WalletStore` exclusively owns `BEGIN`, whole-callback serialization/deadlock retry, `COMMIT`, rollback and connection release. The existing `mutateDevelopmentFocusedTradeInTransaction` participates without opening a second connection or nested transaction.

The order is the canonical request advisory lock, the existing global financial advisory lock, the physical `runtime_meta` row fence, the focused canonical read, fixed web authentication, a registered transaction context, then the wallet head/replay. A second inventory query checks that the seller-scoped read did not omit another request on the enrolled listing, and checks normalized identity columns against JSON payloads. A planner is not given an arbitrary client-provided marketplace snapshot.

The new web principal reader uses only the same `WalletSql`. It hashes the opaque session token with the application's SHA-256 convention and reads the actual `alpha_exchange.sessions` and `users` rows with `FOR SHARE`. It checks normalized fields against payload fields, exact stored session timestamps, expiry, disabled state, verified email, the existing verified-phone/exemption policy, recorded adult confirmation and role membership. Recorded adult confirmation remains self-attestation, not independent identity proof. This development reader neither repairs legacy accounts nor substitutes a cached or mobile principal.

Session and account locks last until the outer commit or rollback. A revocation that commits before the locked authentication read must invalidate the attempt; a transaction with an older SERIALIZABLE snapshot must retry the entire decision. A revocation queued after the accepted operation has acquired those locks is ordered after that operation. It does not retroactively cancel a transaction that won the locks. `assertFresh()` checks authority and expiry again after awaited work and after actual marketplace persistence, before the transaction callback returns. This is not a promise that the database's eventual COMMIT acknowledgement arrives before the wall-clock expiry.

Acceptance uses the trusted clock directly and requires it to be later than the canonical request's current update time and earlier than the session expiry. It does not advance wallet time to match a future timestamp supplied by a retained marketplace payload. This keeps an immediate typed owner pause available under the same valid clock.

## Canonical acceptance and exact accounting

The pure accepted-terms planner retains its existing current-policy checks: only a stored pending amount correction, no irreversible payment/evidence/dispute progress, no price change, at most two submitted proposals, full canonical inventory, unchanged destination and frozen payment instructions, and exact decimal/fee agreement with the contract and wallet quote.

The v2 command adjusts only the signed principal difference. A 200-to-300 USDT correction moves 100 USDT from listing inventory to the same trade reservation. For a listing funded with 500 USDT, the resulting allocations are 200 available and 300 reserved. The buyer still receives the full 300 principal when a future, separately implemented settlement path is authorized. The recorded buyer and seller fees are each 3 USDT; at ILS 3.20 the current inclusive fiat quote is ILS 969.60. No commission tolerance reduces the principal reserve.

In the same transaction, the canonical request receives the accepted exact terms and proposal resolution timestamp. One deterministic system message is prepended to `purchase_requests.payload.messages`; no nonexistent SQL chat table or legacy fallback collection is invented. The existing focused SQL encoders persist that request, one seller notification and one dedicated `trade_amount_correction_accepted` audit entry. Enrollment does not consume a proposal, and acceptance does not increment the submitted-proposal count.

`acceptances` records the exact wallet receipt, original command revision/key/event hash, authenticated actor and public business-input digest. `publications` records a deterministic, private publication intent with only safe IDs, participants, revisions and digests. Nothing sends an external message, invalidates a live cache or emits realtime events. A later delivery implementation needs its own authorization, deduplication and recovery contract.

## Historical retries and unknown outcomes

Buyer authentication and canonical ownership precede every acceptance receipt lookup. The immutable business-input digest includes actor, request, proposal and expected prior binding revision. It excludes the transport operation ID, so a retry from a new connection or renewed session can recover the original result without generating a new principal transfer.

Once an acceptance exists, recovery verifies the application receipt against replayed wallet history before evaluating fresh proposal/payment/pause eligibility. The proposal may already be accepted and the wallet may now be paused. Recovery returns the original terms, revision and event hash. It does not recompute a plan from changed current state, return a newer receipt as if it were the original, or disclose the receipt to a different actor. Changed business input is rejected.

Inspection and historical recovery still register their transaction and acquire the wallet's physical head fence. Their internal context/lock-version writes are separate from the business deduplication guarantee: no additional financial command, principal transfer or canonical acceptance event is produced.

An uncertain COMMIT response propagates as unknown. Reopen and authenticate against the same source and recover the same request/proposal/expected revision. The native drill injects a lost reply after a real commit; it is not a physical network-partition test. Never infer rollback from the exception, delete a receipt, create a replacement acceptance or activate a second source.

## Database writer fencing

The private namespace contains append-only enrollments, acceptances and publication intents, plus transaction registrations keyed by the full transaction ID. A context can bind one exact supported v2 command. Its immutable committed row cannot be reused by a different transaction. A simulation GUC by itself is insufficient to authorize a protected write.

SQL guards compare both old and new normalized/payload identities across the enrolled listing, requests, evidence, disputes, trades, commissions, notifications and audit records. Unsupported mutations and truncation are refused. Enrollment physically versions the listing and its existing request rows and advances the runtime fence, so an old snapshot cannot silently overwrite the newly enrolled state. Auxiliary writes lock the relevant listing before checking enrollment. Before activation, a nontrivial write to an associated non-listing record also physically versions its listing without changing its payload. Enrollment must therefore retry an older snapshot even when a legacy auxiliary writer used READ COMMITTED and ignored the application's global advisory lock.

After activation, every supported wallet repository head access requires a registered coordinator context. Only the exact planned enrollment, acceptance or pause command can be appended. Standalone v2 commands, ordinary snapshot/worker calls and wallet-only export therefore stop. Typed owner inspection and pause remain available through the coordinator. Deferred commit checks require coherent canonical terms, wallet bindings/receipts and deterministic acceptance side effects, including failures caught incorrectly by an inner caller.

Functions run as `SECURITY INVOKER`. New tables use forced RLS without public/client policies, and public schema/table/function privileges are revoked. The disposable fixture role needs deliberate superuser or BYPASSRLS access. Registrations and hashes are storage integrity proofs, not authentication against a database administrator who can alter the application/schema. This is not a production role design.

## Recovery boundary

The existing pure-v1 and mixed-v2 wallet backup formats do not contain canonical marketplace rows, transaction registrations, application acceptance receipts or publication intents. After cohort activation, wallet-only export fails closed. Do not bypass the head guard, export inside an ad hoc registered context, restore only one side, or claim the old backup format recovers this integrated cohort.

A combined marketplace/wallet export, restore, quarantine and reconciliation protocol is the next recovery requirement. Until it exists, preserve the complete isolated source and its verification evidence; use owner `inspect` and typed `pause` for the enrolled fixture. There is no production rollout, automatic unpause or live recovery approval.

## Verification contract

The focused PGlite suites exercise the actual canonical SQL reader/writer and new guards, fixed same-transaction auth, exact six/eighteen-decimal behavior, safe receipts, historical recovery, unsupported cohorts, rollback and standalone bypass rejection. The new native script uses three fresh loopback PostgreSQL databases for atomic faults, concurrent writers/acceptances and real authentication-row races. It observes lock waits and whole-callback retries rather than treating an in-process promise race as PostgreSQL evidence.

The complete development workflow retains the earlier wallet suite, actual platform authentication/marketplace regressions, full-project TypeScript, prior native concurrency/backup/shared-transaction/v2 drills and Chromium English desktop/Arabic mobile rehearsal. The coordinator has no new UI, so those browser checks remain evidence for the existing rehearsal only. The separate verification report records the exact tested source, actual counts and artifact digest after execution. Passing this private-cohort milestone does not close the remaining launch gates.
