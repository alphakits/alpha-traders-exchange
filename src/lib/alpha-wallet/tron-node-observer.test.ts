// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDevelopmentNodeTransport, NodeObservationError, type NodeObservationErrorCode } from "./chain-observer-rpc";
import type { ObserverInput } from "./chain-observer-common";
import { observeTronNodeTransfer } from "./tron-node-observer";

type Row = Record<string, unknown>;
type NativeFixtureBlock = { blockID: string; block_header: { raw_data: Row; witness_signature: string }; transactions?: Row[] };
type NativeFixtureReceipt = { id: string; blockNumber: unknown; blockTimeStamp: unknown; receipt: Row; fee: number;
  log: Array<{ address: string; topics: string[]; data: string }> };
type Read = { source: "execution" | "finality"; path: string; body: Row; occurrence: number; method: string | undefined };
const NOW = 1_800_000_000_000, CONTAINING = 20, CHECKPOINT = 23;
const TX = "11".repeat(32), OTHER_TX = "55".repeat(32), TOKEN = `41${"22".repeat(20)}`, RECIPIENT = `41${"44".repeat(20)}`;
const TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const blockId = (height: number, tail = "aa") => `${BigInt(height).toString(16).padStart(16, "0")}${tail.repeat(24)}`;
const word = (value: string) => BigInt(value).toString(16).padStart(64, "0");
const row = (value: unknown) => value as Row;

function nativeBlock(height: number): NativeFixtureBlock {
  return { blockID: blockId(height), block_header: { raw_data: { number: height,
    timestamp: height === 0 ? 0 : NOW - 10_000 + (height - CONTAINING) * 100,
    parentHash: height === 0 ? "0".repeat(64) : blockId(height - 1),
    txTrieRoot: "77".repeat(32), witness_address: `41${"88".repeat(20)}`, version: 32 }, witness_signature: "99".repeat(65) },
  transactions: height === CONTAINING ? [{ txID: OTHER_TX, raw_data: { timestamp: NOW - 10_000 } },
    { txID: TX, raw_data: { timestamp: NOW - 10_000 }, ret: [{ contractRet: "SUCCESS" }] }] : [] };
}
function nativeReceipt(): NativeFixtureReceipt {
  return { id: TX, blockNumber: CONTAINING, blockTimeStamp: nativeBlock(CONTAINING).block_header.raw_data.timestamp,
    receipt: { result: "SUCCESS", energy_usage_total: 1000 }, fee: 100,
    log: [{ address: TOKEN.slice(2), topics: [], data: "" },
      { address: TOKEN.slice(2), topics: [TOPIC, `${"0".repeat(24)}${"33".repeat(20)}`, `${"0".repeat(24)}${RECIPIENT.slice(2)}`],
        data: word("500000001") }] };
}

