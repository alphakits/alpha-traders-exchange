import "server-only";
import { verifyBscFixtureTransfer, type CanonicalBlockFixtureProof } from "./chain-evidence";
import {
  captureObserverInput,
  captureObservationContext,
  captureObservationPolicy,
  checkCheckpointFreshness,
  observationCheck,
  observationRuntime,
  safeObservationVerification,
  sealDevelopmentObservation,
  type ObserverInput,
} from "./chain-observer-common";

type NativeObject = Record<string, unknown>;
type Block = Readonly<{
  number: string;
  hash: string;
  parentHash: string;
  timestampMs: number;
  transactions: readonly string[];
}>;
const ONE = BigInt(1), MAX_UINT64 = (ONE << BigInt(64)) - ONE;
const MAX_TIMESTAMP_SECONDS = BigInt("8640000000000");
const MAX_TRANSACTIONS = 4096;

function record(value: unknown, label: string): NativeObject {
  observationCheck(value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_RESPONSE", `${label} must be a native JSON object`);
  const prototype = Object.getPrototypeOf(value);
  observationCheck(prototype === Object.prototype || prototype === null,
    "INVALID_RESPONSE", `${label} must contain plain JSON data`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    observationCheck(typeof key === "string" && descriptor.enumerable && "value" in descriptor,
      "INVALID_RESPONSE", `${label} must contain plain JSON fields`);
  }
  return value as NativeObject;
}

function hash(value: unknown, label: string): string {
  observationCheck(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
    "INVALID_RESPONSE", `${label} must be an exact native block or transaction hash`);
  return value.toLowerCase();
}

function quantity(value: unknown, label: string, maximum = MAX_UINT64): string {
  observationCheck(typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value),
    "INVALID_RESPONSE", `${label} must be a canonical native hex quantity`);
  const number = BigInt(value);
  observationCheck(number <= maximum, "INVALID_RESPONSE", `${label} exceeds the supported exact range`);
  return number.toString();
}

function nativeBlock(value: unknown, expectedNumber?: string): Block {
  const block = record(value, "BSC block");
  const number = quantity(block.number, "block.number");
  observationCheck(expectedNumber === undefined || number === expectedNumber,
    "SOURCE_CONFLICT", "BSC node returned a different block height than requested");
  const timestampMs = Number(quantity(block.timestamp, "block.timestamp", MAX_TIMESTAMP_SECONDS)) * 1000;
  observationCheck(number === "0" || timestampMs > 0, "INVALID_RESPONSE", "A non-genesis BSC block requires a timestamp");
  observationCheck(Array.isArray(block.transactions), "INVALID_RESPONSE", "BSC block must include ordered transaction hashes");
  observationCheck(block.transactions.length <= MAX_TRANSACTIONS,
    "RESOURCE_LIMIT", "BSC block exceeds the transaction count bound");
  observationCheck(Reflect.ownKeys(block.transactions).length === block.transactions.length + 1,
    "INVALID_RESPONSE", "BSC transactions must be a dense native array");
  const transactions = Array.from(block.transactions, (transaction, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(block.transactions, String(index));
    observationCheck(descriptor && "value" in descriptor && descriptor.enumerable,
      "INVALID_RESPONSE", "BSC transactions must contain plain hash values");
    return hash(transaction, "block transaction");
  });
  observationCheck(new Set(transactions).size === transactions.length,
    "INVALID_RESPONSE", "BSC block repeats a transaction hash");
  return Object.freeze({ number, hash: hash(block.hash, "block.hash"),
    parentHash: hash(block.parentHash, "block.parentHash"), timestampMs, transactions: Object.freeze(transactions) });
}

function sameBlock(actual: Block, expected: Block) {
  observationCheck(JSON.stringify(actual) === JSON.stringify(expected),
    "SOURCE_CONFLICT", "Configured BSC block views disagree");
}

/** Called only after the frozen decoder has validated every supported receipt field. */
function receiptSemantics(receipt: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("0x")) return value.toLowerCase();
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, normalize(child)]));
    }
    return value;
  };
  return JSON.stringify(normalize(receipt));
}

/**
 * Collects configured-node consistency evidence using explicit BSC finality.
 * It does not authenticate consensus or independent ownership of the sources,
 * persist a deposit, grant credit authority, sign, or submit a transaction.
 */
