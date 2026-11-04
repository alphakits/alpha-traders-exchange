# Alpha Wallet access and platform integration contract

Status: development gateway and actual platform session-source adapters implemented and tested with isolated stores; no production web/mobile wallet route is connected.

The [platform verification report](platform-verification-2026-11-04.md) identifies the exact tested commit, 578 passing wallet/authentication tests and the complete successful CI run. The 23 new resolver tests are included in the wallet suite, not counted again in the separate authentication gate.

The later [marketplace groundwork checkpoint](marketplace-groundwork-verification-2026-11-04.md) verifies those retained authentication contracts together with the new planner, frozen v1 history and shared-transaction participant: 800 tests, full-project TypeScript, three native PostgreSQL drills and the actual browser rehearsal passed on `44ac6c4`.

## What the access gateway enforces

`src/lib/alpha-wallet/access.ts` accepts a trusted server-side account/session resolver and a wallet repository. It does not accept identity, roles, verification flags, service authority, or raw wallet command envelopes from a request body. A request contains only an allowlisted operation, its idempotency key, and operation data.

Every read and action requires an unexpired session, an enabled account, verified email, verified phone access, and adult confirmation. Re-resolution before execution and after private state loading detects authorization changes during asynchronous work. This is a checked adapter boundary, not an implementation of atomic authorization revocation across the future platform database and custody service.

| Public operation | Required authority |
| --- | --- |
| Deposit intent; listing creation/closure; seller release authorization | Canonically approved seller or administration, acting on their own account/trade |
| Reserve a trade; report buyer payment | Actual buyer role or administration, acting as the relevant buyer |
| Cancel a trade | Existing buyer/seller party, within the core's pre-payment cancellation rules |
| Open a dispute | Existing party or owner; no automatic money movement |
| Approve a listing; pause the wallet | Owner |
| Request a withdrawal | Seller account plus independently verified approval bound to exact terms |
| Observe a deposit; verify fiat payment; reconcile custody; claim/submit/confirm a payout; set gas readiness | Never a public user command; separate trusted service boundary required |

Canonical seller suspension/rejection overrides stale seller labels. A default `sellerStatus: buyer` is not by itself a buyer role. Ownership checks reject guessed trade/listing IDs before revealing domain-state details. Owner authority does not become signer, chain-verifier, or payment-verifier authority.

Public results include only the caller's balances, deposit destinations, listings, trades, payouts and commissions, plus active public marketplace listings. Raw journal history, idempotency records, internal provider references, payment-verifier evidence and authorization records are not returned. Mutation responses use the same private projection rather than exposing raw domain objects.

If a financial command commits but the subsequent private read or authorization check fails, the gateway raises `WALLET_COMMITTED_RESPONSE_UNAVAILABLE` with `committed: true`, the original request ID and revision. It does not reveal the private view or imply that the command rolled back. A caller must reconcile that original operation after authorization is restored; creating a new request ID could create a second legitimate operation. A lower-level unknown-COMMIT error likewise must not be converted into a confirmed failure.

## Withdrawal approval binding

The gateway requires an opaque approval token. A trusted server callback verifies it and returns the authenticated user ID, a unique proof reference, issue/expiry times, and a digest binding the user, withdrawal ID, asset, exact integer principal and destination. A request cannot provide the synthetic core approval marker directly.

The development policy accepts an approval only within five minutes of verification and before its own expiry. Freshness is checked again after the final asynchronous account lookup, immediately before calling the financial repository. Changing the amount, destination, user or withdrawal ID invalidates the approval. Repeating the same authorized withdrawal retains the same core payout identity. Equivalent decimal representations are bound to the same integer units.

This does **not** issue or verify a real passkey, SMS code or MFA credential. Before production, select and implement the proof issuer, brute-force/rate limits, signing-key rotation, approval replay storage, revocation semantics and recovery path. Keep those credentials out of request logs. A provider signer must enforce its own independent policy too.

## Exact existing-platform mappings

| Existing source | Required integration |
| --- | --- |
| `src/lib/auth.ts`, `requireApiUser` in `api-auth.ts` | New `getCurrentSessionForAuthorization` resolves the existing server cookie through a strict uncached combined session/account lookup and retains actual expiry. Existing user-only APIs retain their behavior. No client session JSON is authoritative. |
| `requireMobileApiUser` in `mobile-api-auth.ts` | New `requireMobileApiSession` retains the validated bearer/device session's access expiry and uses the strict account source. The development wallet resolver revalidates the session after account loading and applies explicit wallet verification gates. The old route-facing helper retains its original result shape. |
| `hasVerifiedPhone` and `isAccountPhoneVerificationExempt` | Derive phone access from actual OTP evidence or the exact owner-authorized account-ID/email pair. Never accept a UI badge, role label, unsigned cookie, email alias or test bypass as production authority. |
| `hasAdultConfirmation` | Require the actual canonical adult-confirmation record. The wallet boundary must not inherit local test switches that skip marketplace gates. |
| `seller-approval.ts`, `seller-approval-verification.ts` | Use canonical seller status and existing owner approval. Do not invent an additional completed KYC checklist or infer identity verification from role labels. |
| `updateTradeTerms` and `packages/contracts/src/trade-terms.ts` | Preserve seller proposal → buyer acceptance, the two-proposal limit (declined/withdrawn proposals still count), pre-payment locking and current payment-method rules. Wallet reservation resizing must commit with acceptance; this operation is still not connected. |
| `assertBuyerEligibleForDemand` / pending feedback checks | Preserve active-trade and pending-review restrictions at reservation, including buyers who also owe seller commission. The isolated wallet model does not replace these marketplace gates. |
| Marketplace owner review | Full funding and owner approval are separate requirements. Deposit confirmation cannot bypass review. |
| Existing payment statuses | A buyer's paid claim, manual `funds_received`, `usdt_sent`, or owner completion flag does not establish a verified custody payout. |
| Existing transaction/repository layer | Choose one atomic consistency design for marketplace acceptance, wallet reservation and financial completion. Two independent writes or generic snapshot replacement are not sufficient. |
| Trade receipts, benefits, ranks, reviews, notifications and commission accounting | Publish after a durable confirmed payout through an idempotent integration outbox. Preserve the established privacy and fee policy and prove no duplicate benefits/email/commission posting. |

