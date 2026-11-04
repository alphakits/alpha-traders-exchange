# Alpha Wallet custody and signing decision

Status: no custody provider, signing service, account, key, commercial plan or real asset configuration has been selected or created.

## Proposed next direction

Evaluate managed MPC wallet infrastructure with a separate test environment and enforceable transaction policies before building an Alpha-operated signer from scratch. This is an engineering recommendation for the next validation step, not a claim of provider approval, price suitability, regulatory eligibility or guaranteed security.

Keep the Alpha accounting ledger independent of the provider. The provider must receive one immutable authorized payout and preserve its original identity through timeouts, restarts and repeated lookup. A vendor connection must not weaken exact-amount checks, finality verification, fee separation or the pause/recovery controls already implemented.

The owner's decision matters because it determines who controls key material, who can approve transactions, which recovery process is possible, what commercial costs apply and which entity holds the customer-funds responsibility. A wallet-infrastructure vendor is not automatically the customer's legal custodian.

## Concrete candidates and limits of the research

| Direction | Documented fit | What must be established before selection |
| --- | --- | --- |
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
