// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Timing = { operation: string; ok: boolean; elapsedMs: number; actionElapsedMs?: number };
function timings(): Timing[] {
  return [
    ...Array.from({ length: 240 }, () => ({ operation: "status", ok: true, elapsedMs: 900, actionElapsedMs: 200 })),
    ...Array.from({ length: 30 }, () => ({ operation: "evidence", ok: true, elapsedMs: 200 })),
  ];
}
function run(rows: Timing[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "alpha-performance-gate-"));
  try {
    const input = path.join(dir, "results.json");
    writeFileSync(input, JSON.stringify({ commit: "isolated-fixture", timings: rows,
      serverActionTiming: { count: 240, medianMs: 200, p95Ms: 200, maxMs: 200, scope: "Fixture summary" } }));
    let passed = true;
    try { execFileSync(process.execPath, ["scripts/check-postgres-performance.mjs", input], { stdio: "pipe" }); }
    catch { passed = false; }
    return { passed, evidence: JSON.parse(readFileSync(path.join(dir, "performance-gate.json"), "utf8")) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("release performance evidence includes receipt uploads", () => {
  it("accepts all 270 measured actions below the unchanged threshold", () => {
    const rows = timings(); rows.at(-1)!.elapsedMs = 999.999;
    const result = run(rows);
    expect(result.passed).toBe(true);
    expect(result.evidence.measured.count).toBe(270);
    expect(result.evidence.groups.evidence.count).toBe(30);
  });
  it.each([1000, 1250])("rejects a receipt taking %s ms even when status actions pass", duration => {
    const rows = timings(); rows.at(-1)!.elapsedMs = duration;
    const result = run(rows);
    expect(result.passed).toBe(false);
    expect(result.evidence.status).toBe("FAIL");
    expect(result.evidence.groups.evidence.maxMs).toBe(duration);
  });
  it("rejects a slow status action even when a supplied summary claims success", () => {
    const rows = timings(); rows[0].actionElapsedMs = 1000;
    expect(run(rows).passed).toBe(false);
  });
  it.each(["missing", "failed", "negative", "invalid"])("rejects %s receipt measurements", kind => {
    const rows = timings();
    if (kind === "missing") rows.pop();
    if (kind === "failed") rows.at(-1)!.ok = false;
    if (kind === "negative") rows.at(-1)!.elapsedMs = -1;
    if (kind === "invalid") rows.at(-1)!.elapsedMs = Number.NaN;
    const result = run(rows);
    expect(result.passed).toBe(false);
    expect(result.evidence.reason).toMatch(/Incomplete or invalid/);
  });
  it("excludes explicitly deferred trust work while retaining awaited action time", () => {
    const rows = timings(); rows[0].elapsedMs = 5000;
    expect(run(rows).passed).toBe(true);
    rows[0].actionElapsedMs = 1000;
    expect(run(rows).passed).toBe(false);
  });
});
