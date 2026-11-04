/** Pure fixture evidence checks. No RPC, credit authority, custody, or signing. */
export type FixtureChain =
  | { family: "bsc"; chainId: "56" | "97"; genesisHash: string }
  | { family: "tron"; network: "mainnet" | "nile" | "shasta"; genesisHash: string };

export interface TransferFixtureContext {
  mode: "development-fixture";
  chain: FixtureChain;
  token: string;
  recipient: string;
  transactionId: string;
  amountRaw: string;
  /** Decimal block-wide logIndex on BSC; unfiltered receipt-array offset on TRON. */
  eventIndex: string;
}

export interface CanonicalBlockFixtureProof {
  mode: "independent-fixture-proof";
  chain: FixtureChain;
  canonical: true;
  finality: "bsc-finalized" | "tron-solidified";
  block: { number: string; hash: string; transactions: string[] };
  /** Every successor, in order, up to and including the checkpoint. */
  ancestry: { number: string; hash: string; parentHash: string }[];
  checkpoint: { number: string; hash: string };
}

export interface VerifiedFixtureTransfer {
  readonly kind: "verified-development-transfer-evidence";
  readonly creditAuthority: false;
  readonly assurance: "supplied-fixture-consistency-only";
  readonly family: "bsc" | "tron";
  readonly chainKey: string;
  readonly token: string;
  readonly sender: string;
  readonly recipient: string;
  readonly amountRaw: string;
  readonly transactionId: string;
  readonly transactionIndex: string;
  readonly eventIndex: string;
  readonly eventKey: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly finality: "bsc-finalized" | "tron-solidified";
  readonly checkpointNumber: string;
  readonly checkpointHash: string;
}

export class ChainEvidenceError extends Error {
  constructor(reason: string) {
    super(`Chain fixture rejected: ${reason}`);
    this.name = "ChainEvidenceError";
  }
}

const ZERO = BigInt(0), ONE = BigInt(1);
const MAX_UINT256 = (ONE << BigInt(256)) - ONE;
const MAX_UINT64 = (ONE << BigInt(64)) - ONE;
const MAX_TRON_HEIGHT = (ONE << BigInt(63)) - ONE;
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_ITEMS = 4096, MAX_ANCESTRY = 1024, MAX_JSON_CHARS = 1_048_576;
type RecordValue = Record<string, unknown>;
type Family = FixtureChain["family"];

function fail(reason: string): never { throw new ChainEvidenceError(reason); }
function check(condition: unknown, reason: string): asserts condition { if (!condition) fail(reason); }
function own(value: RecordValue, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }

