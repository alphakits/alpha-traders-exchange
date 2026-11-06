import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { FixtureChain, TransferFixtureContext } from "./chain-evidence";
import type { ObservationPolicy } from "./chain-observer-common";
import {
  DepositInboxError, captureInboxData, digestInboxValue, inboxCheck, inboxRuntime,
} from "./deposit-inbox-data";

export type DepositInboxChain = FixtureChain & { readonly chainKey: string };
export interface DepositInboxAsset {
  readonly assetRef: string;
  readonly chainKey: string;
  readonly token: string;
  /** Descriptive metadata only. Candidate amounts always remain exact raw units. */
  readonly decimals: number;
  readonly transferProfile: "fungible-transfer-v1";
}
export interface DepositInboxSource {
  readonly sourceId: string;
  readonly independenceGroup: string;
  readonly host: string;
  readonly endpointSha256: string;
  readonly responseProfile: "native-node-observer-v1";
}
export interface DepositInboxSourceSet {
  readonly sourceSetId: string;
  readonly chainKey: string;
  readonly executionSourceId: string;
  readonly finalitySourceId: string;
  readonly policy: ObservationPolicy;
}
export interface DepositInboxAssignment {
  readonly assignmentId: string;
  readonly custodyDomainId: string;
  readonly assetRef: string;
  readonly recipient: string;
  readonly beneficiaryRef: string;
  readonly purpose: "principal" | "commission";
  readonly admissionKind: "synthetic-fixture";
}
export interface DepositInboxWorker {
  readonly workerId: string;
  readonly sourceSetIds: readonly string[];
  readonly assignmentIds: readonly string[];
}
export interface DepositInboxManifestV1 {
  readonly kind: "development-deposit-inbox-manifest";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly inboxId: string;
  readonly chains: readonly DepositInboxChain[];
  readonly assets: readonly DepositInboxAsset[];
  readonly sources: readonly DepositInboxSource[];
  readonly sourceSets: readonly DepositInboxSourceSet[];
  readonly assignments: readonly DepositInboxAssignment[];
  readonly workers: readonly DepositInboxWorker[];
}
export interface DepositInboxAdmission {
  readonly manifest: DepositInboxManifestV1;
  readonly manifestSha256: string;
  readonly chainHashes: Readonly<Record<string, string>>;
  readonly assetHashes: Readonly<Record<string, string>>;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly sourceSetHashes: Readonly<Record<string, string>>;
  readonly assignmentHashes: Readonly<Record<string, string>>;
  readonly workerHashes: Readonly<Record<string, string>>;
}
export interface DepositInboxCandidate {
  readonly assignmentId: string;
  readonly sourceSetId: string;
  readonly transactionId: string;
  readonly eventIndex: string;
  readonly amountRaw: string;
}
export interface ResolvedDepositInboxCandidate {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly candidate: DepositInboxCandidate;
  readonly context: TransferFixtureContext;
  readonly policy: ObservationPolicy;
  readonly chain: DepositInboxChain;
  readonly asset: DepositInboxAsset;
  readonly sourceSet: DepositInboxSourceSet;
  readonly executionSource: DepositInboxSource;
  readonly finalitySource: DepositInboxSource;
  readonly assignment: DepositInboxAssignment;
  readonly worker: DepositInboxWorker;
  readonly manifestSha256: string;
  readonly chainSha256: string;
  readonly assetSha256: string;
  readonly sourceSetSha256: string;
  readonly executionSourceSha256: string;
  readonly finalitySourceSha256: string;
  readonly assignmentSha256: string;
  readonly workerSha256: string;
}

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_UINT64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const RESERVED_IDS = new Set(["constructor", "prototype", "__proto__"]);
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine(value => !RESERVED_IDS.has(value));
const chainKeySchema = z.string().min(1).max(100);
const sha256 = z.string().regex(/^[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase());
const bscHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase());
const tronHash = sha256.refine(value => value.startsWith("0000000000000000"));
const dnsPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i;
const host = z.string().min(1).max(253).regex(dnsPattern).refine(value => !isIP(value))
  .transform(value => value.toLowerCase());
