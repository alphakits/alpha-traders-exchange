# Commission receiving amount and sender network fee

The seller must cover any fee deducted by their sending service so the platform receives the displayed commission amount in full. A 40-USDT target with a deducted 1-USDT fee means sending 41 USDT. If the fee is charged separately, the transfer remains 40 USDT.

## Interface

- English and Arabic checkout now label the exact target **Platform must receive**.
- The setup field and copy button refer to the receiving amount. Copying preserves all six decimals used for attribution.
- One short reminder assigns network fees to the seller. An expandable **Fee example** explains deducted versus separately charged fees and directs the seller to their wallet's actual fee.
- Earlier-payment instructions use the same wording. The warning against a duplicate payment remains visible.
- The example is explanatory, not a live fee quote. No fixed fee is added to checkout amounts or commission records.

## Verification scope

The story is seller checkout → authenticated checkout API → reserved receiving amount → scheduled provider discovery and independent confirmation → atomic settlement → updated seller status.

Two new integration cases use the actual isolated repository and mocked TRC20/BEP20 provider boundaries. A full 40-USDT receipt remains unpaid while confirmation is pending; after confirmation, concurrent scans settle it once, preserve the 40-USDT obligation, record no excess or shortfall, and generate one notification. Repeated scans do not settle it again.

Two new clipboard cases cover English and Arabic: the exact 40.000001-USDT receipt target is copied unchanged. The example fee never changes the copied target or issues a payment request.

Existing discovery, independent receipt verification, scheduler, API authorization, recovery and replay tests remain applicable. Browser fixtures cover small and six-decimal amounts plus the 40-USDT example on phone and desktop in both languages. These browser fixtures do not send funds.

The focused local suite passed 159 tests across nine files, including the preserved ±2-USDT cases on both networks. The initial UI run caught a changed duplicate-payment warning expected by an existing test; that wording was restored and all 32 UI tests passed on the focused rerun. ESLint and the production build (including type validation) passed. A standalone type check overlapped the build's cleanup of generated types and was invalidated; the subsequent build's type-validation result is authoritative.

The first local Chromium attempt could not launch because its browser executable was absent. That attempt is an environment failure, not a passing visual check. Browser evidence and hosted release-gate results are recorded separately in the audit report.

## Live observation

At 20:41 UTC on 17 October 2026, a bounded read-only production log sample contained 15 consecutive successful checkout scans, with complete receiving history and zero reported errors. No new payment was verified in that sample. The BEP20 index reported its existing plan limitation and used the configured Binance deposit-history fallback; TRC20 and Binance history reported complete scans.

The live application was still commit `27f1a15ff8aafbbd48e7ce7789b248cd5d3f9c04`. These logs establish that the scheduler was running, not that this UI revision had shipped or that a new real transfer had settled. Controlled real transfers on both networks and production release acceptance remain outstanding.

The receiving guidance does not change the previously approved ±2-USDT matching tolerance. The wider audit candidate's separate shortfall carry-forward policy is still an open financial cutover decision; this wording change does not authorize it.

## Provider semantics

Binance distinguishes a receiving amount from a withdrawal total: in the former the fee is added to the total debit; in the latter it is deducted from that total. Wallets may instead charge network resources separately. The wallet's final recipient amount is therefore the relevant check.

- https://www.binance.com/en/support/faq/detail/115003670492
- https://developers.tron.network/docs/paying-for-resources
