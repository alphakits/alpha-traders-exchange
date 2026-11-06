// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeBscNodeTransfer } from "./bsc-node-observer";
import { createDevelopmentNodeTransport, NodeObservationError, type NodeObservationErrorCode } from "./chain-observer-rpc";
import type { ObserverInput } from "./chain-observer-common";

type JsonObject = Record<string, unknown>;
type Read = { source: "execution" | "finality"; method: string; params: unknown[]; occurrence: number };
type Mutation = (result: unknown, read: Read) => unknown;
const NOW = 1_900_000_000_000;
const bytes = (byte: string, size: number) => `0x${byte.repeat(size)}`;
const TX = bytes("11", 32), OTHER_TX = bytes("55", 32), GENESIS = bytes("a0", 32);
const TOKEN = bytes("22", 20), RECIPIENT = bytes("44", 20);
const AMOUNT = "500000000000000000001";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const record = (value: unknown) => value as JsonObject;
const array = (value: unknown) => value as unknown[];
const word = (value: string) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const blockHash = (number: number) => number === 0 ? GENESIS : word(String(number));
const hexHeight = (number: number) => `0x${number.toString(16)}`;
const addressTopic = (byte: string) => `0x${"0".repeat(24)}${byte.repeat(20)}`;
const logs = (value: unknown) => array(record(value).logs).map(record);
const selected = (value: unknown) => logs(value)[1];

function nativeBlock(number: number): JsonObject {
  return { number: hexHeight(number), hash: blockHash(number), parentHash: number === 0 ? bytes("00", 32) : blockHash(number - 1),
    timestamp: hexHeight(number === 0 ? 0 : NOW / 1000 - 100 + number - 100),
    transactions: number === 100 ? [OTHER_TX, TX] : [] };
}

function nativeReceipt(amountRaw = AMOUNT): JsonObject {
  const identity = { transactionHash: TX, transactionIndex: "0x1", blockHash: blockHash(100), blockNumber: "0x64", removed: false };
  return { transactionHash: TX, transactionIndex: "0x1", blockHash: blockHash(100), blockNumber: "0x64", status: "0x1", chainId: "0x61",
    from: bytes("66", 20), to: bytes("77", 20), contractAddress: null, gasUsed: "0x5208",
    logs: [
      { ...identity, logIndex: "0x7", address: TOKEN, topics: [], data: "0x" },
      { ...identity, logIndex: "0x8", address: TOKEN, topics: [TOPIC, addressTopic("33"), addressTopic("44")], data: word(amountRaw) },
    ] };
}

function fixture(options: { mutate?: Mutation; checkpoint?: number; amountRaw?: string; clock?: () => number } = {}) {
  const reads: Read[] = [], counts = new Map<string, number>();
  const context = { mode: "development-fixture", chain: { family: "bsc", chainId: "97", genesisHash: GENESIS },
    token: TOKEN, recipient: RECIPIENT, transactionId: TX, amountRaw: options.amountRaw ?? AMOUNT, eventIndex: "8" };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { jsonrpc: string; id: string; method: string; params: unknown[] };
    const source = new URL(url).hostname.startsWith("execution.") ? "execution" : "finality";
    const key = JSON.stringify([source, request.method, request.params]);
    const occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    const read: Read = { source, method: request.method, params: request.params, occurrence };
    reads.push(read);
    let result: unknown;
    if (request.method === "eth_chainId") result = "0x61";
    else if (request.method === "eth_getTransactionReceipt") result = nativeReceipt(options.amountRaw);
    else if (request.method === "eth_getBlockByNumber") {
      result = nativeBlock(request.params[0] === "finalized" ? options.checkpoint ?? 102 : Number(BigInt(String(request.params[0]))));
    } else throw new Error(`Unexpected BSC operation: ${request.method}`);
    if (options.mutate) result = options.mutate(result, read);
    const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      { status: 200, headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  });
  const transport = createDevelopmentNodeTransport({ mode: "simulation-only", fetch, clock: options.clock ?? (() => NOW),
    sources: [
      { id: "execution", independenceGroup: "execution-operator", endpoint: "https://execution.bsc-fixture.invalid/rpc" },
      { id: "finality", independenceGroup: "finality-operator", endpoint: "https://finality.bsc-fixture.invalid/rpc" },
    ] });
  const input: ObserverInput = { mode: "simulation-only", transport, context, executionSourceId: "execution", finalitySourceId: "finality" };
  return { input, context, reads, fetch, run: () => observeBscNodeTransfer(input) };
}

