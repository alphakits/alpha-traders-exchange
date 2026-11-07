import "server-only";

import type { FixtureChain } from "./chain-evidence";
import type { DepositInboxAsset, DepositInboxAssignment } from "./deposit-inbox-admission";
import { captureInboxData, digestInboxValue, inboxCheck } from "./deposit-inbox-data";

/** Closed native response profile for the separate bounded range reader. */
export interface DepositRangeBlock {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly timestampMs: number;
  readonly transactions: readonly string[];
  readonly nativeSha256: string;
}
export interface DepositRangeLog {
  readonly eventIndex: string;
  readonly contract: string;
  readonly classification: "admitted-transfer" | "zero-value-transfer" | "other-recipient" | "other-asset" | "other-event";
  readonly assignmentId: string | null;
  readonly transfer: Readonly<{ sender: string; recipient: string; amountRaw: string }> | null;
}
export interface DepositRangeReceipt {
  readonly transactionId: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionIndex: string;
  readonly execution: "successful" | "failed";
  readonly logs: readonly DepositRangeLog[];
  readonly nativeSha256: string;
}

type Row = Record<string, unknown>;
const ONE = BigInt(1), MAX_UINT64 = (ONE << BigInt(64)) - ONE, MAX_UINT256 = (ONE << BigInt(256)) - ONE;
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const FAILURES = new Set(["REVERT", "BAD_JUMP_DESTINATION", "OUT_OF_MEMORY", "PRECOMPILED_CONTRACT", "STACK_TOO_SMALL",
  "STACK_TOO_LARGE", "ILLEGAL_OPERATION", "OUT_OF_ENERGY", "OUT_OF_TIME", "JVM_STACK_OVER_FLOW", "UNKNOWN",
  "TRANSFER_FAILED", "INVALID_CODE"]);

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Row {
  inboxCheck(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_RESPONSE", "Range native object is missing");
  const row = value as Row, allowed = new Set([...required, ...optional]);
  inboxCheck(Object.keys(row).every(key => allowed.has(key)) && required.every(key => Object.hasOwn(row, key)),
    "INVALID_RESPONSE", "Range native object is incomplete, truncated, or outside the supported response profile");
  return row;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  inboxCheck(Array.isArray(value), "INVALID_RESPONSE", "Range native array is missing");
  inboxCheck(value.length <= maximum, "RESOURCE_LIMIT", "Range native array exceeds its complete-response bound");
  return value;
}
function hex(value: unknown, bytes: number, prefixed: boolean): string {
  const prefix = prefixed ? "0x" : "";
  inboxCheck(typeof value === "string" && value.length === bytes * 2 + prefix.length && value.startsWith(prefix)
    && /^[0-9a-fA-F]+$/.test(value.slice(prefix.length)), "INVALID_RESPONSE", "Range native hexadecimal identity is invalid");
  return value.toLowerCase();
}
function bytes(value: unknown, prefixed: boolean): string {
  const prefix = prefixed ? "0x" : "";
  inboxCheck(typeof value === "string" && value.length <= 131_072 + prefix.length && value.startsWith(prefix)
    && /^(?:[0-9a-fA-F]{2})*$/.test(value.slice(prefix.length)), "INVALID_RESPONSE", "Range native byte data is invalid");
  return value.toLowerCase();
}
export function depositRangeQuantity(value: unknown, maximum = MAX_UINT64): string {
  inboxCheck(typeof value === "string" && value.length <= 66 && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value),
    "INVALID_RESPONSE", "Range native quantity is not canonical hexadecimal");
  const number = BigInt(value);
  inboxCheck(number <= maximum, "INVALID_RESPONSE", "Range native quantity exceeds its exact numeric bound");
  return number.toString();
}
function integer(value: unknown): number {
  inboxCheck(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
    "INVALID_RESPONSE", "Range native number must be an exact nonnegative integer");
  return value;
}
function normalized(value: unknown): unknown {
  if (typeof value === "string" && /^(?:0x)?[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalized(child)]));
  return value;
}
function captured(value: unknown): unknown {
  return captureInboxData(value, { maxBytes: 1_048_576, maxNodes: 25_000, maxStringBytes: 131_074 });
}