function fixture(head = CHECKPOINT) {
  const executionBlocks = new Map<number, NativeFixtureBlock>([[0, nativeBlock(0)], [CONTAINING, nativeBlock(CONTAINING)]]);
  const finalityBlocks = new Map<number, NativeFixtureBlock>([[0, nativeBlock(0)]]);
  for (let height = CONTAINING; height <= head; height++) finalityBlocks.set(height, nativeBlock(height));
  const state = { executionBlocks, finalityBlocks, executionReceipt: nativeReceipt(), finalityReceipt: nativeReceipt(),
    heads: [nativeBlock(head), nativeBlock(head)], now: NOW, calls: [] as Read[],
    onRead: undefined as ((read: Read, data: Row) => unknown) | undefined };
  const occurrences = new Map<string, number>();
  let headReads = 0;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url), source = parsed.hostname.startsWith("execution.") ? "execution" : "finality";
    const body = JSON.parse(String(init.body)) as Row, path = parsed.pathname;
    const key = JSON.stringify([source, path, body]), occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const read: Read = { source, path, body, occurrence, method: init.method }; state.calls.push(read);
    let value: unknown;
    if (path.endsWith("/getblockbynum")) value = (source === "execution" ? state.executionBlocks : state.finalityBlocks).get(Number(body.num)) ?? {};
    else if (path.endsWith("/gettransactioninfobyid")) value = source === "execution" ? state.executionReceipt : state.finalityReceipt;
    else if (path === "/walletsolidity/getnowblock") value = state.heads[Math.min(headReads++, state.heads.length - 1)];
    else throw new Error("Unexpected endpoint");
    const data = structuredClone(value) as Row, replacement = state.onRead?.(read, data);
    const response = new Response(JSON.stringify(replacement === undefined ? data : replacement), { status: 200,
      headers: { "content-type": "application/json; charset=utf-8" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  });
  const transport = createDevelopmentNodeTransport({ mode: "simulation-only", fetch: fetcher, clock: () => state.now,
    sources: [{ id: "execution", independenceGroup: "operator-a", endpoint: "https://execution.example.invalid" },
      { id: "finality", independenceGroup: "operator-b", endpoint: "https://finality.example.invalid" }] });
  const context = { mode: "development-fixture", chain: { family: "tron", network: "nile", genesisHash: blockId(0) },
    token: TOKEN, recipient: RECIPIENT, transactionId: TX, amountRaw: "500000001", eventIndex: "1" };
  const input: ObserverInput = { mode: "simulation-only", transport, context, executionSourceId: "execution", finalitySourceId: "finality" };
  return { ...state, state, fetcher, context, input, observe: () => observeTronNodeTransfer(input) };
}
type Fixture = ReturnType<typeof fixture>;
function advancing(f: Fixture, height: number) {
  for (let next = CHECKPOINT + 1; next <= height; next++) f.finalityBlocks.set(next, nativeBlock(next));
  f.state.heads[1] = nativeBlock(height);
}
async function rejected(f: Fixture, code?: NodeObservationErrorCode) {
  let error: unknown;
  try { await f.observe(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(NodeObservationError);
  expect(error).toMatchObject({ creditAuthority: false, ...(code ? { code } : {}) });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", () => { throw new Error("Ambient network IO is forbidden"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("development TRON native observation", () => {
  it("pins native receipt membership and complete ancestry without credit authority or ambient IO", async () => {
    const f = fixture(), result = await f.observe();
    expect(result).toMatchObject({ kind: "development-chain-observation", mode: "simulation-only", creditAuthority: false,
      assurance: "configured-node-consistency-only", executionSourceId: "execution", finalitySourceId: "finality",
      startedAtMs: NOW, completedAtMs: NOW, transfer: { family: "tron", creditAuthority: false, amountRaw: "500000001",
        transactionId: TX, transactionIndex: "1", eventIndex: "1", token: TOKEN, recipient: RECIPIENT,
        sender: `41${"33".repeat(20)}`, blockNumber: "20", checkpointNumber: "23", finality: "tron-solidified" } });
    expect(result.reads).toHaveLength(16);
    expect(f.calls.every(call => call.method === "POST" && call.body.visible === false)).toBe(true);
    expect(f.calls.filter(call => call.path === "/walletsolidity/getnowblock")).toHaveLength(2);
    expect(f.calls.filter(call => call.source === "execution").every(call => call.path.startsWith("/wallet/"))).toBe(true);
    expect(f.calls.filter(call => call.source === "finality").every(call => call.path.startsWith("/walletsolidity/"))).toBe(true);
    expect(result.reads.every(read => read.protocol === "tron-http"
      && read.responseSha256 === createHash("sha256").update(read.responseBody).digest("hex"))).toBe(true);
    const { observationSha256, ...body } = result;
    expect(observationSha256).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    expect(Object.isFrozen(result) && Object.isFrozen(result.transfer) && Object.isFrozen(result.reads) && Object.isFrozen(result.reads[0])).toBe(true);
  });
  it("normalizes native hex letter case without changing receipt-local event identity", async () => {
    const f = fixture();
    f.state.onRead = (_read, data) => JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === "string" && ["blockID", "parentHash", "txTrieRoot", "witness_address", "witness_signature", "txID", "id", "address", "data"].includes(key)
        ? value.toUpperCase() : value));
    expect((await f.observe()).transfer.eventIndex).toBe("1");
  });
  it("accepts native proto3 genesis zero omissions and omitted empty transaction arrays", async () => {
    const f = fixture(), raw = f.executionBlocks.get(0)!.block_header.raw_data;
    delete raw.number; delete raw.timestamp; delete raw.parentHash;
    delete f.executionBlocks.get(0)!.transactions;
    for (const height of [0, 21, 22, 23]) delete f.finalityBlocks.get(height)!.transactions;
    expect((await f.observe()).transfer.blockNumber).toBe("20");
  });
  it("allows the containing block itself to be the checkpoint without fabricated successors", async () => {
    const f = fixture(CONTAINING); f.input.policy = { maxAncestry: 0 };
    const result = await f.observe();
    expect(result.transfer.checkpointNumber).toBe(String(CONTAINING));
    expect(result.reads).toHaveLength(13);
  });
  it("accepts the complete supported 64-block ancestry without skipping an intermediate height", async () => {
    const f = fixture(CONTAINING + 64), result = await f.observe();
    expect(result.transfer.checkpointNumber).toBe(String(CONTAINING + 64));
    expect(result.reads).toHaveLength(77);
    expect(f.calls.filter(call => call.path === "/walletsolidity/getblockbynum" && Number(call.body.num) > CONTAINING)
      .slice(0, 64).map(call => call.body.num)).toEqual(Array.from({ length: 64 }, (_, index) => CONTAINING + index + 1));
  });
  it("retains maximum uint256 transfer units without floating point conversion", async () => {
    const f = fixture(), amount = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
    f.context.amountRaw = amount;
    f.executionReceipt.log[1].data = word(amount); f.finalityReceipt.log[1].data = word(amount);
    expect((await f.observe()).transfer.amountRaw).toBe(amount);
  });
  it("preserves identical logs at separate offsets rather than deduplicating them", async () => {
    const f = fixture();
    f.executionReceipt.log.push(structuredClone(f.executionReceipt.log[1])); f.finalityReceipt.log.push(structuredClone(f.finalityReceipt.log[1]));
    const first = await f.observe(); f.context.eventIndex = "2";
    const second = await f.observe();
    expect(first.transfer.eventKey).not.toBe(second.transfer.eventKey);
    expect(second.transfer.eventIndex).toBe("2");
    expect(second.transfer.amountRaw).toBe(first.transfer.amountRaw);
  });
  it("compares execution evidence while permitting differing resource-accounting metadata", async () => {
    const f = fixture(); f.finalityReceipt.fee = 101; f.finalityReceipt.receipt.net_usage = 99;
    expect((await f.observe()).creditAuthority).toBe(false);
  });
  it("captures context, source IDs and policy before the first injected read", async () => {
    const f = fixture(), policy = { maxAncestry: 3 }; f.input.policy = policy;
    f.state.onRead = () => { f.context.amountRaw = "1"; f.context.chain.genesisHash = blockId(0, "cc");
      f.input.finalitySourceId = "execution"; policy.maxAncestry = 0; };
    expect((await f.observe()).transfer.amountRaw).toBe("500000001");
  });
});