const isBlock = (read: Read, number: number) => read.method === "eth_getBlockByNumber" && read.params[0] === hexHeight(number);
const isHead = (read: Read) => read.method === "eth_getBlockByNumber" && read.params[0] === "finalized";
const isReceipt = (read: Read) => read.method === "eth_getTransactionReceipt";
async function rejectsWith(run: () => Promise<unknown>, code?: NodeObservationErrorCode) {
  await expect(run()).rejects.toMatchObject({ name: "NodeObservationError", creditAuthority: false, ...(code ? { code } : {}) });
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("development BSC node observation", () => {
  it("binds an exact raw-unit transfer to both complete node views and immutable native transcripts", async () => {
    const f = fixture(), observation = await f.run();
    expect(observation).toMatchObject({ mode: "simulation-only", creditAuthority: false, assurance: "configured-node-consistency-only",
      executionSourceId: "execution", finalitySourceId: "finality", checkpointTimestampMs: NOW - 98_000 });
    expect(observation.transfer).toMatchObject({ creditAuthority: false, family: "bsc", amountRaw: AMOUNT, token: TOKEN,
      sender: bytes("33", 20), recipient: RECIPIENT, transactionId: TX, transactionIndex: "1", eventIndex: "8",
      blockNumber: "100", blockHash: blockHash(100), finality: "bsc-finalized", checkpointNumber: "102", checkpointHash: blockHash(102) });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.transfer)).toBe(true);
    expect(Object.isFrozen(observation.reads)).toBe(true);
    expect(observation.reads).toHaveLength(f.reads.length);
    for (const read of observation.reads) {
      expect(Object.isFrozen(read)).toBe(true);
      expect(read.responseSha256).toBe(createHash("sha256").update(read.responseBody).digest("hex"));
      expect(JSON.parse(read.responseBody).id).toBe(JSON.parse(read.requestBody).id);
      expect(["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber"]).toContain(read.operation);
    }
    const { observationSha256, ...body } = observation;
    expect(observationSha256).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    expect(f.reads.filter(isHead)).toHaveLength(2);
  });

  it("keeps maximum uint256 raw units exact", async () => {
    const maximum = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
    expect((await fixture({ amountRaw: maximum }).run()).transfer.amountRaw).toBe(maximum);
  });

  it("normalizes native hex case and object-key ordering without reordering transactions or logs", async () => {
    const reorder = (value: unknown): unknown => {
      if (typeof value === "string" && value.startsWith("0x")) return `0x${value.slice(2).toUpperCase()}`;
      if (Array.isArray(value)) return value.map(reorder);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)]));
      return value;
    };
    const f = fixture({ mutate: (value, read) => read.source === "finality" ? reorder(value) : value });
    expect((await f.run()).transfer.recipient).toBe(RECIPIENT);
  });

  it("captures caller expectations, source IDs, policy and runtime mode before asynchronous reads", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (read.source === "execution" && read.method === "eth_chainId") {
        f.context.recipient = bytes("88", 20);
        f.context.chain.chainId = "56";
        f.context.amountRaw = "1";
        f.input.finalitySourceId = "execution";
        f.input.policy = { maxAncestry: 0 };
        (f.input as { mode: string }).mode = "mainnet";
      }
      return value;
    } });
    expect((await f.run()).transfer).toMatchObject({ amountRaw: AMOUNT, recipient: RECIPIENT, chainKey: `bsc:97:${GENESIS}` });
  });

  it("refuses invalid transfer expectations before any node IO", async () => {
    const f = fixture();
    f.context.amountRaw = "0";
    await rejectsWith(f.run, "INVALID_INPUT");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("refuses production runtime before node IO", async () => {
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    await rejectsWith(f.run, "RUNTIME_REFUSED");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("refuses a signing flag enabled while a required read is pending", async () => {
    const f = fixture({ mutate: value => { vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1"); return value; } });
    await rejectsWith(f.run, "RUNTIME_REFUSED");
    expect(f.reads).toHaveLength(1);
  });

  it.each(["execution", "finality"] as const)("binds %s chain ID to the expected network", async source => {
    const f = fixture({ mutate: (value, read) => read.source === source && read.method === "eth_chainId" ? "0x38" : value });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it.each(["execution", "finality"] as const)("binds %s genesis hash even when chain ID agrees", async source => {
    const f = fixture({ mutate: (value, read) => {
      if (read.source === source && isBlock(read, 0)) record(value).hash = bytes("ee", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it.each(["execution", "finality"] as const)("holds when %s has no native transaction receipt", async source => {
    const f = fixture({ mutate: (value, read) => read.source === source && isReceipt(read) ? null : value });
    await rejectsWith(f.run, "INVALID_EVIDENCE");
  });

  it("does not substitute a provider receipt for a different transaction", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (isReceipt(read)) record(value).transactionHash = OTHER_TX;
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it.each([
    ["failed execution", (receipt: JsonObject) => { receipt.status = "0x0"; }],
    ["wrong token", (receipt: JsonObject) => { selected(receipt).address = bytes("88", 20); }],
    ["wrong recipient", (receipt: JsonObject) => { array(selected(receipt).topics)[2] = addressTopic("88"); }],
    ["wrong raw amount", (receipt: JsonObject) => { selected(receipt).data = word("1"); }],
    ["removed unrelated log", (receipt: JsonObject) => { logs(receipt)[0].removed = true; }],
    ["invalid unrelated log bytes", (receipt: JsonObject) => { logs(receipt)[0].data = "0x0"; }],
    ["wrong transaction offset", (receipt: JsonObject) => { receipt.transactionIndex = "0x0"; }],
    ["missing expected event", (receipt: JsonObject) => { receipt.logs = array(receipt.logs).slice(0, 1); }],
    ["reordered log indices", (receipt: JsonObject) => { array(receipt.logs).reverse(); }],
    ["unsupported receipt field", (receipt: JsonObject) => { receipt.confirmations = 100; }],
  ] as const)("rejects two agreeing receipts with %s", async (_label, change) => {
    const f = fixture({ mutate: (value, read) => { if (isReceipt(read)) change(record(value)); return value; } });
    await rejectsWith(f.run, "INVALID_EVIDENCE");
  });

  it.each([
    ["an omitted unrelated log", (receipt: JsonObject) => { receipt.logs = array(receipt.logs).slice(1); }],
    ["changed unrelated log bytes", (receipt: JsonObject) => { logs(receipt)[0].data = "0x01"; }],
    ["changed receipt sender", (receipt: JsonObject) => { receipt.from = bytes("88", 20); }],
    ["omitted optional receipt metadata", (receipt: JsonObject) => { delete receipt.gasUsed; }],
  ] as const)("compares complete validated receipt semantics and detects %s", async (_label, change) => {
    const f = fixture({ mutate: (value, read) => { if (read.source === "finality" && isReceipt(read)) change(record(value)); return value; } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("compares the entire ordered block transaction list, including unrelated transactions", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (read.source === "finality" && isBlock(read, 100)) array(record(value).transactions)[0] = bytes("88", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it.each([
    ["duplicate transaction hashes", (block: JsonObject) => { block.transactions = [TX, TX]; }],
    ["full transaction objects", (block: JsonObject) => { block.transactions = [{ hash: OTHER_TX }, { hash: TX }]; }],
    ["a nonminimal native height", (block: JsonObject) => { block.number = "0x064"; }],
    ["an inexact JSON numeric timestamp", (block: JsonObject) => { block.timestamp = NOW / 1000; }],
    ["a timestamp outside the exact millisecond range", (block: JsonObject) => { block.timestamp = "0xffffffffffffffff"; }],
  ] as const)("rejects containing block responses with %s", async (_label, change) => {
    const f = fixture({ mutate: (value, read) => { if (isBlock(read, 100)) change(record(value)); return value; } });
    await rejectsWith(f.run, "INVALID_RESPONSE");
  });

  it("rejects a response for a different exact requested height", async () => {
    const f = fixture({ mutate: (value, read) => { if (isBlock(read, 101)) record(value).number = "0x66"; return value; } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("requires the containing transaction in the agreed block, even if both nodes omit it", async () => {
    const f = fixture({ mutate: (value, read) => { if (isBlock(read, 100)) record(value).transactions = [OTHER_TX]; return value; } });
    await rejectsWith(f.run, "INVALID_EVIDENCE");
  });

  it("bounds native transaction count before using an oversized block", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (isBlock(read, 100)) record(value).transactions = Array.from({ length: 4097 }, (_, i) => word(String(i)));
      return value;
    } });
    await rejectsWith(f.run, "RESOURCE_LIMIT");
  });

  it("requires an explicit finalized response without falling back to safe or latest", async () => {
    const f = fixture({ mutate: (value, read) => isHead(read) ? null : value });
    await rejectsWith(f.run, "INVALID_RESPONSE");
    expect(f.reads.some(read => read.params.includes("safe") || read.params.includes("latest"))).toBe(false);
  });

  it("does not treat a block above finalized as final based on elapsed time or inclusion", async () => {
    await rejectsWith(fixture({ checkpoint: 99 }).run, "INVALID_EVIDENCE");
  });

  it("accepts the containing block itself as explicitly finalized without inventing a confirmation count", async () => {
    const f = fixture({ checkpoint: 100 });
    f.input.policy = { maxAncestry: 0 };
    expect((await f.run()).transfer.checkpointNumber).toBe("100");
    expect(f.reads.filter(read => isBlock(read, 101))).toHaveLength(0);
  });

  it.each([
    ["a stale head", -121_000],
    ["an excessively future head", 6_000],
  ] as const)("refuses %s even when supplied through finalized", async (_label, offset) => {
    const f = fixture({ mutate: (value, read) => {
      if (isHead(read)) record(value).timestamp = hexHeight((NOW + offset) / 1000);
      return value;
    } });
    await rejectsWith(f.run, "STALE_CHECKPOINT");
  });

  it.each([
    ["a disconnected parent", (block: JsonObject) => { block.parentHash = bytes("ee", 32); }],
    ["a backwards block timestamp", (block: JsonObject) => { block.timestamp = hexHeight(NOW / 1000 - 101); }],
    ["a repeated ancestor hash", (block: JsonObject) => { block.hash = blockHash(100); }],
  ] as const)("rejects an agreed ancestry with %s", async (_label, change) => {
    const f = fixture({ mutate: (value, read) => { if (isBlock(read, 101)) change(record(value)); return value; } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("allows equal second-resolution timestamps on consecutive BSC blocks", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (read.method === "eth_getBlockByNumber" && read.params[0] !== "0x0") record(value).timestamp = hexHeight(NOW / 1000 - 100);
      return value;
    } });
    expect((await f.run()).transfer.checkpointNumber).toBe("102");
  });

  it("corroborates every intermediate ancestor across both sources", async () => {
    const f = fixture({ checkpoint: 103, mutate: (value, read) => {
      if (read.source === "execution" && isBlock(read, 101)) record(value).hash = bytes("ee", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("requires the finalized tag's full block view to match the connected fixed-height checkpoint", async () => {
    const f = fixture({ mutate: (value, read) => { if (isHead(read)) record(value).transactions = [OTHER_TX]; return value; } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("corroborates all 64 allowed successors within the bounded transport session", async () => {
    const f = fixture({ checkpoint: 164 });
    expect((await f.run()).transfer.checkpointNumber).toBe("164");
    for (let number = 101; number <= 164; number++) {
      expect(new Set(f.reads.filter(read => isBlock(read, number)).map(read => read.source))).toEqual(new Set(["execution", "finality"]));
    }
    expect(f.reads.length).toBeLessThanOrEqual(160);
  });

  it("holds 65-successor transfers for bounded backfill before walking ancestors", async () => {
    const f = fixture({ checkpoint: 165 });
    await rejectsWith(f.run, "RESOURCE_LIMIT");
    expect(f.reads.some(read => isBlock(read, 101))).toBe(false);
  });

  it.each([
    ["execution", 100], ["finality", 100], ["execution", 102], ["finality", 102],
  ] as const)("rechecks the %s source's original fixed block at height %s", async (source, height) => {
    const f = fixture({ mutate: (value, read) => {
      if (read.source === source && isBlock(read, height) && read.occurrence === 2) record(value).hash = bytes("ee", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it.each(["execution", "finality"] as const)("rechecks every log in the %s receipt", async source => {
    const f = fixture({ mutate: (value, read) => {
      if (read.source === source && isReceipt(read) && read.occurrence === 2) logs(value)[0].data = "0x01";
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("detects finalized-height retraction while the original checkpoint remains canonical", async () => {
    const f = fixture({ mutate: (value, read) => isHead(read) && read.occurrence === 2 ? nativeBlock(101) : value });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("detects replacement of a same-height finalized checkpoint", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (isHead(read) && read.occurrence === 2) record(value).hash = bytes("ee", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("checks one captured advancing head through both sources while retaining the pinned proof", async () => {
    const f = fixture({ mutate: (value, read) => isHead(read) && read.occurrence > 1 ? nativeBlock(102 + read.occurrence) : value });
    const observation = await f.run();
    expect(observation.transfer).toMatchObject({ checkpointNumber: "102", checkpointHash: blockHash(102) });
    expect(observation.checkpointTimestampMs).toBe(NOW - 98_000);
    expect(f.reads.filter(isHead)).toHaveLength(2);
    for (const number of [103, 104]) {
      expect(new Set(f.reads.filter(read => isBlock(read, number)).map(read => read.source))).toEqual(new Set(["execution", "finality"]));
    }
    expect(f.reads.some(read => isBlock(read, 105))).toBe(false);
  });

  it("rejects a newer head with an agreed continuation disconnected from the pinned checkpoint", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (isHead(read) && read.occurrence === 2) return nativeBlock(104);
      if (isBlock(read, 103)) record(value).parentHash = bytes("ee", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("rejects source disagreement on an intermediate advancing-head block", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (isHead(read) && read.occurrence === 2) return nativeBlock(104);
      if (read.source === "execution" && isBlock(read, 103)) record(value).hash = bytes("ee", 32);
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("binds the captured advanced finalized response to the end of its fixed-height continuation", async () => {
    const f = fixture({ mutate: (value, read) => {
      if (isHead(read) && read.occurrence === 2) return { ...nativeBlock(104), hash: bytes("ee", 32) };
      return value;
    } });
    await rejectsWith(f.run, "SOURCE_CONFLICT");
  });

  it("applies the 64-successor budget to initial and advancing ancestry together", async () => {
    const f = fixture({ checkpoint: 132, mutate: (value, read) => isHead(read) && read.occurrence === 2 ? nativeBlock(165) : value });
    await rejectsWith(f.run, "RESOURCE_LIMIT");
    expect(f.reads.some(read => isBlock(read, 133))).toBe(false);
  });

  it("rechecks freshness of the original pinned checkpoint after following a fresh advanced head", async () => {
    let now = NOW;
    const f = fixture({ clock: () => now, mutate: (value, read) => {
      if (isHead(read) && read.occurrence === 2) { now += 5_000; return nativeBlock(110); }
      return value;
    } });
    f.input.policy = { maxCheckpointAgeMs: 100_000 };
    await rejectsWith(f.run, "STALE_CHECKPOINT");
    expect(f.reads.some(read => isBlock(read, 110))).toBe(true);
  });

  it("uses the public typed error contract for a shorter ancestry policy", async () => {
    const f = fixture();
    f.input.policy = { maxAncestry: 1 };
    await expect(f.run()).rejects.toBeInstanceOf(NodeObservationError);
    expect(f.reads.some(read => isBlock(read, 101))).toBe(false);
  });
});
