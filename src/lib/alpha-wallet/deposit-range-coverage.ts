import "server-only";

import { types } from "node:util";
import { z } from "zod";
import { parseChainFixtureJson, verifyBscFixtureTransfer, verifyTronFixtureTransfer,
  type CanonicalBlockFixtureProof, type FixtureChain } from "./chain-evidence";
import { checkCheckpointFreshness } from "./chain-observer-common";
import { createDevelopmentNodeTransport, observationDigest, type DevelopmentNodeSource,
  type DevelopmentNodeTransportOptions, type NodeObservationSession, type NodeReadTranscript } from "./chain-observer-rpc";
import { captureDepositInboxManifest, normalizeDepositInboxEndpoint, type DepositInboxAdmission,
  type DepositInboxAsset, type DepositInboxAssignment, type DepositInboxCandidate, type DepositInboxSourceSet } from "./deposit-inbox-admission";
import { captureInboxData, captureInboxOptions, canonicalInboxJson, depositInboxError, DepositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { decodeDepositRangeBlock, decodeDepositRangeReceipt, depositRangeQuantity,
  type DepositRangeBlock, type DepositRangeReceipt } from "./deposit-range-native";

const MAX_UINT64 = (BigInt(1) << BigInt(64)) - BigInt(1), ONE = BigInt(1);
const MAX_RANGE_BLOCKS = 8, MAX_SPAN_BLOCKS = 16, MAX_TRANSACTIONS = 16, MAX_LOGS = 512;
const MAX_READS = 160, MAX_RAW_BYTES = 16 * 1_048_576, MAX_SESSION_MS = 30_000;
const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine(value => !["__proto__", "prototype", "constructor"].includes(value));
const instant = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => !Object.is(value, -0));
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const decimal = z.string().min(1).max(20).regex(/^(?:0|[1-9][0-9]*)$/).refine(value => BigInt(value) <= MAX_UINT64);
const requestSchema = z.object({ fromBlock: decimal, throughBlock: decimal, previousBlockHash: z.string().min(64).max(66) }).strict();
const clockSchema = z.object({ afterRead: z.number().int().min(0).max(MAX_READS), atMs: instant }).strict();
const transcriptSchema = z.object({ sourceId: identifier, protocol: z.enum(["bsc-json-rpc", "tron-http"]), operation: z.string().min(1).max(100),
  requestBody: z.string().min(1).max(1024), responseBody: z.string().min(1).max(1_048_576), responseSha256: sha256, completedAtMs: instant }).strict();

export interface DepositRangeRequest {
  readonly fromBlock: string;
  readonly throughBlock: string;
  /** Exact immediate predecessor; this does not claim earlier blocks were scanned. */
  readonly previousBlockHash: string;
}
export interface DepositRangeScope {
  readonly inboxId: string;
  readonly manifestSha256: string;
  readonly workerId: string;
  readonly workerSha256: string;
  readonly sourceSetId: string;
  readonly sourceSetSha256: string;
  readonly chainKey: string;
  readonly chainSha256: string;
  readonly assignments: readonly Readonly<{ assignmentId: string; assignmentSha256: string }>[];
}
export interface DevelopmentRangeCoverageV1 {
  readonly kind: "development-deposit-range-coverage";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly cursorAuthority: false;
  readonly assurance: "configured-synthetic-response-completeness-only";
  readonly scope: DepositRangeScope;
  readonly request: DepositRangeRequest;
  readonly previousBlock: DepositRangeBlock;
  readonly coveredBlocks: readonly DepositRangeBlock[];
  /** Linked blocks above throughBlock prove checkpoint continuity, not receipt coverage. */
  readonly bridgeBlocks: readonly DepositRangeBlock[];
  readonly checkpoint: DepositRangeBlock;
  readonly receipts: readonly DepositRangeReceipt[];
  readonly candidates: readonly DepositInboxCandidate[];
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly reads: readonly NodeReadTranscript[];
  readonly semanticClocks: readonly Readonly<{ afterRead: number; atMs: number }>[];
  readonly coverageSha256: string;
}
export interface VerifiedDevelopmentRangeCoverage {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly cursorAuthority: false;
  readonly certificate: DevelopmentRangeCoverageV1;
}
export interface AdmittedDevelopmentRangeReaderOptions {
  mode: "simulation-only";
  manifest: unknown;
  workerId: string;
  sourceSetId: string;
  endpointConfig: readonly { sourceId: string; endpoint: string }[];
  fetch: DevelopmentNodeTransportOptions["fetch"];
  clock?: () => number;
}
export interface AdmittedDevelopmentRangeReader {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly cursorAuthority: false;
  readonly scope: DepositRangeScope;
  read(request: DepositRangeRequest): Promise<DevelopmentRangeCoverageV1>;
}
type ResolvedScope = {
  admission: DepositInboxAdmission; scope: DepositRangeScope; chain: FixtureChain; sourceSet: DepositInboxSourceSet;
  assets: readonly DepositInboxAsset[]; assignments: readonly DepositInboxAssignment[];
};
type CoverageBody = Omit<DevelopmentRangeCoverageV1, "coverageSha256">;
type ScanResult = Omit<CoverageBody, "kind" | "formatVersion" | "mode" | "creditAuthority" | "cursorAuthority" | "assurance" | "semanticClocks">;
const verifiedRanges = new WeakSet<object>();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  inboxCheck(result.success, "INVALID_INPUT", "Range evidence is outside its closed development profile");
  return result.data;
}
const same = (left: unknown, right: unknown) => canonicalInboxJson(left) === canonicalInboxJson(right);

