# Buyer and seller push event audit — updated 28 October 2026

This is a source and isolated regression audit integrated with main `dc2de1e` plus the notification changes. It does not establish delivery on a real device or production rollout readiness.

| Important event | Recipient and destination found in source | Audit result |
| --- | --- | --- |
| New marketplace listing / saved price match | Eligible buyers; listing destination | Existing central publication path. See `appendMatchingPriceAlerts` and listing broadcast in `alpha-exchange-store.ts`. |
| New Buy Request / renewal | Eligible sellers; exact `/usdt-exchange/requests/<id>` | **Fixed:** direct transaction previously persisted a notice without invoking native push or realtime. `mutateDemands` now publishes canonical new notices after successful commit and transaction release. |
| Seller response to Buy Request | Request's buyer; exact request and `?offer=<id>` | **Fixed** through the same postcommit path. Replays, failed writes and canonical rebases cannot publish speculative duplicate notices. |
| Seller withdraws a current Buy Request response | Request's buyer; exact request and withdrawn response | **Added:** recipient-bound canonical notice after persistence. No self-alert or seller broadcast. Expired/stale/already closed responses and replay do not produce a new alert. |
| Buyer cancels a Buy Request | Distinct sellers with an open current-revision response who retain request access; exact request | **Added:** one canonical notice per eligible respondent after commit. Disabled/blocked/paused/revoked recipients and prior withdrawn/superseded responses are excluded. Buyer does not receive a self-alert. |
| Buy Request reaches its 12-hour expiry | Request's buyer; exact request to review/renew | **Added:** authenticated five-minute notification sweep observes the existing expiry policy. At most 100 notices/marker repairs per run, with a 24-hour recent-expiry window. Notification-only revision metadata survives inbox deletion/pruning; no lifecycle, quote, offer, reservation or trade state is changed. Matched/accepted and disabled accounts are excluded. |
| Buy Request seller response accepted | Selected seller; existing Trade Room alert | Existing new-trade-request path. Other responses become superseded; their sellers have no remaining action and receive no additional push. |
| New trade request / price offer | Listing seller; Trade Room | Existing central publisher in `createPurchaseRequest`. |
| Proposal / counter-offer | Other participant; Trade Room | Existing canonical publication after mutation. |
| Acceptance / decline | Buyer; Trade Room (counter acceptance also alerts seller) | Existing central publisher in status transition. |
| Trade cancellation / admin cancellation | Both participants; their Trade Room | Existing recipient loop. Admin destinations remain separate from participant destinations. Closing an unfinished trade follows this cancellation path. |
| Owner closes an already-completed trade | Informational Trade Room realtime update | `updateFinishedTradeByAdmin` preserves completion, settlement and history, and emits realtime only. It creates no new participant action or push notification. |
| Payment marked sent / payment evidence upload | Seller; Trade Room | Existing status and evidence paths. Evidence writes collect publications for after commit. |
| Funds confirmed / release started / USDT sent | Other participant; Trade Room | Existing central publication; seller also receives completion action after manually marking USDT sent. |
| Completion / review available | Buyer; Trade Room; seller commission action | Existing central publication. Review nudges use category `trade` with reviews center classification, requiring preference classification beyond category alone. |
| Commission due / overdue / verification pending | Seller; commission payment/status destination | Existing central publication; important blocking-action notices remain in-app. |
| Automatic / combined commission payment verified | Seller; checkout or listings/remaining-dues destination | **Fixed:** both runtime atomic wrappers now publish new canonical notifications after successful persistence, including browser scheduling and native push. Financial verification and settlement decisions are unchanged. |
| Action reminder / release deadline overdue | Responsible participant; Trade Room; admins separately | Existing `claimDueTradeActionReminders` and reliability notifications. |
| Dispute opened / resolved | Both participants; Trade Room; separate admin destination | Existing canonical postcommit publication. |
| Trade Room message, including owner message | Other participant(s); Trade Room chat | Existing publication. Owner messages share `reason=trade_room_message` but have a different title; push preference classification must use conversation semantics, not only one literal title. |
| Seller application approved / rejected | Applicant; seller dashboard / application destination | Existing application notifications; approval explicitly publishes after persistence. |
| Listing expiry | Seller; own listing workspace | Existing central publication. |

## Verified changes

Executed together: `usdt-demand-push-publication.test.ts`, `usdt-demand-notifications.test.ts`, `commission-batch-runtime.test.ts`, `commission-checkout-runtime.test.ts`: **4 files, 56 tests passed**.

The new tests exercise correct recipients, persisted destinations, publication only after commit/release, idempotent replay, concurrent settlement, failure suppression, canonical rebase suppression and archived email-only notice exclusion. All providers are mocked; no real messages or payments were sent.

Final Buy Request terminal-event validation executed `usdt-demand-terminal-notifications.test.ts`, `usdt-demand-push-publication.test.ts`, `usdt-demand-notifications.test.ts`, `usdt-demand.test.ts` and `usdt-demand-workspace-contract.test.ts`: **5 files, 116 tests passed**, including **36 new terminal-event tests**. These counts overlap the earlier run; they are not additive. The new cases cover withdrawal/cancellation recipients, paused/disabled/blocked/opted-out recipients, replay and storage failures, accepted/stale/expired guards, English/Arabic destination persistence, 12-hour policy expiry, the 24-hour recovery window, batches beyond 100, renewed revisions, canonical rebases, and durable deduplication after inbox deletion/pruning. Targeted ESLint and Git whitespace checks passed.

## Boundaries retained or covered by the wider audit

- Existing browser logic makes push depend on in-app notifications being enabled; this pass preserves that behavior rather than redesigning canonical hidden notification storage.
- Native delivery must recheck current user/session/subscription eligibility and preferences; the separate transport audit owns that change.
- Browser category preferences must recognize owner chat, feedback notices categorized as trade, and explicit admin destinations; the separate browser audit owns those changes.
- Economic news notices have a direct realtime-only publisher. They were inspected but are outside this buyer/seller transaction-focused change.
- New Buy Request editing deliberately avoids broadcasting every unrestricted edit; no additional broad marketing broadcasts were added.
- The Buy Request withdrawal, cancellation and expiry rows were added during the final completeness review; the earlier Trade Room cancellation row did not cover these events. Terminal notices honor existing in-app/push preferences and do not enqueue the open-request email template.
- Expiry cron catches events from the previous 24 hours. Requests that expired before that window are intentionally not backfilled as fresh alerts; renewals receive a new expiry notice only when their new revision expires. Seller cancellation recipients retain the same access checks as the existing request-detail endpoint, avoiding a push that opens an inaccessible request.
