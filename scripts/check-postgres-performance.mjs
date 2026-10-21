import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const resultPath = process.argv[2] ?? "test-results/postgres-concurrency/results.json";
const results = JSON.parse(await readFile(resultPath, "utf8"));
const rows = Array.isArray(results.timings) ? results.timings : [];
const scope = "240 successful status actions and 30 successful receipt uploads against loopback PostgreSQL, including concurrent lock waiting and awaited work. Excludes explicitly deferred trust persistence, browser/network time, external delivery and other operation types.";
function summarize(durations, expectedCount) {
  const valid = durations.length === expectedCount && durations.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const sorted = valid ? [...durations].sort((a, b) => a - b) : [];
  const percentile = fraction => sorted.length ? sorted[Math.ceil(fraction * sorted.length) - 1] : null;
  return { valid, count: durations.length, expectedCount, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1) };
}
const statusDurations = rows.filter(row => row?.ok === true && row.operation === "status").map(row => row.actionElapsedMs ?? row.elapsedMs);
const evidenceDurations = rows.filter(row => row?.ok === true && row.operation === "evidence").map(row => row.elapsedMs);
const groups = { status: summarize(statusDurations, 240), evidence: summarize(evidenceDurations, 30) };
const measured = { ...summarize([...statusDurations, ...evidenceDurations], 270), scope };
const valid = groups.status.valid && groups.evidence.valid && measured.valid;
const evidence = { commit: results.commit, status: valid && measured.maxMs < 1000 ? "PASS" : "FAIL",
  requirement: "All 240 measured status actions and 30 receipt uploads complete in less than 1000 ms", thresholdMs: 1000,
  scope, measured, groups,
  reason: !valid ? "Incomplete or invalid 240-status/30-receipt measurement" : measured.maxMs >= 1000 ? "Subsecond action target exceeded" : "All measured actions below threshold" };
await writeFile(path.join(path.dirname(resultPath), "performance-gate.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
assert.equal(evidence.status, "PASS", evidence.reason);