describe("TRON admission before IO", () => {
  it.each([
    ["NODE_ENV", "production"], ["VERCEL", "1"], ["ALPHA_WALLET_MAINNET_ENABLED", "true"], ["ALPHA_WALLET_SIGNING_ENABLED", "true"],
  ])("refuses %s=%s before any source read", async (name, value) => {
    const f = fixture(); vi.stubEnv(name, value); await rejected(f, "RUNTIME_REFUSED"); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("requires explicit simulation-only mode before consuming invalid source or context data", async () => {
    const f = fixture(); f.input.mode = "live" as never; f.input.context = null;
    await rejected(f, "RUNTIME_REFUSED"); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["missing units", (f: Fixture) => { delete row(f.context).amountRaw; }],
    ["wrong family", (f: Fixture) => { f.context.chain.family = "bsc"; }],
    ["nonzero genesis prefix", (f: Fixture) => { f.context.chain.genesisHash = blockId(1); }],
    ["visible base58 token", (f: Fixture) => { f.context.token = "TIndexerAddress"; }],
    ["floating units", (f: Fixture) => { row(f.context).amountRaw = 500000001; }],
    ["noncanonical event offset", (f: Fixture) => { f.context.eventIndex = "01"; }],
    ["caller metadata", (f: Fixture) => { row(f.context).confirmed = true; }],
    ["receipt-selected source identity", (f: Fixture) => { f.input.finalitySourceId = f.input.executionSourceId; }],
  ] as const)("rejects %s before IO", async (_name, mutate) => {
    const f = fixture(); mutate(f); await rejected(f, "INVALID_INPUT"); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ maxAncestry: 65 }, { maxAncestry: -1 }, { maxCheckpointAgeMs: 0 }, { maxFutureSkewMs: 30_001 }, { confirmations: 100 }])(
    "refuses invalid policy %# before IO", async policy => {
      const f = fixture(); f.input.policy = policy; await rejected(f, "INVALID_INPUT"); expect(f.fetcher).not.toHaveBeenCalled();
    });
});

describe("TRON complete native receipt rejection", () => {
  const invalid: Array<[string, (f: Fixture) => void]> = [
    ["different transaction", f => { f.executionReceipt.id = OTHER_TX; }],
    ["missing successful execution", f => { delete f.executionReceipt.receipt.result; }],
    ["failed execution", f => { f.executionReceipt.receipt.result = "OUT_OF_ENERGY"; }],
    ["conflicting top-level result", f => { row(f.executionReceipt).result = "FAILED"; }],
    ["decimal-string native height", f => { f.executionReceipt.blockNumber = "20"; }],
    ["unsafe int64 native height", f => { f.executionReceipt.blockNumber = Number.MAX_SAFE_INTEGER + 1; }],
    ["fractional native height", f => { f.executionReceipt.blockNumber = 20.5; }],
    ["negative native height", f => { f.executionReceipt.blockNumber = -1; }],
    ["unsafe unselected resource integer", f => { f.executionReceipt.receipt.energy_fee = Number.MAX_SAFE_INTEGER + 1; }],
    ["unsafe nested native integer", f => { row(f.executionReceipt).internal_transactions = [{ callValueInfo: [{ callValue: Number.MAX_SAFE_INTEGER + 1 }] }]; }],
    ["wrong timestamp", f => { f.executionReceipt.blockTimeStamp = NOW; }],
    ["projected indexer receipt", f => { delete row(f.executionReceipt).receipt; row(f.executionReceipt).confirmed = true; }],
    ["missing full log array", f => { delete row(f.executionReceipt).log; }],
    ["extra selected log fields", f => { row(f.executionReceipt.log[1]).logIndex = 1; }],
    ["malformed unselected log", f => { f.executionReceipt.log[0].topics = ["bad"]; }],
    ["wrong token", f => { f.executionReceipt.log[1].address = "99".repeat(20); }],
    ["wrong recipient", f => { f.executionReceipt.log[1].topics[2] = "0".repeat(64); }],
    ["wrong amount", f => { f.executionReceipt.log[1].data = word("500000000"); }],
    ["filtered receipt offset", f => { f.executionReceipt.log.shift(); }],
    ["missing selected offset", f => { f.context.eventIndex = "2"; }],
  ];
  it.each(invalid)("refuses %s without manufacturing transfer evidence", async (_name, mutate) => {
    const f = fixture(); mutate(f); await rejected(f, "INVALID_EVIDENCE");
  });
  it("requires the solidified receipt to decode successfully too", async () => {
    const f = fixture(); delete f.finalityReceipt.receipt.result; await rejected(f, "INVALID_EVIDENCE");
  });
  it("rejects a difference in an unselected receipt log", async () => {
    const f = fixture(); f.finalityReceipt.log[0].data = "abcd"; await rejected(f, "SOURCE_CONFLICT");
  });
  it("rejects differing full receipt lengths even when the selected transfer is identical", async () => {
    const f = fixture(); f.finalityReceipt.log.push(structuredClone(f.finalityReceipt.log[1])); await rejected(f, "SOURCE_CONFLICT");
  });
  it("does not accept a provider missing-transaction object", async () => {
    const f = fixture(); f.state.onRead = read => read.path.endsWith("/gettransactioninfobyid") ? {} : undefined;
    await rejected(f, "INVALID_EVIDENCE");
  });
});

describe("TRON block identities and solidified ancestry", () => {
  it("requires both sources to match the configured native genesis", async () => {
    const f = fixture(); f.finalityBlocks.get(0)!.blockID = blockId(0, "bb"); await rejected(f, "SOURCE_CONFLICT");
  });
  it.each([
    ["height prefix", (block: NativeFixtureBlock) => { block.blockID = blockId(21); }],
    ["parent height prefix", (block: NativeFixtureBlock) => { block.block_header.raw_data.parentHash = blockId(18); }],
    ["decimal-string height", (block: NativeFixtureBlock) => { block.block_header.raw_data.number = "20"; }],
    ["omitted nonzero height", (block: NativeFixtureBlock) => { delete block.block_header.raw_data.number; }],
    ["omitted timestamp", (block: NativeFixtureBlock) => { delete block.block_header.raw_data.timestamp; }],
    ["unsafe timestamp", (block: NativeFixtureBlock) => { block.block_header.raw_data.timestamp = Number.MAX_SAFE_INTEGER + 1; }],
    ["omitted nonzero parent", (block: NativeFixtureBlock) => { delete block.block_header.raw_data.parentHash; }],
    ["duplicate txID", (block: NativeFixtureBlock) => { block.transactions!.push(structuredClone(block.transactions![1])); }],
    ["projected txID array", (block: NativeFixtureBlock) => { block.transactions = [TX] as never; }],
    ["missing native header", (block: NativeFixtureBlock) => { delete row(block).block_header; }],
  ] as const)("refuses malformed containing-block %s", async (_name, mutate) => {
    const f = fixture(); mutate(f.executionBlocks.get(CONTAINING)!); await rejected(f, "INVALID_EVIDENCE");
  });
  it.each([
    ["hash", (block: NativeFixtureBlock) => { block.blockID = blockId(CONTAINING, "bb"); }],
    ["ordered transaction membership", (block: NativeFixtureBlock) => { block.transactions!.reverse(); }],
    ["full native header", (block: NativeFixtureBlock) => { block.block_header.raw_data.txTrieRoot = "66".repeat(32); }],
  ] as const)("rejects containing-block source disagreement in %s", async (_name, mutate) => {
    const f = fixture(); mutate(f.finalityBlocks.get(CONTAINING)!); await rejected(f, "SOURCE_CONFLICT");
  });
  it("refuses absent transaction membership even when both sources agree", async () => {
    const f = fixture(); f.executionBlocks.get(CONTAINING)!.transactions = []; f.finalityBlocks.get(CONTAINING)!.transactions = [];
    await rejected(f, "INVALID_EVIDENCE");
  });
  it.each(["stale", "future"] as const)("rejects a %s solidified checkpoint", async kind => {
    const f = fixture(); f.state.heads[0].block_header.raw_data.timestamp = kind === "stale" ? NOW - 120_001 : NOW + 5_001;
    await rejected(f, "STALE_CHECKPOINT");
  });
  it("holds when the solidified checkpoint is below the containing block", async () => {
    const f = fixture(); f.state.heads[0] = nativeBlock(CONTAINING - 1); await rejected(f, "SOURCE_CONFLICT");
  });
  it("bounds original ancestry before requesting successors", async () => {
    const f = fixture(); f.input.policy = { maxAncestry: 2 }; await rejected(f, "RESOURCE_LIMIT");
    expect(f.calls.some(call => call.body.num === CONTAINING + 1)).toBe(false);
  });
  it("refuses a missing intermediate native block", async () => {
    const f = fixture(); f.finalityBlocks.delete(22); await rejected(f, "INVALID_EVIDENCE");
  });
  it("refuses a fork between intermediate solidified blocks", async () => {
    const f = fixture(); f.finalityBlocks.get(22)!.block_header.raw_data.parentHash = blockId(21, "bb"); await rejected(f, "SOURCE_CONFLICT");
  });
  it("requires strictly increasing native timestamps along ancestry", async () => {
    const f = fixture(); f.finalityBlocks.get(22)!.block_header.raw_data.timestamp = f.finalityBlocks.get(21)!.block_header.raw_data.timestamp;
    await rejected(f, "SOURCE_CONFLICT");
  });
  it("compares the last fixed-height header to the captured checkpoint", async () => {
    const f = fixture(); f.state.heads[0].block_header.raw_data.version = 33; await rejected(f, "SOURCE_CONFLICT");
  });
});

describe("TRON final source-change and advancing-head checks", () => {
  it.each([
    ["execution containing", "execution", "/wallet/getblockbynum", CONTAINING],
    ["solidified containing", "finality", "/walletsolidity/getblockbynum", CONTAINING],
    ["pinned checkpoint", "finality", "/walletsolidity/getblockbynum", CHECKPOINT],
  ] as const)("rechecks the fixed %s header", async (_name, source, path, height) => {
    const f = fixture(); f.state.onRead = (read, data) => {
      if (read.source === source && read.path === path && read.body.num === height && read.occurrence === 2)
        row(row(data.block_header).raw_data).version = 33;
    };
    await rejected(f, "SOURCE_CONFLICT");
  });
  it.each(["execution", "finality"] as const)("rechecks complete %s receipt evidence", async source => {
    const f = fixture(); f.state.onRead = (read, data) => {
      if (read.source === source && read.path.endsWith("/gettransactioninfobyid") && read.occurrence === 2)
        row((data.log as unknown[])[0]).data = "abcd";
    };
    await rejected(f, "SOURCE_CONFLICT");
  });
  it("rejects a regressing solidified head", async () => {
    const f = fixture(); f.state.heads[1] = nativeBlock(CHECKPOINT - 1); await rejected(f, "SOURCE_CONFLICT");
  });
  it("rejects a different hash at the pinned checkpoint height", async () => {
    const f = fixture(); f.state.heads[1].blockID = blockId(CHECKPOINT, "bb"); await rejected(f, "SOURCE_CONFLICT");
  });
  it.each([1, 3])("proves a captured head advancing %s blocks while retaining the original proof", async distance => {
    const f = fixture(); advancing(f, CHECKPOINT + distance); f.state.heads.push(nativeBlock(CHECKPOINT + distance + 1));
    const result = await f.observe();
    expect(result.transfer.checkpointNumber).toBe(String(CHECKPOINT));
    expect(result.checkpointTimestampMs).toBe(nativeBlock(CHECKPOINT).block_header.raw_data.timestamp);
    expect(result.reads).toHaveLength(16 + distance);
    expect(f.calls.filter(call => call.path === "/walletsolidity/getnowblock")).toHaveLength(2);
  });
  it("rejects an advancing head with the wrong immediate parent", async () => {
    const f = fixture(); advancing(f, 24);
    f.state.heads[1].block_header.raw_data.parentHash = blockId(23, "bb");
    f.finalityBlocks.get(24)!.block_header.raw_data.parentHash = blockId(23, "bb");
    await rejected(f, "SOURCE_CONFLICT");
  });
  it("requires every intermediate block on a multi-block head advance", async () => {
    const f = fixture(); advancing(f, 26); f.finalityBlocks.delete(25); await rejected(f, "INVALID_EVIDENCE");
  });
  it("rejects an intermediate fork even when the captured advancing head is internally well formed", async () => {
    const f = fixture(); advancing(f, 26); f.finalityBlocks.get(25)!.block_header.raw_data.parentHash = blockId(24, "bb");
    await rejected(f, "SOURCE_CONFLICT");
  });
  it("rejects an equal timestamp in the continuation to an advancing head", async () => {
    const f = fixture(); advancing(f, 26);
    f.finalityBlocks.get(24)!.block_header.raw_data.timestamp = f.finalityBlocks.get(23)!.block_header.raw_data.timestamp;
    await rejected(f, "SOURCE_CONFLICT");
  });
  it("bounds total containing-to-fresh-head distance before reading the continuation", async () => {
    const f = fixture(); advancing(f, 25); f.input.policy = { maxAncestry: 4 }; await rejected(f, "RESOURCE_LIMIT");
    expect(f.calls.some(call => call.body.num === 24)).toBe(false);
  });
  it("requires the fixed-height continuation endpoint to equal the one captured fresh head", async () => {
    const f = fixture(); advancing(f, 26); f.finalityBlocks.get(26)!.block_header.raw_data.version = 33;
    await rejected(f, "SOURCE_CONFLICT");
  });
  it("does not use a fresher advancing head to conceal expiry of the pinned proof", async () => {
    const f = fixture(); advancing(f, 24); f.input.policy = { maxCheckpointAgeMs: 1000 };
    for (const [height, block] of f.finalityBlocks) if (height >= CONTAINING)
      block.block_header.raw_data.timestamp = NOW - 800 + (height - CONTAINING) * 100;
    f.executionBlocks.get(CONTAINING)!.block_header.raw_data.timestamp = NOW - 800;
    f.executionReceipt.blockTimeStamp = NOW - 800; f.finalityReceipt.blockTimeStamp = NOW - 800;
    f.state.heads[0] = structuredClone(f.finalityBlocks.get(CHECKPOINT)!);
    f.finalityBlocks.get(24)!.block_header.raw_data.timestamp = NOW + 500;
    f.state.heads[1] = structuredClone(f.finalityBlocks.get(24)!);
    f.state.onRead = read => { if (read.path === "/walletsolidity/getnowblock" && read.occurrence === 2) f.state.now = NOW + 501; };
    await rejected(f, "STALE_CHECKPOINT");
  });
});
