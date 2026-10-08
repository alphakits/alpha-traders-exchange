# Private trading journal — review build

This adds a personal trading journal at `/en/journal` and `/ar/journal` for signed-in members, including buyers, sellers, and students. It is an independent journal for the member's own market trades. P2P exchange transactions are not imported or changed.

The supplied standalone journal informed the trade fields, calendar, image support, and performance overview. The implementation replaces browser-only production persistence with account-scoped storage and rebuilds the interface for mobile use.

## Member experience

| Screen | Working behavior |
| --- | --- |
| Overview | Today, Monday–Sunday week, month, or all-time results; net P&L, win rate, closed/open counts, plan adherence, cumulative P&L, drawdown, profit factor, interactive calendar, and recent trades. The calendar has its own month control. |
| My trades | Add, edit, and delete; search symbol/setup/notes; filter wins, losses, break-even, or open trades; export the selected period as CSV. |
| Trade details | Symbol, side, date/time, gross result, fees; optional position size, entry/exit, stop/target, initial risk, setup and session. Notes, emotion, rule adherence, and mistake tags live in a separate tab. |
| Charts | Up to three screenshots per saved trade. Mobile image resizing, server decoding/re-encoding, private storage, and authenticated reads. No public image URLs. |
| Review | Daily and weekly notes stored separately: preparation, what went well, what to improve, next focus, execution rating, and chronological trade list. No-trade days can be reviewed. |
| Insights | Breakdown by setup, emotion, session, and symbol; on-plan/off-plan comparison; mistake associations; realized R and drawdown. These are deterministic calculations, not an AI chat or trading predictions. |
| My rules | Editable timezone, daily loss threshold, maximum trades per day, and trading plan. Reminders do not place orders or restrict broker access. |

English and Arabic are included. Financial values use consistent LTR USD formatting in both interfaces. User notes render as text with automatic text direction. Dialogs support keyboard focus, Escape, and unsaved-change confirmation. The existing native app loads the website through `WebsiteAppShell`; the journal uses that same first-party route and account session.

## Financial definitions

- All entries are USD. No automatic FX conversion or broker contract multiplier is assumed. The trader enters the broker's actual P&L.
- Net realized P&L = gross P&L minus fees, calculated in integer cents.
- Open trades are counted separately and excluded from realized results, win rate, equity, and realized R. Their entered fees become part of realized results when closed.
- Wins have net P&L greater than zero; losses are below zero; exactly zero is break-even. Win rate is wins divided by all closed trades, including break-even trades.
- Profit factor = positive net P&L / absolute negative net P&L. No losing observations show “No losses”, not a fabricated ratio.
- Drawdown starts from zero and follows closed trades by session date, entry time, then stable tie-break. It describes this journal's cumulative P&L, not a broker's intraday equity curve.
- Realized R = net P&L / recorded initial risk. Missing or zero risk is not imputed.
- Dates are explicit session dates; closed trades use their closing session date. Changing the reporting timezone does not move recorded trades to other dates. Weekly notes start on Monday.
- Plan adherence uses reviewed closed trades only. Mistake tags may overlap; their associated results are not attributed as causal effects.

## Account and data boundaries

- API authorization uses the current Alpha account session, including disabled-account checks. No user ID is accepted in any journal body.
- Database requests execute as a limited, non-login, non-bypass role within a transaction. The verified account ID is set transaction-locally. Every journal table has forced row-level security; browser database roles have no grants. Queries also explicitly scope by account.
- Optimistic record versions reject stale edits and duplicate creates. Client-generated trade IDs make retry conflicts visible instead of duplicating trades.
- Responses and private chart bytes are `private, no-store`. Notes are never interpreted as HTML. CSV text fields neutralize spreadsheet formula prefixes.
- Chart uploads accept PNG/JPEG/WebP, enforce streamed size limits, validate the signature, and decode/re-encode to WebP to strip metadata. Files are served only after an ownership check.
- File deletions enqueue durable storage cleanup in the same transaction, including account-deletion cascades. A secret-protected hourly task removes queued blobs and abandoned upload reservations.
- Reads page at 500 trades and compare dataset revisions across pages; a concurrent change asks the client to reload instead of presenting mismatched totals. A database failure never falls back to process memory or pretends a save succeeded.

## Preview and release status

The self-contained HTML preview is generated from the same React components:

```sh
node scripts/build-journal-preview.mjs /absolute/path/Alpha-Traders-Trading-Journal.html
JOURNAL_BROWSER_EXECUTABLE=/path/to/chromium node scripts/verify-journal-preview.mjs /absolute/path/Alpha-Traders-Trading-Journal.html
```

The preview is clearly labelled, contains sample data, and offers a separate empty test journal. It saves to IndexedDB on the reviewer's current device. It is not connected to member accounts and does not demonstrate live synchronization. The sample dataset is not part of the production component or API.

Production is disabled unless `ALPHA_JOURNAL_ENABLED=1`. The default remains disabled in this review branch. Before enabling:

1. Obtain Mark's review of the working preview.
2. Apply `20261008200530_private_trading_journal.sql` in a staging database and verify the runtime database identity can assume `alpha_journal_runtime`. Verify the `journal-charts` bucket is private and that no broad existing storage policy exposes it.
3. Verify actual signed-in buyer, seller, and student routes and cross-account denial on staging, plus an actual private storage upload/download/deletion round trip and native iOS/Android image-picker behavior.
4. Run the existing repository release gates; merge/deploy only after approval, then enable the feature and verify production reads and saves.

The code has not applied a production migration or enabled a live feature. Embedded PostgreSQL tests exercise the real migration, SQL, RLS, stale writes, cleanup trigger, and HTTP trade handler. The browser harness exercises the actual interface with the preview adapter. Neither substitutes for the live-account and private-storage release checks above.

## Later enhancements requiring separate implementation

Broker imports/sync, automatic execution recognition, screen or voice recording, AI conversations, automatic chart analysis, multi-currency accounts, deposits/withdrawals, and import of legacy JSON/images are not implemented in this build. Any AI coaching should cite the relevant recorded trades, distinguish insufficient samples, and offer observations about process rather than promises of profit.

TradePath's public page was used as a feature reference, not as proof of access to its private application or a benchmark demonstrating superiority: https://www.tradepath.ai/
