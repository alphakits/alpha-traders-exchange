import "server-only";

import { isDeepStrictEqual } from "node:util";
import { verifyTronFixtureTransfer, type CanonicalBlockFixtureProof, type TransferFixtureContext } from "./chain-evidence";
import { captureObserverInput, captureObservationContext, captureObservationPolicy, checkCheckpointFreshness, observationCheck,
  observationRuntime, safeObservationVerification, sealDevelopmentObservation,
  type DevelopmentChainObservation, type ObserverInput } from "./chain-observer-common";

type JsonRecord = Record<string, unknown>;
type NativeBlock = {
  number: number;
  hash: string;
  parentHash: string;
  timestampMs: number;
  transactions: string[];
  header: JsonRecord;
};
type NativeReceipt = { raw: JsonRecord; number: number };
const ZERO_HASH = "0".repeat(64);

function record(value: unknown, label: string): JsonRecord {
  observationCheck(value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_EVIDENCE", `TRON ${label} must be a native object`);
  return value as JsonRecord;
}
function own(value: JsonRecord, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
function hash(value: unknown, label: string): string {
  observationCheck(typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value),
    "INVALID_EVIDENCE", `TRON ${label} must be native visible:false hex`);
  return value.toLowerCase();
}
function integer(value: unknown, label: string): number {
  observationCheck(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
    "INVALID_EVIDENCE", `TRON ${label} must be an exact native nonnegative integer`);
  return value;
}

/** The declared native profile refuses unsafe JSON integers instead of rounding int64 values. */
function safeNativeNumbers(value: unknown, depth = 0): void {
  observationCheck(depth <= 64, "RESOURCE_LIMIT", "TRON native response nesting exceeds the supported bound");
  if (typeof value === "number") {
    observationCheck(Number.isSafeInteger(value) && !Object.is(value, -0),
      "INVALID_EVIDENCE", "TRON native response contains an inexact integer");
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) safeNativeNumbers(child, depth + 1);
  }
}

function nativeBlock(value: unknown, expectedHeight?: number): NativeBlock {
  safeNativeNumbers(value);
  const block = record(value, "block"), header = record(block.block_header, "block_header");
  const raw = record(header.raw_data, "block_header.raw_data"), blockHash = hash(block.blockID, "blockID");
  // java-tron prints proto3 default fields by omission. Only a requested genesis
  // block may omit its zero number/timestamp and empty parent bytes; a nonzero
  // block must carry all three fields. No execution success is ever inferred.
  const genesis = expectedHeight === 0 && blockHash.startsWith("0000000000000000");
  const number = integer(genesis && !own(raw, "number") ? 0 : raw.number, "block number");
  const timestampMs = integer(genesis && !own(raw, "timestamp") ? 0 : raw.timestamp, "block timestamp");
  const parentHash = genesis && (!own(raw, "parentHash") || raw.parentHash === "")
    ? ZERO_HASH : hash(raw.parentHash, "parentHash");
  observationCheck(BigInt(`0x${blockHash.slice(0, 16)}`) === BigInt(number)
    && (expectedHeight === undefined || number === expectedHeight),
  "INVALID_EVIDENCE", "TRON block identity does not encode the requested native height");
  observationCheck(number === 0 || BigInt(`0x${parentHash.slice(0, 16)}`) === BigInt(number - 1),
    "INVALID_EVIDENCE", "TRON parent block ID does not encode the previous height");
  const items = own(block, "transactions") ? block.transactions : [];
  observationCheck(Array.isArray(items) && items.length <= 4096,
    "INVALID_EVIDENCE", "TRON block transactions must be a bounded native array");
  const transactions = items.map(item => hash(record(item, "transaction").txID, "transaction txID"));
  observationCheck(new Set(transactions).size === transactions.length,
    "INVALID_EVIDENCE", "TRON block repeats a transaction identity");
  // Preserve all native header fields for fixed-header/source-change comparisons.
  // Byte fields are case-insensitive; proto3 genesis defaults normalize to zero.
  const normalizedRaw: JsonRecord = { ...raw, number, timestamp: timestampMs, parentHash };
  for (const key of ["txTrieRoot", "witness_address"]) {
    if (typeof normalizedRaw[key] === "string") normalizedRaw[key] = normalizedRaw[key].toLowerCase();
  }
  const normalizedHeader: JsonRecord = { ...header, raw_data: normalizedRaw };
  if (typeof normalizedHeader.witness_signature === "string") normalizedHeader.witness_signature = normalizedHeader.witness_signature.toLowerCase();
  return { number, hash: blockHash, parentHash, timestampMs, transactions, header: normalizedHeader };
}