The initial gateway left existing source APIs unchanged. The subsequent session adapter adds explicit metadata/strict-read entry points in the platform's authentication modules while preserving existing caller behavior. The remaining mappings are still integration work; a passing development adapter is not a deployed wallet flow.

## Implemented platform session adapters

`src/lib/alpha-wallet/platform-session.ts` exports server-only `createDevelopmentWebWalletResolver` and `createDevelopmentMobileWalletResolver`. Both require `mode: "simulation-only"` and check the runtime before and after asynchronous authorization. They call the concrete platform authentication sources and supply minimal canonical evidence to `createWalletAccess`. They do not install a route or retain an authorization result in the resolver closure.

- **Web:** `getAuthenticatedSessionByToken` retains the stored `AuthSession.expiresAt` with the canonical user from one combined repository query. It refuses the older compatibility path of separate session and user reads. `getCurrentSessionForAuthorization` re-reads the cookie and metadata without React request memoization, cookie renewal or an invented TTL.
- **Fresh durable source:** strict session and account reads use `requireFresh: true`. A configured repository that failed initialization or a query cannot authorize from its cached development fallback. The original user-only APIs retain their prior fallback behavior. An explicitly in-memory repository remains usable for isolated fixtures; that is not durable authentication evidence. A configured instance already in initialization fallback continues to reject strict reads until it is reinitialized.
- **Mobile:** `requireMobileApiSession` retains the validated access session ID, subject and `accessExpiresAt`, with a trusted account loader that can be isolated in tests. The wallet resolver validates the bearer/device token again after account loading and requires unchanged session identity, subject and expiry. Refresh expiry and client metadata do not replace access expiry. `requireMobileApiUser` keeps its existing gates, original account loader and exact `{ user, accessToken, unauthorized }` result shape.
- **Canonical evidence:** email uses `emailVerified === true`; phone uses `hasVerifiedPhone` or the exact account-ID/email exemption; age uses `hasAdultConfirmation`. Runtime gate skipping and development photo-verification bypasses are not accepted as evidence. Canonical seller suspension overrides a stale approved role. The returned object excludes email, phone, credential hashes and session tokens; role arrays are copied.

The tests execute actual repository combined/account SQL through isolated PGlite, actual cookie/store helpers, real mobile issue/validate/revoke/replace methods with an isolated session store, and the real wallet access gateway. They cover exact expiry, disabled/revoked canonical rereads, database failures with a retained active fallback, exact phone exemptions, device/subject mismatch, post-await token changes, private-response denial and no credential revocation on an unavailable account read. Ambient database discovery is blocked by the fixtures.

No `src/app` wallet route is connected to these entry points. These tests do not establish deployed login configuration or atomic revocation across authentication storage and a financial commit. Mobile token and account reads remain separate; the tested rereads detect those races without replacing the future transaction-level authorization contract. Real withdrawal step-up issuance, CSRF/rate limits, HTTP private-cache policy and the production adapter rollout remain unfinished.

The separate [atomic marketplace terms design](transaction-integration-design.md) identifies the actual transaction owners, pending-versus-reserved distinction, required bindings, protected writer cohort and historical-version constraints. Its preliminary stage now implements a pure canonical acceptance planner, frozen historical v1 fixtures and an actual focused repository participant that can share one owned simulation transaction with wallet commands. Durable resize, enrollment/acceptance receipts, lifecycle participants and all enrolled-writer protections remain unfinished. No production wallet route calls this participant or planner.

## Rules for the private integrated stage

1. Keep production routes disabled and production deployments blocked while adding the explicit web/mobile session adapter.
2. Derive identity and all verification evidence on the server, including on replays and reads.
3. Reject cross-origin cookie-authenticated writes and enforce a CSRF mechanism, request-size limits and rate limits. Mobile bearer flows require their own tested origin/session contract.
4. Use explicit participant-scoped projections and no-store responses. Do not return full custody state to a browser.
5. Bind payment verification and seller release to unchanged trade terms; preserve disputes and pre-payment adjustment consent.
6. Require proof of exactly one business effect across HTTP retries, database failures, stale proposals, session revocation, mobile/web concurrent actions and provider ambiguity.
7. Keep signer, verifier and user interfaces separate. A disabled live flag is not an authentication system.

Primary references reviewed 4 November 2026:

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
