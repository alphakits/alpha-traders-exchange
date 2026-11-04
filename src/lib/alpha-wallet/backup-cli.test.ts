// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_WALLET_BACKUP_BYTES } from "./backup";
import { walletDigest } from "./commands";

const run = promisify(execFile);
const TIMEOUT = 120_000;
const script = resolve("scripts/alpha-wallet/backup-cli.ts");
let directory: string, source: string, backupPath: string;
let exported: { checksum: string; checkpoint: { revision: number; eventHash: string; stateHash: string }; commandCount: number };
let prepared: { revision: number; eventHash: string; payoutId: string };

function processOptions(extra: Partial<NodeJS.ProcessEnv> = {}) {
  // Child processes receive no application/database/cloud credentials.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: "test", ...extra };
  return { cwd: process.cwd(), env,
    encoding: "utf8" as const, timeout: 60_000, maxBuffer: 128 * 1024 };
}
function cli(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return run(process.execPath, ["--import", "tsx", script, ...args], processOptions(env));
}
function inline(code: string) {
  return run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], processOptions());
}
function restoreArgs(input: string, target: string, checksum = exported.checksum) {
  return ["restore", input, target, "--fresh-target", "--expected-checksum", checksum];
}
async function refused(args: string[], expected: RegExp, env: Partial<NodeJS.ProcessEnv> = {}) {
  await expect(cli(args, env)).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringMatching(expected) });
}
async function doesNotExist(path: string) {
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-backup-cli-"));
  source = join(directory, "source");
  backupPath = join(directory, "initial-backup.json");
  // Real independent process, current Date.now(), and a cleanly closed source.
  // No future FIXTURE_TIME timestamps are used by the wallet being exported.
  const seeded = await inline(`
    import { createFileWalletStore } from './src/lib/alpha-wallet/durable-store.ts';
    import { createDurableWallet, initializeDurableWallet } from './src/lib/alpha-wallet/durable.ts';
    import { durableFixture, SELLER, TRON } from './scripts/alpha-wallet/durable-fixtures.ts';
    import { simulatedDestination } from './src/lib/alpha-wallet/sandbox.ts';
    const store = await createFileWalletStore({ mode: 'simulation-only', dataDir: ${JSON.stringify(source)} });
    try {
      await initializeDurableWallet(store);
      const wallet = createDurableWallet({ mode: 'simulation-only', store, clock: Date.now });
      const fixture = durableFixture(wallet);
      await fixture.deposit('500');
      await fixture.ready();
      const payout = (await fixture.command('requestWithdrawal', SELLER, {
        id: 'cli-withdrawal', assetId: TRON, amount: '200', destination: simulatedDestination(TRON, SELLER.id), stepUpReference: 'sim-stepup-cli',
      })).result;
      const snapshot = await wallet.snapshot();
      console.log(JSON.stringify({ revision: snapshot.revision, eventHash: snapshot.eventHash, payoutId: payout.id }));
    } finally { await store.close(); }
  `);
  prepared = JSON.parse(seeded.stdout.trim());
  exported = JSON.parse((await cli(["export", source, backupPath])).stdout.trim());
}, TIMEOUT);

afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); }, TIMEOUT);

