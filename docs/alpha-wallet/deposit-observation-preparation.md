# Admitted deposit observation preparation

This is the preparation layer of the [durable inbox contract](deposit-observation-ingestion-design.md). It supplies development admission, bounded observation capture, historical replay and prepared evidence. The preparation module itself creates no database, persistent receipt, candidate job, custody claim, wallet credit or financial command; its [separate persistence layer](deposit-inbox-persistence.md) now supplies isolated durable evidence and recovery. Prepared observations and verified preparation results carry `mode: "simulation-only"` and `creditAuthority: false`.

## Modules and API

| Module | Responsibility |
| --- | --- |
| [`deposit-inbox-data.ts`](../../src/lib/alpha-wallet/deposit-inbox-data.ts) | Capture bounded inert data without invoking getters or Proxy traps; canonical versioned hashes; sanitized errors. |
| [`deposit-inbox-admission.ts`](../../src/lib/alpha-wallet/deposit-inbox-admission.ts) | Immutable normalized manifest, dependency-bound record hashes, endpoint commitments and worker-scoped candidate resolution. |
| [`observation-transcript.ts`](../../src/lib/alpha-wallet/observation-transcript.ts) | Capture timing around the unchanged BSC/TRON observers and reproduce each observer from exact original reads and semantic clocks. |
| [`deposit-observation-preparation.ts`](../../src/lib/alpha-wallet/deposit-observation-preparation.ts) | Bind admitted records to a trusted synthetic store context and prepare a serializable envelope; separately verify historical consistency and current admission freshness. |
| [`deposit-observation-fixtures.ts`](../../scripts/alpha-wallet/deposit-observation-fixtures.ts) | Deterministic synthetic native responses through explicit `.invalid` sources for tests. No ambient fetch or actual provider configuration. |

```ts
const reader = createAdmittedDevelopmentObservationReader({
  mode: "simulation-only",
  manifest, workerId, storeInstanceId,
  endpointConfig, // [{ sourceId, endpoint }], exactly the admitted sources
  fetch: syntheticFetch,
  clock: syntheticClock,
  preparationContext: recorder.preparationContext, // isolated retained development history
});

const prepared = await reader.prepare({
  attemptId,
  candidate: { assignmentId, sourceSetId, transactionId, eventIndex, amountRaw },
  // jobId is optional and must bind the context's finite candidate cursor.
});

const validated = await verifyPreparedDepositObservation({
  mode: "simulation-only", manifest, workerId, storeInstanceId, prepared,
});
checkPreparedDepositAdmissionFreshness(validated, currentTimeMs);
```

The trusted constructor supplies the manifest, configured store-instance identifier, worker, endpoint configuration and capabilities. The candidate cannot select another token, recipient, beneficiary, purpose, chain, policy or worker. Raw units and native event indices are exact decimal strings. Endpoint configuration must match the normalized HTTPS URL's SHA-256 and host commitment before any callback or node read. Actual URLs stay in the reader closure and do not appear in prepared envelopes or diagnostic errors.

The context callback receives a frozen copy of `{ inboxId, storeInstanceId, manifestSha256, workerId, candidate, jobId }`. It must return the closed `development-deposit-preparation-context` version-1 snapshot, either as inert data or an unmodified native Promise. Plain thenables, accessors, Proxy values and Promise subclasses are refused. The snapshot binds the admitted assignment/source set, global checkpoint revision/hashes, optional retained source head and optional finite job cursor. Revisions and native head identities are validated, including TRON's height-bearing block ID.

**The callback remains a trusted development boundary.** Matching hashes and valid snapshot fields alone do not prove a database checkpoint or membership in a persisted job. The [implemented recorder](deposit-inbox-persistence.md) supplies `recorder.preparationContext` from retained store history and compares the captured base and cursor again inside that same physical store. Tests can still inject a synthetic context. Preparation itself performs no durable acceptance/quarantine, cursor advance, unknown-COMMIT resolution or restoration; those operations belong to the persistence contract.

## Timing, cancellation and replay

One preparation has a strict total budget of less than 30 seconds, checked with both an injected wall clock and a real monotonic clock. The budget includes context lookup, native reads, hashing and replay validation. A never-resolving context Promise expires; a late callback result cannot start node IO. Per-read capture retains the existing less-than-5-second budget. All reads remain bounded by 1 MiB each, 16 MiB combined raw request/response bytes, 160 reads and eight semantic clock calls.