export async function observeBscNodeTransfer(suppliedInput: ObserverInput) {
  const input = captureObserverInput(suppliedInput);
  const { mode, transport, executionSourceId, finalitySourceId, context: suppliedContext, policy: suppliedPolicy } = input;
  observationRuntime(mode);
  const context = captureObservationContext(suppliedContext, "bsc");
  const policy = captureObservationPolicy(suppliedPolicy);
  observationCheck(context.chain.family === "bsc", "INVALID_INPUT", "BSC observation requires a BSC identity");
  const session = transport.openSession(executionSourceId, finalitySourceId);
  const sources = [executionSourceId, finalitySourceId] as const;
  const readBlock = async (sourceId: string, number: string) => nativeBlock(
    await session.bsc(sourceId, "eth_getBlockByNumber", [`0x${BigInt(number).toString(16)}`, false]), number);
  const readReceipt = async (sourceId: string) => {
    const result = await session.bsc(sourceId, "eth_getTransactionReceipt", [context.transactionId]);
    observationCheck(result !== null, "INVALID_EVIDENCE", "The requested BSC transaction has no native receipt");
    const receipt = record(result, "BSC receipt");
    observationCheck(hash(receipt.transactionHash, "receipt.transactionHash") === context.transactionId,
      "SOURCE_CONFLICT", "BSC receipt is for a different transaction");
    return receipt;
  };

  for (const sourceId of sources) {
    const chainId = quantity(await session.bsc(sourceId, "eth_chainId", []), "chain ID");
    observationCheck(chainId === context.chain.chainId, "SOURCE_CONFLICT", "BSC chain identity differs from the configured network");
  }
  const executionGenesis = await readBlock(executionSourceId, "0");
  const finalityGenesis = await readBlock(finalitySourceId, "0");
  observationCheck(executionGenesis.hash === context.chain.genesisHash && finalityGenesis.hash === context.chain.genesisHash,
    "SOURCE_CONFLICT", "BSC genesis differs from the configured network");
  sameBlock(executionGenesis, finalityGenesis);

  const receipt = await readReceipt(executionSourceId);
  const containingNumber = quantity(receipt.blockNumber, "receipt.blockNumber");
  const containing = await readBlock(executionSourceId, containingNumber);
  const checkpoint = nativeBlock(await session.bsc(finalitySourceId, "eth_getBlockByNumber", ["finalized", false]));
  checkCheckpointFreshness(checkpoint.timestampMs, session.now(), policy);
  const containingHeight = BigInt(containingNumber), checkpointHeight = BigInt(checkpoint.number);
  observationCheck(checkpointHeight >= containingHeight,
    "INVALID_EVIDENCE", "BSC containing block is beyond the explicit finalized checkpoint");
  observationCheck(checkpointHeight - containingHeight <= BigInt(policy.maxAncestry),
    "RESOURCE_LIMIT", "BSC finality ancestry requires bounded backfill outside this observation");

  sameBlock(await readBlock(finalitySourceId, containingNumber), containing);
  const finalityReceipt = await readReceipt(finalitySourceId);
  const ancestry: CanonicalBlockFixtureProof["ancestry"] = [];
  const seenHashes = new Set([containing.hash]);
  const successor = async (number: bigint, previous: Block): Promise<Block> => {
    const next = await readBlock(finalitySourceId, number.toString());
    sameBlock(await readBlock(executionSourceId, number.toString()), next);
    observationCheck(next.parentHash === previous.hash && next.timestampMs >= previous.timestampMs && !seenHashes.has(next.hash),
      "SOURCE_CONFLICT", "BSC canonical ancestry has a conflicting parent, time, or repeated block hash");
    seenHashes.add(next.hash);
    return next;
  };
  let previous = containing;
  for (let number = containingHeight + ONE; number <= checkpointHeight; number += ONE) {
    const next = await successor(number, previous);
    ancestry.push({ number: next.number, hash: next.hash, parentHash: next.parentHash });
    previous = next;
  }
  sameBlock(previous, checkpoint);
  const proof: CanonicalBlockFixtureProof = {
    mode: "independent-fixture-proof", chain: context.chain, canonical: true, finality: "bsc-finalized",
    block: { number: containing.number, hash: containing.hash, transactions: [...containing.transactions] },
    ancestry, checkpoint: { number: checkpoint.number, hash: checkpoint.hash },
  };
  const verify = (value: unknown) => safeObservationVerification(() => verifyBscFixtureTransfer(context, value, proof));
  const transfer = verify(receipt), corroborated = verify(finalityReceipt);
  const originalSemantics = receiptSemantics(receipt);
  observationCheck(originalSemantics === receiptSemantics(finalityReceipt) && JSON.stringify(transfer) === JSON.stringify(corroborated),
    "SOURCE_CONFLICT", "Configured BSC sources disagree on complete native receipt evidence");

  // Pin the original block, checkpoint, and complete receipt on each source.
  for (const sourceId of sources) {
    sameBlock(await readBlock(sourceId, containingNumber), containing);
    sameBlock(await readBlock(sourceId, checkpoint.number), checkpoint);
    const reread = await readReceipt(sourceId);
    verify(reread);
    observationCheck(receiptSemantics(reread) === originalSemantics,
      "SOURCE_CONFLICT", "BSC receipt changed during the observation");
  }

  const finalizedNow = nativeBlock(await session.bsc(finalitySourceId, "eth_getBlockByNumber", ["finalized", false]));
  checkCheckpointFreshness(finalizedNow.timestampMs, session.now(), policy);
  const finalHeight = BigInt(finalizedNow.number);
  observationCheck(finalHeight >= checkpointHeight && finalizedNow.timestampMs >= checkpoint.timestampMs,
    "SOURCE_CONFLICT", "BSC finalized head regressed during the observation");
  if (finalHeight === checkpointHeight) sameBlock(finalizedNow, checkpoint);
  else {
    observationCheck(finalHeight - containingHeight <= BigInt(policy.maxAncestry),
      "RESOURCE_LIMIT", "BSC advancing finality exceeds the original total ancestry bound");
    let continued = checkpoint;
    for (let number = checkpointHeight + ONE; number <= finalHeight; number += ONE) continued = await successor(number, continued);
    sameBlock(continued, finalizedNow);
  }

  observationRuntime(mode);
  return sealDevelopmentObservation({ session, transfer, executionSourceId, finalitySourceId,
    checkpointTimestampMs: checkpoint.timestampMs, policy });
}
