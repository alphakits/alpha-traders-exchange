// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositObservationAdmissionFixture } from "../../../scripts/alpha-wallet/deposit-observation-fixtures";
import { observationDigest } from "./chain-observer-rpc";
import { digestInboxValue } from "./deposit-inbox-data";
import { compareDevelopmentRangeCoverage, createAdmittedDevelopmentRangeReader, verifyDevelopmentRangeCoverage,
  type DevelopmentRangeCoverageV1, type DepositRangeRequest } from "./deposit-range-coverage";

type Family = "bsc" | "tron";
type Row = Record<string, unknown>;
type Read = { family: Family; source: "execution" | "finality"; operation: string; number?: number; transactionId?: string; isHead: boolean; occurrence: number };
const row = (value: unknown) => value as Row;
const copy = <T>(value: T): T => structuredClone(value);
const ONE = BigInt(1), NOW = 1_800_000_000_000;
const TRANSFER = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function fixture(family: Family = "bsc") {
  const admission = createDepositObservationAdmissionFixture(family), bsc = family === "bsc";
  const chain = admission.fixture.context.chain, token = admission.fixture.context.token, recipient = admission.fixture.context.recipient;
  const tx = (value: number) => `${bsc ? "0x" : ""}${value.toString(16).padStart(64, "0")}`;
  const blockHash = (height: number) => height === 0 ? chain.genesisHash : bsc
    ? `0x${(100_000 + height).toString(16).padStart(64, "0")}`
    : `${height.toString(16).padStart(16, "0")}${(100_000 + height).toString(16).padStart(48, "0")}`;
  const timestamp = (height: number) => height === 0 ? 0 : NOW - 5_000 - (103 - height) * 1000;
  const members = new Map<number, string[]>([[100, [tx(1), tx(2)]], [101, [tx(3)]], [103, [tx(4)]]]);
  let head = 103, now = NOW;
  const block = (height: number): Row => bsc ? { number: `0x${height.toString(16)}`, hash: blockHash(height),
    parentHash: height === 0 ? `0x${"0".repeat(64)}` : blockHash(height - 1), timestamp: `0x${(timestamp(height) / 1000).toString(16)}`,
    transactions: [...(members.get(height) ?? [])] }
    : { blockID: blockHash(height), block_header: { raw_data: { number: height, timestamp: timestamp(height),
      parentHash: height === 0 ? "0".repeat(64) : blockHash(height - 1), txTrieRoot: "77".repeat(32), version: 32 }, witness_signature: "88".repeat(65) },
    transactions: (members.get(height) ?? []).map(id => ({ txID: id, raw_data: { timestamp: NOW - 20_000 }, ret: [{ contractRet: id === tx(3) ? "REVERT" : "SUCCESS" }] })) };
  const otherToken = `${bsc ? "0x" : "41"}${"99".repeat(20)}`, otherRecipient = `${bsc ? "0x" : "41"}${"ab".repeat(20)}`;
  function rawLog(transactionId: string, blockNumber: number, transactionIndex: number, eventIndex: number,
    options: { token?: string; recipient?: string; amount?: string; otherEvent?: boolean } = {}): Row {
    const prefix = bsc ? "0x" : "", address = options.token ?? token;
    const event = { address: bsc ? address : address.slice(2),
      topics: options.otherEvent ? [] : [`${prefix}${TRANSFER}`, `${prefix}${"0".repeat(24)}${"33".repeat(20)}`,
        `${prefix}${"0".repeat(24)}${(options.recipient ?? recipient).slice(2)}`],
      data: options.otherEvent ? prefix : `${prefix}${BigInt(options.amount ?? "1000000").toString(16).padStart(64, "0")}` };
    return bsc ? { ...event, transactionHash: transactionId, transactionIndex: `0x${transactionIndex.toString(16)}`,
      blockHash: blockHash(blockNumber), blockNumber: `0x${blockNumber.toString(16)}`, logIndex: `0x${eventIndex.toString(16)}`, removed: false } : event;
  }
  function receipt(transactionId: string): Row {
    const entry = [...members].find(([, ids]) => ids.includes(transactionId));
    if (!entry) throw new Error("Unknown synthetic transaction");
    const [height, ids] = entry, transactionIndex = ids.indexOf(transactionId);
    const logs = transactionId === tx(1) ? [rawLog(transactionId, height, transactionIndex, 0, { token: otherToken })]
      : transactionId === tx(2) ? [
        rawLog(transactionId, height, transactionIndex, bsc ? 1 : 0),
        rawLog(transactionId, height, transactionIndex, bsc ? 2 : 1),
        rawLog(transactionId, height, transactionIndex, bsc ? 3 : 2, { amount: "0" }),
        rawLog(transactionId, height, transactionIndex, bsc ? 4 : 3, { recipient: otherRecipient }),
        rawLog(transactionId, height, transactionIndex, bsc ? 5 : 4, { otherEvent: true }),
      ] : [];
    return bsc ? { transactionHash: transactionId, transactionIndex: `0x${transactionIndex.toString(16)}`, blockHash: blockHash(height),
      blockNumber: `0x${height.toString(16)}`, chainId: "0x61", status: transactionId === tx(3) ? "0x0" : "0x1", logs,
      from: `0x${"55".repeat(20)}`, to: token, contractAddress: null, gasUsed: "0x5208" }
      : { id: transactionId, blockNumber: height, blockTimeStamp: timestamp(height), receipt: { result: transactionId === tx(3) ? "REVERT" : "SUCCESS" }, log: logs, fee: 100 };
  }
  const calls: Read[] = [], counts = new Map<string, number>();
  const f = { ...admission, family, token, recipient, otherToken, otherRecipient, members, blockHash, block, receipt, rawLog, tx, calls,
    mutate: undefined as undefined | ((value: unknown, read: Read) => unknown | Promise<unknown>),
    get head() { return head; }, setHead(value: number) { head = value; }, setNow(value: number) { now = value; },
    request: { fromBlock: "100", throughBlock: "102", previousBlockHash: blockHash(99) } as DepositRangeRequest,
    async fetch(url: string, init: RequestInit): Promise<Response> {
      const parsedUrl = new URL(url), body = JSON.parse(String(init.body));
      const source = parsedUrl.origin === new URL(admission.endpointConfig[0].endpoint).origin ? "execution" : "finality";
      let value: unknown, number: number | undefined, transactionId: string | undefined, isHead = false;
      const operation = bsc ? body.method as string : parsedUrl.pathname;
      if (bsc && operation === "eth_chainId") value = "0x61";
      else if (bsc && operation === "eth_getBlockByNumber" || !bsc && operation.endsWith("getblockbynum")) {
        isHead = bsc && body.params[0] === "finalized";
        number = isHead ? head : bsc ? Number(BigInt(body.params[0])) : body.num;
        value = block(number!);
      } else if (!bsc && operation === "/walletsolidity/getnowblock") { isHead = true; number = head; value = block(head); }
      else if (bsc && operation === "eth_getTransactionReceipt" || !bsc && operation.endsWith("gettransactioninfobyid")) {
        transactionId = bsc ? body.params[0] : body.value; value = receipt(transactionId!);
      } else throw new Error("Unexpected synthetic operation");
      const key = JSON.stringify([source, operation, isHead ? "head" : number, transactionId]);
      const occurrence = (counts.get(key) ?? 0) + 1; counts.set(key, occurrence);
      const read: Read = { family, source, operation, number, transactionId, isHead, occurrence }; calls.push(read);
      const changed = await f.mutate?.(value, read); if (changed !== undefined) value = changed;
      if (value instanceof Response) return value;
      const response = new Response(JSON.stringify(bsc ? { jsonrpc: "2.0", id: body.id, result: value } : value),
        { status: 200, headers: { "content-type": "application/json" } });
      Object.defineProperty(response, "url", { value: url }); return response;
    },
    create(overrides: Row = {}) { return createAdmittedDevelopmentRangeReader({ mode: "simulation-only", manifest: f.manifest, workerId: f.workerId,
      sourceSetId: f.sourceSetId, endpointConfig: f.endpointConfig, fetch: f.fetch, clock: () => now, ...overrides } as never); },
    verify(certificate: unknown, overrides: Row = {}) { return verifyDevelopmentRangeCoverage({ mode: "simulation-only", manifest: f.manifest,
      workerId: f.workerId, sourceSetId: f.sourceSetId, certificate, ...overrides } as never); },
  };
  return f;
}

