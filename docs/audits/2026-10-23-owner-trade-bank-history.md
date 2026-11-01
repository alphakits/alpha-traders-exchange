# Owner trade bank history

The live owner trade table used the current listing bank when a historical trade
had no saved bank. The CSV and trade detail used the trade's recorded value, so
the table could attribute a current bank to an older trade without evidence.

The table now uses only `request.bankName`. An absent value displays **Not
recorded** in English or **غير مسجّل** in Arabic. Existing recorded bank values
remain visible. The CSV schema and values, historical records, payment rules,
and financial actions are unchanged.

Verification:

- The live export contained 147 rows across 19 rendered pages. Ordered trade
  IDs, USDT amounts, statuses, and the aggregate of all request amounts matched.
  The bank-column discrepancy was reproduced in English and Arabic. This
  aggregate includes cancelled and declined requests; it is not settled volume.
- English/Arabic exports for a search, status filter, and oldest-first sort
  contained the same three records and identical columns.
- Four new component cases failed before repair for missing or null recorded
  banks in English/Arabic. Two cases for an existing recorded bank already
  passed. All six pass after repair.
- All 45 owner-dashboard tests pass, including the existing export/filter/order
  regressions. Release CI and deployed verification are separate gates.

No historical bank was inferred, backfilled, or changed. Live checks were
read-only; no trade, payment, commission, customer account, or message was
created or modified. Raw customer export files are not included in this note.
