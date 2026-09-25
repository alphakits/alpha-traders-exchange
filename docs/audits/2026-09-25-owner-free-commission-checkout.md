# Owner-free commission checkout

## Supported flow

An authenticated seller creates a checkout BEFORE transferring funds, selecting all outstanding commissions and an intended received amount within ±1 USDT of their combined base total. The server freezes the group and reserves one exact received amount. If the selected amount is already used, the server allocates and displays a nearby six-decimal reference still within tolerance. The seller sends the displayed amount once using the selected canonical TRC20/BEP20 address. The protected scanner reads receiving-account/blockchain history, independently verifies the actual receipt, atomically marks the group paid and persists actual received/waived/excess plus recoverable notification/email work. No owner approval, screenshot or TxID submission is needed for this flow.

This is NOT fuzzy matching for anonymous deposits already sent. Payments before checkout creation, removed decimal references, wrong assets/networks/addresses and reused references never automatically clear an arbitrary seller. No Binance Pay/UID/email transfer support or new seller-wallet custody is introduced.

## Financial isolation

The legacy fee, trade, auth, session and listing workflow remains intact. Writes use the existing canonical repository lock and update only commissions, audit and notifications. All individual amounts are frozen; one tolerance applies to the whole group. Payment amounts and receipts are permanently reserved with private PostgreSQL tables/triggers. A paid incident is never reset for testing.

## Release gate

`node scripts/check-commission-checkout-release.mjs` runs dependency-free workflow tests plus isolated PostgreSQL/PGlite, owner-free API, scheduler and UI tests. Existing commission release checks and original build gates remain required. Only the dependency-free 40 tests have been executed at initial draft creation; preview tests/build and database migration are checked separately before release. Tests use an OS-only environment allowlist, not live provider/DB credentials.

Before activation verify the migration and live scheduler. A successful empty scan is not evidence of a genuine customer settlement. Physical devices and real received payments must not be fabricated as validation evidence.

The current app root uses WebsiteAppShell (apps/mobile/app/_layout.tsx), so the web checkout can be reached by website-based app builds. Do not claim a new native binary or universal old-version compatibility.
