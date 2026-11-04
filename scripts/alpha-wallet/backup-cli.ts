/** Explicit local files only. Close other PGlite writers before using this CLI. */
import { constants } from "node:fs";
import { open, lstat, readdir, link, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { exportWalletBackup, inspectWalletBackup, restoreWalletBackup, MAX_WALLET_BACKUP_BYTES, WalletBackupError } from "../../src/lib/alpha-wallet/backup";
import { createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { WalletIntegrityError } from "../../src/lib/alpha-wallet/durable";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";

const MARKER = ".alpha-wallet-simulation";
const MARKER_CONTENT = "alpha-wallet-file-store-v1\nsimulation-only\n";
const HEX = /^[a-f0-9]{64}$/;
const USAGE = `Alpha Wallet local simulation backup CLI
Close existing file-wallet writers before export or restore.
All paths must be explicit absolute paths with real directory ancestors.

NODE_ENV=test node --import tsx scripts/alpha-wallet/backup-cli.ts export EXISTING_MARKED_DATA_DIR NEW_BACKUP_PATH
NODE_ENV=test node --import tsx scripts/alpha-wallet/backup-cli.ts inspect BACKUP_PATH [--expected-checksum HEX]
NODE_ENV=test node --import tsx scripts/alpha-wallet/backup-cli.ts restore BACKUP_PATH FRESH_TARGET_DIR --fresh-target --expected-checksum HEX

The checksum is the canonical checksum returned by export/inspect.
Restore always commits a durable pause. No production database, provider, signer, or cloud service is used.`;

class BackupCliError extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BackupCliError(message);
}
function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}
function localRuntime() {
  try { assertSimulationRuntime("simulation-only"); }
  catch { throw new BackupCliError("Backup CLI requires a local development/test simulation runtime without hosted, mainnet, or signing flags"); }
  check(typeof constants.O_NOFOLLOW === "number", "This filesystem must support no-follow file opens");
}
function explicitPath(value: string | undefined) {
  check(typeof value === "string" && value.length > 0 && value.length <= 4096 && isAbsolute(value)
    && !/[\0-\x1f\x7f]/.test(value), "An explicit absolute local path is required");
  const path = resolve(value);
  check(path !== parse(path).root, "The filesystem root cannot be a backup or wallet path");
  return path;
}
async function realDirectory(path: string) {
  let current = parse(path).root;
  for (const component of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    let info;
    try { info = await lstat(current); }
    catch { throw new BackupCliError("Directory ancestors must already exist and be real local directories"); }
    check(info.isDirectory() && !info.isSymbolicLink(), "Directory ancestors cannot be symlinks or non-directories");
  }
}
async function absent(path: string) {
  try { await lstat(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new BackupCliError("Cannot verify that the new output path is unused");
  }
  throw new BackupCliError("Output already exists; overwriting is refused");
}

/** Bounded descriptor reads reject symlinks, directories, FIFOs, and file growth. */
async function readRegular(path: string, limit: number, label: string): Promise<string> {
  await realDirectory(dirname(path));
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new BackupCliError(`${label} must exist as a regular file without symlinks`); }
  try {
    const before = await file.stat();
    check(before.isFile() && before.size > 0 && before.size <= limit, `${label} must be a nonempty regular file within its size limit`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      const buffer = Buffer.allocUnsafe(Math.min(65_536, limit + 1 - total));
      const read = await file.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      total += read.bytesRead;
      check(total <= limit, `${label} exceeded its size limit while reading`);
      chunks.push(buffer.subarray(0, read.bytesRead));
    }
    const after = await file.stat();
    check(total === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
      `${label} changed while reading; use a stable copy`);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)); }
    catch { throw new BackupCliError(`${label} is not valid UTF-8`); }
  } finally { await file.close(); }
}
async function existingSource(path: string) {
  await realDirectory(path);
  const marker = await readRegular(join(path, MARKER), 256, "Source simulation marker");
  check(marker === MARKER_CONTENT, "Source simulation marker is invalid");
  await realDirectory(join(path, "database"));
  const version = await readRegular(join(path, "database", "PG_VERSION"), 64, "Existing PostgreSQL version marker");
  check(/^\d+(?:\.\d+)?\n?$/.test(version), "Source does not contain an existing PostgreSQL file database");
}
async function freshTarget(path: string) {
  await realDirectory(dirname(path));
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new BackupCliError("Cannot verify the fresh target directory");
  }
  check(info.isDirectory() && !info.isSymbolicLink(), "Restore target must be a real fresh directory");
  check((await readdir(path)).length === 0, "Restore target must be absent or empty; existing contents are never overwritten");
}
async function syncDirectory(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { check((await file.stat()).isDirectory(), "Output parent must remain a directory"); await file.sync(); }
  finally { await file.close(); }
}