/** Every block includes its complete native ordered membership, including explicit empty BSC arrays. */
export function decodeDepositRangeBlock(value: unknown, chain: FixtureChain, expectedNumber?: string): DepositRangeBlock {
  const raw = captured(value), family = chain.family;
  let number: string, hash: string, parentHash: string, timestampMs: number, transactions: string[];
  if (family === "bsc") {
    const block = object(raw, ["number", "hash", "parentHash", "timestamp", "transactions"],
      ["nonce", "sha3Uncles", "logsBloom", "transactionsRoot", "stateRoot", "receiptsRoot", "miner", "difficulty",
        "totalDifficulty", "extraData", "size", "gasLimit", "gasUsed", "uncles", "baseFeePerGas", "mixHash",
        "blobGasUsed", "excessBlobGas", "parentBeaconBlockRoot", "requestsHash", "withdrawalsRoot"]);
    number = depositRangeQuantity(block.number); hash = hex(block.hash, 32, true); parentHash = hex(block.parentHash, 32, true);
    timestampMs = Number(depositRangeQuantity(block.timestamp, BigInt("8640000000000"))) * 1000;
    transactions = array(block.transactions, 4096).map(item => hex(item, 32, true));
    for (const key of ["sha3Uncles", "transactionsRoot", "stateRoot", "receiptsRoot", "mixHash", "parentBeaconBlockRoot", "requestsHash", "withdrawalsRoot"])
      if (Object.hasOwn(block, key)) hex(block[key], 32, true);
    for (const key of ["difficulty", "totalDifficulty", "size", "gasLimit", "gasUsed", "baseFeePerGas", "blobGasUsed", "excessBlobGas"])
      if (Object.hasOwn(block, key)) depositRangeQuantity(block[key], MAX_UINT256);
    if (Object.hasOwn(block, "nonce")) hex(block.nonce, 8, true);
    if (Object.hasOwn(block, "logsBloom")) hex(block.logsBloom, 256, true);
    if (Object.hasOwn(block, "miner")) hex(block.miner, 20, true);
    if (Object.hasOwn(block, "extraData")) bytes(block.extraData, true);
    if (Object.hasOwn(block, "uncles")) array(block.uncles, 16).forEach(item => hex(item, 32, true));
  } else {
    const block = object(raw, ["blockID", "block_header"], ["transactions"]);
    const header = object(block.block_header, ["raw_data"], ["witness_signature"]);
    const data = object(header.raw_data, [], ["number", "timestamp", "parentHash", "txTrieRoot", "witness_address", "version", "accountStateRoot"]);
    hash = hex(block.blockID, 32, false);
    const genesis = expectedNumber === "0" && hash.startsWith("0000000000000000");
    number = String(integer(genesis && !Object.hasOwn(data, "number") ? 0 : data.number));
    timestampMs = integer(genesis && !Object.hasOwn(data, "timestamp") ? 0 : data.timestamp);
    parentHash = genesis && (!Object.hasOwn(data, "parentHash") || data.parentHash === "") ? "0".repeat(64) : hex(data.parentHash, 32, false);
    inboxCheck(BigInt(`0x${hash.slice(0, 16)}`) === BigInt(number)
      && (number === "0" || BigInt(`0x${parentHash.slice(0, 16)}`) === BigInt(number) - ONE),
    "INVALID_RESPONSE", "Range TRON block IDs do not encode their exact native heights");
    for (const key of ["txTrieRoot", "accountStateRoot"]) if (Object.hasOwn(data, key)) hex(data[key], 32, false);
    if (Object.hasOwn(data, "witness_address")) inboxCheck(hex(data.witness_address, 21, false).startsWith("41"), "INVALID_RESPONSE", "TRON witness address is invalid");
    if (Object.hasOwn(data, "version")) integer(data.version);
    if (Object.hasOwn(header, "witness_signature")) hex(header.witness_signature, 65, false);
    transactions = array(Object.hasOwn(block, "transactions") ? block.transactions : [], 4096).map(item => {
      const transaction = object(item, ["txID"], ["raw_data", "raw_data_hex", "ret", "signature", "visible"]);
      return hex(transaction.txID, 32, false);
    });
  }
  inboxCheck(expectedNumber === undefined || number === expectedNumber, "SOURCE_CONFLICT", "Range source returned a different requested height");
  inboxCheck(number === "0" || timestampMs > 0, "INVALID_RESPONSE", "Range non-genesis block lacks a positive timestamp");
  inboxCheck(new Set(transactions).size === transactions.length, "INVALID_RESPONSE", "Range block repeats native transaction membership");
  inboxCheck(number !== "0" || (hash === chain.genesisHash && transactions.length === 0), "SOURCE_CONFLICT", "Range genesis identity or membership differs");
  return captureInboxData({ number, hash, parentHash, timestampMs, transactions,
    nativeSha256: digestInboxValue("range-native-block", normalized(raw)) });
}