function resolveScope(manifest: unknown, workerId: unknown, sourceSetId: unknown): ResolvedScope {
  inboxCheck(typeof workerId === "string" && typeof sourceSetId === "string", "INVALID_INPUT", "Range worker and source identifiers must be strings");
  const admission = captureDepositInboxManifest(manifest);
  const capturedWorkerId = parse(identifier, workerId), capturedSourceSetId = parse(identifier, sourceSetId);
  const worker = admission.manifest.workers.find(value => value.workerId === capturedWorkerId);
  const sourceSet = admission.manifest.sourceSets.find(value => value.sourceSetId === capturedSourceSetId);
  inboxCheck(worker && sourceSet && worker.sourceSetIds.includes(sourceSet.sourceSetId),
    "ADMISSION_REFUSED", "Range reader lacks immutable source-set and worker admission");
  const declared = admission.manifest.chains.find(value => value.chainKey === sourceSet.chainKey)!;
  const allAssets = admission.manifest.assets.filter(asset => asset.chainKey === declared.chainKey);
  const assignments = admission.manifest.assignments.filter(assignment => worker.assignmentIds.includes(assignment.assignmentId)
    && allAssets.some(asset => asset.assetRef === assignment.assetRef));
  inboxCheck(assignments.length > 0, "ADMISSION_REFUSED", "Range reader has no admitted assignments on this chain");
  const assets = allAssets.filter(asset => assignments.some(assignment => assignment.assetRef === asset.assetRef));
  const chain: FixtureChain = declared.family === "bsc"
    ? { family: declared.family, chainId: declared.chainId, genesisHash: declared.genesisHash }
    : { family: declared.family, network: declared.network, genesisHash: declared.genesisHash };
  const scope: DepositRangeScope = captureInboxData({ inboxId: admission.manifest.inboxId, manifestSha256: admission.manifestSha256,
    workerId: worker.workerId, workerSha256: admission.workerHashes[worker.workerId], sourceSetId: sourceSet.sourceSetId,
    sourceSetSha256: admission.sourceSetHashes[sourceSet.sourceSetId], chainKey: declared.chainKey,
    chainSha256: admission.chainHashes[declared.chainKey], assignments: assignments.map(assignment => ({ assignmentId: assignment.assignmentId,
      assignmentSha256: admission.assignmentHashes[assignment.assignmentId] })) });
  return { admission, scope, chain, sourceSet, assets, assignments };
}
function captureRequest(value: unknown, chain: FixtureChain): DepositRangeRequest {
  const request = parse(requestSchema, captureInboxData(captureInboxOptions(value, ["fromBlock", "throughBlock", "previousBlockHash"]),
    { maxBytes: 1024, maxNodes: 4, maxDepth: 1, maxStringBytes: 100 }));
  const from = BigInt(request.fromBlock), through = BigInt(request.throughBlock);
  inboxCheck(from > BigInt(0) && through >= from, "INVALID_INPUT", "Range must start after genesis and include every requested height");
  inboxCheck(through - from < BigInt(MAX_RANGE_BLOCKS), "RESOURCE_LIMIT", "Range exceeds its complete block-count bound");
  const hash = request.previousBlockHash.toLowerCase();
  inboxCheck((chain.family === "bsc" ? /^0x[0-9a-f]{64}$/ : /^[0-9a-f]{64}$/).test(hash), "INVALID_INPUT", "Range predecessor hash encoding is invalid");
  if (chain.family === "tron") inboxCheck(through <= BigInt(Number.MAX_SAFE_INTEGER)
    && BigInt(`0x${hash.slice(0, 16)}`) === from - ONE, "INVALID_INPUT", "TRON range exceeds exact native heights or names another predecessor");
  if (from === ONE) inboxCheck(hash === chain.genesisHash, "ADMISSION_REFUSED", "Range starting at height one must retain admitted genesis");
  return captureInboxData({ ...request, previousBlockHash: hash });
}
function sameBlock(left: DepositRangeBlock, right: DepositRangeBlock) {
  inboxCheck(same(left, right), "SOURCE_CONFLICT", "Range sources disagree on a complete fixed native block");
}
function link(left: DepositRangeBlock, right: DepositRangeBlock) {
  inboxCheck(BigInt(right.number) === BigInt(left.number) + ONE && right.parentHash === left.hash && right.timestampMs > left.timestampMs,
    "SOURCE_CONFLICT", "Range contains a missing successor, changed parent, or non-increasing native timestamp");
}
function coverageBody(result: ScanResult, semanticClocks: CoverageBody["semanticClocks"]): CoverageBody {
  return { kind: "development-deposit-range-coverage", formatVersion: 1, mode: "simulation-only", creditAuthority: false,
    cursorAuthority: false, assurance: "configured-synthetic-response-completeness-only", ...result, semanticClocks };
}

