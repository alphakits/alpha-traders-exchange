# Commission precision repair

The owner reconfirmed that each participant pays their own 1% share. The buyer
share remains included in the fiat payment to the seller. The seller remits
that collected share together with their own 1% under the existing P2P model.

New requests receive the server-owned `usdt_6dp_v2` calculation version. Their
final agreed USDT quantity determines each share, rounded half-up once to six
decimal USDT places. The combined obligation is the sum of those two shares.
The previous unapproved 0.01 USDT minimum per share no longer applies to new
requests. A quantity whose fee rounds to zero, or cannot retain exact
six-decimal precision in the numeric ledger, is rejected before submission or
agreement. The separate fiat total must remain positive at currency precision.

| Final quantity | Each 1% share | Combined obligation |
| --- | --- | --- |
| 0.1 USDT | 0.001 USDT | 0.002 USDT |
| 415.202811 USDT (₪1,300 / (₪3.10 × 1.01)) | 4.152028 USDT | 8.304056 USDT |

Existing requests, completed obligations and issued payment instructions retain
their original calculation. The calculation version is distinct from the
buyer/seller fee-policy version; neither may be lost during stale snapshot
merges. Existing unique payment-reference suffixes and settlement tolerances
are unchanged. These are payment association rules, not additional commission.

The contracts package supplies calculations, integer-micro-unit summation,
display formatting and editable payment amounts for web and native clients.
Trade rooms, seller totals, owner totals, CSV amounts, checkout input and
settlement confirmations retain up to six decimal places. Fiat totals remain
at their existing currency precision.

Regression coverage includes small fees, half-up boundaries, invalid/unsafe
numbers, the ₪1,300 ATM example, all three payment methods, repeated completion,
legacy obligations, copied checkout amounts and stale request/commission
writers. The audit evidence directory records the before/after executions;
CI on the candidate commit is required before any release. This document does
not assert a production deployment.

The separate repeated-tolerance issue remains unresolved: repeated underpayments
within the current tolerance can cumulatively waive debt. Historical settled
payments are preserved while the owner clarifies the prospective carry/budget
rule. No tolerance fix is claimed by this change.
