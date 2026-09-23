# Commission payment automation

The protected `/api/cron/commission-payment-verification` job runs every minute in production. It reads persisted exact payment intents, discovers deposits, and passes every match through the existing receipt verifier and atomic commission settlement. Website and native app share this backend. No customer funds are moved by this job.

## Supported discovery

| Payment | Discovery | Receipt verification |
| --- | --- | --- |
| Public USDT TRC20 | TronGrid account history, official Tether contract | SolidityNode solidified receipt |
| Public USDT BEP20 | Etherscan V2, or authenticated Binance receiving-account deposit history | BSC mainnet RPC, canonical block and at least 15 confirmations |
| Binance internal deposit | Optional signed receiving-account deposit history | Re-read credited USDT internal deposit, canonical destination, network, issue time and exact amount |

Discovery scans up to five pages of 200 entries with a shared 12-second deadline per provider. Incomplete history is reported as degraded, not as an empty/successful full scan. Larger historical backlogs require a separate bounded backfill. Provider errors do not stop the other providers or submitted-payment retries. The same payment signature cannot settle two records; failed unique-intent submissions can recover automatically when the actual payment appears. Original legacy submissions retain their original TxID binding.

An exact six-decimal amount is the payment reference for the shared recipient wallet. Rounded payments, deducted network fees, payments to another recipient, unsupported assets, ambiguous matches and pre-intent transfers are not auto-credited. Do not waive those checks or tell a seller to pay twice. Investigate any already-received unmatched payment with its original evidence.

## Configuration

- `CRON_SECRET`: existing production secret, at least 32 characters.
- `ALPHA_EXCHANGE_TRONGRID_API_KEY`: recommended for authenticated TronGrid quota. Public access remains supported.
- `ALPHA_EXCHANGE_ETHERSCAN_API_KEY`: existing key must include BSC chain 56 history access. Failures distinguish `bep20_index_plan_unsupported`, `bep20_index_key_invalid`, `bep20_index_rate_limited` and `bep20_index_unavailable`. Submitted BEP20 TxID verification remains independent of this index.
- `ALPHA_EXCHANGE_BSC_RPC_URL`: optional synced BSC mainnet RPC override.
- `ALPHA_EXCHANGE_BINANCE_READ_API_KEY` and `ALPHA_EXCHANGE_BINANCE_READ_API_SECRET`: optional **read-only** credentials on the account receiving commission deposits. Keep trading, withdrawals and transfers disabled. Save only as server secrets; never in source, chat, logs or `NEXT_PUBLIC` variables. Use the owner's secure settings flow and obtain authorization before creating new account access.

The Binance adapter only calls `GET https://api.binance.com/sapi/v1/capital/deposit/hisrec`. Configure credentials from the account that owns the canonical receiving addresses. It does not support Binance Pay, UID/email transfers without a canonical deposit address, or uncredited/Travel Rule held deposits. Public blockchain deposits retain their original chain TxID and stay on the chain verifiers; an internal ID alias cannot credit the same public payment twice. Missing Binance credentials are explicitly reported as `providers.BINANCE_DEPOSITS.configured=false`. Do not claim internal deposits are live until configured and verified against a genuine incoming record.

A complete authenticated Binance history scan can cover BEP20 discovery when the Etherscan plan lacks chain 56 access. The explorer's error remains visible with `fallback: BINANCE_DEPOSITS`; incomplete or failed Binance scans never hide the explorer failure. Connecting the receiving account can therefore support both on-chain and internal deposits without a paid BEP20 explorer plan.

## Monitoring

Inspect `commission_payment_verification_cron` in production runtime logs. Summaries include provider configuration, page completeness, candidate and transfer counts, matches, verified/pending/rejected results, skipped used references, ambiguous matches, and `baseAmountOnly` for deposits equal to the base fee rather than the assigned payment amount. Diagnostics exclude credentials and customer identities.

`providerHealth` is a serialized summary so runtime console truncation does not hide provider results as `[Object]`. Individual failures also emit `commission_deposit_discovery` with a fixed reason code and provider name.

HTTP 401 = unauthorized caller. HTTP 503 = missing scheduler secret or degraded scan/retry. HTTP 500 = pending sweep failure. HTTP 200 alone is not proof a payment was received: inspect `verified` and `autoReconciliation.verified`.

After release, verify the deployed commit, scheduler authorization, each provider's status and a real credited commission. No live customer payment should be fabricated for a test. Native instructions in this change require a new native build; the server automation applies immediately to existing app clients.

## Provider references

- https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address
- https://docs.etherscan.io/api-reference/endpoint/tokentx
- https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/capital