/** Shared deterministic scan; replay must consume exactly the same ordered native reads and clock checks. */
async function scan(resolved: ResolvedScope, request: DepositRangeRequest, session: NodeObservationSession): Promise<ScanResult> {
  const { chain, sourceSet, assets, assignments, scope } = resolved;
  const sources = [sourceSet.executionSourceId, sourceSet.finalitySourceId];
  const readBlock = async (source: string, number: string) => {
    const value = chain.family === "bsc"
      ? await session.bsc(source, "eth_getBlockByNumber", [`0x${BigInt(number).toString(16)}`, false])
      : await session.tron(source, `${source === sourceSet.finalitySourceId ? "/walletsolidity" : "/wallet"}/getblockbynum`, { num: Number(number), visible: false });
    inboxRuntime("simulation-only");
    return decodeDepositRangeBlock(value, chain, number);
  };
  const head = async () => {
    const value = chain.family === "bsc"
      ? await session.bsc(sourceSet.finalitySourceId, "eth_getBlockByNumber", ["finalized", false])
      : await session.tron(sourceSet.finalitySourceId, "/walletsolidity/getnowblock", { visible: false });
    inboxRuntime("simulation-only");
    return decodeDepositRangeBlock(value, chain);
  };
  const receipt = async (source: string, block: DepositRangeBlock, transactionIndex: number) => {
    const transactionId = block.transactions[transactionIndex];
    const value = chain.family === "bsc"
      ? await session.bsc(source, "eth_getTransactionReceipt", [transactionId])
      : await session.tron(source, `${source === sourceSet.finalitySourceId ? "/walletsolidity" : "/wallet"}/gettransactioninfobyid`, { value: transactionId, visible: false });
    inboxRuntime("simulation-only");
    return { raw: value, decoded: decodeDepositRangeReceipt(value, { chain, block, transactionId, transactionIndex, assets, assignments }) };
  };
  if (chain.family === "bsc") for (const source of sources) {
    const chainId = await session.bsc(source, "eth_chainId", []);
    inboxRuntime("simulation-only");
    inboxCheck(depositRangeQuantity(chainId) === chain.chainId, "SOURCE_CONFLICT", "Range native chain identity differs from admission");
  }
  const genesis = await readBlock(sources[0], "0");
  sameBlock(await readBlock(sources[1], "0"), genesis);
  const checkpoint = await head();
  checkCheckpointFreshness(checkpoint.timestampMs, session.now(), sourceSet.policy);
  const from = BigInt(request.fromBlock), through = BigInt(request.throughBlock), checkpointHeight = BigInt(checkpoint.number);
  inboxCheck(checkpointHeight >= through, "INVALID_EVIDENCE", "Requested range extends beyond explicit native finality");
  inboxCheck(checkpointHeight - from < BigInt(MAX_SPAN_BLOCKS)
    && checkpointHeight - from <= BigInt(sourceSet.policy.maxAncestry), "RESOURCE_LIMIT", "Range checkpoint bridge exceeds its complete ancestry bound");
  const previousBlock = await readBlock(sources[0], (from - ONE).toString());
  sameBlock(await readBlock(sources[1], previousBlock.number), previousBlock);
  inboxCheck(previousBlock.hash === request.previousBlockHash, "SOURCE_CONFLICT", "Range does not extend the requested exact predecessor");
  const allBlocks: DepositRangeBlock[] = [], coveredBlocks: DepositRangeBlock[] = [], bridgeBlocks: DepositRangeBlock[] = [];
  const transactionIds = new Set(previousBlock.transactions), blockHashes = new Set([previousBlock.hash]);
  let previous = previousBlock, coveredTransactionCount = 0;
  for (let height = from; height <= checkpointHeight; height += ONE) {
    const block = await readBlock(sources[0], height.toString());
    sameBlock(await readBlock(sources[1], height.toString()), block);
    link(previous, block);
    inboxCheck(!blockHashes.has(block.hash), "SOURCE_CONFLICT", "Range repeats a native block hash"); blockHashes.add(block.hash);
    for (const id of block.transactions) {
      inboxCheck(!transactionIds.has(id), "SOURCE_CONFLICT", "Range repeats a transaction in another native block"); transactionIds.add(id);
    }
    allBlocks.push(block);
    if (height <= through) {
      coveredTransactionCount += block.transactions.length;
      inboxCheck(coveredTransactionCount <= MAX_TRANSACTIONS, "RESOURCE_LIMIT", "Range exceeds its complete receipt-count bound");
      coveredBlocks.push(block);
    } else bridgeBlocks.push(block);
    previous = block;
  }
  sameBlock(previous, checkpoint);
  const receipts: DepositRangeReceipt[] = [], candidates: DepositInboxCandidate[] = [];
  let logCount = 0;
  for (const block of coveredBlocks) {
    let nextBlockLogIndex = BigInt(0);
    for (let index = 0; index < block.transactions.length; index++) {
      const execution = await receipt(sources[0], block, index), finality = await receipt(sources[1], block, index);
      inboxCheck(same(execution.decoded, finality.decoded), "SOURCE_CONFLICT", "Range sources disagree on complete native receipt or log evidence");
      receipts.push(execution.decoded);
      logCount += execution.decoded.logs.length;
      inboxCheck(logCount <= MAX_LOGS, "RESOURCE_LIMIT", "Range exceeds its complete log-classification bound");
      const proof: CanonicalBlockFixtureProof = { mode: "independent-fixture-proof", chain, canonical: true,
        finality: chain.family === "bsc" ? "bsc-finalized" : "tron-solidified",
        block: { number: block.number, hash: block.hash, transactions: [...block.transactions] },
        ancestry: allBlocks.filter(candidate => BigInt(candidate.number) > BigInt(block.number))
          .map(candidate => ({ number: candidate.number, hash: candidate.hash, parentHash: candidate.parentHash })),
        checkpoint: { number: checkpoint.number, hash: checkpoint.hash } };
      for (const log of execution.decoded.logs) {
        if (chain.family === "bsc") {
          inboxCheck(BigInt(log.eventIndex) === nextBlockLogIndex, "INVALID_EVIDENCE", "Range BSC block-wide log sequence omits or reorders an event");
          nextBlockLogIndex += ONE;
        }
        if (log.classification !== "admitted-transfer") continue;
        inboxCheck(log.transfer && log.assignmentId, "INVALID_EVIDENCE", "Range admitted transfer lacks exact immutable attribution");
        const context = { mode: "development-fixture", chain, token: log.contract, recipient: log.transfer.recipient,
          transactionId: execution.decoded.transactionId, amountRaw: log.transfer.amountRaw, eventIndex: log.eventIndex };
        const verify = chain.family === "bsc" ? verifyBscFixtureTransfer : verifyTronFixtureTransfer;
        try { verify(context, execution.raw, proof); verify(context, finality.raw, proof); }
        catch { throw new DepositInboxError("INVALID_EVIDENCE", "Range discovery failed the unchanged complete native transfer decoder"); }
        candidates.push({ assignmentId: log.assignmentId, sourceSetId: sourceSet.sourceSetId,
          transactionId: execution.decoded.transactionId, eventIndex: log.eventIndex, amountRaw: log.transfer.amountRaw });
      }
    }
  }
  // Re-read every fixed block and every receipt, rather than relying on moving filters or indexer pages.
  for (const block of [previousBlock, ...allBlocks]) for (const source of sources) sameBlock(await readBlock(source, block.number), block);
  for (const recorded of receipts) {
    const block = coveredBlocks.find(candidate => candidate.number === recorded.blockNumber)!;
    for (const source of sources) inboxCheck(same((await receipt(source, block, Number(recorded.transactionIndex))).decoded, recorded),
      "SOURCE_CONFLICT", "Range receipt changed during the complete scan");
  }
  const finalHead = await head();
  inboxCheck(BigInt(finalHead.number) >= checkpointHeight, "SOURCE_CONFLICT", "Range finalized head regressed during the scan");
  inboxCheck(finalHead.number === checkpoint.number, "STALE_CHECKPOINT", "Range finalized head advanced; retry the complete bounded scan");
  sameBlock(finalHead, checkpoint);
  const completedAtMs = session.now();
  checkCheckpointFreshness(finalHead.timestampMs, completedAtMs, sourceSet.policy);
  const reads = session.finish();
  inboxRuntime("simulation-only");
  return captureInboxData({ scope, request, previousBlock, coveredBlocks, bridgeBlocks, checkpoint, receipts, candidates,
    startedAtMs: session.startedAtMs, completedAtMs, reads });
}

