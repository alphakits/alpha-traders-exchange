# Local USDT requests preview

From this checkout, after dependencies are installed:

```powershell
node scripts/usdt-request-offline.mjs
```

Open <http://localhost:3210/en/login?redirectTo=/en/usdt-exchange/requests>.
Use separate browser profiles or an incognito window for the buyer and seller.

| Role | Synthetic email | Password |
| --- | --- | --- |
| Buyer | buyer@offline.example.test | OfflineDemo!2026 |
| Seller | seller@offline.example.test | OfflineDemo!2026 |
| Second buyer | buyer-two@offline.example.test | OfflineDemo!2026 |
| Second seller | seller-two@offline.example.test | OfflineDemo!2026 |

Publish a request for 5,000 USDT at 3.30 ILS using Bank Transfer and TRC20.
As the seller, choose **Buyer requests · Sell USDT**, open the request and respond from the synthetic listing.
As the buyer, refresh the request, review the response, enter a valid-format test wallet, acknowledge the terms and open the Trade Room.
Use only synthetic values; the local preview does not move money.

The reference is fixed at **3.30 ILS**, with the request price range **2.95–3.65 ILS**.

The dedicated Playwright server additionally opts into `--quote-scenarios` to verify changing, stale and unavailable synthetic provider quotes, including **3.10 ILS → 2.75–3.45 ILS**. That fixture control exists only in the offline network guard. The ordinary user preview does not enable it, and production application routes do not expose it. Each automated case receives fresh synthetic account IDs so cases do not share rate-limit windows; the actual per-account limits remain enforced.
All accounts, listings and bank details are synthetic. External server networking is blocked, service credentials are omitted, and request email delivery is off.
In-app notifications and real application session/API/Trade Room logic remain active.
The offline preview uses local Arial substitutes for the remotely downloaded fonts.
The launcher refuses `.env` files, binds to `127.0.0.1`, and creates a separate temporary runtime for each launch.
Stop with Ctrl+C. Starting it again resets the demo data. `--port 3212` selects another port.

To preserve requests and signed-in sessions, note the **Offline runtime** folder printed by the launcher.
After stopping that preview, restart from this same checkout with:

```powershell
node scripts/usdt-request-offline.mjs --production --resume-runtime "C:\path\to\work\usdt-offline-runtime\run-XXXXXX"
```

Use the exact existing folder printed by your launch. Resume always skips fixture reset and keeps the same isolation guards.
It accepts only immediate `run-*` folders under this checkout's sibling `usdt-offline-runtime` directory; links, junctions and outside paths are refused.
Do not run two previews against one runtime folder. Omit `--production` when using the development server.

The default suite uses installed Google Chrome and starts its own isolated server on port 3211:

```powershell
node node_modules/playwright/cli.js test --config=playwright.usdt-requests-offline.config.ts
```

It checks real sessions, price boundaries, replay protection, ownership/privacy, the buyer/seller browser flow, listing prefill, all three payment methods and Arabic mobile layout.
It also checks grouped number typing/pasting, canonical API amounts, fee breakdowns, invalid input, quote recovery, seller response updates/withdrawals and stale request recovery.
Screenshots and failure traces are saved under `test-results/usdt-requests-offline`.
It never reuses an existing server and refuses to reset any server without the offline network-guard marker.

To verify the production bundle with the same isolated environment, first stop any dev server:

```powershell
node scripts/usdt-request-offline.mjs --build
```

This invokes the existing production build wrapper. It starts no server, seeds no data and deploys nothing.
After that build, `node scripts/usdt-request-offline.mjs --production` serves the compiled preview with the same isolation guards.
Set `USDT_OFFLINE_PRODUCTION=1` when running the Playwright command to test that prebuilt preview instead of starting a dev server.
The local quote is a deterministic test fixture, so this preview does not verify live provider, production database, email or SMS integration.
