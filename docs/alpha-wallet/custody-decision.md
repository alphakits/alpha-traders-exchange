# Alpha Wallet custody and signing decision

Status: the owner selected **Trust Wallet as the preferred interface for a new receiving wallet** on 2026-11-05. No real receiving address, wallet, key, provider account, signing service, commercial plan or live asset configuration has been created or connected. Live launch remains off.

## Receiving preference and development direction

Use a dedicated Alpha receiving identity for each approved network, with Trust Wallet as the owner's preferred wallet interface. The application will retain approved public destination assignments and exact chain/token configuration. A read-only observer will verify deposits and feed the durable escrow ledger without possessing the receiving wallet's private keys. Trust's address-balance and single-chain history commands document this separation. [Address queries](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/balance.md) · [History and transaction lookup](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/history.md)

Development continues with simulation fixtures, deterministic adapter contracts, deposit attribution and recovery. The receiving-wallet preference is recorded; it does not require the owner to choose a signing vendor before this engineering work can continue. Exact chain and token identities remain explicit configuration. In particular, a BSC Binance-Peg token representation is an asset identity, separate from using a Binance exchange deposit account as the receiving destination.

Trust Wallet Agent Kit (TWAK) is an automation candidate for a dedicated Alpha-operated signer. Its official portal distinguishes a locally controlled agent wallet from an interactive WalletConnect session. Trust's July 2026 announcement describes developer-held keys and configured spend policies. This is documented capability research, not an installed or verified Alpha integration. [Trust Wallet Builders](https://portal.trustwallet.com/) · [Agent Kit announcement](https://trustwallet.com/blog/company/trust-wallet-agent-kit-the-non-custodial-wallet-primitive-for-ai-agents)

Keep the Alpha accounting ledger independent of the provider. The provider must receive one immutable authorized payout and preserve its original identity through timeouts, restarts and repeated lookup. A vendor connection must not weaken exact-amount checks, finality verification, fee separation or the pause/recovery controls already implemented.

If Alpha controls the receiving key, Alpha controls coins deposited to that address. A self-custody wallet describes Alpha's control relative to the wallet vendor; it does not give an escrow customer unilateral spending control over the deposit. A wallet-infrastructure vendor is not automatically the customer's legal custodian.

## Trust Wallet capability review — 2026-11-05

The review used the official Trust Wallet portal and current public `trustwallet/tw-agent-skills` reference files, plus BNB Chain's own TWAK integration documentation. No CLI was installed, no account or wallet was opened, and no key generation, signing or transfer was performed. Several older `developer.trustwallet.com` agent-SDK links redirected to the marketing home page, and the indexed `trustwallet/developer/agent-sdk` files were unavailable through the repository API. The live reference files below take precedence over those older indexed examples.

| Surface | Documented scope | Alpha integration consequence |
| --- | --- | --- |
| Public-address queries | Balance queries require no local wallet; history can use an explicit address and chain; transaction lookup takes a known hash | Suitable as a read-only observation input. Portfolio totals and history summaries do not establish exact deposit credit or finality. |
| TWAK WalletConnect | External-wallet approval for each transaction; the reviewed integration supports EVM chains only; the app must be opened for approval | An interactive BSC path can be evaluated. TRON mobile-wallet support does not establish TRON support through this integration. |
| Local agent wallet | Local encrypted wallet material and a CLI/MCP/REST execution surface | An Alpha-operated signing boundary requiring separate infrastructure, policies and recovery evidence. |
| Built-in DCA/limit watcher | Swap automation on supported EVM chains and Solana; testnets and TRON are rejected; WalletConnect mode remains idle | It is not the escrow payout scheduler. The reference warns that two watcher processes can fire the same saved automation. |
| Wallet Core | Address/key and transaction-signing primitives, with no node communication, balance retrieval or broadcasting | A potential low-level component for an isolated signer; node observation, transaction persistence and delivery remain separate responsibilities. |

Sources: [Wallet and WalletConnect reference](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/wallet.md) · [Local setup and stores](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/setup.md) · [Automation reference](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/automations.md) · [Wallet Core reference](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/sdk/references/wallet-core.md).

### Transfer identity and recovery remain unverified

The transfer command returns a hash after execution. Its reviewed options expose neither an immutable payout/idempotency identity nor prepare/sign-only, nonce-control or signed-byte-export modes; broadcast network errors are possible. [Transfer reference](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/send.md)

Known-hash lookup is useful after the hash is durably recorded. Address-history matching alone cannot uniquely identify repeated equal payments after a lost result. [Lookup reference](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/history.md)

BNB Chain's current first-party TWAK integration describes a self-broadcasting wallet and no generic raw-transaction signing primitive for its verified integration. Its documentation also treats uncertain submitted operations as requiring reconciliation. This establishes that integration's boundary; it does not prove every newer or private Trust SDK has the same surface. No reviewed interface has yet satisfied Alpha's required payout contract. [BNB Chain TWAK capability reference](https://github.com/bnb-chain/bnbagent-sdk/blob/main/docs/twak.md)

Before activation, an adapter must either persist the signed transaction and its chain identity before broadcast, or use a provider contract that durably deduplicates an immutable Alpha payout ID and supports lookup after timeout or restart. Unknown outcomes keep principal reserved for reconciliation. A failed command or lost response never authorizes a replacement payment.