const chainSchema = z.discriminatedUnion("family", [
  z.object({ chainKey: chainKeySchema, family: z.literal("bsc"), chainId: z.enum(["56", "97"]), genesisHash: bscHash }).strict(),
  z.object({ chainKey: chainKeySchema, family: z.literal("tron"), network: z.enum(["mainnet", "nile", "shasta"]), genesisHash: tronHash }).strict(),
]);
const policySchema = z.object({
  maxAncestry: z.number().int().min(0).max(64),
  maxCheckpointAgeMs: z.number().int().min(1).max(600_000),
  maxFutureSkewMs: z.number().int().min(0).max(30_000),
}).strict();
const manifestSchema = z.object({
  kind: z.literal("development-deposit-inbox-manifest"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), inboxId: id,
  chains: z.array(chainSchema).min(1).max(2),
  assets: z.array(z.object({ assetRef: id, chainKey: chainKeySchema, token: z.string().min(1).max(42),
    decimals: z.number().int().min(0).max(255), transferProfile: z.literal("fungible-transfer-v1") }).strict()).min(1).max(4),
  sources: z.array(z.object({ sourceId: id, independenceGroup: id, host, endpointSha256: sha256,
    responseProfile: z.literal("native-node-observer-v1") }).strict()).min(2).max(8),
  sourceSets: z.array(z.object({ sourceSetId: id, chainKey: chainKeySchema, executionSourceId: id,
    finalitySourceId: id, policy: policySchema }).strict()).min(1).max(4),
  assignments: z.array(z.object({ assignmentId: id, custodyDomainId: id, assetRef: id,
    recipient: z.string().min(1).max(42), beneficiaryRef: id, purpose: z.enum(["principal", "commission"]),
    admissionKind: z.literal("synthetic-fixture") }).strict()).min(1).max(64),
  workers: z.array(z.object({ workerId: id, sourceSetIds: z.array(id).min(1).max(4),
    assignmentIds: z.array(id).min(1).max(64) }).strict()).min(1).max(16),
}).strict();
const decimal = (maximum: bigint, positive = false) => z.string().min(1).max(78)
  .refine(value => value.length <= 78 && /^(?:0|[1-9][0-9]*)$/.test(value)
    && BigInt(value) <= maximum && (!positive || BigInt(value) > BigInt(0)));
const candidateSchema = z.object({ assignmentId: id, sourceSetId: id,
  transactionId: z.string().min(1).max(66), eventIndex: decimal(MAX_UINT64), amountRaw: decimal(MAX_UINT256, true),
}).strict();
const capturedAdmissions = new WeakSet<object>();

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  inboxCheck(result.success, "INVALID_INPUT", "Deposit admission data is outside the closed development profile");
  return result.data;
}
function guard<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof DepositInboxError) throw error;
    throw new DepositInboxError("INVALID_INPUT", "Deposit admission could not be captured as bounded plain data");
  }
}
function index<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const value = key(item);
    inboxCheck(!result.has(value), "ADMISSION_REFUSED", "Deposit admission repeats an immutable identifier");
    result.set(value, item);
  }
  return result;
}
function needed<T>(items: ReadonlyMap<string, T>, key: string): T {
  const value = items.get(key);
  inboxCheck(value !== undefined, "ADMISSION_REFUSED", "Deposit admission references an unknown immutable record");
  return value;
}
function sorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
}
function normalizedAddress(value: string, family: FixtureChain["family"]): string {
  inboxCheck((family === "bsc" ? /^0x[0-9a-fA-F]{40}$/ : /^41[0-9a-fA-F]{40}$/).test(value),
    "INVALID_INPUT", "Deposit admission address does not match its exact native chain family");
  return value.toLowerCase();
}
function normalizedTransaction(value: string, family: FixtureChain["family"]): string {
  inboxCheck((family === "bsc" ? /^0x[0-9a-fA-F]{64}$/ : /^[0-9a-fA-F]{64}$/).test(value),
    "INVALID_INPUT", "Deposit candidate transaction does not match its exact native chain family");
  return value.toLowerCase();
}
function nativeChainKey(chain: FixtureChain): string {
  return chain.family === "bsc" ? `bsc:${chain.chainId}:${chain.genesisHash}` : `tron:${chain.network}:${chain.genesisHash}`;
}
function hashRecords<T>(items: readonly T[], key: (item: T) => string, value: (item: T) => string): Record<string, string> {
  return Object.fromEntries(items.map(item => [key(item), value(item)]));
}

/** Matching a normalized endpoint commitment is still not provider authentication. */
export function normalizeDepositInboxEndpoint(value: unknown): Readonly<{ endpoint: string; host: string; endpointSha256: string }> {
  inboxRuntime("simulation-only");
  return guard(() => {
    inboxCheck(typeof value === "string", "INVALID_INPUT", "Deposit node endpoints must be plain URL strings");
    const supplied = parsed(z.string().min(1).max(2048), value);
    const url = new URL(supplied);
    inboxCheck(url.protocol === "https:" && !url.username && !url.password && !supplied.includes("?")
      && !supplied.includes("#") && !isIP(url.hostname) && dnsPattern.test(url.hostname) && url.hostname.length <= 253,
    "INVALID_INPUT", "Deposit node endpoints require explicit HTTPS DNS URLs without credentials or URL parameters");
    const endpoint = url.href;
    inboxRuntime("simulation-only");
    return Object.freeze({ endpoint, host: url.hostname.toLowerCase(), endpointSha256: createHash("sha256").update(endpoint).digest("hex") });
  });
}

