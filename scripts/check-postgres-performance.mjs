import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const resultPath = process.argv[2] ?? "test-results/postgres-concurrency/results.json";
const results = JSON.parse(await readFile(resultPath, "utf8"));
const measured = results.serverActionTiming;
const metrics = ["medianMs", "p95Ms", "maxMs"];
const valid = measured?.count === 240 && metrics.every(key => typeof measured[key] === "number" && Number.isFinite(measured[key]) && measured[key] >= 0)
  && measured.medianMs <= measured.p95Ms && measured.p95Ms <= measured.maxMs;
const evidence = { commit: results.commit, status: valid && measured.maxMs < 1000 ? "PASS" : "FAIL",
  requirement: "Every measured server action completes in less than 1000 ms", thresholdMs: 1000,
  scope: measured?.scope ?? "Missing action timing evidence", measured,
  reason: !valid ? "Incomplete or invalid 240-action measurement" : measured.maxMs >= 1000 ? "Subsecond action target exceeded" : "All measured actions below threshold" };
await writeFile(path.join(path.dirname(resultPath), "performance-gate.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
assert.equal(evidence.status, "PASS", evidence.reason);