### Network, policy and key boundaries

Trust documents limited `bsctestnet` operations on chain ID 97, a mainnet-only wallet-balance gateway, and reuse of the BSC mainnet address on testnet. Alpha therefore requires separate development keys/stores and explicit network verification. [Testnet transfer details](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/send.md)

The reviewed files do not establish Nile/Shasta configuration or an escrow-grade TRC-20 send/recovery contract. TRON remains a separately unverified integration capability. [Supported-chain configuration](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/setup.md)

The transfer reference says its price-based USD cap can be skipped when price data is unavailable, and its recipient pin applies to resolved names. Alpha must independently enforce the approved raw address, exact contract, integer amount, fee bounds and spend policy. Those convenience checks are not the custody policy. [Transfer guard limitations](https://github.com/trustwallet/tw-agent-skills/blob/main/skills/wallet/references/send.md)

No personal recovery phrase is imported into the website process. Any eventual unattended signer uses a dedicated wallet in an isolated service with explicit access controls, transaction policy, rotation/recovery procedures, monitoring and tested pause behavior. A read-only observer needs only approved public destinations and its own data-source credentials.

## Concrete candidates and limits of the research

| Direction | Documented fit | What must be established before selection |
| --- | --- | --- |
| Trust Wallet receiving interface and optional TWAK signer | Owner's selected receiving direction; public-address observation, interactive WalletConnect and local agent-wallet modes documented separately above | Exact supported network/asset configuration, destination control, isolated keys, durable payout identity, pre-broadcast or provider-backed recovery, independent policy enforcement, and separate testnet evidence; signer not selected or activated |
| Fireblocks wallet infrastructure | Separate developer/testnet/mainnet workspaces; editable policies in a full Testnet workspace; transaction lookup and persistent external transaction identity | Current account eligibility and pricing; exact TRON/BSC asset availability in the chosen workspace; co-signer/key-share ownership; policy and recovery setup; full testnet evidence |
| BitGo self-custody/hot-wallet integration | Separate wallet models and explicit build/sign/send flows; relevant TRON support documented separately | Exact supported TRON/BSC assets and wallet type; signer operation; recovery and provider-reference semantics; account approval and costs |
| BitGo institutional custody | Provider-managed signing and custody model | Its documented custody withdrawal process and up-to-24-hour service window may not fit the intended rapid marketplace flow; its custody wallets do not execute signed testnet withdrawals, so the required rehearsal plan would need a different arrangement |
| Alpha-operated signing service | Maximum direct control over integration and execution policy | Isolated signer design, key generation/storage, access control, audited transaction construction, nonce/expiry/rebroadcast handling, backups and recovery, monitoring and independent review; none should be improvised in the website process |

Fireblocks' workspace comparison lists non-editable sandbox policies and editable Testnet policies, with separate production credentials. Its table and later Testnet-limitations section conflict on client co-signer and mobile-signing support. Those capabilities therefore require account-specific confirmation and an actual test; they are not assumed available. A quick sandbox demo is insufficient evidence for the final signing policy. [Source: workspace comparison](https://developers.fireblocks.com/docs/workspace-environments).

Fireblocks directs transaction creation to use `externalTxId`; it says a duplicate transaction request is rejected with HTTP 400. Its general request-idempotency cache lasts 24 hours and is not the transaction-creation mechanism. The adapter must bind the external identity to exact payout terms and resolve uncertain outcomes through original-reference lookup, including duplicate-request errors. Successful API submission alone does not establish blockchain finality. [Source: API idempotency](https://developers.fireblocks.com/reference/api-idempotency).

BitGo's own documentation distinguishes self-custody from institutional custody. The documented custody signing process and testnet restriction are material to this marketplace's latency and testing requirements; they should not be hidden behind the generic word “wallet.” [Source: wallet types](https://developers.bitgo.com/docs/wallet-types).

This research has not verified a price quote, signed agreement, onboarding acceptance, exact account-specific asset catalogue, insurance coverage or legal treatment for Alpha Traders. No signup, purchase, external message or credential request was performed.

## Evidence required from the selected test environment

1. A separately isolated development/testnet account whose keys and asset configuration cannot be used for mainnet by changing a URL.
2. Exact network identity and allowlisted contracts, decimals and asset IDs. Test tokens are explicitly different from real USDT.
3. Deposit-address ownership and attribution, finality/execution validation, reorg behavior and complete scanning checkpoints.
4. Stable payout identity; lookup after ambiguous acceptance; duplicate-request behavior; request mismatch behavior; webhook replay handling.
5. Sender authorization and policy controls independent of the website, plus exact amount/destination enforcement and gas-resource funding.
6. Pausing, service/key rotation, loss of a signer/co-signer, and backup recovery while an external transfer continues.
7. Reconciliation against independently obtained balances and transfer history, including fees and sweep transactions.
8. Evidence that a confirmed transfer reaches the same buyer once while commission remains separate and marketplace side effects occur once.

No mainnet key generation, funding, signing, real transfer or deployment is authorized by this document. The user's existing instruction to keep live launch off remains in force.
