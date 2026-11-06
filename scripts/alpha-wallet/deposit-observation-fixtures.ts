import { createHash } from "node:crypto";
import type { TransferFixtureContext } from "../../src/lib/alpha-wallet/chain-evidence";
import type { DevelopmentNodeSource } from "../../src/lib/alpha-wallet/chain-observer-rpc";

type Row = Record<string, unknown>;
export type DepositObservationFixtureFamily = "bsc" | "tron";

export interface DepositObservationFixtureRead {
  readonly ordinal: number;
  readonly source: "execution" | "finality";
  readonly sourceId: string;
  readonly protocol: "bsc-json-rpc" | "tron-http";
  readonly operation: string;
  readonly url: string;
  readonly requestBody: string;
  readonly request: Readonly<Row>;
  readonly params: readonly unknown[] | null;
  readonly occurrence: number;
  readonly isHead: boolean;
}

export interface DepositObservationFixtureOptions {
  amountRaw?: string;
  now?: number;
  checkpointHeight?: number;
}

export interface DepositObservationFixture {
  readonly mode: "simulation-only";
  readonly family: DepositObservationFixtureFamily;
  context: TransferFixtureContext;
  sources: DevelopmentNodeSource[];
  readonly executionSourceId: string;
  readonly finalitySourceId: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly clock: () => number;
  readonly now: number;
  readonly containingHeight: number;
  readonly headHeight: number;
  readonly calls: DepositObservationFixtureRead[];
  setNow(value: number): void;
  /** Sets the absolute height for subsequent head reads, preserving the current response. */
  advanceHead(height: number): void;
  blockAt(height: number): Row;
  receipt(): Row;
  /** Mutate a fresh native result, return its replacement, or return a custom HTTP response. */
  mutateResponse?: (value: unknown, read: DepositObservationFixtureRead) => unknown | Promise<unknown>;
}

const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const word = (value: string) => BigInt(value).toString(16).padStart(64, "0");
const hexHeight = (value: number) => `0x${value.toString(16)}`;
const tronBlockId = (height: number) => `${BigInt(height).toString(16).padStart(16, "0")}${"aa".repeat(24)}`;

function requireFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Synthetic deposit observation fixture: ${message}`);
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** In-memory native node responses only; this helper never calls ambient fetch. */
export function createDepositObservationFixture(
  family: DepositObservationFixtureFamily,
  options: DepositObservationFixtureOptions = {},
): DepositObservationFixture {
  requireFixture(family === "bsc" || family === "tron", "unsupported chain family");
  const containingHeight = family === "bsc" ? 100 : 20;
  const initialNow = options.now ?? (family === "bsc" ? 1_900_000_000_000 : 1_800_000_000_000);
  requireFixture(Number.isSafeInteger(initialNow) && initialNow >= 100_000, "invalid initial clock");
  let now = initialNow;
  let headHeight = options.checkpointHeight ?? (family === "bsc" ? 102 : 23);
  requireFixture(Number.isSafeInteger(headHeight) && headHeight >= containingHeight, "invalid initial head");
  const amountRaw = options.amountRaw ?? (family === "bsc" ? "500000000000000000001" : "500000001");
  requireFixture(/^[1-9][0-9]*$/.test(amountRaw) && BigInt(amountRaw) < (BigInt(1) << BigInt(256)), "invalid raw amount");
  const prefix = family === "bsc" ? "0x" : "";
  const transactionId = `${prefix}${"11".repeat(32)}`;
  const otherTransactionId = `${prefix}${"55".repeat(32)}`;
  const token = `${family === "bsc" ? "0x" : "41"}${"22".repeat(20)}`;
  const recipient = `${family === "bsc" ? "0x" : "41"}${"44".repeat(20)}`;
  const genesisHash = family === "bsc" ? `0x${"a0".repeat(32)}` : tronBlockId(0);
  const bscBlockHash = (height: number) => height === 0 ? genesisHash : `0x${word(String(height))}`;
  const executionSourceId = `${family}-execution`, finalitySourceId = `${family}-finality`;
  const sources: DevelopmentNodeSource[] = [
    { id: executionSourceId, independenceGroup: `${family}-execution-operator`, endpoint: `https://execution.${family}-fixture.invalid${family === "bsc" ? "/rpc" : ""}` },
    { id: finalitySourceId, independenceGroup: `${family}-finality-operator`, endpoint: `https://finality.${family}-fixture.invalid${family === "bsc" ? "/rpc" : ""}` },
  ];
  const sourceUrls = sources.map(source => ({ sourceId: source.id, url: new URL(source.endpoint) }));
  const context: TransferFixtureContext = {
    mode: "development-fixture",
    chain: family === "bsc" ? { family, chainId: "97", genesisHash } : { family, network: "nile", genesisHash },
    token, recipient, transactionId, amountRaw, eventIndex: family === "bsc" ? "8" : "1",
  };

  function blockAt(height: number): Row {
    requireFixture(Number.isSafeInteger(height) && height >= 0, "invalid native block height");
    if (family === "bsc") return {
      number: hexHeight(height), hash: bscBlockHash(height),
      parentHash: height === 0 ? `0x${"00".repeat(32)}` : bscBlockHash(height - 1),
      timestamp: hexHeight(height === 0 ? 0 : Math.floor(initialNow / 1000) - 100 + height - containingHeight),
      transactions: height === containingHeight ? [otherTransactionId, transactionId] : [],
    };
    return {
      blockID: tronBlockId(height),
      block_header: {
        raw_data: { number: height, timestamp: height === 0 ? 0 : initialNow - 10_000 + (height - containingHeight) * 100,
          parentHash: height === 0 ? "0".repeat(64) : tronBlockId(height - 1),
          txTrieRoot: "77".repeat(32), witness_address: `41${"88".repeat(20)}`, version: 32 },
        witness_signature: "99".repeat(65),
      },
      transactions: height === containingHeight ? [
        { txID: otherTransactionId, raw_data: { timestamp: initialNow - 10_000 } },
        { txID: transactionId, raw_data: { timestamp: initialNow - 10_000 }, ret: [{ contractRet: "SUCCESS" }] },
      ] : [],
    };
  }

  function receipt(): Row {
    if (family === "bsc") {
      const identity = { transactionHash: transactionId, transactionIndex: "0x1", blockHash: bscBlockHash(containingHeight),
        blockNumber: hexHeight(containingHeight), removed: false };
      return { transactionHash: transactionId, transactionIndex: "0x1", blockHash: bscBlockHash(containingHeight),
        blockNumber: hexHeight(containingHeight), status: "0x1", chainId: "0x61", from: `0x${"66".repeat(20)}`,
        to: `0x${"77".repeat(20)}`, contractAddress: null, gasUsed: "0x5208", logs: [
          { ...identity, logIndex: "0x7", address: token, topics: [], data: "0x" },
          { ...identity, logIndex: "0x8", address: token,
            topics: [`0x${TRANSFER_TOPIC}`, `0x${"0".repeat(24)}${"33".repeat(20)}`, `0x${"0".repeat(24)}${"44".repeat(20)}`],
            data: `0x${word(amountRaw)}` },
        ] };
    }
    return { id: transactionId, blockNumber: containingHeight, blockTimeStamp: initialNow - 10_000,
      receipt: { result: "SUCCESS", energy_usage_total: 1000 }, fee: 100, log: [
        { address: token.slice(2), topics: [], data: "" },
        { address: token.slice(2), topics: [TRANSFER_TOPIC, `${"0".repeat(24)}${"33".repeat(20)}`, `${"0".repeat(24)}${recipient.slice(2)}`],
          data: word(amountRaw) },
      ] };
  }

  const calls: DepositObservationFixtureRead[] = [], occurrences = new Map<string, number>();
  const fixture: DepositObservationFixture = {
    mode: "simulation-only", family, context, sources, executionSourceId, finalitySourceId,
    clock: () => now, get now() { return now; }, containingHeight, get headHeight() { return headHeight; },
    calls, setNow(value) { now = value; },
    advanceHead(height) {
      requireFixture(Number.isSafeInteger(height) && height >= headHeight, "head must advance monotonically");
      headHeight = height;
    },
    blockAt, receipt,
    async fetch(url, init) {
      requireFixture(init.method === "POST" && typeof init.body === "string", "expected a JSON POST request");
      requireFixture(!init.signal?.aborted, "request was already aborted");
      const parsedUrl = new URL(url);
      const sourceIndex = sourceUrls.findIndex(source => source.url.origin === parsedUrl.origin);
      requireFixture(sourceIndex >= 0 && parsedUrl.username === "" && parsedUrl.password === ""
        && parsedUrl.search === "" && parsedUrl.hash === "", "unexpected synthetic endpoint");
      const source = sourceIndex === 0 ? "execution" : "finality";
      const sourceId = sourceUrls[sourceIndex].sourceId;
      const request = JSON.parse(init.body) as Row;
      requireFixture(request !== null && typeof request === "object" && !Array.isArray(request), "request must be an object");
      let operation: string, params: unknown[] | null, isHead = false, value: unknown;
      if (family === "bsc") {
        requireFixture(parsedUrl.href === sourceUrls[sourceIndex].url.href && request.jsonrpc === "2.0"
          && typeof request.id === "string" && typeof request.method === "string" && Array.isArray(request.params), "invalid JSON-RPC request");
        operation = request.method; params = request.params;
        if (operation === "eth_chainId") {
          requireFixture(params.length === 0, "chain ID request arguments changed"); value = "0x61";
        } else if (operation === "eth_getTransactionReceipt") {
          requireFixture(params.length === 1 && params[0] === transactionId, "transaction request arguments changed"); value = receipt();
        } else if (operation === "eth_getBlockByNumber") {
          requireFixture(params.length === 2 && params[1] === false && typeof params[0] === "string", "block request arguments changed");
          isHead = params[0] === "finalized";
          requireFixture(isHead || /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(params[0]), "unexpected native block tag");
          value = blockAt(isHead ? headHeight : Number(BigInt(params[0])));
        } else throw new Error(`Unexpected synthetic BSC operation: ${operation}`);
      } else {
        operation = parsedUrl.pathname; params = null;
        requireFixture(request.visible === false, "TRON requests must use native hexadecimal addresses");
        const pathPrefix = source === "execution" ? "/wallet/" : "/walletsolidity/";
        requireFixture(operation.startsWith(pathPrefix), "TRON node role does not match request path");
        if (operation === `${pathPrefix}getblockbynum`) {
          requireFixture(typeof request.num === "number", "TRON height must be a native number"); value = blockAt(request.num);
        } else if (operation === `${pathPrefix}gettransactioninfobyid`) {
          requireFixture(request.value === transactionId, "transaction request arguments changed"); value = receipt();
        } else if (operation === "/walletsolidity/getnowblock") {
          isHead = true; value = blockAt(headHeight);
        } else throw new Error(`Unexpected synthetic TRON operation: ${operation}`);
      }
      const occurrenceKey = JSON.stringify([sourceId, operation, params ?? request]);
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const read: DepositObservationFixtureRead = freezeJson({ ordinal: calls.length + 1, source, sourceId,
        protocol: family === "bsc" ? "bsc-json-rpc" : "tron-http", operation, url, requestBody: init.body,
        request, params, occurrence, isHead });
      calls.push(read);
      const replacement = await fixture.mutateResponse?.(value, read);
      if (replacement instanceof Response) return replacement;
      if (replacement !== undefined) value = replacement;
      const body = family === "bsc" ? { jsonrpc: "2.0", id: request.id, result: value } : value;
      const response = new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
  };
  return fixture;
}