function endpointSources(resolved: ResolvedScope, value: unknown): DevelopmentNodeSource[] {
  const configured = parse(z.array(z.object({ sourceId: identifier, endpoint: z.string().min(1).max(2048) }).strict()).min(2).max(8),
    captureInboxData(value, { maxBytes: 20_000, maxNodes: 40, maxDepth: 3, maxStringBytes: 2048 }));
  const map = new Map(configured.map(source => [source.sourceId, source]));
  inboxCheck(map.size === configured.length && map.size === resolved.admission.manifest.sources.length,
    "ADMISSION_REFUSED", "Range endpoint configuration must exactly cover immutable source admission");
  return resolved.admission.manifest.sources.map(source => {
    const config = map.get(source.sourceId);
    inboxCheck(config, "ADMISSION_REFUSED", "Range endpoint configuration omits an admitted source");
    const endpoint = normalizeDepositInboxEndpoint(config.endpoint);
    inboxCheck(endpoint.host === source.host && endpoint.endpointSha256 === source.endpointSha256,
      "ADMISSION_REFUSED", "Range endpoint differs from its immutable source commitment");
    return { id: source.sourceId, independenceGroup: source.independenceGroup, endpoint: endpoint.endpoint };
  });
}

/** Synthetic admission and explicit injected reads only. No ambient fetch, database, credit or cursor write. */
export function createAdmittedDevelopmentRangeReader(supplied: AdmittedDevelopmentRangeReaderOptions): AdmittedDevelopmentRangeReader {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(supplied, ["mode", "manifest", "workerId", "sourceSetId", "endpointConfig", "fetch", "clock"]);
    inboxRuntime(options.mode);
    inboxCheck(typeof options.fetch === "function" && !types.isProxy(options.fetch)
      && (options.clock === undefined || typeof options.clock === "function" && !types.isProxy(options.clock)),
    "INVALID_INPUT", "Range reader requires explicit injected IO and an optional trusted synthetic clock");
    const resolved = resolveScope(options.manifest, options.workerId, options.sourceSetId), sources = endpointSources(resolved, options.endpointConfig);
    const fetch = options.fetch as DevelopmentNodeTransportOptions["fetch"], suppliedClock = options.clock as (() => number) | undefined;
    let busy = false, poisoned = false;
    return Object.freeze({ mode: "simulation-only", creditAuthority: false, cursorAuthority: false, scope: resolved.scope,
      async read(value: DepositRangeRequest): Promise<DevelopmentRangeCoverageV1> {
        if (busy) { poisoned = true; throw new DepositInboxError("SESSION_CLOSED", "Concurrent or reentrant range scans close this reader"); }
        busy = true;
        let clockBusy = false, failed = false, lastWall = -1;
        const guard = () => {
          inboxRuntime("simulation-only");
          inboxCheck(!poisoned && !failed, "SESSION_CLOSED", "Range reader is closed");
        };
        const clock = () => {
          try {
            guard(); inboxCheck(!clockBusy, "RUNTIME_REFUSED", "Range clock is reentrant"); clockBusy = true;
            const now = suppliedClock ? suppliedClock() : Date.now();
            guard();
            inboxCheck(typeof now === "number" && Number.isSafeInteger(now) && now >= 0 && !Object.is(now, -0) && now >= lastWall,
              "RUNTIME_REFUSED", "Range clock must return exact monotonic nonnegative instants");
            lastWall = now; return now;
          } catch (error) { failed = true; throw depositInboxError(error, "RUNTIME_REFUSED"); }
          finally { clockBusy = false; }
        };
        try {
          guard();
          const request = captureRequest(value, resolved.chain);
          const transport = createDevelopmentNodeTransport({ mode: "simulation-only", sources, fetch, clock });
          const inner = transport.openSession(resolved.sourceSet.executionSourceId, resolved.sourceSet.finalitySourceId);
          const semanticClocks: Array<{ afterRead: number; atMs: number }> = [];
          let readCount = 0;
          const session: NodeObservationSession = {
            startedAtMs: inner.startedAtMs,
            async bsc(source, operation, params) { guard(); const result = await inner.bsc(source, operation, params); guard(); readCount++; return result; },
            async tron(source, operation, params) { guard(); const result = await inner.tron(source, operation, params); guard(); readCount++; return result; },
            now() { guard(); const atMs = inner.now(); guard(); semanticClocks.push({ afterRead: readCount, atMs }); return atMs; },
            finish() { guard(); const reads = inner.finish(); guard(); return reads; },
          };
          const result = await scan(resolved, request, session);
          guard();
          const body = coverageBody(result, semanticClocks);
          const certificate = captureInboxData<DevelopmentRangeCoverageV1>({ ...body, coverageSha256: digestInboxValue("deposit-range-coverage", body) });
          validateTranscriptTimes(certificate);
          guard(); return certificate;
        } catch (error) {
          failed = true;
          if (poisoned) throw new DepositInboxError("SESSION_CLOSED", "Concurrent or reentrant range scans closed this reader");
          throw depositInboxError(error);
        }
        finally { busy = false; }
      },
    });
  } catch (error) { throw depositInboxError(error); }
}

