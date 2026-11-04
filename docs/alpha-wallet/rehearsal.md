# Alpha Wallet local rehearsal

This is a functional interface for the **synthetic wallet development model**. It uses the durable command store and the offline file provider. It does not connect to the live marketplace, a bank, a chain RPC, a wallet signer, or production authentication.

The interface provides English and Arabic, including an RTL phone layout. Balances, reservations, approvals, payout states, and ledger movements come from the durable engine. The 500 USDT card is labeled as the rehearsal target; the balance cards always show stored state.

## Start locally

Run from the repository root with the Node version specified by `.nvmrc` and the existing installed dependencies:

```bash
NODE_ENV=development node --import tsx scripts/alpha-wallet/rehearsal-server.ts
```

The server prints its URL and the location of its marked temporary data directory. Its default URL is `http://127.0.0.1:4318`. The server always binds `127.0.0.1`; there is no public-host option.

To keep a chosen local fixture directory across restarts:

```bash
NODE_ENV=development node --import tsx scripts/alpha-wallet/rehearsal-server.ts \
  --port 4318 \
  --data-dir /tmp/alpha-wallet-rehearsal-demo
```

The directory must be empty on first use or already carry this rehearsal's valid marker. An unrelated nonempty directory is refused. Restart with the same directory to reconstruct the wallet from committed commands and reuse the same fake-provider evidence. Session cookies and selected fixture roles are intentionally kept in process memory and reset on restart.

Stop with Ctrl+C. Files are preserved for reopening; the server does not delete them. To start a different scenario, choose a new empty directory. The current model has no automatic unpause, dispute resolution, or final-failure refund.

## What the roles mean

The role selector is explicitly a **fixture role switcher, not account authentication**. Any person using this local rehearsal can switch among the five fixed roles. The server chooses the fixture actor from the selected session role; the browser cannot submit an actor, identity, raw wallet command, or real destination.

| Fixture role | Available rehearsal actions |
| --- | --- |
| Seller | Create listings and funding destinations, authorize a verified trade, close unreserved inventory, request a withdrawal to the fixed synthetic seller destination |
| Buyer | Reserve part of an active listing, report payment, cancel a permitted reservation, open a dispute |
| Owner reviewer | Approve a listing, set native network-fee readiness, pause the wallet, open a dispute |
| Evidence verifier | Record pending deposit observations and finality, verify a matching fixture fiat credit, reconcile synthetic custody evidence, publish fake-provider finality |
| Payout worker | Queue an authorized payout, claim and submit it, exercise response loss or interruption, recover using the original provider reference |

The real-user authorization adapter is separate. This interface does not demonstrate production login, seller onboarding, live payment verification, actual step-up authentication, signing controls, or role administration.

## Rehearse the full 500 USDT journey

Use the default TRC20 simulation asset. BEP20 simulation is also selectable; the asset identity remains attached to every funding intent, listing, reservation, and payout. Switching the display network does not bridge funds.

| Stage | Role and action | Expected behavior |
| --- | --- | --- |
| Create listing | Seller: create a listing for 500 USDT at 3.20 ILS | Inventory is unavailable until both full funding and owner approval exist |
| Prepare deposit | Seller: create a principal funding destination | A `sim://` destination appears; no balance is credited |
| Observe transfer | Verifier: record a pending observation for 500 USDT | Funding remains pending and custody remains uncredited |
| Establish finality | Verifier: confirm the same 500 USDT observation | Full principal is credited and assigned to the listing |
| Approve listing | Owner: approve the fixture listing | The listing becomes reservable once funding is also complete; approval may happen before or after funding |
| Reserve principal | Buyer: reserve 200 USDT, then 300 USDT | The full 500 is locked across the two trades; no further inventory is available |
| Report payment | Buyer: record the first payment claim | The claim alone cannot authorize release |
| Verify evidence | Verifier: verify the matching fixture credit | The server constructs evidence for the exact quoted ILS amount; this is not a bank integration |
| Authorize release | Seller: authorize the verified trade | The existing amount and synthetic destination remain fixed |
| Prepare dispatch | Owner: mark the native fee reserve ready; verifier: run fixture reconciliation | Dispatch requires separate native-fee readiness and matching reconciliation no older than 60 seconds |
| Queue | Worker: queue the authorized payout | The trade's reserved amount moves to the payout hold |
| Submit | Worker: choose a normal transfer or “Accept, then lose response” | An unknown response retains the hold and original reference |
| Recover | Worker: recover the original transfer | Accepted provider evidence becomes visible without a second transfer claim |
| Finalize provider evidence | Verifier: publish successful finality | Provider finality appears separately; the ledger still holds funds until the worker records the outcome |
| Settle ledger | Worker: recover again | The buyer receives the full principal and the commission obligation is recorded separately |

