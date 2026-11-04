import { constants } from "node:fs";
import { open, mkdir, readdir, link, unlink, lstat } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assetFor, parseRawUnits } from "./amounts";
import { walletDigest } from "./commands";
import { assertSimulationRuntime } from "./runtime";
import type { Payout, PayoutReceipt } from "./types";

const MARKER = "alpha-wallet-fake-provider.json";
const MARKER_BODY = { kind: "alpha-wallet-fake-provider", version: 1 };
const intentSchema = z.strictObject({
  payoutId: z.string().regex(/^(?:trade|withdrawal)-[A-Za-z0-9_-]{1,80}$/),
  providerReference: z.string().min(1).max(120),
  assetId: z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]),
  destination: z.string().min(1).max(250),
  amountRaw: z.string().regex(/^[1-9]\d{0,77}$/),
});
const recordSchema = z.strictObject({
  version: z.literal(1), kind: z.literal("simulated-broadcast"), intent: intentSchema,
  intentHash: z.string().regex(/^[a-f0-9]{64}$/), transactionId: z.string().regex(/^sim-tx-[a-f0-9]{64}$/),
});
const finalitySchema = z.strictObject({ version: z.literal(1), intentHash: z.string().regex(/^[a-f0-9]{64}$/), successful: z.boolean() });
export type FakeProviderRecord = z.infer<typeof recordSchema>;
export type FakeLookup = { status: "not_found" } | { status: "broadcast"; record: FakeProviderRecord }
  | { status: "finalized"; record: FakeProviderRecord; receipt: PayoutReceipt };

export class SimulatedProviderResponseLostError extends Error {
  readonly code = "SIMULATED_PROVIDER_RESPONSE_LOST";
  constructor() { super("Fake provider accepted the transfer but its response was lost"); this.name = "SimulatedProviderResponseLostError"; }
}
function isCode(error: unknown, code: string) { return error instanceof Error && "code" in error && error.code === code; }
function immutableIntent(payout: Payout) {
  const intent = intentSchema.parse({ payoutId: payout.id, providerReference: payout.providerReference, assetId: payout.assetId,
    destination: payout.destination, amountRaw: payout.amountRaw.toString() });
  parseRawUnits(intent.amountRaw);
  if (intent.providerReference !== `sim-payout-${intent.payoutId}`
    || !new RegExp(`^sim://${intent.assetId}/recipient/[A-Za-z0-9_-]{1,80}$`).test(intent.destination)) {
    throw new Error("Only immutable simulation payout identities are accepted");
  }
  return intent;
}
async function readJson(path: string): Promise<unknown | undefined> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (isCode(error, "ENOENT")) return undefined; throw error; }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65_536) throw new Error("Invalid fake provider record");
    return JSON.parse(await file.readFile("utf8"));
  } finally { await file.close(); }
}
async function syncDirectory(path: string) {
  const directory = await open(path, constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
/** Publishes a fully fsynced record without overwriting an existing operation. */
async function publishOnce(directory: string, name: string, value: unknown, temporaryDirectory = directory) {
  const temporary = join(temporaryDirectory, `.alpha-wallet-pending-${randomUUID()}`), destination = join(directory, name);
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  try {
    try { await link(temporary, destination); }
    catch (error) { if (!isCode(error, "EEXIST")) throw error; }
    // Even a concurrent publisher must ensure the destination directory is durable before acknowledging.
    await syncDirectory(directory);
    const existing = await readJson(destination);
    if (walletDigest(existing) !== walletDigest(value)) throw new Error("Provider reference already belongs to different immutable terms");
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** An offline provider fixture. It has no RPC, signer, credentials, chain address, or networking. */
export async function createFileFakeProvider(options: { mode: "simulation-only"; dataDir: string }) {
  assertSimulationRuntime(options.mode);
  if (!isAbsolute(options.dataDir) || options.dataDir === "/") throw new Error("An explicit absolute fixture directory is required");
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const stat = await lstat(options.dataDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Fake provider directory must be a real directory");
  const contents = await readdir(options.dataDir);
  if (!contents.includes(MARKER)) {
    if (contents.length) throw new Error("Refusing an unmarked nonempty fake provider directory");
    // Keep initialization temporaries outside the new directory, so concurrent
    // initializers see either an empty directory or the complete marker.
    await publishOnce(options.dataDir, MARKER, MARKER_BODY, dirname(options.dataDir));
  }
  if (walletDigest(await readJson(join(options.dataDir, MARKER))) !== walletDigest(MARKER_BODY)) throw new Error("Unknown fake provider directory format");
  const paths = (payout: Payout) => {
    const intent = immutableIntent(payout), key = walletDigest(intent.providerReference);
    return { intent, key, broadcast: join(options.dataDir, `${key}.broadcast.json`), finality: join(options.dataDir, `${key}.finality.json`) };
  };
  async function lookup(payout: Payout): Promise<FakeLookup> {
    assertSimulationRuntime(options.mode);
    const location = paths(payout), raw = await readJson(location.broadcast);
    if (raw === undefined) return { status: "not_found" };
    const record = recordSchema.parse(raw), hash = walletDigest(location.intent);
    if (walletDigest(record.intent) !== hash || record.intentHash !== hash || record.transactionId !== `sim-tx-${hash}`) {
      throw new Error("Fake provider evidence disagrees with immutable payout intent");
    }
    const finality = await readJson(location.finality);
    if (finality === undefined) return { status: "broadcast", record };
    const final = finalitySchema.parse(finality);
    if (final.intentHash !== hash) throw new Error("Fake provider finality belongs to a different intent");
    const asset = assetFor(payout.assetId);
    return { status: "finalized", record, receipt: { payoutId: payout.id, providerReference: payout.providerReference,
      assetId: payout.assetId, network: asset.network, token: asset.token, transactionId: record.transactionId,
      eventIndex: 0, destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: final.successful } };
  }
  return Object.freeze({
    kind: "alpha-wallet-file-fake-provider" as const,
    lookup,
    async submit(payout: Payout, faults: { loseResponseAfterAccept?: boolean } = {}) {
      assertSimulationRuntime(options.mode);
      if (payout.state !== "submitting" || payout.dispatchCount !== 1) throw new Error("A committed first dispatch claim is required");
      const location = paths(payout), hash = walletDigest(location.intent);
      const record: FakeProviderRecord = { version: 1, kind: "simulated-broadcast", intent: location.intent, intentHash: hash, transactionId: `sim-tx-${hash}` };
      await publishOnce(options.dataDir, `${location.key}.broadcast.json`, record);
      if (faults.loseResponseAfterAccept) throw new SimulatedProviderResponseLostError();
      return record;
    },
    async finalize(payout: Payout, successful: boolean) {
      assertSimulationRuntime(options.mode);
      const found = await lookup(payout);
      if (found.status === "not_found") throw new Error("Fake provider has no accepted transfer to finalize");
      const location = paths(payout);
      await publishOnce(options.dataDir, `${location.key}.finality.json`, finalitySchema.parse({ version: 1, intentHash: walletDigest(location.intent), successful }));
      return lookup(payout);
    },
  });
}
export type FileFakeProvider = Awaited<ReturnType<typeof createFileFakeProvider>>;