describe("backup CLI across independent processes", () => {
  it("exports a private backup, inspects its canonical checksum and restores a durable paused wallet in another process", async () => {
    const file = await readFile(backupPath, "utf8");
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
    expect(exported).toMatchObject({ action: "export", simulationOnly: true, mode: "simulation-only", commandCount: prepared.revision,
      checkpoint: { revision: prepared.revision, eventHash: prepared.eventHash } });
    const rawByteHash = createHash("sha256").update(file).digest("hex");
    expect(rawByteHash).not.toBe(exported.checksum);
    const inspected = await cli(["inspect", backupPath, "--expected-checksum", exported.checksum]);
    expect(JSON.parse(inspected.stdout)).toMatchObject({ action: "inspect", simulationOnly: true, checksum: exported.checksum,
      checkpoint: exported.checkpoint });
    expect(inspected.stdout).not.toMatch(/command_json|providerReference|sim-token-|fixture-seller/);

    const target = join(directory, "restored");
    const restored = JSON.parse((await cli(restoreArgs(backupPath, target))).stdout);
    expect(restored).toMatchObject({ action: "restore", simulationOnly: true, quarantined: true,
      backup: { checksum: exported.checksum, checkpoint: exported.checkpoint }, restored: { revision: prepared.revision + 1 } });
    const verification = await inline(`
      import { createFileWalletStore } from './src/lib/alpha-wallet/durable-store.ts';
      import { createDurableWallet, walletCommand } from './src/lib/alpha-wallet/durable.ts';
      import { createFileFakeProvider } from './src/lib/alpha-wallet/fake-provider.ts';
      import { createSimulationPayoutWorker } from './src/lib/alpha-wallet/payout-worker.ts';
      import { balance } from './src/lib/alpha-wallet/ledger.ts';
      const store = await createFileWalletStore({ mode: 'simulation-only', dataDir: ${JSON.stringify(target)} });
      try {
        const wallet = createDurableWallet({ mode: 'simulation-only', store });
        const snapshot = await wallet.snapshot();
        const provider = await createFileFakeProvider({ mode: 'simulation-only', dataDir: ${JSON.stringify(join(directory, "provider"))} });
        let submissions = 0;
        const watched = { ...provider, submit: async (...args) => { submissions++; return provider.submit(...args); } };
        const worker = createSimulationPayoutWorker({ mode: 'simulation-only', wallet, provider: watched });
        const step = await worker.step(${JSON.stringify(prepared.payoutId)});
        let dispatchRejected = false;
        try { await wallet.execute(walletCommand('beginDispatch', { kind: 'dispatcher', id: 'cli-verifier' }, 'forbidden-dispatch', ${JSON.stringify(prepared.payoutId)})); }
        catch (error) { dispatchRejected = /Wallet paused/.test(error.message); }
        const original = await store.transaction(async tx => (await tx.query(
          'SELECT event_hash FROM alpha_wallet_simulation.commands WHERE revision=$1', [${prepared.revision}])).rows[0]);
        console.log(JSON.stringify({ revision: snapshot.revision, paused: Boolean(snapshot.state.haltReason),
          originalEventHash: original.event_hash, step: step.status, submissions, dispatchRejected,
          heldRaw: balance(snapshot.state, 'tron-sim-usdt', ${JSON.stringify(`payout:${prepared.payoutId}`)}).toString() }));
      } finally { await store.close(); }
    `);
    expect(JSON.parse(verification.stdout)).toEqual({ revision: prepared.revision + 1, paused: true,
      originalEventHash: prepared.eventHash, step: "held_by_policy", submissions: 0, dispatchRejected: true, heldRaw: "200000000" });
  }, TIMEOUT);

  it("refuses a wrong checksum and a raw-byte hash before creating a restore target", async () => {
    const target = join(directory, "wrong-checksum-target");
    await refused(restoreArgs(backupPath, target, "a".repeat(64)), /expected checksum/);
    await doesNotExist(target);
    await refused(["inspect", backupPath, "--expected-checksum", "a".repeat(64)], /expected checksum/);
    const raw = createHash("sha256").update(await readFile(backupPath)).digest("hex");
    await refused(restoreArgs(backupPath, target, raw), /expected checksum/);
    await doesNotExist(target);
  }, TIMEOUT);

  it("validates semantic replay before opening a target even when the outer checksum was recomputed", async () => {
    const parsed = JSON.parse(await readFile(backupPath, "utf8"));
    parsed.commands[0].command_json.requestId = "rewritten-identity";
    const { checksum: _checksum, ...body } = parsed;
    const alteredChecksum = walletDigest(body);
    const corrupted = join(directory, "corrupted.json");
    await writeFile(corrupted, JSON.stringify({ ...body, checksum: alteredChecksum }), { mode: 0o600 });
    const target = join(directory, "corrupted-target");
    await refused(restoreArgs(corrupted, target, alteredChecksum), /identity mismatch/);
    await doesNotExist(target);
  }, TIMEOUT);

  it("refuses overwriting an existing output or following an output symlink", async () => {
    const original = await readFile(backupPath, "utf8");
    await refused(["export", source, backupPath], /overwriting is refused/);
    expect(await readFile(backupPath, "utf8")).toBe(original);
    const victim = join(directory, "keep-existing.txt"), alias = join(directory, "output-link.json");
    await writeFile(victim, "preserved", { mode: 0o600 });
    await symlink(victim, alias);
    await refused(["export", source, alias], /overwriting is refused/);
    expect(await readFile(victim, "utf8")).toBe("preserved");
  }, TIMEOUT);

  it("requires an existing marked source and never initializes an absent or unmarked source", async () => {
    const missing = join(directory, "missing-source"), unmarked = join(directory, "unmarked-source");
    await mkdir(unmarked);
    await refused(["export", missing, join(directory, "missing-export.json")], /directories/);
    await doesNotExist(missing);
    await refused(["export", unmarked, join(directory, "unmarked-export.json")], /Source simulation marker/);
    await doesNotExist(join(unmarked, ".alpha-wallet-simulation"));
    const alias = join(directory, "source-link");
    await symlink(source, alias);
    await refused(["export", alias, join(directory, "linked-export.json")], /symlinks/);
  }, TIMEOUT);

  it("requires absolute paths, explicit restore acknowledgment and a valid checksum argument", async () => {
    await refused(["export", "relative-source", join(directory, "unused.json")], /absolute local path/);
    await refused(["export", source, "relative-backup.json"], /absolute local path/);
    await refused(["inspect", "relative-backup.json"], /absolute local path/);
    await refused(restoreArgs(backupPath, "relative-target"), /absolute local path/);
    await refused(["restore", backupPath, join(directory, "missing-flags")], /Usage: restore/);
    await refused(["restore", backupPath, join(directory, "missing-ack"), "--expected-checksum", exported.checksum], /Usage: restore/);
    await refused(restoreArgs(backupPath, join(directory, "invalid-checksum"), "not-a-checksum"), /Usage: restore/);
    await refused(["inspect", "/"], /filesystem root/);
    await refused(["inspect", join(directory, "bad\npath.json")], /absolute local path/);
  }, TIMEOUT);

  it("rejects symlink, directory, FIFO and oversized backup inputs without hanging or opening a target", async () => {
    const link = join(directory, "input-link.json");
    await symlink(backupPath, link);
    await refused(["inspect", link], /without symlinks/);
    await refused(["inspect", directory], /regular file/);
    const fifo = join(directory, "input-fifo");
    await run("mkfifo", [fifo], processOptions());
    await refused(["inspect", fifo], /regular file/);
    const oversized = join(directory, "oversized.json"), file = await open(oversized, "wx", 0o600);
    try { await file.truncate(MAX_WALLET_BACKUP_BYTES + 1); } finally { await file.close(); }
    const target = join(directory, "oversized-target");
    await refused(restoreArgs(oversized, target), /size limit/);
    await doesNotExist(target);
    const aliasDirectory = join(directory, "ancestor-link");
    await symlink(directory, aliasDirectory);
    await refused(["inspect", join(aliasDirectory, "initial-backup.json")], /symlinks/);
  }, TIMEOUT);

  it("refuses a nonempty or symlink restore target without modifying existing contents", async () => {
    const occupied = join(directory, "occupied");
    await mkdir(occupied);
    await writeFile(join(occupied, "keep.txt"), "unchanged");
    await refused(restoreArgs(backupPath, occupied), /absent or empty/);
    expect(await readFile(join(occupied, "keep.txt"), "utf8")).toBe("unchanged");
    await doesNotExist(join(occupied, ".alpha-wallet-simulation"));
    const alias = join(directory, "target-link");
    await symlink(occupied, alias);
    await refused(restoreArgs(backupPath, alias), /real fresh directory/);
  }, TIMEOUT);

  it("refuses production, hosted and signing runtimes before inspecting or creating files", async () => {
    const environments: Array<Partial<NodeJS.ProcessEnv>> = [
      { NODE_ENV: "production" }, { VERCEL: "1" }, { ALPHA_WALLET_SIGNING_ENABLED: "1" }, { ALPHA_WALLET_MAINNET_ENABLED: "1" },
    ];
    for (const environment of environments) {
      const target = join(directory, "forbidden-runtime-target");
      await refused(restoreArgs(backupPath, target), /local development\/test simulation runtime/, environment);
      await doesNotExist(target);
    }
  }, TIMEOUT);
});