/** Closed synthetic admission. This creates no database, custody claim, financial command or network call. */
export function captureDepositInboxManifest(value: unknown): DepositInboxAdmission {
  inboxRuntime("simulation-only");
  return guard(() => {
    const input = parsed(manifestSchema, captureInboxData(value,
      { maxBytes: 262_144, maxNodes: 8192, maxDepth: 12, maxStringBytes: 2048 }));
    const chainMap = index(input.chains, item => item.chainKey);
    for (const chain of input.chains) {
      inboxCheck(chain.chainKey === nativeChainKey(chain), "ADMISSION_REFUSED", "Deposit chain key is not its canonical native identity");
    }
    // TRON network names are labels: the same native genesis must not become two chains.
    index(input.chains, item => JSON.stringify(item.family === "bsc"
      ? [item.family, item.chainId, item.genesisHash] : [item.family, item.genesisHash]));
    const assets = input.assets.map(item => ({ ...item, token: normalizedAddress(item.token, needed(chainMap, item.chainKey).family) }));
    const assetMap = index(assets, item => item.assetRef);
    index(assets, item => JSON.stringify([item.chainKey, item.token]));
    const sourceMap = index(input.sources, item => item.sourceId);
    index(input.sources, item => item.endpointSha256);
    const sourceSetMap = index(input.sourceSets, item => item.sourceSetId);
    for (const pair of input.sourceSets) {
      needed(chainMap, pair.chainKey);
      const execution = needed(sourceMap, pair.executionSourceId), finality = needed(sourceMap, pair.finalitySourceId);
      inboxCheck(execution.sourceId !== finality.sourceId && execution.host !== finality.host
        && execution.independenceGroup !== finality.independenceGroup,
      "ADMISSION_REFUSED", "Deposit observation requires distinct declared source IDs, hosts and operator groups");
    }
    const assignments = input.assignments.map(item => {
      const asset = needed(assetMap, item.assetRef), chain = needed(chainMap, asset.chainKey);
      return { ...item, recipient: normalizedAddress(item.recipient, chain.family) };
    });
    const assignmentMap = index(assignments, item => item.assignmentId);
    index(assignments, item => JSON.stringify([needed(assetMap, item.assetRef).chainKey, item.recipient]));
    index(input.workers, item => item.workerId);
    const workers = input.workers.map(worker => {
      index(worker.sourceSetIds, item => item); index(worker.assignmentIds, item => item);
      const pairs = worker.sourceSetIds.map(value => needed(sourceSetMap, value));
      const assignedChains = worker.assignmentIds.map(value => needed(assetMap, needed(assignmentMap, value).assetRef).chainKey);
      inboxCheck(assignedChains.every(chain => pairs.some(pair => pair.chainKey === chain))
        && pairs.every(pair => assignedChains.includes(pair.chainKey)),
      "ADMISSION_REFUSED", "Deposit worker scopes do not contain compatible source and assignment chains");
      return { ...worker, sourceSetIds: [...worker.sourceSetIds].sort(), assignmentIds: [...worker.assignmentIds].sort() };
    });
    const manifest = captureInboxData<DepositInboxManifestV1>({
      kind: input.kind, formatVersion: input.formatVersion, mode: input.mode, creditAuthority: input.creditAuthority,
      inboxId: input.inboxId, chains: sorted(input.chains, item => item.chainKey), assets: sorted(assets, item => item.assetRef),
      sources: sorted(input.sources, item => item.sourceId), sourceSets: sorted(input.sourceSets, item => item.sourceSetId),
      assignments: sorted(assignments, item => item.assignmentId), workers: sorted(workers, item => item.workerId),
    });
    const chainHashes = hashRecords(manifest.chains, item => item.chainKey, item => digestInboxValue("chain", item));
    const assetHashes = hashRecords(manifest.assets, item => item.assetRef,
      item => digestInboxValue("asset", { asset: item, chainSha256: chainHashes[item.chainKey] }));
    const sourceHashes = hashRecords(manifest.sources, item => item.sourceId, item => digestInboxValue("source", item));
    const sourceSetHashes = hashRecords(manifest.sourceSets, item => item.sourceSetId,
      item => digestInboxValue("source-set", { sourceSet: item, chainSha256: chainHashes[item.chainKey],
        executionSourceSha256: sourceHashes[item.executionSourceId], finalitySourceSha256: sourceHashes[item.finalitySourceId] }));
    const assignmentHashes = hashRecords(manifest.assignments, item => item.assignmentId,
      item => digestInboxValue("assignment", { assignment: item, assetSha256: assetHashes[item.assetRef] }));
    const workerHashes = hashRecords(manifest.workers, item => item.workerId,
      item => digestInboxValue("worker", { worker: item,
        sourceSets: item.sourceSetIds.map(sourceSetId => ({ sourceSetId, sourceSetSha256: sourceSetHashes[sourceSetId] })),
        assignments: item.assignmentIds.map(assignmentId => ({ assignmentId, assignmentSha256: assignmentHashes[assignmentId] })),
      }));
    const admission = captureInboxData<DepositInboxAdmission>({ manifest, manifestSha256: digestInboxValue("manifest", manifest),
      chainHashes, assetHashes, sourceHashes, sourceSetHashes, assignmentHashes, workerHashes });
    inboxRuntime("simulation-only");
    capturedAdmissions.add(admission);
    return admission;
  });
}

