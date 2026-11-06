import { createHash } from "node:crypto";
import { createDepositObservationAdmissionFixture, type DepositObservationFixtureFamily } from "./deposit-observation-fixtures";
import { captureDepositInboxManifest, type DepositInboxCandidate, type DepositInboxManifestV1 } from "../../src/lib/alpha-wallet/deposit-inbox-admission";
import { captureInboxData, digestInboxValue } from "../../src/lib/alpha-wallet/deposit-inbox-data";
import { createAdmittedDevelopmentObservationReader, verifyPreparedDepositObservation,
  type AdmittedDevelopmentObservationReaderOptions, type PreparedDepositObservationV1 } from "../../src/lib/alpha-wallet/deposit-observation-preparation";
import type { DepositInboxUnsealedAttempt } from "../../src/lib/alpha-wallet/deposit-inbox-protocol";

type Row = Record<string, unknown>;
type Family = DepositObservationFixtureFamily;
const row = (value: unknown) => value as Row;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UINT64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
export const DEPOSIT_INBOX_FIXTURE_UINT64_MAX = UINT64_MAX.toString();
export const DEPOSIT_INBOX_FIXTURE_UINT256_MAX = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();

export interface DepositInboxFixtureRead {
  readonly ordinal: number;
  readonly attemptId: string;
  readonly sourceId: string;
  readonly source: "execution" | "finality";
  readonly protocol: "bsc-json-rpc" | "tron-http";
  readonly operation: string;
  readonly requestBody: string;
  readonly request: Readonly<Row>;
  readonly isHead: boolean;
  readonly occurrence: number;
  readonly url: string;
}

export interface DepositInboxFixtureVariant {
  /** Exact decimal native quantities; no BSC height or index passes through Number. */
  containingHeight?: string;
  checkpointHeight?: string;
  /** The second explicit finalized/solidified head, when it advances during capture. */
  headHeight?: string;
  forkFromHeight?: string;
  forkTag?: string;
  /** Override only for independent extreme-height fixtures whose timestamps must remain representable. */
  timestampOriginHeight?: string;
  /** Two identical Transfer payloads at distinct positions in one unchanged full receipt. */
  duplicateTransferLog?: boolean;
  failure?: "missing-receipt" | "invalid-evidence" | "source-conflict" | "timeout";
  mutateResponse?: (value: unknown, read: DepositInboxFixtureRead) => unknown | Promise<unknown>;
}

export interface DepositInboxFixturePreparation {
  attemptId: string;
  storeInstanceId: string;
  preparationContext: AdmittedDevelopmentObservationReaderOptions["preparationContext"];
  candidate?: DepositInboxCandidate;
  jobId?: string;
  variant?: DepositInboxFixtureVariant;
}