const logsOf = (value: unknown, family: Family) => row(value)[family === "bsc" ? "logs" : "log"] as Row[];
const setNumber = (value: unknown, family: Family, number: number) => {
  if (family === "bsc") row(value).number = `0x${number.toString(16)}`;
  else row(row(row(value).block_header).raw_data).number = number;
};
const setParent = (value: unknown, family: Family, hash: string) => {
  if (family === "bsc") row(value).parentHash = hash;
  else row(row(row(value).block_header).raw_data).parentHash = hash;
};
function reseal(certificate: DevelopmentRangeCoverageV1) {
  const { coverageSha256: ignored, ...body } = certificate; void ignored;
  return { ...body, coverageSha256: digestInboxValue("deposit-range-coverage", body) };
}
async function refused(run: () => unknown | Promise<unknown>, code?: string) {
  let caught: unknown; try { await run(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ creditAuthority: false, ...(code ? { code } : {}) });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  vi.stubGlobal("fetch", () => { throw new Error("Ambient network is forbidden"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(["bsc", "tron"] as const)("complete bounded %s synthetic range", family => {
  it("covers empty blocks and every native receipt, classifies ignored logs and discovers each distinct transfer", async () => {
    const f = fixture(family), result = await f.create().read(f.request);
    expect(result).toMatchObject({ mode: "simulation-only", creditAuthority: false, cursorAuthority: false,
      assurance: "configured-synthetic-response-completeness-only", request: f.request });
    expect(result.coveredBlocks.map(block => [block.number, block.transactions.length])).toEqual([["100", 2], ["101", 1], ["102", 0]]);
    expect(result.bridgeBlocks.map(block => block.number)).toEqual(["103"]);
    expect(result.receipts.map(receipt => receipt.execution)).toEqual(["successful", "successful", "failed"]);
    expect(result.receipts[1].logs.map(log => log.classification)).toEqual(["admitted-transfer", "admitted-transfer", "zero-value-transfer", "other-recipient", "other-event"]);
    expect(result.receipts[0].logs[0].classification).toBe("other-asset");
    expect(result.candidates).toEqual([family === "bsc" ? "1" : "0", family === "bsc" ? "2" : "1"].map(eventIndex => ({ assignmentId: f.assignmentId,
      sourceSetId: f.sourceSetId, transactionId: f.tx(2), eventIndex, amountRaw: "1000000" })));
    for (const id of [f.tx(1), f.tx(2), f.tx(3)]) expect(f.calls.filter(call => call.transactionId === id)).toHaveLength(4);
    expect(f.calls.some(call => call.transactionId === f.tx(4))).toBe(false);
    expect(f.calls).toHaveLength(family === "bsc" ? 38 : 36);
    expect((await f.verify(copy(result))).certificate).toEqual(result);
    expect(Object.isFrozen(result) && Object.isFrozen(result.coveredBlocks) && Object.isFrozen(result.candidates[0])).toBe(true);
  });

  it("certifies a genuinely empty covered range without treating its bridge as deposit coverage", async () => {
    const f = fixture(family); f.members.set(100, []); f.members.set(101, []);
    const result = await f.create().read(f.request);
    expect(result.receipts).toEqual([]); expect(result.candidates).toEqual([]);
    expect(result.coveredBlocks.every(block => block.transactions.length === 0)).toBe(true);
    expect(result.bridgeBlocks[0].transactions).toEqual([f.tx(4)]);
    expect(f.calls.some(call => call.transactionId)).toBe(false);
    await f.verify(result);
  });

  it("automatically covers every admitted worker assignment on this chain", async () => {
    const f = fixture(family), extraId = `${family}-second-assignment`;
    f.manifest.assignments.push({ ...f.manifest.assignments[0], assignmentId: extraId, recipient: f.otherRecipient, beneficiaryRef: "second-seller" });
    f.manifest.workers[0].assignmentIds.push(extraId);
    const result = await f.create().read(f.request);
    expect(result.scope.assignments).toHaveLength(2);
    expect(result.candidates.at(-1)).toMatchObject({ assignmentId: extraId, transactionId: f.tx(2) });
    expect(result.candidates).toHaveLength(3);
    await f.verify(result);
  });

  it("keeps raw transfer units exact above JavaScript's numeric range", async () => {
    const f = fixture(family), amountRaw = (ONE << BigInt(200)).toString();
    f.mutate = (value, read) => {
      if (read.transactionId === f.tx(2)) logsOf(value, family)[0].data = `${family === "bsc" ? "0x" : ""}${BigInt(amountRaw).toString(16).padStart(64, "0")}`;
    };
    const result = await f.create().read(f.request); expect(result.candidates[0].amountRaw).toBe(amountRaw); await f.verify(result);
  });

  const mutations: Array<[string, (f: ReturnType<typeof fixture>, value: unknown, read: Read) => unknown]> = [
    ["missing native block", (_f, _value, read) => { if (read.number === 101) return null; }],
    ["wrong requested height", (_f, value, read) => { if (read.number === 101) setNumber(value, family, 102); }],
    ["unlinked block parent", (f, value, read) => { if (read.number === 101) setParent(value, family, f.blockHash(98)); }],
    ["omitted ordered transaction on one source", (_f, value, read) => { if (read.number === 100 && read.source === "finality") (row(value).transactions as unknown[]).pop(); }],
    ["null native receipt", (f, _value, read) => { if (read.transactionId === f.tx(1)) return null; }],
    ["receipt for another transaction", (f, value, read) => { if (read.transactionId === f.tx(2)) row(value)[family === "bsc" ? "transactionHash" : "id"] = f.tx(99); }],
    ["omitted final log on one source", (f, value, read) => { if (read.transactionId === f.tx(2) && read.source === "finality") logsOf(value, family).pop(); }],
    ["changed receipt on fixed reread", (f, value, read) => { if (read.transactionId === f.tx(2) && read.occurrence === 2) logsOf(value, family)[0].data = `${family === "bsc" ? "0x" : ""}${"0".repeat(63)}9`; }],
    ["native block pagination marker", (_f, value, read) => { if (read.number === 100) row(value).nextPage = "truncated"; }],
    ["native receipt truncation marker", (f, value, read) => { if (read.transactionId === f.tx(2)) row(value).hasMore = true; }],
    ["failed transaction with transfer logs", (f, value, read) => {
      if (read.transactionId !== f.tx(2)) return;
      if (family === "bsc") row(value).status = "0x0"; else row(row(value).receipt).result = "REVERT";
    }],
    ["admitted token with malformed Transfer ABI", (f, value, read) => { if (read.transactionId === f.tx(2)) (logsOf(value, family)[0].topics as unknown[]).pop(); }],
    ["admitted token with nonzero address padding", (f, value, read) => {
      if (read.transactionId === f.tx(2)) (logsOf(value, family)[0].topics as string[])[2] = `${family === "bsc" ? "0x" : ""}1${"0".repeat(23)}${f.recipient.slice(2)}`;
    }],
    ["missing explicit execution result", (f, value, read) => {
      if (read.transactionId !== f.tx(2)) return;
      if (family === "bsc") delete row(value).status; else delete row(row(value).receipt).result;
    }],
    ["missing complete receipt log array", (f, value, read) => { if (read.transactionId === f.tx(1)) delete row(value)[family === "bsc" ? "logs" : "log"]; }],
  ];
  it.each(mutations)("refuses %s without any partial coverage certificate", async (_label, mutate) => {
    const f = fixture(family); f.mutate = (value, read) => mutate(f, value, read);
    await refused(() => f.create().read(f.request));
  });

  it("refuses a range beyond the pinned finalized/solidified block", async () => {
    const f = fixture(family); f.setHead(101);
    await refused(() => f.create().read(f.request), "INVALID_EVIDENCE");
    expect(f.calls.some(call => call.transactionId)).toBe(false);
  });
  it("holds an advancing head instead of silently certifying a changing checkpoint", async () => {
    const f = fixture(family);
    f.mutate = (_value, read) => { if (read.isHead && read.occurrence === 2) return f.block(104); };
    await refused(() => f.create().read(f.request), "STALE_CHECKPOINT");
  });
  it("rejects a regressing finalized/solidified head", async () => {
    const f = fixture(family); f.mutate = (_value, read) => { if (read.isHead && read.occurrence === 2) return f.block(102); };
    await refused(() => f.create().read(f.request), "SOURCE_CONFLICT");
  });
  it("rejects stale checkpoints at the native semantic clock", async () => {
    const f = fixture(family); f.setNow(NOW + 120_001);
    await refused(() => f.create().read(f.request), "STALE_CHECKPOINT");
  });
  it("rejects stale checkpoints after the scan even when the first check passed", async () => {
    const f = fixture(family); f.setNow(NOW + 114_000);
    f.mutate = (_value, read) => { if (read.isHead && read.occurrence === 2) f.setNow(NOW + 116_000); };
    await refused(() => f.create().read(f.request), "STALE_CHECKPOINT");
  });
  it("refuses an oversized range before native IO", async () => {
    const f = fixture(family);
    await refused(() => f.create().read({ ...f.request, throughBlock: "108" }), "RESOURCE_LIMIT"); expect(f.calls).toHaveLength(0);
  });
  it("refuses an oversized checkpoint bridge without truncating it", async () => {
    const f = fixture(family); f.setHead(116); f.setNow(NOW + 20_000);
    await refused(() => f.create().read(f.request), "RESOURCE_LIMIT"); expect(f.calls.some(call => call.transactionId)).toBe(false);
  });
  it("refuses more receipts than the complete bounded scan can collect", async () => {
    const f = fixture(family); f.members.set(100, Array.from({ length: 17 }, (_, index) => f.tx(1000 + index)));
    await refused(() => f.create().read(f.request), "RESOURCE_LIMIT"); expect(f.calls.some(call => call.transactionId)).toBe(false);
  });
  it("refuses an oversized receipt log array instead of sampling it", async () => {
    const f = fixture(family); f.mutate = (value, read) => { if (read.transactionId === f.tx(2)) row(value)[family === "bsc" ? "logs" : "log"] = Array.from({ length: 257 }, () => copy(logsOf(value, family)[0])); };
    await refused(() => f.create().read(f.request), "RESOURCE_LIMIT");
  });
  it("refuses a total log budget overflow across individually bounded receipts", async () => {
    const f = fixture(family), transactions = [f.tx(1001), f.tx(1002), f.tx(1003)]; f.members.set(100, transactions);
    f.mutate = (value, read) => {
      if (!read.transactionId || !transactions.includes(read.transactionId)) return;
      const index = transactions.indexOf(read.transactionId), count = index === 2 ? 1 : 256;
      row(value)[family === "bsc" ? "logs" : "log"] = Array.from({ length: count }, (_, offset) =>
        f.rawLog(read.transactionId!, 100, index, index * 256 + offset, { token: f.otherToken }));
    };
    await refused(() => f.create().read(f.request), "RESOURCE_LIMIT");
  });
  it("completes the largest header span and receipt batch within the existing native read budget", async () => {
    const f = fixture(family); f.members.set(100, Array.from({ length: 16 }, (_, index) => f.tx(2000 + index)));
    f.setHead(115); f.setNow(NOW + 20_000);
    const result = await f.create().read({ ...f.request, throughBlock: "100" });
    expect(result.coveredBlocks).toHaveLength(1); expect(result.bridgeBlocks).toHaveLength(15); expect(result.receipts).toHaveLength(16);
    expect(result.reads).toHaveLength(family === "bsc" ? 138 : 136); await f.verify(result);
  });

  it("replays an exact duplicate and identifies no range progress", async () => {
    const f = fixture(family), certificate = await f.create().read(f.request);
    const first = await f.verify(certificate), second = await f.verify(copy(certificate));
    expect(compareDevelopmentRangeCoverage(first, second)).toMatchObject({ relation: "identical-evidence", cursorAuthority: false, throughBlock: "102" });
    await refused(() => compareDevelopmentRangeCoverage(copy(first), second), "ADMISSION_REFUSED");
  });
  it("proves adjacency only for the exact previous covered block and retains overlapping bridge facts", async () => {
    const f = fixture(family);
    const first = await f.verify(await f.create().read({ ...f.request, throughBlock: "101" }));
    const second = await f.verify(await f.create().read({ fromBlock: "102", throughBlock: "103", previousBlockHash: f.blockHash(101) }));
    expect(compareDevelopmentRangeCoverage(first, second)).toMatchObject({ relation: "contiguous-extension", fromBlock: "100", throughBlock: "103", cursorAuthority: false });
  });
  it("does not accept a missing height as cursor advancement", async () => {
    const f = fixture(family), first = await f.verify(await f.create().read({ ...f.request, throughBlock: "101" }));
    const gap = await f.verify(await f.create().read({ fromBlock: "103", throughBlock: "103", previousBlockHash: f.blockHash(102) }));
    await refused(() => compareDevelopmentRangeCoverage(first, gap), "INVALID_EVIDENCE");
  });
  it("rejects a self-consistent later range that changes an overlapping finalized bridge block", async () => {
    const f = fixture(family); f.members.set(103, []);
    const first = await f.verify(await f.create().read({ ...f.request, throughBlock: "101" }));
    const forkHash = `${f.blockHash(103).slice(0, -1)}f`;
    f.mutate = (value, read) => { if (read.number === 103) row(value)[family === "bsc" ? "hash" : "blockID"] = forkHash; };
    const fork = await f.verify(await f.create().read({ fromBlock: "102", throughBlock: "103", previousBlockHash: f.blockHash(101) }));
    await refused(() => compareDevelopmentRangeCoverage(first, fork), "SOURCE_CONFLICT");
  });
  it("rejects finality regression between otherwise adjacent range certificates", async () => {
    const f = fixture(family), first = await f.verify(await f.create().read({ ...f.request, throughBlock: "101" }));
    f.setHead(102);
    const regressed = await f.verify(await f.create().read({ fromBlock: "102", throughBlock: "102", previousBlockHash: f.blockHash(101) }));
    await refused(() => compareDevelopmentRangeCoverage(first, regressed), "SOURCE_CONFLICT");
  });
  it("rejects transaction re-inclusion between non-overlapping covered blocks", async () => {
    const f = fixture(family); f.setHead(101);
    const first = await f.verify(await f.create().read({ ...f.request, throughBlock: "101" }));
    f.setHead(103); f.members.set(102, [f.tx(2)]);
    f.mutate = (value, read) => {
      if (read.transactionId !== f.tx(2)) return;
      if (family === "bsc") {
        row(value).blockNumber = "0x66"; row(value).blockHash = f.blockHash(102); row(value).transactionIndex = "0x0";
        logsOf(value, family).forEach((log, index) => { log.blockNumber = "0x66"; log.blockHash = f.blockHash(102); log.transactionIndex = "0x0"; log.logIndex = `0x${index.toString(16)}`; });
      } else { row(value).blockNumber = 102; row(value).blockTimeStamp = NOW - 6_000; }
    };
    const repeated = await f.verify(await f.create().read({ fromBlock: "102", throughBlock: "103", previousBlockHash: f.blockHash(101) }));
    await refused(() => compareDevelopmentRangeCoverage(first, repeated), "SOURCE_CONFLICT");
  });

  it.each(["candidates", "coveredBlocks", "receipts"] as const)("does not accept removed %s even with a recomputed outer checksum", async field => {
    const f = fixture(family), certificate = copy(await f.create().read(f.request));
    (row(certificate)[field] as unknown[]).pop();
    await refused(() => f.verify(reseal(certificate)));
  });
  it("does not accept an unclassified zero transfer becoming a positive deposit candidate", async () => {
    const f = fixture(family), certificate = copy(await f.create().read(f.request));
    row(certificate.candidates[0]).amountRaw = "0";
    await refused(() => f.verify(reseal(certificate)), "REPLAY_MISMATCH");
  });
  it("does not accept omitted native reads, including absence disguised by a new checksum", async () => {
    const f = fixture(family), certificate = copy(await f.create().read(f.request));
    (certificate.reads as unknown[]).splice(10, 1);
    row(certificate.semanticClocks[1]).afterRead = certificate.reads.length;
    await refused(() => f.verify(reseal(certificate)), "REPLAY_MISMATCH");
  });
  it("does not ignore unused transcript reads appended after the final checkpoint", async () => {
    const f = fixture(family), certificate = copy(await f.create().read(f.request));
    (certificate.reads as unknown[]).push(copy(certificate.reads.at(-1)));
    row(certificate.semanticClocks[1]).afterRead = certificate.reads.length;
    await refused(() => f.verify(reseal(certificate)), "REPLAY_MISMATCH");
  });
  it("does not accept a new worker or assignment scope for old coverage", async () => {
    const f = fixture(family), certificate = await f.create().read(f.request);
    f.manifest.assignments[0].beneficiaryRef = "different-seller";
    await refused(() => f.verify(certificate), "ADMISSION_REFUSED");
  });
  it("rejects fabricated completion timing after a full session deadline", async () => {
    const f = fixture(family), certificate = copy(await f.create().read(f.request));
    row(certificate).startedAtMs = certificate.completedAtMs - 30_000;
    await refused(() => f.verify(reseal(certificate)), "TIMEOUT");
  });
});

describe("range input and runtime boundaries", () => {
  it("does not permit request-selected assignments, provider sources, or amounts", async () => {
    const f = fixture();
    await refused(() => f.create().read({ ...f.request, assignmentIds: [f.assignmentId] } as never), "INVALID_INPUT");
    expect(f.calls).toHaveLength(0);
  });
  it("rejects executable request fields without invoking them", async () => {
    const f = fixture(), value = { ...f.request }, getter = vi.fn(() => "100");
    Object.defineProperty(value, "fromBlock", { enumerable: true, get: getter });
    await refused(() => f.create().read(value), "INVALID_INPUT"); expect(getter).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it("rejects a Proxy request without invoking traps", async () => {
    const f = fixture(), trap = vi.fn();
    await refused(() => f.create().read(new Proxy(f.request, { ownKeys: trap })), "INVALID_INPUT"); expect(trap).not.toHaveBeenCalled();
  });
  it("captures request and immutable manifest before native awaits", async () => {
    const f = fixture(), request = { ...f.request }, reader = f.create();
    f.mutate = () => { request.throughBlock = "110"; f.manifest.assignments[0].beneficiaryRef = "changed-after-capture"; };
    const result = await reader.read(request); expect(result.request.throughBlock).toBe("102"); expect(result.candidates).toHaveLength(2);
  });
  it("refuses an endpoint that was not admitted", async () => {
    const f = fixture(); f.endpointConfig[0].endpoint += "/unexpected";
    await refused(() => f.create(), "ADMISSION_REFUSED"); expect(f.calls).toHaveLength(0);
  });
  it("refuses an unadmitted worker before fetching", async () => {
    const f = fixture(); await refused(() => f.create({ workerId: "intruder" }), "ADMISSION_REFUSED"); expect(f.calls).toHaveLength(0);
  });
  it("refuses production during construction", async () => {
    const f = fixture(); vi.stubEnv("NODE_ENV", "production"); await refused(() => f.create(), "RUNTIME_REFUSED"); expect(f.calls).toHaveLength(0);
  });
  it("refuses production enabled during an awaited native read", async () => {
    const f = fixture(); f.mutate = () => { vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "1"); };
    await refused(() => f.create().read(f.request), "RUNTIME_REFUSED");
  });
  it("poisons both concurrent scans even if the fetch callback swallows the second failure", async () => {
    const f = fixture(), reader = f.create(); let attempted = false;
    f.mutate = async () => { if (!attempted) { attempted = true; try { await reader.read(f.request); } catch { /* Deliberately swallowed. */ } } };
    await refused(() => reader.read(f.request), "SESSION_CLOSED");
    await refused(() => reader.read(f.request), "SESSION_CLOSED");
  });
  it("refuses a negative synthetic clock", async () => {
    const f = fixture(); await refused(() => f.create({ clock: () => -1 }).read(f.request), "RUNTIME_REFUSED"); expect(f.calls).toHaveLength(0);
  });
});

describe("native completeness cases", () => {
  it("refuses an explicit null TRON block transaction array", async () => {
    const f = fixture("tron"); f.mutate = (value, read) => { if (read.number === 102) row(value).transactions = null; };
    await refused(() => f.create().read(f.request), "INVALID_RESPONSE");
  });
  it("rejects the wrong BSC chain ID before scanning receipts", async () => {
    const f = fixture(); f.mutate = (_value, read) => { if (read.operation === "eth_chainId") return "0x38"; };
    await refused(() => f.create().read(f.request), "SOURCE_CONFLICT");
  });
  it("rejects a missing first BSC block-wide log", async () => {
    const f = fixture(); f.mutate = (value, read) => { if (read.transactionId === f.tx(1)) logsOf(value, "bsc")[0].logIndex = "0x1"; };
    await refused(() => f.create().read(f.request), "INVALID_EVIDENCE");
  });
  it("rejects a missing whole earlier BSC receipt log via the next receipt's native block-wide index", async () => {
    const f = fixture(); f.mutate = (value, read) => { if (read.transactionId === f.tx(1)) row(value).logs = []; };
    await refused(() => f.create().read(f.request), "INVALID_EVIDENCE");
  });
  it("rejects removed BSC logs even when both nodes agree", async () => {
    const f = fixture(); f.mutate = (value, read) => { if (read.transactionId === f.tx(2)) logsOf(value, "bsc")[0].removed = true; };
    await refused(() => f.create().read(f.request), "SOURCE_CONFLICT");
  });
  it("rejects an RPC response ID mismatch during offline replay", async () => {
    const f = fixture(), certificate = copy(await f.create().read(f.request)), read = certificate.reads[0];
    const data = JSON.parse(read.responseBody); data.id = "another-call";
    row(read).responseBody = JSON.stringify(data); row(read).responseSha256 = observationDigest(read.responseBody);
    await refused(() => f.verify(reseal(certificate)), "INVALID_INPUT");
  });
  it("rejects TRON fractional native JSON that JSON.parse would round to an integer", async () => {
    const f = fixture("tron"), certificate = copy(await f.create().read(f.request));
    const read = certificate.reads.find(item => item.responseBody.includes('"number":100'))!;
    row(read).responseBody = read.responseBody.replace('"number":100', '"number":100.000000000000001');
    row(read).responseSha256 = observationDigest(read.responseBody);
    await refused(() => f.verify(reseal(certificate)), "INVALID_EVIDENCE");
  });
});