/** Publish complete, fsynced content under a new name without replacing anything. */
async function writeNewBackup(path: string, serialized: string) {
  await realDirectory(dirname(path));
  const temporary = join(dirname(path), `.alpha-wallet-backup-${randomUUID()}.pending`);
  let created = false;
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await file.chmod(0o600); await file.writeFile(serialized, "utf8"); await file.sync(); }
    finally { await file.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if (errorCode(error) === "EEXIST") throw new BackupCliError("Output already exists; overwriting is refused");
      throw error;
    }
    await syncDirectory(dirname(path));
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}

async function main() {
  localRuntime();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log(USAGE); return; }
  const command = args[0];
  if (command === "export") {
    check(args.length === 3, "Usage: export EXISTING_MARKED_DATA_DIR NEW_BACKUP_PATH");
    const source = explicitPath(args[1]), output = explicitPath(args[2]);
    await existingSource(source);
    await realDirectory(dirname(output));
    await absent(output);
    const store = await createFileWalletStore({ mode: "simulation-only", dataDir: source });
    let inspection;
    try {
      const serialized = await exportWalletBackup({ mode: "simulation-only", store });
      inspection = inspectWalletBackup(serialized);
      await writeNewBackup(output, serialized);
    } finally { await store.close(); }
    console.log(JSON.stringify({ action: "export", simulationOnly: true, ...inspection }));
    return;
  }
  if (command === "inspect") {
    check(args.length === 2 || (args.length === 4 && args[2] === "--expected-checksum" && HEX.test(args[3]!)),
      "Usage: inspect BACKUP_PATH [--expected-checksum HEX]");
    const source = explicitPath(args[1]);
    const serialized = await readRegular(source, MAX_WALLET_BACKUP_BYTES, "Backup input");
    const inspection = inspectWalletBackup(serialized, { expectedChecksum: args[3] });
    console.log(JSON.stringify({ action: "inspect", simulationOnly: true, ...inspection }));
    return;
  }
  if (command === "restore") {
    check(args.length === 6 && args[3] === "--fresh-target" && args[4] === "--expected-checksum" && HEX.test(args[5]!),
      "Usage: restore BACKUP_PATH FRESH_TARGET_DIR --fresh-target --expected-checksum HEX");
    const source = explicitPath(args[1]), target = explicitPath(args[2]);
    const serialized = await readRegular(source, MAX_WALLET_BACKUP_BYTES, "Backup input");
    // Semantic replay and expected-checksum comparison precede opening or
    // creating the target, even though the restore library validates again.
    inspectWalletBackup(serialized, { expectedChecksum: args[5] });
    await freshTarget(target);
    const store = await createFileWalletStore({ mode: "simulation-only", dataDir: target });
    let result;
    try {
      result = await restoreWalletBackup({ mode: "simulation-only", store, backup: serialized,
        acknowledgeFreshTarget: true, expectedChecksum: args[5] });
    } finally { await store.close(); }
    console.log(JSON.stringify({ action: "restore", simulationOnly: true, ...result }));
    return;
  }
  throw new BackupCliError("Choose export, inspect, or restore; use --help for exact arguments");
}

void main().catch(error => {
  // Filesystem and parser errors may contain supplied paths or private values.
  // Print only deliberate diagnostic messages, never history or raw arguments.
  const message = error instanceof BackupCliError || error instanceof WalletBackupError || error instanceof WalletIntegrityError
    ? error.message : "Backup command failed; no successful backup or restore was reported";
  console.error(`Alpha Wallet backup: ${message}`);
  process.exitCode = 1;
});
