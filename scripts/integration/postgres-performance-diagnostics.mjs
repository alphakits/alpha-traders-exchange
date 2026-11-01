// Read only the isolated audit's numeric timings and fixed category names. Never
// forward payloads, SQL, parameters, identifiers, paths, or error messages to CI.
const phases = new Set(["initial-before-fixtures", "acceptance-before-process-restart",
  "all-payment-methods-and-before-lost-follow-up-restart", "trust-recovery-before-transaction-kill", "final"]);
const statuses = new Set(["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "declined", "cancelled"]);
const queryKinds = new Set(["advisory_lock", "snapshot_aggregate", "runtime_version", "begin", "commit", "rollback"]);
const tables = new Set(["schema", "users", "seller_profiles", "seller_settings", "listings", "trades", "purchase_requests", "usdt_demands",
  "notifications", "commissions", "audit_logs", "evidence", "sessions", "password_reset_tokens", "seller_applications",
  "activity_logs", "disputes", "seller_reports", "trust_snapshots", "trust_score_history", "private_beta_invites",
  "private_beta_invite_uses", "beta_feedback", "beta_announcements", "admin_announcement_runs", "sms_deliveries",
  "marketplace_enforcement_records", "marketplace_enforcement_audit_log"]);
const waitTypes = new Set(["Lock", "LWLock", "IO", "Client", "Activity", "IPC", "Timeout", "BufferPin", "Extension"]);
const waitEvents = new Set(["advisory", "relation", "tuple", "transactionid", "virtualxid", "extend", "object",
  "WALWrite", "WALSync", "WALInsert", "WALBufMapping", "WALRead", "WALInitWrite", "WALInitSync",
  "DataFileRead", "DataFileWrite", "DataFileSync", "DataFileExtend", "BufferContent", "BufferMapping",
  "LockManager", "ProcArray", "XidGen", "ClientRead", "ClientWrite", "SyncRep", "CheckpointDone", "PgSleep"]);
const metricKeys = ["totalMs", "readDbMs", "timelineMs", "chatMs", "notificationMs", "writeDbMs", "sseMs", "trustMs"];
const walKeys = ["wal_records", "wal_bytes", "wal_write", "wal_sync", "wal_write_time", "wal_sync_time"];
const list = value => Array.isArray(value) ? value : [];
const numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const rounded = value => numeric(value) === null ? null : Math.round(value * 1000) / 1000;
const numericFields = (value, keys) => Object.fromEntries(keys.map(key => [key, rounded(value?.[key])]));
const workerId = value => typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : numeric(value);
const phaseName = value => phases.has(value) ? value : "other";
const statusName = value => statuses.has(value) ? value : "other";
function queryKind(value) {
  if (queryKinds.has(value)) return value;
  if (typeof value !== "string") return "other";
  const [verb, table, extra] = value.split(":");
  return !extra && ["select", "insert", "update", "delete", "with", "create", "alter"].includes(verb) && tables.has(table) ? `${verb}:${table}` : "other";
}
const duration = row => row.operation === "status" ? row.actionElapsedMs ?? row.elapsedMs : row.elapsedMs;
function callSummary(row) {
  return { nextStatus: statusName(row.nextStatus), worker: workerId(row.worker), durationMs: rounded(duration(row)),
    startedAt: numeric(row.startedAt), finishedAt: numeric(row.finishedAt),
    elapsedMs: rounded(row.elapsedMs), backgroundMs: rounded(row.backgroundElapsedMs),
    metrics: numericFields(row.metrics, metricKeys) };
}
function groupSummary(rows) {
  const durations = rows.map(duration).filter(value => numeric(value) !== null).sort((a, b) => a - b);
  return { count: rows.length, validTimingCount: durations.length,
    overThreshold: durations.filter(value => value >= 1000).length,
    p95Ms: rounded(durations[Math.ceil(durations.length * .95) - 1]), maxMs: rounded(durations.at(-1)) };
}
function querySummary(workers) {
  const aggregate = new Map();
  for (const row of list(workers).flatMap(list)) {
    const operation = queryKind(row?.operation);
    const item = aggregate.get(operation) ?? { operation, count: 0, totalMs: 0, maximumMs: 0 };
    item.count += numeric(row?.count) ?? 0;
    item.totalMs += numeric(row?.totalMs) ?? 0;
    item.maximumMs = Math.max(item.maximumMs, numeric(row?.maximumMs) ?? 0);
    aggregate.set(operation, item);
  }
  return [...aggregate.values()].sort((a, b) => b.maximumMs - a.maximumMs).slice(0, 4)
    .map(row => ({ operation: row.operation, ...numericFields(row, ["count", "totalMs", "maximumMs"]) }));
}
function walDelta(current, previous) {
  if (!current || !previous || current.stats_reset !== previous.stats_reset) return null;
  // pg returns the bigint/numeric WAL counters as strings.
  const number = value => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? numeric(Number(value)) : numeric(value);
  return Object.fromEntries(walKeys.map(key => {
    const end = number(current[key]), start = number(previous[key]);
    return [key, end === null || start === null || end < start ? null : rounded(end - start)];
  }));
}
function waitSummary(samples, slowCalls) {
  const intervals = slowCalls.filter(row => numeric(row.startedAt) !== null && numeric(row.finishedAt) !== null && row.finishedAt >= row.startedAt);
  const selected = list(samples).filter(sample => numeric(sample?.startedAt) !== null && numeric(sample?.finishedAt) !== null
    && intervals.some(row => sample.startedAt <= row.finishedAt && sample.finishedAt >= row.startedAt));
  const tallies = new Map();
  for (const sample of selected) for (const backend of list(sample.backends)) {
    if (backend?.wait_event_type === null && backend?.wait_event === null) continue;
    const type = waitTypes.has(backend?.wait_event_type) ? backend.wait_event_type : "other";
    const event = waitEvents.has(backend?.wait_event) ? backend.wait_event : "other";
    const key = `${type}:${event}`;
    const item = tallies.get(key) ?? { type, event, observations: 0, maxTransactionAgeMs: null };
    item.observations++;
    const rawAge = backend?.transaction_age_ms;
    const age = typeof rawAge === "string" && /^\d+(\.\d+)?$/.test(rawAge) ? numeric(Number(rawAge)) : numeric(rawAge);
    if (age !== null) item.maxTransactionAgeMs = rounded(Math.max(item.maxTransactionAgeMs ?? 0, age));
    tallies.set(key, item);
  }
  return { slowCallWindows: intervals.length, overlappingSamples: selected.length,
    waits: [...tallies.values()].sort((a, b) => b.observations - a.observations).slice(0, 8) };
}

export const MAX_DIAGNOSTIC_BYTES = 11500;
export function formatPostgresPerformanceDiagnostics(results, waitDiagnostics, queryTimings) {
  const measured = list(results?.timings).filter(row => row?.ok === true && ["status", "evidence"].includes(row.operation));
  const successful = measured.filter(row => numeric(duration(row)) !== null);
  const sorted = operation => successful.filter(row => row.operation === operation).sort((a, b) => duration(b) - duration(a));
  const status = sorted("status"), evidence = sorted("evidence");
  const queryPhases = Array.isArray(queryTimings) ? queryTimings : list(queryTimings?.phases);
  const runtime = list(waitDiagnostics?.runtimeDiagnostics);
  const phaseRows = [...new Set([...runtime, ...queryPhases].map(row => phaseName(row?.phase)))].slice(0, 6).map(phase => {
    const index = runtime.findIndex(row => phaseName(row?.phase) === phase);
    const entry = runtime[index];
    const workers = list(entry?.workers);
    const previousCapture = numeric(runtime[index - 1]?.capturedAt), capture = numeric(entry?.capturedAt);
    return { phase, intervalMs: capture === null || previousCapture === null ? null : rounded(capture - previousCapture),
      queries: querySummary(queryPhases.find(row => phaseName(row?.phase) === phase)?.workers),
      workers: workers.slice(0, 4).map(worker => ({ worker: workerId(worker?.workerId),
        cpuMs: numericFields(worker?.cpuMs, ["user", "system"]),
        eventLoopDelayMs: numericFields(worker?.eventLoopDelayMs, ["mean", "max", "p99"]),
        omittedSlowQueries: numeric(worker?.omittedSlowQueries) })),
      slowQueries: workers.flatMap(worker => list(worker?.slowQueries).map(query => ({ worker: workerId(worker?.workerId),
        operation: queryKind(query?.operation), elapsedMs: rounded(query?.elapsedMs) })))
        .sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0)).slice(0, 3),
      walDelta: walDelta(entry?.wal, runtime[index - 1]?.wal) };
  });
  const report = { scope: "Isolated audit only. readDbMs includes pool/lock/read waits. Query timing includes client queuing. Sample windows include IPC/deferred work; observations are not wait durations.",
    diagnosticsEnabled: waitDiagnostics?.enabled === true,
    available: { waitDiagnostics: !!waitDiagnostics, queryTimings: !!queryTimings },
    samplingErrorCount: list(waitDiagnostics?.samplingErrors).length,
    counts: { status: groupSummary(measured.filter(row => row.operation === "status")), evidence: groupSummary(measured.filter(row => row.operation === "evidence")) },
    statusGroups: [...new Set(status.map(row => statusName(row.nextStatus)))].map(nextStatus => ({ nextStatus, ...groupSummary(status.filter(row => statusName(row.nextStatus) === nextStatus)) })),
    slowest: { status: status.slice(0, 5).map(callSummary), evidence: evidence.slice(0, 5).map(callSummary) },
    phases: phaseRows,
    overlappingSlowCallWaits: waitSummary(waitDiagnostics?.databaseSamples, successful.filter(row => duration(row) >= 1000)),
    truncated: false };
  let serialized = JSON.stringify(report);
  // The logs remain bounded even if future audit phases or large numeric fields
  // grow. Retain every phase and the worst call of each operation when trimming.
  while (Buffer.byteLength(serialized) > MAX_DIAGNOSTIC_BYTES) {
    report.truncated = true;
    const arrays = [report.slowest.status, report.slowest.evidence, ...report.phases.flatMap(phase => [phase.queries, phase.slowQueries, phase.workers])];
    const longest = arrays.filter(array => array.length > 1).sort((a, b) => b.length - a.length)[0];
    if (!longest) break;
    longest.pop();
    serialized = JSON.stringify(report);
  }
  return serialized;
}