/** A candidate supplies only expectations; immutable admission supplies the beneficiary and custody purpose. */
export function resolveDepositInboxCandidate(admission: DepositInboxAdmission, workerId: string, value: unknown): ResolvedDepositInboxCandidate {
  inboxRuntime("simulation-only");
  return guard(() => {
    inboxCheck(admission !== null && typeof admission === "object" && capturedAdmissions.has(admission),
      "ADMISSION_REFUSED", "Deposit candidate requires an original captured admission capability");
    inboxCheck(typeof workerId === "string", "INVALID_INPUT", "Deposit worker identity must be an explicit identifier string");
    const trustedWorkerId = parsed(id, workerId);
    const candidate = parsed(candidateSchema, captureInboxData(value,
      { maxBytes: 4096, maxNodes: 32, maxDepth: 3, maxStringBytes: 100 }));
    const worker = admission.manifest.workers.find(item => item.workerId === trustedWorkerId);
    inboxCheck(worker !== undefined && worker.assignmentIds.includes(candidate.assignmentId)
      && worker.sourceSetIds.includes(candidate.sourceSetId),
    "ADMISSION_REFUSED", "Deposit candidate exceeds its trusted worker admission");
    const assignment = admission.manifest.assignments.find(item => item.assignmentId === candidate.assignmentId)!;
    const asset = admission.manifest.assets.find(item => item.assetRef === assignment.assetRef)!;
    const chain = admission.manifest.chains.find(item => item.chainKey === asset.chainKey)!;
    const sourceSet = admission.manifest.sourceSets.find(item => item.sourceSetId === candidate.sourceSetId)!;
    inboxCheck(sourceSet.chainKey === chain.chainKey, "ADMISSION_REFUSED", "Deposit candidate source set and custody assignment use different native chains");
    const executionSource = admission.manifest.sources.find(item => item.sourceId === sourceSet.executionSourceId)!;
    const finalitySource = admission.manifest.sources.find(item => item.sourceId === sourceSet.finalitySourceId)!;
    const captured = captureInboxData<DepositInboxCandidate>({ ...candidate,
      transactionId: normalizedTransaction(candidate.transactionId, chain.family) });
    const fixtureChain: FixtureChain = chain.family === "bsc"
      ? { family: chain.family, chainId: chain.chainId, genesisHash: chain.genesisHash }
      : { family: chain.family, network: chain.network, genesisHash: chain.genesisHash };
    const context = captureInboxData<TransferFixtureContext>({ mode: "development-fixture", chain: fixtureChain,
      token: asset.token, recipient: assignment.recipient, transactionId: captured.transactionId,
      amountRaw: captured.amountRaw, eventIndex: captured.eventIndex });
    inboxRuntime("simulation-only");
    return Object.freeze({ mode: "simulation-only", creditAuthority: false,
      candidate: captured, context, policy: sourceSet.policy, chain, asset, sourceSet, executionSource, finalitySource, assignment, worker,
      manifestSha256: admission.manifestSha256, chainSha256: admission.chainHashes[chain.chainKey], assetSha256: admission.assetHashes[asset.assetRef],
      sourceSetSha256: admission.sourceSetHashes[sourceSet.sourceSetId], executionSourceSha256: admission.sourceHashes[executionSource.sourceId],
      finalitySourceSha256: admission.sourceHashes[finalitySource.sourceId], assignmentSha256: admission.assignmentHashes[assignment.assignmentId],
      workerSha256: admission.workerHashes[worker.workerId] });
  });
}