/** Synthetic admission records for the same two isolated, injected node sources. */
export function createDepositObservationAdmissionFixture(
  family: DepositObservationFixtureFamily,
  options: DepositObservationFixtureOptions = {},
) {
  const fixture = createDepositObservationFixture(family, options);
  const chain = fixture.context.chain;
  const chainKey = chain.family === "bsc" ? `bsc:${chain.chainId}:${chain.genesisHash}` : `tron:${chain.network}:${chain.genesisHash}`;
  const inboxId = `${family}-inbox-fixture`, assetRef = `${family}-fixture-usdt`, sourceSetId = `${family}-source-set`;
  const assignmentId = `${family}-principal`, workerId = "fixture-observer";
  const manifest = {
    kind: "development-deposit-inbox-manifest" as const, formatVersion: 1 as const,
    mode: "simulation-only" as const, creditAuthority: false as const, inboxId,
    chains: [{ chainKey, ...chain }],
    assets: [{ assetRef, chainKey, token: fixture.context.token, decimals: family === "bsc" ? 18 : 6, transferProfile: "fungible-transfer-v1" as const }],
    sources: fixture.sources.map(source => {
      const url = new URL(source.endpoint);
      return { sourceId: source.id, independenceGroup: source.independenceGroup, host: url.hostname,
        endpointSha256: createHash("sha256").update(url.href).digest("hex"), responseProfile: "native-node-observer-v1" as const };
    }),
    sourceSets: [{ sourceSetId, chainKey, executionSourceId: fixture.executionSourceId, finalitySourceId: fixture.finalitySourceId,
      policy: { maxAncestry: 64, maxCheckpointAgeMs: 120_000, maxFutureSkewMs: 5_000 } }],
    assignments: [{ assignmentId, custodyDomainId: "synthetic-custody", assetRef, recipient: fixture.context.recipient,
      beneficiaryRef: "fixture-seller", purpose: "principal" as const, admissionKind: "synthetic-fixture" as const }],
    workers: [{ workerId, sourceSetIds: [sourceSetId], assignmentIds: [assignmentId] }],
  };
  return { fixture, manifest, workerId, inboxId, chainKey, assetRef, sourceSetId, assignmentId,
    endpointConfig: fixture.sources.map(source => ({ sourceId: source.id, endpoint: source.endpoint })),
    candidate: { assignmentId, sourceSetId, transactionId: fixture.context.transactionId,
      eventIndex: fixture.context.eventIndex, amountRaw: fixture.context.amountRaw } };
}