Each reader is single-flight. Concurrent or reentrant preparation poisons that reader, aborts pending IO and prevents any pending attempt from returning success. A consumed attempt ID cannot trigger another observation. The reader retains at most 256 attempt IDs without eviction. A normal failed attempt can be followed by a different attempt ID; retrying a later durable operation must reuse its original prepared bytes rather than reobserve.

Runtime admission is checked at construction, before preparation, around callbacks and native IO, and before completion. Production, hosted, mainnet-enabled and signing-enabled environments remain refused. The root abort signal composes with the native transport's read signal, and unread late response bodies are cancelled. Provider and callback exception text is never copied into returned errors. Root timeout, runtime and closed-session classifications survive the existing transport's generic IO error handling.

The timing trace records per-read enclosing wall intervals, conservative integer microsecond elapsed intervals and offsets, and the observer's semantic clock calls at their exact read boundaries. Original raw native bytes and response hashes remain intact. Replay checks native JSON, request serialization, BSC RPC UUID/session ordinals and matching response IDs, TRON exact integer literals, source/operation/argument order, every read and every semantic clock. It reruns the existing observers and frozen decoders, then compares the complete original observation digest. Canonical serialization of the outer envelope remains valid because replay reconstructs the original observer's field insertion order.

`verifyPreparedDepositObservation` verifies historical consistency without consulting current wall time or a provider. Old, internally valid evidence can still be inspected. `checkPreparedDepositAdmissionFreshness` accepts only a branded verification result and checks a genuinely new admission against the current time: less than 30 seconds after the observation's completion, configured future skew, and both pinned-checkpoint and last-validated-head freshness. Replaying a stale observation does not make it newly admissible.

## Identities and assurance

The verified result returns the prepared envelope, native semantics and identity fields. Native event locators contain chain identity, transaction ID, native index kind and event index. They exclude token, recipient, amount, assignment and block placement so contradictory facts do not create a different native position. Event-facts hashes bind those excluded facts and the assignment; transaction-facts hashes bind the complete receipt semantics and transaction placement. The recorder uses the transaction key to catch BSC re-inclusion with a changed block-wide log index.

The admitted evidence ID binds the manifest, source-set and assignment hashes, comparison profile and exact observation digest. Changing only an attempt ID does not create additional evidence. A fresh read with different RPC IDs or timing can have another observation digest while retaining identical native event and transaction facts; this phase does not count either observation as corroboration.

Replay returns the original pinned proof checkpoint separately from the last fully validated head. Validated block semantics retain ordered transaction membership and supported TRON headers; their hashes exclude the list of supporting source IDs. The implemented recorder adds overlap/continuity checks, durable first-fact retention and absorbing global quarantine.

New hashes use SHA-256 over UTF-8 `["alpha-wallet-deposit-inbox-v1", domain, value]`, with lexicographically ordered object keys and preserved array order. Inputs are deeply copied and frozen, bounded by actual UTF-8 JSON size, and reject unsafe numeric values, malformed Unicode, cycles, sparse arrays, executable fields and reserved object keys. Hashes demonstrate consistency. They do not authenticate a provider, clock, organization, custody assignment or restored store.

## Remaining work

The [separate implemented persistence contract](deposit-inbox-persistence.md) supplies the isolated SQL inbox, deterministic durable reducer, immutable command receipts, transaction/block anchors, finite jobs/cursors, same-target unknown-COMMIT fencing, paused backups and quarantine-only restores. Complete chain scanning, wallet credit authorization, direction exclusion, reconciliation, real custody, signing, payout execution and product routes remain unfinished. No deployment or live launch is part of either development phase.

## Historical preparation verification

Implementation `68ee52017b18631bfbd44acb3c5afea44a3c8223`, tree `b16deed3ad860c77923d0d3d4780f37343812434`, passed [CI run 42280807815](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42280807815) on **6 November 2026, 21:53:24 Asia/Jerusalem**. The complete run reports **3,604 passing tests across 87 files**, including all 3,130 predecessors and 474 distinct additions, with zero failures or skips. The 18 existing native PostgreSQL drills / 212 ordered checks, repository TypeScript, offline demo and retained English/Arabic Chromium rehearsal also passed. These native and browser checks retain previous contracts; they do not test a new durable inbox or product route. See the [verification report](deposit-preparation-verification-2026-11-06.md) and [machine-readable evidence](deposit-preparation-verification-results.json).

The later [inbox verification report](deposit-inbox-verification-2026-11-06.md) and [machine-readable evidence](deposit-inbox-verification-results.json) bind the separate persistence/recovery source and its new native drills. The preparation counts above remain their original historical milestone.
