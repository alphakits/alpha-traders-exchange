# Buy Requests PC continuation — 25 October 2026

This continuation uses the existing PC draft at `d2e6fe9e44b4063a322cd3053293c70e277a7ff5`. The later cloud rebuild did not discover that checkout; its parallel `buy_requests` table is not used. The existing `usdt_demands` model and canonical Trade Room remain the implementation.

## Current rules

- At most two publications in any rolling 24-hour window. Creation and publishing an expired/cancelled request again consume a slot. The existing five-minute gap between publications remains.
- Each publication lasts 12 hours. One open request per account.
- A current open or price-paused request can be edited. Editing does not consume a slot or extend expiry. Changed terms invalidate previous seller responses; saving unchanged terms preserves them.
- Accepting a seller response and creating its canonical trade locks the request. A seller response alone does not lock it. A later cancelled/declined trade does not unlock those accepted terms; publish a separate request if eligible.
- Cancelling a request does not refund its publication slot.
- Both buyer and seller prices remain within the fresh reference ±₪0.35. Existing payment methods, fees, eligibility, inventory, capacity and atomic trade checks remain in force.
- Edits do not broadcast a new-request notification to the whole seller base. New publications retain the existing notification flow and delivery preferences.

The API uses `PATCH action: edit` for active requests, and `action: renew` to publish an expired/cancelled request again. A legacy client sending `renew` for an active request receives edit semantics, with no expiry or quota reset. English and Arabic distinguish **Edit request / Save changes** from **Publish again**, show remaining slots, and show time remaining.

## Verification and release scope

The current task's output checkpoint records final checks and the exact source commit. Historical October 24 test counts belong to their recorded source versions and are not new evidence for this change.

The older handoffs predate the separately authorized protected Vercel/Supabase staging setup recorded on October 24. This continuation changes and verifies local source; it does not update or reverify that hosted preview, or imply that it includes these rules. Existing hosted lifecycle, concurrency, recovery, provider-delivery, exact release CI and physical-device gates remain open unless independently closed with new evidence.

The original manual offline runtime `run-m2Nayb` is retained. Automated tests use a separate synthetic runtime. Push remains disabled on the repository remote. No production data, deployment, payments or real messages are part of this local continuation.

## Local review

The updated preview uses `http://localhost:3212/en/login?redirectTo=/en/usdt-exchange/requests` with synthetic accounts `buyer@offline.example.test` and `seller@offline.example.test`, both using `OfflineDemo!2026`. Use separate browser sessions for the two roles. The reference is a fixed test quote; no money or external messages are sent.

To resume this preview after stopping it, use the repository's Node 24.22.1 runtime with:

```text
node scripts/usdt-request-offline.mjs --production --port 3212 --resume-runtime "C:\Users\micro\Documents\Codex\2026-10-24\continue-the-new-usdt-task\work\usdt-offline-runtime\run-1frRCq"
```

Do not launch a second process on the same port or runtime. The source ZIP excludes dependencies and generated builds; the local checkout retains the verified bundle. The output checkpoint records the source path, branch, commit and artifact hashes.

## Verified October 25

- 246 backend tests across 12 files and 74 component tests across two files passed.
- All 21 browser scenarios have passing Chromium results: 20 from the full run plus the corrected and extended policy case from its focused run. The original exact-error assertion failure and fixture-startup timeout are retained in the evidence logs.
- All 21 WebKit scenarios passed in the final serial run. An earlier concurrent run reached trade creation but exceeded its aggregate timer before final navigation; the successful run used the same timeouts.
- The isolated production build, application lint/type checks and diff checks passed with Node 24.22.1. The initial sandbox filesystem/loopback failures and corrected browser-path setup remain documented.
- Automated accessibility checks passed for English and Arabic at 320px. Browser automation does not establish representative physical-device, live provider, hosted concurrency, recovery or production release readiness.

The output verification ZIP contains the current run logs, component/legacy verification records, last-run browser records and checkpoint manifest. Historical October 24 totals are not included in these new test counts.