function nativeReceipt(value: unknown, context: TransferFixtureContext): NativeReceipt {
  safeNativeNumbers(value);
  const receipt = record(value, "transaction info");
  observationCheck(hash(receipt.id, "receipt id") === context.transactionId,
    "INVALID_EVIDENCE", "TRON node returned a different transaction receipt");
  const number = integer(receipt.blockNumber, "receipt blockNumber"), execution = record(receipt.receipt, "execution receipt");
  observationCheck(execution.result === "SUCCESS" && (!own(receipt, "result") || receipt.result === "SUCCESS"),
    "INVALID_EVIDENCE", "TRON receipt does not explicitly report successful execution");
  return { raw: receipt, number };
}

function sameBlock(actual: NativeBlock, expected: NativeBlock): void {
  observationCheck(isDeepStrictEqual(actual, expected), "SOURCE_CONFLICT", "TRON sources disagree on a fixed native block or ordered membership");
}
function successor(actual: NativeBlock, previous: NativeBlock): void {
  observationCheck(actual.number === previous.number + 1 && actual.parentHash === previous.hash
    && actual.timestampMs > previous.timestampMs,
  "SOURCE_CONFLICT", "TRON solidified ancestry is not an exact linked successor with increasing time");
}

/** Compare complete ordered log semantics only after the frozen decoder validates every log. */
function receiptSemantics(receipt: NativeReceipt) {
  const logs = receipt.raw.log as Array<{ address: string; topics: string[]; data: string }>;
  return { id: String(receipt.raw.id).toLowerCase(), number: receipt.number, result: (receipt.raw.receipt as JsonRecord).result,
    logs: logs.map(log => ({ address: log.address.toLowerCase(), topics: log.topics.map(topic => topic.toLowerCase()), data: log.data.toLowerCase() })) };
}
function sameReceipt(actual: NativeReceipt, expected: NativeReceipt): void {
  observationCheck(isDeepStrictEqual(receiptSemantics(actual), receiptSemantics(expected)),
    "SOURCE_CONFLICT", "TRON sources disagree on complete ordered receipt evidence");
}

/**
 * Bounded development observation of two explicitly configured native sources.
 * Matching IDs, headers and receipts establish configured-source consistency only:
 * these checks do not authenticate operators, establish independent infrastructure,
 * recompute block IDs, verify witness signatures, or confer consensus/credit authority.
 * There is no default endpoint, network discovery, signer, ledger or transfer call.
 */