After the first 200-USDT trade settles, the separate commission due is 4 USDT. Unpaid commission blocks new commitments. The existing 300-USDT reservation remains intact.

As the seller, create a **commission-purpose** funding destination. As the verifier, record and finalize a separate 10-USDT observation. Four USDT settles the first trade's fees and six remains available for the second trade's fees. Complete the 300-USDT trade through the same independent stages.

The resulting state is:

| Quantity | USDT |
| --- | ---: |
| Listing principal deposited | 500 |
| Principal delivered to buyers | 500 |
| Separate commission deposited | 10 |
| Commission recognized after both completions | 10 |
| Remaining customer principal in trade or payout holds | 0 |

The buyer's ILS quote includes its 1% fee. The seller settles both 1% fee portions from the separate commission-purpose balance after completion, preserving the existing development model's fee semantics.

## Recovery and held states

**Response lost after acceptance.** “Accept, then lose response” makes the offline provider publish the immutable accepted transfer and then throw a simulated response-loss error. The wallet records an unknown outcome and keeps the payout hold. Recovery looks up the existing reference. No replacement transfer is sent.

**Interruption before submission.** “Interrupt before submission” commits the dispatch claim but never calls the provider. Recovery finds no provider evidence and remains held. Not-found evidence is not proof that sending again is safe. The interface shows the hold, original reference, held amount, and dispatch count; it has no resend override.

**Provider finality before ledger settlement.** The verifier's finality action writes offline provider evidence only. The worker must subsequently record the finalized receipt in the wallet. The interface displays these as separate states and does not increase “Delivered to buyers” early.

**Final failure.** Publishing a final failure and running recovery records the failed outcome while retaining the hold. Manual recovery is required; the rehearsal does not invent a refund or release path.

**Disputes and pauses.** A pre-dispatch dispute prevents a new send. A pause blocks new commitments and dispatch. If a transfer was already submitted, real evidence within this synthetic model still has to be recorded; the interface does not suggest that a dispute can recall a transfer.

**Withdrawal.** A withdrawal uses uncommitted principal only and a fixed `sim://` seller recipient. The server supplies a fixture approval reference, which is explicitly not production step-up authentication. Existing listing, trade, and payout holds stay unavailable.

## Local HTTP boundary

The server is isolated from the production application and provides only the page, `/api/state`, fixture role selection, and a fixed allowlist of action routes. It imports the simulation/durable modules directly; it does not import production routes or repositories.

The boundary includes:

- Actual `NODE_ENV=test` or `development` and the shared simulation runtime guard at construction and on every request.
- A hard-coded IPv4 loopback listener, exact Host validation, and loopback peer validation.
- Exact Origin and per-session CSRF checks for mutations, with an HttpOnly, SameSite=Strict fixture-session cookie.
- Strict action-specific JSON schemas, a 4096-byte request limit, and rejection of browser-supplied actors, identities, raw commands, or destinations.
- Nonce-based script/style CSP, no external resources, no cross-origin response grants, no framing, and no caching of session/state responses.
- Fixed synthetic actors, assets, destinations, and evidence identities; no keys, provider credentials, environment database URL, scheduler, or production connection.

These controls constrain the local development surface. They do not make the role switcher a production authorization boundary. Every role can see the same synthetic rehearsal state by design.

## Verification

HTTP tests exercise the actual loopback server and persistent file store:

```bash
node ./node_modules/vitest/vitest.mjs run src/lib/alpha-wallet/rehearsal.test.ts
```

The tests cover Host/Origin/CSRF/session guards, strict role and body handling, CSP and executable script syntax, runtime rejection, full principal and separate commission settlement, provider-response recovery, a crash-before-submission hold, and close/reopen persistence.

The optional Chromium check drives rendered controls through the full workflow:

```bash
NODE_ENV=test node --import tsx scripts/alpha-wallet/rehearsal-browser-check.ts
```

It creates its own temporary local server, accepts no external URL or host, rejects browser network requests outside that server, and closes both server and browser afterward. An installed Playwright-compatible Chromium browser is required; the script does not install or download one.

When successful, it writes a JSON report and full-page screenshots under `test-results/alpha-wallet/rehearsal/` for English desktop and Arabic at 390 pixels. It checks horizontal overflow, browser/page errors, the lost-response state, finality versus settlement, and the exact 500-principal/10-fee outcome. A successful browser run is distinct from the HTTP and domain test results.

## Remaining boundaries before any live integration

This rehearsal deliberately retains the development-only actor and provider model. Real sessions and authorization, custody operations, production signing, independent chain finality, authenticated bank/payment evidence, native-fee operations, approved dispute handling, and operational recovery must be integrated and reviewed separately. The file store is single-process; native PostgreSQL concurrency is verified by its separate disposable-database harness.

Neither the UI nor its startup command enables a live deployment or access to real funds.