function object(value: unknown, label: string, required: string[], optional: string[] = []): RecordValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null, `${label} must be JSON data`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === "string" && allowed.has(key), `${label} has an unsupported field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    check("value" in descriptor && descriptor.enumerable, `${label} must contain plain data fields`);
  }
  for (const key of required) check(Object.prototype.hasOwnProperty.call(value, key), `${label}.${key} is missing`);
  return value as RecordValue;
}

function array(value: unknown, label: string, maximum = MAX_ITEMS): unknown[] {
  check(Array.isArray(value) && value.length <= maximum, `${label} must be a bounded array`);
  check(Reflect.ownKeys(value).length === value.length + 1, `${label} must be a dense JSON array`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    check(descriptor && "value" in descriptor && descriptor.enumerable, `${label} must contain plain data items`);
  }
  return value;
}

function hex(value: unknown, bytes: number, prefixed: boolean, label: string): string {
  const prefix = prefixed ? "0x" : "";
  check(typeof value === "string" && value.length === bytes * 2 + prefix.length &&
    value.startsWith(prefix) && /^[0-9a-fA-F]+$/.test(value.slice(prefix.length)), `${label} has invalid hex encoding`);
  return value.toLowerCase();
}

function data(value: unknown, prefixed: boolean, label: string): string {
  const prefix = prefixed ? "0x" : "";
  check(typeof value === "string" && value.length <= 131072 + prefix.length && value.startsWith(prefix) &&
    /^(?:[0-9a-fA-F]{2})*$/.test(value.slice(prefix.length)), `${label} has invalid byte encoding`);
  return value.toLowerCase();
}

function decimal(value: unknown, maximum: bigint, label: string, positive = false): string {
  check(typeof value === "string" && value.length <= 78 && /^(?:0|[1-9][0-9]*)$/.test(value), `${label} must be canonical decimal`);
  const parsed = BigInt(value);
  check(parsed <= maximum && (!positive || parsed > ZERO), `${label} is outside its supported range`);
  return value;
}

function quantity(value: unknown, maximum: bigint, label: string): string {
  check(typeof value === "string" && value.length <= 66 && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value), `${label} must be a canonical RPC quantity`);
  const parsed = BigInt(value);
  check(parsed <= maximum, `${label} is outside its supported range`);
  return parsed.toString();
}

function tronNumber(value: unknown, label: string): string {
  if (typeof value === "number") {
    check(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0), `${label} must be an exact nonnegative integer`);
    return String(value);
  }
  return decimal(value, MAX_TRON_HEIGHT, label);
}

function address(value: unknown, family: Family, label: string): string {
  if (family === "bsc") return hex(value, 20, true, label);
  const normalized = hex(value, 21, false, label);
  check(normalized.startsWith("41"), `${label} must use the TRON 41 prefix`);
  return normalized;
}

function hash(value: unknown, family: Family, label: string): string { return hex(value, 32, family === "bsc", label); }

function chainKey(value: unknown, family: Family): string {
  const chain = object(value, "chain", family === "bsc" ? ["family", "chainId", "genesisHash"] : ["family", "network", "genesisHash"]);
  check(chain.family === family, "chain family differs from the decoder");
  const genesis = hash(chain.genesisHash, family, "chain.genesisHash");
  if (family === "bsc") {
    check(chain.chainId === "56" || chain.chainId === "97", "unsupported BSC chain ID");
    return `bsc:${chain.chainId}:${genesis}`;
  }
  check(chain.network === "mainnet" || chain.network === "nile" || chain.network === "shasta", "unsupported TRON network");
  check(genesis.slice(0, 16) === "0".repeat(16), "TRON genesis block ID must encode height zero");
  return `tron:${chain.network}:${genesis}`;
}

function context(value: unknown, family: Family) {
  const input = object(value, "context", ["mode", "chain", "token", "recipient", "transactionId", "amountRaw", "eventIndex"]);
  check(input.mode === "development-fixture", "explicit development fixture mode is required");
  return {
    family, chainKey: chainKey(input.chain, family), token: address(input.token, family, "context.token"),
    recipient: address(input.recipient, family, "context.recipient"), transactionId: hash(input.transactionId, family, "context.transactionId"),
    amountRaw: decimal(input.amountRaw, MAX_UINT256, "context.amountRaw", true),
    eventIndex: decimal(input.eventIndex, MAX_UINT64, "context.eventIndex"),
  };
}

type Context = ReturnType<typeof context>;
function blockIdentity(input: RecordValue, family: Family, label: string) {
  const number = decimal(input.number, family === "tron" ? MAX_TRON_HEIGHT : MAX_UINT64, `${label}.number`), blockHash = hash(input.hash, family, `${label}.hash`);
  if (family === "tron") check(BigInt(`0x${blockHash.slice(0, 16)}`).toString() === number, `${label} TRON block ID height conflicts`);
  return { number, hash: blockHash };
}

function canonicalProof(value: unknown, expected: Context) {
  const proof = object(value, "proof", ["mode", "chain", "canonical", "finality", "block", "ancestry", "checkpoint"]);
  check(proof.mode === "independent-fixture-proof" && proof.canonical === true, "independent canonical fixture proof is required");
  check(chainKey(proof.chain, expected.family) === expected.chainKey, "proof chain identity conflicts");
  const finality: VerifiedFixtureTransfer["finality"] = expected.family === "bsc" ? "bsc-finalized" : "tron-solidified";
  check(proof.finality === finality, "finalized or solidified checkpoint is required");
  const block = object(proof.block, "proof.block", ["number", "hash", "transactions"]);
  const containing = blockIdentity(block, expected.family, "proof.block");
  const transactions = array(block.transactions, "proof.block.transactions").map(item => hash(item, expected.family, "block transaction"));
  check(new Set(transactions).size === transactions.length, "canonical block has duplicate transaction IDs");
  const transactionIndex = transactions.indexOf(expected.transactionId);
  check(transactionIndex >= 0, "transaction is absent from the canonical block");
  let previous = containing;
  const seen = new Set([containing.hash]);
  for (const value of array(proof.ancestry, "proof.ancestry", MAX_ANCESTRY)) {
    const header = object(value, "ancestry header", ["number", "hash", "parentHash"]);
    const next = blockIdentity(header, expected.family, "ancestry header");
    check(BigInt(next.number) === BigInt(previous.number) + ONE &&
      hash(header.parentHash, expected.family, "ancestry parentHash") === previous.hash, "finality ancestry is not contiguous");
    check(!seen.has(next.hash), "finality ancestry repeats a block hash");
    seen.add(next.hash);
    previous = next;
  }
  const checkpoint = blockIdentity(object(proof.checkpoint, "proof.checkpoint", ["number", "hash"]), expected.family, "proof.checkpoint");
  check(checkpoint.number === previous.number && checkpoint.hash === previous.hash, "checkpoint is not the end of the canonical ancestry");
  return { blockNumber: containing.number, blockHash: containing.hash, transactionIndex: String(transactionIndex),
    finality, checkpointNumber: checkpoint.number, checkpointHash: checkpoint.hash };
}

function transfer(log: RecordValue, expected: Context) {
  const prefixed = expected.family === "bsc";
  const emitter = prefixed ? hex(log.address, 20, true, "event.address") : `41${hex(log.address, 20, false, "event.address")}`;
  check(emitter === expected.token, "event token differs from the expected token");
  const topics = array(log.topics, "event.topics", 4).map(value => hex(value, 32, prefixed, "event topic"));
  check(topics.length === 3 && topics[0] === `${prefixed ? "0x" : ""}${TRANSFER_TOPIC}`, "event is not the supported fungible Transfer layout");
  const decodeAddress = (topic: string) => {
    const body = prefixed ? topic.slice(2) : topic;
    check(body.slice(0, 24) === "0".repeat(24), "event address has nonzero ABI padding");
    return `${prefixed ? "0x" : "41"}${body.slice(24)}`;
  };
  const sender = decodeAddress(topics[1]), recipient = decodeAddress(topics[2]);
  check(recipient === expected.recipient, "event recipient differs from the expected recipient");
  const value = hex(log.data, 32, prefixed, "event.data");
  const amountRaw = BigInt(prefixed ? value : `0x${value}`).toString();
  check(amountRaw === expected.amountRaw, "event amount differs from the expected raw units");
  return { sender, recipient, amountRaw };
}

function result(expected: Context, proof: ReturnType<typeof canonicalProof>, decoded: ReturnType<typeof transfer>): VerifiedFixtureTransfer {
  return Object.freeze({ kind: "verified-development-transfer-evidence", creditAuthority: false,
    assurance: "supplied-fixture-consistency-only", ...expected, ...decoded, ...proof,
    eventKey: `${expected.chainKey}:${expected.token}:${expected.transactionId}:${expected.eventIndex}` });
}

/** Accepts a complete supported eth_getTransactionReceipt result, never an indexer event. */
export function verifyBscFixtureTransfer(fixture: unknown, receiptValue: unknown, proofValue: unknown): VerifiedFixtureTransfer {
  const expected = context(fixture, "bsc"), proof = canonicalProof(proofValue, expected);
  const receipt = object(receiptValue, "BSC receipt", ["transactionHash", "transactionIndex", "blockHash", "blockNumber", "status", "logs"],
    ["from", "to", "contractAddress", "cumulativeGasUsed", "gasUsed", "effectiveGasPrice", "logsBloom", "type", "blobGasUsed", "blobGasPrice", "chainId"]);
  check(quantity(receipt.status, ONE, "receipt.status") === "1", "BSC execution failed");
  check(hash(receipt.transactionHash, "bsc", "receipt.transactionHash") === expected.transactionId &&
    hash(receipt.blockHash, "bsc", "receipt.blockHash") === proof.blockHash &&
    quantity(receipt.blockNumber, MAX_UINT64, "receipt.blockNumber") === proof.blockNumber &&
    quantity(receipt.transactionIndex, MAX_UINT64, "receipt.transactionIndex") === proof.transactionIndex, "BSC receipt identity conflicts with canonical block");
  for (const key of ["from", "to", "contractAddress"]) {
    if (own(receipt, key) && !(key !== "from" && receipt[key] === null)) address(receipt[key], "bsc", `receipt.${key}`);
  }
  for (const key of ["cumulativeGasUsed", "gasUsed", "effectiveGasPrice", "type", "blobGasUsed", "blobGasPrice"]) {
    if (own(receipt, key)) quantity(receipt[key], MAX_UINT256, `receipt.${key}`);
  }
  if (own(receipt, "logsBloom")) hex(receipt.logsBloom, 256, true, "receipt.logsBloom");
  if (own(receipt, "chainId")) check(quantity(receipt.chainId, MAX_UINT256, "receipt.chainId") === expected.chainKey.split(":")[1], "receipt chain ID conflicts");
  let selected: RecordValue | undefined, previousIndex: bigint | undefined;
  for (const value of array(receipt.logs, "receipt.logs")) {
    const log = object(value, "BSC log", ["address", "topics", "data", "removed", "logIndex", "transactionIndex", "transactionHash", "blockHash", "blockNumber"]);
    check(log.removed === false, "BSC log is removed or has no removal status");
    check(hash(log.transactionHash, "bsc", "log.transactionHash") === expected.transactionId &&
      hash(log.blockHash, "bsc", "log.blockHash") === proof.blockHash &&
      quantity(log.blockNumber, MAX_UINT64, "log.blockNumber") === proof.blockNumber &&
      quantity(log.transactionIndex, MAX_UINT64, "log.transactionIndex") === proof.transactionIndex, "BSC log identity conflicts with its receipt");
    const index = quantity(log.logIndex, MAX_UINT64, "log.logIndex"), numericIndex = BigInt(index);
    check(previousIndex === undefined || numericIndex === previousIndex + ONE, "BSC log indices duplicate, conflict, or omit a middle log");
    previousIndex = numericIndex;
    hex(log.address, 20, true, "log.address");
    array(log.topics, "log.topics", 4).forEach(topic => hex(topic, 32, true, "log topic"));
    data(log.data, true, "log.data");
    if (index === expected.eventIndex) selected = log;
  }
  check(selected, "expected block-wide BSC event index is absent");
  return result(expected, proof, transfer(selected, expected));
}

/** Native visible=false TransactionInfo; eventIndex is the original unfiltered log offset. */
export function verifyTronFixtureTransfer(fixture: unknown, receiptValue: unknown, proofValue: unknown): VerifiedFixtureTransfer {
  const expected = context(fixture, "tron"), proof = canonicalProof(proofValue, expected);
  const receipt = object(receiptValue, "TRON receipt", ["id", "blockNumber", "receipt", "log"],
    ["result", "fee", "blockTimeStamp", "contractResult", "contract_address", "resMessage", "internal_transactions",
      "orderId", "orderDetails", "exchange_received_amount", "exchange_inject_another_amount", "exchange_withdraw_another_amount",
      "exchange_id", "withdraw_amount", "unfreeze_amount", "assetIssueID", "withdraw_expire_amount", "cancel_unfreezeV2_amount"]);
  check(hash(receipt.id, "tron", "receipt.id") === expected.transactionId &&
    tronNumber(receipt.blockNumber, "receipt.blockNumber") === proof.blockNumber, "TRON receipt identity conflicts with canonical block");
  const execution = object(receipt.receipt, "TRON execution receipt", ["result"],
    ["energy_usage", "energy_fee", "origin_energy_usage", "energy_usage_total", "net_usage", "net_fee", "energy_penalty_total"]);
  check(execution.result === "SUCCESS" && (!Object.prototype.hasOwnProperty.call(receipt, "result") || receipt.result === "SUCCESS"), "TRON execution failed or result fields conflict");
  const logs = array(receipt.log, "receipt.log");
  let selected: RecordValue | undefined;
  logs.forEach((value, index) => {
    const log = object(value, "TRON log", ["address", "topics", "data"]);
    hex(log.address, 20, false, "log.address");
    array(log.topics, "log.topics", 4).forEach(topic => hex(topic, 32, false, "log topic"));
    data(log.data, false, "log.data");
    if (String(index) === expected.eventIndex) selected = log;
  });
  check(selected, "expected receipt-local TRON event index is absent");
  return result(expected, proof, transfer(selected, expected));
}

/** Parse before projection: JSON.parse alone silently discards duplicate object keys. */
export function parseChainFixtureJson(raw: unknown): unknown {
  check(typeof raw === "string" && raw.length <= MAX_JSON_CHARS, "JSON exceeds the fixture text limit");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail("JSON syntax is invalid"); }
  const stack: ({ kind: "object"; expectingKey: boolean; keys: Set<string> } | { kind: "array" })[] = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\],:]/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(raw)) !== null) {
    const token = match[0], current = stack[stack.length - 1];
    if (token === "{") stack.push({ kind: "object", expectingKey: true, keys: new Set() });
    else if (token === "[") stack.push({ kind: "array" });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && current?.kind === "object") current.expectingKey = true;
    else if (token.startsWith('"') && current?.kind === "object" && current.expectingKey) {
      const key = JSON.parse(token) as string;
      check(!current.keys.has(key), "JSON has duplicate object keys");
      current.keys.add(key);
      current.expectingKey = false;
    }
    check(stack.length <= 64, "JSON exceeds the fixture nesting limit");
  }
  return parsed;
}