const certificateSchema = z.object({ kind: z.literal("development-deposit-range-coverage"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), cursorAuthority: z.literal(false),
  assurance: z.literal("configured-synthetic-response-completeness-only"), scope: z.unknown(), request: requestSchema,
  previousBlock: z.unknown(), coveredBlocks: z.array(z.unknown()).min(1).max(MAX_RANGE_BLOCKS),
  bridgeBlocks: z.array(z.unknown()).max(MAX_SPAN_BLOCKS - 1), checkpoint: z.unknown(),
  receipts: z.array(z.unknown()).max(MAX_TRANSACTIONS), candidates: z.array(z.unknown()).max(MAX_LOGS),
  startedAtMs: instant, completedAtMs: instant, reads: z.array(transcriptSchema).min(1).max(MAX_READS),
  semanticClocks: z.array(clockSchema).length(2), coverageSha256: sha256 }).strict();

/** Semantic clock/transcript consistency is retained; copied data cannot authenticate real elapsed time. */
function validateTranscriptTimes(certificate: DevelopmentRangeCoverageV1) {
  inboxCheck(certificate.completedAtMs >= certificate.startedAtMs
    && certificate.completedAtMs - certificate.startedAtMs < MAX_SESSION_MS,
  "TIMEOUT", "Range certificate exceeds its full session interval");
  let wall = certificate.startedAtMs, rawBytes = 0;
  for (const read of certificate.reads) {
    inboxCheck(read.completedAtMs >= wall && read.completedAtMs <= certificate.completedAtMs, "REPLAY_MISMATCH", "Range read timestamps are out of sequence");
    wall = read.completedAtMs;
    const requestBytes = Buffer.byteLength(read.requestBody, "utf8"), responseBytes = Buffer.byteLength(read.responseBody, "utf8");
    inboxCheck(requestBytes <= 1024 && responseBytes <= 1_048_576, "RESOURCE_LIMIT", "Range transcript exceeds a complete native message bound");
    rawBytes += requestBytes + responseBytes;
  }
  inboxCheck(rawBytes <= MAX_RAW_BYTES, "RESOURCE_LIMIT", "Range transcripts exceed their aggregate raw byte bound");
  let lastRead = 0, lastTime = certificate.startedAtMs;
  for (const sample of certificate.semanticClocks) {
    const previous = certificate.reads[sample.afterRead - 1], next = certificate.reads[sample.afterRead];
    inboxCheck(sample.afterRead >= lastRead && sample.afterRead <= certificate.reads.length && sample.atMs >= lastTime
      && sample.atMs >= (previous?.completedAtMs ?? certificate.startedAtMs)
      && sample.atMs <= (next?.completedAtMs ?? certificate.completedAtMs), "REPLAY_MISMATCH", "Range semantic clock moved outside its read boundary");
    lastRead = sample.afterRead; lastTime = sample.atMs;
  }
  inboxCheck(certificate.semanticClocks[1]?.afterRead === certificate.reads.length
    && certificate.semanticClocks[1]?.atMs === certificate.completedAtMs, "REPLAY_MISMATCH", "Range completion clock does not close every native read");
}
function transcriptJson(text: string, tron: boolean): unknown {
  inboxCheck(text.charCodeAt(0) !== 0xfeff, "INVALID_RESPONSE", "Range JSON may not contain a byte order mark");
  if (tron) for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    inboxCheck(token.length <= 17 && /^-?(?:0|[1-9][0-9]*)$/.test(token) && token !== "-0"
      && BigInt(token) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(token) >= -BigInt(Number.MAX_SAFE_INTEGER),
    "INVALID_EVIDENCE", "Range TRON JSON contains an inexact native integer literal");
  }
  try { return captureInboxData(parseChainFixtureJson(text), { maxBytes: 1_048_576, maxNodes: 25_000 }); }
  catch { throw new DepositInboxError("INVALID_RESPONSE", "Range transcript contains invalid, ambiguous, or excessive native JSON"); }
}