function classify(log: Row, eventIndex: string, chain: FixtureChain, assets: readonly DepositInboxAsset[], assignments: readonly DepositInboxAssignment[]): DepositRangeLog {
  const bsc = chain.family === "bsc", contract = bsc ? hex(log.address, 20, true) : `41${hex(log.address, 20, false)}`;
  const topics = array(log.topics, 4).map(item => hex(item, 32, bsc));
  const data = bytes(log.data, bsc), prefix = bsc ? "0x" : "";
  const basis = { eventIndex, contract, assignmentId: null, transfer: null };
  const asset = assets.find(item => item.token === contract);
  if (!asset) return { ...basis, classification: "other-asset" };
  if (topics[0] !== `${prefix}${TRANSFER_TOPIC}`) return { ...basis, classification: "other-event" };
  inboxCheck(topics.length === 3 && data.length === 64 + prefix.length,
    "INVALID_EVIDENCE", "Admitted asset emitted an unsupported fungible Transfer layout");
  const address = (topic: string) => {
    const word = bsc ? topic.slice(2) : topic;
    inboxCheck(word.slice(0, 24) === "0".repeat(24), "INVALID_EVIDENCE", "Range Transfer address padding is nonzero");
    return `${bsc ? "0x" : "41"}${word.slice(24)}`;
  };
  const sender = address(topics[1]), recipient = address(topics[2]);
  const amountRaw = BigInt(bsc ? data : `0x${data}`).toString();
  const transfer = { sender, recipient, amountRaw }, assignment = assignments.find(item => item.recipient === recipient && item.assetRef === asset.assetRef);
  if (!assignment) return { ...basis, transfer, classification: "other-recipient" };
  return { eventIndex, contract, assignmentId: assignment.assignmentId, transfer,
    classification: amountRaw === "0" ? "zero-value-transfer" : "admitted-transfer" };
}

