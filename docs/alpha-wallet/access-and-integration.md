# Alpha Wallet access and platform integration contract

Status: development boundary implemented and tested; no production web/mobile route is connected.

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
| `src/lib/auth.ts`, `requireApiUser` in `api-auth.ts` | Resolve the current server session and fresh canonical account. Never use client session JSON as authority. Preserve disabled-account behavior and fail closed on unavailable account reads. |
| `requireMobileApiUser` in `mobile-api-auth.ts` | Resolve bearer/device session and fresh account. Wallet routes need explicit verification gates: the current marketplace/trades/seller/admin regex does not include `/wallet`. |
| `hasVerifiedPhone` and `isAccountPhoneVerificationExempt` | Derive phone access from actual OTP evidence or the exact owner-authorized account-ID/email pair. Never accept a UI badge, role label, unsigned cookie, email alias or test bypass as production authority. |
| `hasAdultConfirmation` | Require the actual canonical adult-confirmation record. The wallet boundary must not inherit local test switches that skip marketplace gates. |
| `seller-approval.ts`, `seller-approval-verification.ts` | Use canonical seller status and existing owner approval. Do not invent an additional completed KYC checklist or infer identity verification from role labels. |
| `updateTradeTerms` and `packages/contracts/src/trade-terms.ts` | Preserve seller proposal → buyer acceptance, the two-proposal limit (declined/withdrawn proposals still count), pre-payment locking and current payment-method rules. Wallet reservation resizing must commit with acceptance; this operation is still not connected. |
| `assertBuyerEligibleForDemand` / pending feedback checks | Preserve active-trade and pending-review restrictions at reservation, including buyers who also owe seller commission. The isolated wallet model does not replace these marketplace gates. |
| Marketplace owner review | Full funding and owner approval are separate requirements. Deposit confirmation cannot bypass review. |
| Existing payment statuses | A buyer's paid claim, manual `funds_received`, `usdt_sent`, or owner completion flag does not establish a verified custody payout. |
| Existing transaction/repository layer | Choose one atomic consistency design for marketplace acceptance, wallet reservation and financial completion. Two independent writes or generic snapshot replacement are not sufficient. |
| Trade receipts, benefits, ranks, reviews, notifications and commission accounting | Publish after a durable confirmed payout through an idempotent integration outbox. Preserve the established privacy and fee policy and prove no duplicate benefits/email/commission posting. |

No existing source in this table was changed by the development access gateway. These mappings identify real remaining integration work and prevent a passing isolated simulation from being mistaken for a completed live-platform integration.

## Session metadata required for the next integrated stage

A bounded source review after resuming development found the following concrete gaps. These are implementation requirements, not claims that authentication is already connected:

- **Web expiry is available in storage but discarded by current public helpers.** `getAuthenticatedUserBySessionToken` loads the session, account and seller-application context through `loadAuthenticatedSessionSnapshot`, validates the stored session expiry, then returns only the user. `requireApiUser` therefore cannot supply the gateway's `sessionExpiresAtMs` directly. Expose the actual `AuthSession.expiresAt` alongside the canonical account through an explicitly uncached server lookup. Preserve existing user-only caller behavior and disabled-account handling. Do not invent a TTL or call a separate session lookup and describe the two reads as one coherent snapshot.
- **Request memoization is not a fresh authorization read.** The Next auth wrapper uses React `cache`. Repeating that wrapper is not evidence that canonical account/session state was reread after asynchronous work. The wallet resolver must use the reviewed uncached boundary, including replays and post-commit private-response checks.
- **Mobile access expiry exists before the wrapper drops it.** `MobileAuthService.validateAccessToken` returns a validated, device-bound session with `accessExpiresAt`. `requireMobileApiUser` resolves the current account but returns no expiry metadata. Retain the validated access expiry, use a trusted account loader that can be isolated in tests, and explicitly apply wallet phone/age gates. Refresh-token expiry and client-provided metadata cannot replace access-session expiry.
- **Use concrete verification evidence.** Map email with `emailVerified === true`, phone with `hasVerifiedPhone` or the existing exact account-ID/email exemption, and age with `hasAdultConfirmation`. The broader `isVerified` helper can accept a development photo-verification bypass and is not sufficient wallet evidence. Map legacy optional `disabled` consistently with the canonical account semantics, then pass an explicit boolean to the strict gateway.

Local tests can establish token/device binding, expiry deadlines, revocation, canonical suspension, actual verification helpers, loader failures and fresh rereads using isolated stores. They cannot establish atomic revocation across a separate financial transaction or prove a real deployment's authentication configuration. No production auth helper or route was modified by this review.

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