export async function observeTronNodeTransfer(suppliedInput: ObserverInput): Promise<DevelopmentChainObservation> {
  const input = captureObserverInput(suppliedInput);
  observationRuntime(input?.mode);
  const context = captureObservationContext(input.context, "tron"), policy = captureObservationPolicy(input.policy);
  const executionSourceId = input.executionSourceId, finalitySourceId = input.finalitySourceId;
  observationCheck(input.transport && typeof input.transport.openSession === "function",
    "INVALID_INPUT", "TRON observation requires an explicit development transport");
  // openSession enforces distinct configured IDs, hosts and operator groups before IO.
  const session = input.transport.openSession(executionSourceId, finalitySourceId);
  const blockAt = async (source: string, solid: boolean, height: number) => nativeBlock(await session.tron(source,
    solid ? "/walletsolidity/getblockbynum" : "/wallet/getblockbynum", { num: height, visible: false }), height);
  const receiptAt = async (source: string, solid: boolean) => nativeReceipt(await session.tron(source,
    solid ? "/walletsolidity/gettransactioninfobyid" : "/wallet/gettransactioninfobyid",
    { value: context.transactionId, visible: false }), context);
  const solidHead = async () => nativeBlock(await session.tron(finalitySourceId, "/walletsolidity/getnowblock", { visible: false }));

  const executionGenesis = await blockAt(executionSourceId, false, 0), finalityGenesis = await blockAt(finalitySourceId, true, 0);
  observationCheck(executionGenesis.hash === context.chain.genesisHash && finalityGenesis.hash === context.chain.genesisHash,
    "SOURCE_CONFLICT", "TRON configured genesis differs from the native source");
  sameBlock(executionGenesis, finalityGenesis);
  const executionReceipt = await receiptAt(executionSourceId, false);
  const containing = await blockAt(executionSourceId, false, executionReceipt.number);
  sameBlock(await blockAt(finalitySourceId, true, containing.number), containing);
  const finalityReceipt = await receiptAt(finalitySourceId, true), checkpoint = await solidHead();
  checkCheckpointFreshness(checkpoint.timestampMs, session.now(), policy);
  observationCheck(checkpoint.number >= containing.number,
    "SOURCE_CONFLICT", "TRON solidified checkpoint is below the containing block");
  observationCheck(checkpoint.number - containing.number <= policy.maxAncestry,
    "RESOURCE_LIMIT", "TRON containing block exceeds the bounded solidified ancestry window");

  const ancestry: CanonicalBlockFixtureProof["ancestry"] = [];
  let previous = containing;
  for (let offset = 1; offset <= checkpoint.number - containing.number; offset++) {
    const next = await blockAt(finalitySourceId, true, containing.number + offset);
    successor(next, previous);
    ancestry.push({ number: String(next.number), hash: next.hash, parentHash: next.parentHash });
    previous = next;
  }
  sameBlock(previous, checkpoint);
  const proof: CanonicalBlockFixtureProof = { mode: "independent-fixture-proof", chain: context.chain,
    canonical: true, finality: "tron-solidified", block: { number: String(containing.number), hash: containing.hash,
      transactions: containing.transactions }, ancestry, checkpoint: { number: String(checkpoint.number), hash: checkpoint.hash } };
  const verify = (receipt: NativeReceipt) => {
    if (own(receipt.raw, "blockTimeStamp")) observationCheck(integer(receipt.raw.blockTimeStamp, "receipt blockTimeStamp") === containing.timestampMs,
      "INVALID_EVIDENCE", "TRON receipt timestamp conflicts with its containing native block");
    // Pass the complete original receipt; no filtering, fabricated success, or indexer projection.
    return safeObservationVerification(() => verifyTronFixtureTransfer(context, receipt.raw, proof));
  };
  const transfer = verify(executionReceipt);
  verify(finalityReceipt);
  sameReceipt(finalityReceipt, executionReceipt);

  // Re-read fixed identities, not moving ranges, before sealing the pinned proof.
  sameBlock(await blockAt(executionSourceId, false, containing.number), containing);
  sameBlock(await blockAt(finalitySourceId, true, containing.number), containing);
  sameBlock(await blockAt(finalitySourceId, true, checkpoint.number), checkpoint);
  const executionAgain = await receiptAt(executionSourceId, false), finalityAgain = await receiptAt(finalitySourceId, true);
  verify(executionAgain); verify(finalityAgain);
  sameReceipt(executionAgain, executionReceipt); sameReceipt(finalityAgain, executionReceipt);

  const freshHead = await solidHead();
  checkCheckpointFreshness(freshHead.timestampMs, session.now(), policy);
  observationCheck(freshHead.number >= checkpoint.number, "SOURCE_CONFLICT", "TRON solidified head regressed during observation");
  if (freshHead.number === checkpoint.number) sameBlock(freshHead, checkpoint);
  else {
    observationCheck(freshHead.number - containing.number <= policy.maxAncestry,
      "RESOURCE_LIMIT", "TRON advancing head exceeds the total bounded ancestry window");
    previous = checkpoint;
    // Follow only this captured head. Never chase a continually moving checkpoint.
    for (let offset = 1; offset <= freshHead.number - checkpoint.number; offset++) {
      const next = await blockAt(finalitySourceId, true, checkpoint.number + offset);
      successor(next, previous);
      previous = next;
    }
    sameBlock(previous, freshHead);
  }
  return sealDevelopmentObservation({ session, transfer, executionSourceId, finalitySourceId,
    checkpointTimestampMs: checkpoint.timestampMs, policy });
}
