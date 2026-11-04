// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile), directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("independent process recovery", () => {
  it("recovers an accepted transfer after abrupt process exit without a second submission or settlement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-process-")); directories.push(directory);
    const database = join(directory, "wallet"), provider = join(directory, "provider");
    // Give the child only a minimal local test runtime; no application or cloud credentials.
    const options = { cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: "test" as const }, encoding: "utf8" as const, timeout: 60_000, maxBuffer: 64 * 1024 };
    const first = await run(process.execPath, ["--import", "tsx", "scripts/alpha-wallet/recovery-demo.ts", "prepare", database, provider, "--abrupt-exit"], options);
    const prepared = JSON.parse(first.stdout.trim());
    expect(prepared).toMatchObject({ simulationOnly: true, status: "submission_unknown", dispatchCount: 1,
      heldPrincipalRaw: "200000000", exitsWithoutClosingStore: true });
    const second = await run(process.execPath, ["--import", "tsx", "scripts/alpha-wallet/recovery-demo.ts", "recover", database, provider], options);
    expect(JSON.parse(second.stdout.trim())).toMatchObject({ simulationOnly: true, payoutId: prepared.payoutId, status: "confirmed", dispatchCount: 1,
      deliveredPrincipalRaw: "200000000", remainingCustodyRaw: "300000000", separateCommissionDueRaw: "4000000", repeatedRecoveryAddedSettlement: false });
    expect((await readdir(provider)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
    expect((await readdir(provider)).filter(name => name.endsWith(".finality.json"))).toHaveLength(1);
  }, 120_000);
});