/** Explicit unsupported/missing execution status refuses a certificate, including non-contract TRON shapes. */
export function decodeDepositRangeReceipt(value: unknown, options: {
  chain: FixtureChain; block: DepositRangeBlock; transactionId: string; transactionIndex: number;
  assets: readonly DepositInboxAsset[]; assignments: readonly DepositInboxAssignment[];
}): DepositRangeReceipt {
  const raw = captured(value), { chain, block, transactionId, transactionIndex, assets, assignments } = options;
  let successful: boolean, nativeLogs: readonly unknown[];
  if (chain.family === "bsc") {
    const receipt = object(raw, ["transactionHash", "transactionIndex", "blockHash", "blockNumber", "status", "logs"],
      ["from", "to", "contractAddress", "cumulativeGasUsed", "gasUsed", "effectiveGasPrice", "logsBloom", "type", "blobGasUsed", "blobGasPrice", "chainId"]);
    inboxCheck(hex(receipt.transactionHash, 32, true) === transactionId && hex(receipt.blockHash, 32, true) === block.hash
      && depositRangeQuantity(receipt.blockNumber) === block.number && depositRangeQuantity(receipt.transactionIndex) === String(transactionIndex),
    "SOURCE_CONFLICT", "Range receipt does not bind the complete ordered block membership");
    successful = depositRangeQuantity(receipt.status, ONE) === "1";
    for (const key of ["from", "to", "contractAddress"]) if (Object.hasOwn(receipt, key) && !(key !== "from" && receipt[key] === null)) hex(receipt[key], 20, true);
    for (const key of ["cumulativeGasUsed", "gasUsed", "effectiveGasPrice", "type", "blobGasUsed", "blobGasPrice"])
      if (Object.hasOwn(receipt, key)) depositRangeQuantity(receipt[key], MAX_UINT256);
    if (Object.hasOwn(receipt, "logsBloom")) hex(receipt.logsBloom, 256, true);
    if (Object.hasOwn(receipt, "chainId")) inboxCheck(depositRangeQuantity(receipt.chainId) === chain.chainId, "SOURCE_CONFLICT", "Range receipt chain identity differs");
    nativeLogs = array(receipt.logs, 256);
  } else {
    const receipt = object(raw, ["id", "blockNumber", "receipt", "log"], ["result", "fee", "blockTimeStamp", "contractResult", "contract_address",
      "resMessage", "internal_transactions", "orderId", "orderDetails", "exchange_received_amount", "exchange_inject_another_amount",
      "exchange_withdraw_another_amount", "exchange_id", "withdraw_amount", "unfreeze_amount", "assetIssueID", "withdraw_expire_amount", "cancel_unfreezeV2_amount"]);
    inboxCheck(hex(receipt.id, 32, false) === transactionId && String(integer(receipt.blockNumber)) === block.number,
      "SOURCE_CONFLICT", "Range TRON receipt belongs to another transaction or block");
    const execution = object(receipt.receipt, ["result"], ["energy_usage", "energy_fee", "origin_energy_usage", "energy_usage_total", "net_usage", "net_fee", "energy_penalty_total"]);
    inboxCheck(execution.result === "SUCCESS" || typeof execution.result === "string" && FAILURES.has(execution.result),
      "INVALID_EVIDENCE", "Range TRON receipt lacks a supported explicit execution result");
    successful = execution.result === "SUCCESS";
    inboxCheck(!Object.hasOwn(receipt, "result") || (successful ? receipt.result === "SUCCESS" : receipt.result === "FAILED" || receipt.result === execution.result),
      "INVALID_EVIDENCE", "Range TRON execution results disagree");
    for (const key of Object.keys(execution)) if (key !== "result") integer(execution[key]);
    if (Object.hasOwn(receipt, "blockTimeStamp")) inboxCheck(integer(receipt.blockTimeStamp) === block.timestampMs, "SOURCE_CONFLICT", "Range TRON receipt timestamp differs");
    if (Object.hasOwn(receipt, "fee")) integer(receipt.fee);
    nativeLogs = array(receipt.log, 256);
  }
  inboxCheck(successful || nativeLogs.length === 0, "INVALID_EVIDENCE", "A failed transaction cannot contribute deposit log evidence");
  let previousIndex: bigint | undefined;
  const logs = nativeLogs.map((value, offset) => {
    let eventIndex = String(offset), log: Row;
    if (chain.family === "bsc") {
      log = object(value, ["address", "topics", "data", "removed", "logIndex", "transactionIndex", "transactionHash", "blockHash", "blockNumber"]);
      inboxCheck(log.removed === false && hex(log.transactionHash, 32, true) === transactionId && hex(log.blockHash, 32, true) === block.hash
        && depositRangeQuantity(log.blockNumber) === block.number && depositRangeQuantity(log.transactionIndex) === String(transactionIndex),
      "SOURCE_CONFLICT", "Range BSC log is removed or does not bind its transaction and block");
      eventIndex = depositRangeQuantity(log.logIndex);
      inboxCheck(previousIndex === undefined || BigInt(eventIndex) === previousIndex + ONE, "INVALID_EVIDENCE", "Range BSC receipt has omitted or reordered logs");
      previousIndex = BigInt(eventIndex);
    } else log = object(value, ["address", "topics", "data"]);
    return classify(log, eventIndex, chain, assets, assignments);
  });
  return captureInboxData({ transactionId, blockNumber: block.number, blockHash: block.hash, transactionIndex: String(transactionIndex),
    execution: successful ? "successful" : "failed", logs, nativeSha256: digestInboxValue("range-native-receipt", normalized(raw)) });
}