export interface DepositInboxFixture {
  readonly family: Family;
  readonly mode: "simulation-only";
  readonly manifest: DepositInboxManifestV1;
  readonly workerId: string;
  readonly inboxId: string;
  readonly chainKey: string;
  readonly assignmentId: string;
  readonly sourceSetId: string;
  readonly assignments: Readonly<{ principal: string; otherRecipient: string; otherToken: string }>;
  readonly standardCandidate: DepositInboxCandidate;
  readonly candidates: readonly DepositInboxCandidate[];
  /** A fresh transaction absent from the original block, for genuine later continuity scenarios. */
  readonly laterCandidate: DepositInboxCandidate;
  readonly containingHeight: string;
  readonly checkpointHeight: string;
  readonly now: number;
  readonly clock: () => number;
  readonly calls: DepositInboxFixtureRead[];
  setNow(value: number): void;
  blockAt(height: string, variant?: DepositInboxFixtureVariant, candidate?: DepositInboxCandidate): Row;
  prepare(input: DepositInboxFixturePreparation): Promise<PreparedDepositObservationV1>;
  probe(input: DepositInboxFixturePreparation): Promise<
    { readonly kind: "prepared"; readonly mode: "simulation-only"; readonly creditAuthority: false; readonly prepared: PreparedDepositObservationV1 }
    | { readonly kind: "held"; readonly mode: "simulation-only"; readonly creditAuthority: false; readonly attempt: DepositInboxUnsealedAttempt }>;
  /** Preserve the exact observation, change only attempt provenance, and run the real verifier again. */
  rebindAttempt(prepared: PreparedDepositObservationV1, attemptId: string): Promise<PreparedDepositObservationV1>;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Synthetic deposit inbox fixture: ${message}`);
}

function quantity(value: string): bigint {
  check(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value), "native quantity must be an exact decimal string");
  const number = BigInt(value);
  check(number <= UINT64_MAX, "native quantity exceeds uint64");
  return number;
}

const hexQuantity = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: string) => BigInt(value).toString(16).padStart(64, "0");

/**
 * Deterministic synthetic native history shared by model, SQL and recovery tests.
 * Each prepare uses the real admitted reader and archival verifier. No network,
 * fake validated objects, database state or synthetic persisted context is supplied here.
 */
export function createDepositInboxFixture(family: Family, options: { now?: number; amountRaw?: string } = {}): DepositInboxFixture {
  const base = createDepositObservationAdmissionFixture(family, options);
  const native = base.fixture, initialNow = native.now;
  const defaultContaining = BigInt(native.containingHeight), defaultCheckpoint = BigInt(native.headHeight);
  const prefix = family === "bsc" ? "0x" : "41";
  const alternateAsset = `${family}-inbox-other-token`;
  const otherRecipientAssignment = `${family}-inbox-other-recipient`, otherTokenAssignment = `${family}-inbox-other-token-recipient`;
  const rawManifest = structuredClone(base.manifest);
  rawManifest.assets.push({ ...rawManifest.assets[0], assetRef: alternateAsset, token: `${prefix}${"77".repeat(20)}` });
  rawManifest.assignments.push(
    { ...rawManifest.assignments[0], assignmentId: otherRecipientAssignment, recipient: `${prefix}${"66".repeat(20)}`, beneficiaryRef: "fixture-other-recipient" },
    { ...rawManifest.assignments[0], assignmentId: otherTokenAssignment, assetRef: alternateAsset,
      recipient: `${prefix}${"88".repeat(20)}`, beneficiaryRef: "fixture-other-token" },
  );
  rawManifest.workers[0].assignmentIds.push(otherRecipientAssignment, otherTokenAssignment);
  const admission = captureDepositInboxManifest(rawManifest), manifest = admission.manifest;
  const secondaryTransaction = `${family === "bsc" ? "0x" : ""}${"12".repeat(32)}`;
  const unrelatedTransaction = `${family === "bsc" ? "0x" : ""}${"55".repeat(32)}`;
  const standardCandidate = captureInboxData<DepositInboxCandidate>(base.candidate);
  const candidates = captureInboxData<DepositInboxCandidate[]>([standardCandidate,
    { ...standardCandidate, transactionId: secondaryTransaction, eventIndex: family === "bsc" ? "10" : "1" }]);
  const laterCandidate = captureInboxData<DepositInboxCandidate>({ ...standardCandidate,
    transactionId: `${family === "bsc" ? "0x" : ""}${"13".repeat(32)}` });
  const transactions = [unrelatedTransaction, standardCandidate.transactionId, secondaryTransaction];
  const nativeGenesis = native.context.chain.genesisHash;
  const calls: DepositInboxFixtureRead[] = [];
  const attempts = new Set<string>();

  function heights(variant: DepositInboxFixtureVariant) {
    const containing = quantity(variant.containingHeight ?? defaultContaining.toString());
    const checkpoint = quantity(variant.checkpointHeight ?? (containing + defaultCheckpoint - defaultContaining).toString());
    const head = quantity(variant.headHeight ?? checkpoint.toString());
    const origin = quantity(variant.timestampOriginHeight ?? defaultContaining.toString());
    const forkFrom = variant.forkFromHeight === undefined ? undefined : quantity(variant.forkFromHeight);
    check(checkpoint >= containing && head >= checkpoint, "invalid containing/checkpoint/head order");
    check(forkFrom === undefined || forkFrom > BigInt(0), "admitted genesis may not fork");
    if (family === "tron") check(head <= MAX_SAFE && containing <= MAX_SAFE, "TRON profile requires exact native safe integers");
    return { containing, checkpoint, head, origin, forkFrom };
  }

  function blockHash(height: bigint, variant: DepositInboxFixtureVariant): string {
    if (height === BigInt(0)) return nativeGenesis;
    const { forkFrom } = heights(variant);
    const forked = forkFrom !== undefined && height >= forkFrom;
    const digest = forked ? createHash("sha256").update(`synthetic-inbox-block:${family}:${variant.forkTag ?? "fork"}:${height}`).digest("hex") : undefined;
    if (family === "bsc") return `0x${digest ?? word(height.toString())}`;
    return `${height.toString(16).padStart(16, "0")}${digest?.slice(0, 48) ?? "aa".repeat(24)}`;
  }

  function timestamp(height: bigint, variant: DepositInboxFixtureVariant): number {
    if (height === BigInt(0)) return 0;
    const { origin } = heights(variant);
    const baseTime = family === "bsc" ? BigInt(Math.floor(initialNow / 1000) * 1000 - 100_000) : BigInt(initialNow - 10_000);
    const value = baseTime + (height - origin) * BigInt(family === "bsc" ? 1000 : 100);
    check(value >= BigInt(0) && value <= MAX_SAFE, "block timestamp exceeds exact native milliseconds; set an explicit time origin for an extreme fixture");
    return Number(value);
  }

  function members(variant: DepositInboxFixtureVariant, candidate: DepositInboxCandidate): string[] {
    return heights(variant).containing === defaultContaining ? transactions
      : [`${family === "bsc" ? "0x" : ""}${"56".repeat(32)}`, candidate.transactionId];
  }

  function blockAt(heightValue: string, variant: DepositInboxFixtureVariant = {}, candidate: DepositInboxCandidate = standardCandidate): Row {
    const height = quantity(heightValue), { containing } = heights(variant);
    if (family === "bsc") return {
      number: hexQuantity(height), hash: blockHash(height, variant),
      parentHash: height === BigInt(0) ? `0x${"00".repeat(32)}` : blockHash(height - BigInt(1), variant),
      timestamp: hexQuantity(BigInt(timestamp(height, variant)) / BigInt(1000)),
      transactions: height === containing ? [...members(variant, candidate)] : [],
    };
    check(height <= MAX_SAFE, "TRON native block height exceeds its exact numeric profile");
    const block = native.blockAt(0), header = row(block.block_header), raw = row(header.raw_data);
    block.blockID = blockHash(height, variant);
    raw.number = Number(height); raw.timestamp = timestamp(height, variant);
    raw.parentHash = height === BigInt(0) ? "00".repeat(32) : blockHash(height - BigInt(1), variant);
    block.transactions = height === containing ? members(variant, candidate).map((txID, index) => ({ txID, raw_data: { timestamp: timestamp(height, variant) },
      ...(index === 0 ? {} : { ret: [{ contractRet: "SUCCESS" }] }) })) : [];
    return block;
  }

  function receipt(candidate: DepositInboxCandidate, variant: DepositInboxFixtureVariant): Row {
    const assignment = manifest.assignments.find(value => value.assignmentId === candidate.assignmentId);
    check(assignment, "unknown fixture assignment");
    const asset = manifest.assets.find(value => value.assetRef === assignment.assetRef)!;
    const transactionIndex = members(variant, candidate).indexOf(candidate.transactionId);
    check(transactionIndex > 0, "candidate must identify a complete fixture transaction");
    const { containing } = heights(variant), result = native.receipt();
    if (family === "bsc") {
      const eventIndex = quantity(variant.duplicateTransferLog
        ? (candidate.transactionId === secondaryTransaction ? "10" : "8") : candidate.eventIndex);
      check(eventIndex > BigInt(0), "BSC selected fixture log needs room for its preceding unrelated log");
      Object.assign(result, { transactionHash: candidate.transactionId, transactionIndex: hexQuantity(BigInt(transactionIndex)),
        blockHash: blockHash(containing, variant), blockNumber: hexQuantity(containing) });
      const logs = result.logs as Row[];
      for (let offset = 0; offset < logs.length; offset++) Object.assign(logs[offset], {
        transactionHash: result.transactionHash, transactionIndex: result.transactionIndex,
        blockHash: result.blockHash, blockNumber: result.blockNumber, address: asset.token,
        logIndex: hexQuantity(eventIndex - BigInt(1) + BigInt(offset)),
      });
      (logs[1].topics as string[])[2] = `0x${"0".repeat(24)}${assignment.recipient.slice(2)}`;
      logs[1].data = `0x${word(variant.failure === "invalid-evidence" ? (candidate.amountRaw === "1" ? "2" : "1") : candidate.amountRaw)}`;
      if (variant.duplicateTransferLog) logs.push({ ...structuredClone(logs[1]), logIndex: hexQuantity(eventIndex + BigInt(1)) });
    } else {
      Object.assign(result, { id: candidate.transactionId, blockNumber: Number(containing), blockTimeStamp: timestamp(containing, variant) });
      const logs = result.log as Row[];
      for (const log of logs) log.address = asset.token.slice(2);
      (logs[1].topics as string[])[2] = `${"0".repeat(24)}${assignment.recipient.slice(2)}`;
      logs[1].data = word(variant.failure === "invalid-evidence" ? (candidate.amountRaw === "1" ? "2" : "1") : candidate.amountRaw);
      if (variant.duplicateTransferLog) logs.push(structuredClone(logs[1]));
      // The fixed native receipt deliberately keeps every log. Larger offsets are missing evidence, never fabricated.
    }
    return result;
  }

  function prepareInput(input: DepositInboxFixturePreparation) {
      check(!attempts.has(input.attemptId), "reuse prepared bytes for a retry; an existing attempt may not be reobserved");
      attempts.add(input.attemptId);
      const candidate = captureInboxData<DepositInboxCandidate>(input.candidate ?? standardCandidate);
      const variant = { ...(input.variant ?? {}) }, capturedHeights = heights(variant);
      const occurrences = new Map<string, number>();
      let headReads = 0, timedOut = false;
      const fetch: AdmittedDevelopmentObservationReaderOptions["fetch"] = async (url, init) => {
        check(init.method === "POST" && typeof init.body === "string", "native reads require a JSON POST");
        const endpoint = new URL(url), source = native.sources.find(value => new URL(value.endpoint).origin === endpoint.origin);
        check(source && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, "unadmitted fixture endpoint");
        const role = source.id === native.executionSourceId ? "execution" : "finality";
        const request = JSON.parse(init.body) as Row;
        let value: unknown, operation: string, isHead = false;
        if (family === "bsc") {
          check(endpoint.href === new URL(source.endpoint).href && request.jsonrpc === "2.0" && Array.isArray(request.params), "invalid fixture JSON-RPC request");
          operation = request.method as string;
          const params = request.params as unknown[];
          if (operation === "eth_chainId") value = variant.failure === "source-conflict" && role === "finality" ? "0x38" : "0x61";
          else if (operation === "eth_getTransactionReceipt") {
            check(params[0] === candidate.transactionId, "unexpected receipt transaction");
            value = variant.failure === "missing-receipt" ? null : receipt(candidate, variant);
          } else if (operation === "eth_getBlockByNumber") {
            check(params[1] === false && typeof params[0] === "string", "unexpected block parameters");
            isHead = params[0] === "finalized";
            value = blockAt((isHead ? (headReads++ === 0 ? capturedHeights.checkpoint : capturedHeights.head) : BigInt(params[0])).toString(), variant, candidate);
          } else throw new Error(`Unsupported synthetic BSC read: ${operation}`);
        } else {
          operation = endpoint.pathname;
          const pathPrefix = role === "execution" ? "/wallet/" : "/walletsolidity/";
          check(operation.startsWith(pathPrefix) && request.visible === false, "unexpected native TRON path or address encoding");
          if (operation === `${pathPrefix}getblockbynum`) {
            check(typeof request.num === "number" && Number.isSafeInteger(request.num), "unexpected TRON native height");
            value = blockAt(String(request.num), variant, candidate);
            if (variant.failure === "source-conflict" && role === "finality" && request.num === 0) row(value).blockID = `0000000000000000${"cc".repeat(24)}`;
          } else if (operation === `${pathPrefix}gettransactioninfobyid`) {
            check(request.value === candidate.transactionId, "unexpected receipt transaction");
            value = variant.failure === "missing-receipt" ? {} : receipt(candidate, variant);
          } else if (operation === "/walletsolidity/getnowblock") {
            isHead = true; value = blockAt((headReads++ === 0 ? capturedHeights.checkpoint : capturedHeights.head).toString(), variant, candidate);
          } else throw new Error(`Unsupported synthetic TRON read: ${operation}`);
        }
        const occurrenceKey = JSON.stringify([source.id, operation, family === "bsc" ? request.params : request]);
        const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
        occurrences.set(occurrenceKey, occurrence);
        const read = captureInboxData<DepositInboxFixtureRead>({ ordinal: calls.length + 1, attemptId: input.attemptId,
          sourceId: source.id, source: role, protocol: family === "bsc" ? "bsc-json-rpc" : "tron-http",
          operation, requestBody: init.body, request, isHead, occurrence, url });
        calls.push(read);
        if (variant.failure === "timeout" && !timedOut) { timedOut = true; native.setNow(native.now + 5_000); }
        const replacement = await variant.mutateResponse?.(value, read);
        if (replacement instanceof Response) return replacement;
        if (replacement !== undefined) value = replacement;
        const response = new Response(JSON.stringify(family === "bsc" ? { jsonrpc: "2.0", id: request.id, result: value } : value),
          { headers: { "content-type": "application/json; charset=utf-8" } });
        Object.defineProperty(response, "url", { value: url });
        return response;
      };
      return { options: { mode: "simulation-only" as const, manifest, workerId: base.workerId,
        storeInstanceId: input.storeInstanceId, endpointConfig: base.endpointConfig, fetch, clock: native.clock,
        preparationContext: input.preparationContext },
      request: { attemptId: input.attemptId, candidate, ...(input.jobId === undefined ? {} : { jobId: input.jobId }) } };
  }

  const fixture: DepositInboxFixture = {
    family, mode: "simulation-only", manifest, workerId: base.workerId, inboxId: base.inboxId, chainKey: base.chainKey,
    assignmentId: base.assignmentId, sourceSetId: base.sourceSetId,
    assignments: Object.freeze({ principal: base.assignmentId, otherRecipient: otherRecipientAssignment, otherToken: otherTokenAssignment }),
    standardCandidate, candidates, laterCandidate, containingHeight: defaultContaining.toString(), checkpointHeight: defaultCheckpoint.toString(),
    get now() { return native.now; }, clock: native.clock, setNow: value => native.setNow(value), calls, blockAt,
    async prepare(input) {
      const captured = prepareInput(input);
      return createAdmittedDevelopmentObservationReader(captured.options).prepare(captured.request);
    },
    async probe(input) {
      const captured = prepareInput(input);
      const { createDevelopmentDepositInboxProbe } = await import("../../src/lib/alpha-wallet/deposit-inbox-probe");
      return createDevelopmentDepositInboxProbe(captured.options).prepare(captured.request);
    },
    async rebindAttempt(prepared, attemptId) {
      const { preparationSha256: ignored, ...originalBody } = prepared;
      void ignored;
      const body = { ...originalBody, attemptId };
      const rebound = { ...body, preparationSha256: digestInboxValue("prepared-observation", body) };
      return (await verifyPreparedDepositObservation({ mode: "simulation-only", manifest, workerId: base.workerId,
        storeInstanceId: prepared.storeInstanceId, prepared: rebound })).prepared;
    },
  };
  return fixture;
}