/** Recomputes every classification from the original native bytes; an outer checksum alone is insufficient. */
export async function verifyDevelopmentRangeCoverage(supplied: {
  mode: "simulation-only"; manifest: unknown; workerId: string; sourceSetId: string; certificate: unknown;
}): Promise<VerifiedDevelopmentRangeCoverage> {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(supplied, ["mode", "manifest", "workerId", "sourceSetId", "certificate"]);
    inboxRuntime(options.mode);
    const resolved = resolveScope(options.manifest, options.workerId, options.sourceSetId);
    const certificate = parse(certificateSchema, captureInboxData(options.certificate)) as unknown as DevelopmentRangeCoverageV1;
    const request = captureRequest(certificate.request, resolved.chain);
    const { coverageSha256, ...originalBody } = certificate;
    inboxCheck(same(certificate.scope, resolved.scope) && same(request, certificate.request), "ADMISSION_REFUSED", "Range evidence does not bind its exact immutable scope");
    inboxCheck(coverageSha256 === digestInboxValue("deposit-range-coverage", originalBody), "REPLAY_MISMATCH", "Range evidence checksum differs");
    validateTranscriptTimes(certificate);
    let readIndex = 0, clockIndex = 0, closed = false;
    const rpcIds = new Set<string>();
    const read = async (protocol: NodeReadTranscript["protocol"], source: string, operation: string, args: unknown) => {
      inboxRuntime("simulation-only");
      inboxCheck(!closed, "SESSION_CLOSED", "Range replay is already closed");
      const transcript = certificate.reads[readIndex++];
      inboxCheck(transcript && transcript.protocol === protocol && transcript.sourceId === source && transcript.operation === operation
        && transcript.responseSha256 === observationDigest(transcript.responseBody), "REPLAY_MISMATCH", "Range native read is omitted, reordered, substituted, or changed");
      const nativeRequest = transcriptJson(transcript.requestBody, protocol === "tron-http");
      const response = transcriptJson(transcript.responseBody, protocol === "tron-http");
      if (protocol === "tron-http") {
        inboxCheck(same(nativeRequest, args), "REPLAY_MISMATCH", "Range native TRON request changed");
        return response;
      }
      const request = parse(z.object({ jsonrpc: z.literal("2.0"), id: z.string().min(1).max(200), method: z.literal(operation), params: z.unknown() }).strict(), nativeRequest);
      inboxCheck(same(request.params, args) && !rpcIds.has(request.id), "REPLAY_MISMATCH", "Range JSON-RPC request arguments or unique identity changed");
      rpcIds.add(request.id);
      return parse(z.object({ jsonrpc: z.literal("2.0"), id: z.literal(request.id), result: z.unknown() }).strict(), response).result;
    };
    const session: NodeObservationSession = {
      startedAtMs: certificate.startedAtMs,
      bsc: (source, operation, args) => read("bsc-json-rpc", source, operation, args),
      tron: (source, operation, args) => read("tron-http", source, operation, args),
      now() {
        inboxCheck(!closed, "SESSION_CLOSED", "Range replay clock is closed");
        const sample = certificate.semanticClocks[clockIndex++];
        inboxCheck(sample && sample.afterRead === readIndex, "REPLAY_MISMATCH", "Range replay lacks its exact semantic clock boundary");
        return sample.atMs;
      },
      finish() {
        inboxCheck(!closed && readIndex === certificate.reads.length && clockIndex === certificate.semanticClocks.length,
          "REPLAY_MISMATCH", "Range replay left unused native evidence or clock samples");
        closed = true; return certificate.reads;
      },
    };
    const replayed = coverageBody(await scan(resolved, request, session), certificate.semanticClocks);
    inboxCheck(closed && same(replayed, originalBody), "REPLAY_MISMATCH", "Range projections omit, alter, or add native coverage or transfer classification");
    const verified: VerifiedDevelopmentRangeCoverage = captureInboxData({ mode: "simulation-only", creditAuthority: false, cursorAuthority: false,
      certificate: { ...replayed, coverageSha256 } });
    verifiedRanges.add(verified); inboxRuntime("simulation-only"); return verified;
  } catch (error) { throw depositInboxError(error); }
}

