# Approved commission shortfall flow

The owner explicitly confirmed that the sender covers the network fee and that
any verified, accepted shortfall carries into the next commission, including
repeated short payments. Keep the existing +/-2-USDT matching tolerance. This
approval resolves the previous policy decision; it does not claim live-provider
or full-platform acceptance.

The seller sees a brief network-fee reminder before getting instructions and
beside the receiving amount. The optional example uses the actual receiving
amount: if 100 must arrive and the wallet deducts a 1-USDT fee, send 101. If the
fee is charged separately, send 100. The wallet's actual fee is authoritative.

After 98 arrives against 100, the screen confirms the verified payment and says
that the remaining 2 will be included in the next commission. The optional
receipt breakdown shows 100 due, 98 received and 2 remaining. When another 100
becomes payable, the current screen separately shows 100 of current commissions,
2 remaining from previous payments and 102 total. It explicitly says the
commission rate has not changed. The same explanation is available in Arabic,
including RTL layout, and in the payment notification. Existing mobile carried
records use the same calm explanation.

Two additional issues were reproduced and repaired:

- A previously opened receiving-amount input retained its old value when the
  canonical total changed. It now updates when that total changes, including
  a new commission with carried debt, while preserving an edit if the total
  has not changed.
- A later receipt could be rejected because it matched the same seller's old
  exact instruction, despite that entire group already having verified payment.
  The application and database permit this only for the same seller after
  verified closure before the new instructions. Every original amount and
  transaction reservation remains. Other sellers' references, missing proof,
  late closure, manual paid flags and reused transactions remain blocked.

The database guard was installed and verified as migration
`20261017211725_commission_same_seller_closed_references.sql`; the runtime
checks for the function and fails closed if it is absent. Read-only production checks found 15 valid closed groups among 21 historical
checkouts; other-seller and non-later-instruction probes were rejected. Both
functions remain security-invoker, and the new helper is not executable by
PUBLIC. Security advisors report no WARN or ERROR findings. The migration changes
functions only; it does not rewrite customer payments or issue retrospective
shortfalls.

Executed local checks: 144 tests across the durable database guard, runtime,
ledger, batch runtime and checkout UI passed. The exact repeated sequence
100/98 -> 102/100 -> 102/102 passed for both TRC20 and BEP20 with synthetic
provider verification and persistent repository state. The final balance is
zero; replaying each receipt never charges or settles twice. These are controlled
tests, not live transfers. Browser and release evidence is recorded separately.

The rendered WebKit phone view also exposed a light native select with white
text. The network selector now uses an explicit dark appearance and dropdown
indicator. The final browser rerun passed all eight phone/desktop English/Arabic
cases, including the selector, exact six-decimal instructions and the three-stage
carry-forward explanation. Screenshots capture the real application with synthetic
amounts; outside financial requests are disabled.