/** Pure compatibility only. This does not persist or advance either inbox's finite candidate cursor. */
export function compareDevelopmentRangeCoverage(previous: VerifiedDevelopmentRangeCoverage, next: VerifiedDevelopmentRangeCoverage) {
  inboxRuntime("simulation-only");
  inboxCheck(previous !== null && typeof previous === "object" && verifiedRanges.has(previous)
    && next !== null && typeof next === "object" && verifiedRanges.has(next),
  "ADMISSION_REFUSED", "Range comparison requires original independently replayed capabilities");
  const left = previous.certificate, right = next.certificate;
  inboxCheck(same(left.scope, right.scope), "ADMISSION_REFUSED", "Range comparison cannot change immutable assignment or source scope");
  const unchanged = left.coverageSha256 === right.coverageSha256;
  if (!unchanged) {
    const lastCovered = left.coveredBlocks.at(-1)!;
    inboxCheck(BigInt(right.request.fromBlock) === BigInt(left.request.throughBlock) + ONE,
      "INVALID_EVIDENCE", "Range extension omits heights or overlaps previously covered receipt scope");
    sameBlock(right.previousBlock, lastCovered);
    inboxCheck(BigInt(right.checkpoint.number) >= BigInt(left.checkpoint.number), "SOURCE_CONFLICT", "Range extension finality checkpoint regressed");
    const leftBlocks = new Map([left.previousBlock, ...left.coveredBlocks, ...left.bridgeBlocks].map(block => [block.number, block]));
    for (const block of [right.previousBlock, ...right.coveredBlocks, ...right.bridgeBlocks]) {
      const prior = leftBlocks.get(block.number); if (prior) sameBlock(block, prior);
    }
    const coveredTransactions = new Set(left.coveredBlocks.flatMap(block => [...block.transactions]));
    inboxCheck(right.coveredBlocks.every(block => block.transactions.every(transactionId => !coveredTransactions.has(transactionId))),
      "SOURCE_CONFLICT", "Range extension re-includes an already covered native transaction");
  }
  return captureInboxData({ mode: "simulation-only" as const, creditAuthority: false as const, cursorAuthority: false as const,
    relation: unchanged ? "identical-evidence" as const : "contiguous-extension" as const,
    previousCoverageSha256: left.coverageSha256, nextCoverageSha256: right.coverageSha256,
    fromBlock: left.request.fromBlock, throughBlock: right.request.throughBlock });
}
