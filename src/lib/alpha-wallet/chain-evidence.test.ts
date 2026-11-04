// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ChainEvidenceError, parseChainFixtureJson, verifyBscFixtureTransfer, verifyTronFixtureTransfer } from "./chain-evidence";

type JsonObject = Record<string, unknown>;
type Fixture = { context: JsonObject; receipt: JsonObject; proof: JsonObject };
const record = (value: unknown) => value as JsonObject;
const list = (value: unknown) => value as unknown[];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (byte: string, size: number, prefix = "") => `${prefix}${byte.repeat(size)}`;
const transferTopic = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const word = (value: string, prefix = "") => `${prefix}${BigInt(value).toString(16).padStart(64, "0")}`;
const tronBlock = (height: string, byte: string) => `${BigInt(height).toString(16).padStart(16, "0")}${byte.repeat(24)}`;

function bsc(): Fixture {
  const chain = { family: "bsc", chainId: "97", genesisHash: bytes("a0", 32, "0x") };
  const transactionHash = bytes("11", 32, "0x"), blockHash = bytes("aa", 32, "0x"), token = bytes("22", 20, "0x");
  const recipient = bytes("44", 20, "0x"), amountRaw = "500000000000000000001";
  const logIdentity = { transactionHash, transactionIndex: "0x1", blockHash, blockNumber: "0x64", removed: false };
  return {
    context: { mode: "development-fixture", chain, token, recipient, transactionId: transactionHash, amountRaw, eventIndex: "8" },
    receipt: { transactionHash, transactionIndex: "0x1", blockHash, blockNumber: "0x64", status: "0x1", chainId: "0x61",
      // A router destination is unrelated to the Transfer recipient or token emitter.
      from: bytes("66", 20, "0x"), to: bytes("77", 20, "0x"), contractAddress: null,
      logs: [
        { ...logIdentity, logIndex: "0x7", address: token, topics: [], data: "0x" },
        { ...logIdentity, logIndex: "0x8", address: token,
          topics: [`0x${transferTopic}`, `0x${"0".repeat(24)}${"33".repeat(20)}`, `0x${"0".repeat(24)}${"44".repeat(20)}`], data: word(amountRaw, "0x") },
      ] },
    proof: { mode: "independent-fixture-proof", chain: copy(chain), canonical: true, finality: "bsc-finalized",
      block: { number: "100", hash: blockHash, transactions: [bytes("55", 32, "0x"), transactionHash] },
      ancestry: [
        { number: "101", hash: bytes("ab", 32, "0x"), parentHash: blockHash },
        { number: "102", hash: bytes("ac", 32, "0x"), parentHash: bytes("ab", 32, "0x") },
      ], checkpoint: { number: "102", hash: bytes("ac", 32, "0x") } },
  };
}

function tron(): Fixture {
  const chain = { family: "tron", network: "nile", genesisHash: tronBlock("0", "a0") };
  const id = bytes("11", 32), token = bytes("22", 20, "41"), recipient = bytes("44", 20, "41"), amountRaw = "500000001";
  return {
    context: { mode: "development-fixture", chain, token, recipient, transactionId: id, amountRaw, eventIndex: "1" },
    receipt: { id, blockNumber: 100, receipt: { result: "SUCCESS", energy_usage_total: 1000 }, fee: 100,
      log: [
        { address: bytes("22", 20), topics: [], data: "" },
        { address: bytes("22", 20), topics: [transferTopic, `${"0".repeat(24)}${"33".repeat(20)}`, `${"0".repeat(24)}${"44".repeat(20)}`], data: word(amountRaw) },
      ] },
    proof: { mode: "independent-fixture-proof", chain: copy(chain), canonical: true, finality: "tron-solidified",
      block: { number: "100", hash: tronBlock("100", "aa"), transactions: [bytes("55", 32), id] },
      ancestry: [
        { number: "101", hash: tronBlock("101", "ab"), parentHash: tronBlock("100", "aa") },
        { number: "102", hash: tronBlock("102", "ac"), parentHash: tronBlock("101", "ab") },
      ], checkpoint: { number: "102", hash: tronBlock("102", "ac") } },
  };
}

const selected = (f: Fixture) => record(list(f.receipt.logs ?? f.receipt.log)[1]);
const verify = (f: Fixture) => record(f.context.chain).family === "bsc"
  ? verifyBscFixtureTransfer(f.context, f.receipt, f.proof)
  : verifyTronFixtureTransfer(f.context, f.receipt, f.proof);

describe("fixture chain evidence with no credit authority", () => {
  it.each([bsc, tron])("returns immutable, exact transfer identity from supported native evidence", make => {
    const fixture = make(), before = copy(fixture), result = verify(fixture);
    expect(result).toMatchObject({ kind: "verified-development-transfer-evidence", creditAuthority: false,
      assurance: "supplied-fixture-consistency-only", amountRaw: fixture.context.amountRaw,
      token: fixture.context.token, recipient: fixture.context.recipient, transactionId: fixture.context.transactionId,
      eventIndex: fixture.context.eventIndex, transactionIndex: "1", blockNumber: "100", checkpointNumber: "102" });
    expect(result.sender).toBe(bytes("33", 20, result.family === "bsc" ? "0x" : "41"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.values(result).every(value => typeof value !== "object")).toBe(true);
    expect(fixture).toEqual(before);
    selected(fixture).data = word("1", result.family === "bsc" ? "0x" : "");
    expect(result.amountRaw).toBe(before.context.amountRaw);
  });

  it("uses BSC block-wide logIndex, not receipt-array position", () => {
    const fixture = bsc();
    expect(verify(fixture).eventIndex).toBe("8");
    fixture.context.eventIndex = "1";
    expect(() => verify(fixture)).toThrow(/block-wide/);
  });

  it("preserves two identical TRON events at different receipt offsets as separate evidence", () => {
    const fixture = tron();
    list(fixture.receipt.log).push(copy(selected(fixture)));
    const first = verify(fixture);
    fixture.context.eventIndex = "2";
    const second = verify(fixture);
    expect(first.amountRaw).toBe(second.amountRaw);
    expect(first.eventKey).not.toBe(second.eventKey);
    expect(second.creditAuthority).toBe(false);
  });

  it.each([bsc, tron])("preserves maximum uint256 units without Number conversion", make => {
    const fixture = make(), maximum = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
    fixture.context.amountRaw = maximum;
    selected(fixture).data = word(maximum, make === bsc ? "0x" : "");
    expect(verify(fixture).amountRaw).toBe(maximum);
  });

  it.each(["500000001", "500000000000000000001"])("does not infer token decimals from units %s", amountRaw => {
    const fixture = bsc();
    fixture.context.amountRaw = amountRaw;
    selected(fixture).data = word(amountRaw, "0x");
    expect(verify(fixture).amountRaw).toBe(amountRaw);
  });

  it.each([bsc, tron])("accepts an exact containing-block checkpoint without fabricated confirmations", make => {
    const fixture = make(), block = record(fixture.proof.block);
    fixture.proof.ancestry = [];
    fixture.proof.checkpoint = { number: block.number, hash: block.hash };
    expect(verify(fixture).checkpointNumber).toBe("100");
  });

  it("normalizes hexadecimal letter case without merging separate networks or contracts", () => {
    const fixture = bsc(), original = verify(fixture);
    const upper = (value: unknown) => `0x${String(value).slice(2).toUpperCase()}`;
    fixture.receipt.blockHash = upper(fixture.receipt.blockHash);
    for (const log of list(fixture.receipt.logs)) record(log).blockHash = upper(record(log).blockHash);
    expect(verify(fixture).eventKey).toBe(original.eventKey);
    record(fixture.context.chain).chainId = "56";
    record(fixture.proof.chain).chainId = "56";
    fixture.receipt.chainId = "0x38";
    expect(verify(fixture).eventKey).not.toBe(original.eventKey);
  });
});

const sharedFailures: [string, (f: Fixture) => void][] = [
  ["live mode", f => { f.context.mode = "production"; }],
  ["missing amount", f => { delete f.context.amountRaw; }],
  ["floating amount", f => { f.context.amountRaw = 500; }],
  ["decimal display amount", f => { f.context.amountRaw = "500.0"; }],
  ["zero amount policy", f => { f.context.amountRaw = "0"; }],
  ["negative amount", f => { f.context.amountRaw = "-1"; }],
  ["noncanonical raw units", f => { f.context.amountRaw = "01"; }],
  ["uint256 overflow", f => { f.context.amountRaw = (BigInt(1) << BigInt(256)).toString(); }],
  ["missing canonical proof", f => { f.proof = {}; }],
  ["non-independent proof", f => { f.proof.mode = "receipt-self-report"; }],
  ["noncanonical block", f => { f.proof.canonical = false; }],
  ["confirmation count in place of finality", f => { f.proof.finality = "100-confirmations"; }],
  ["unlinked checkpoint", f => { f.proof.ancestry = []; }],
  ["missing ancestor", f => { list(f.proof.ancestry).shift(); }],
  ["wrong parent", f => { record(list(f.proof.ancestry)[0]).parentHash = record(f.proof.checkpoint).hash; }],
  ["wrong checkpoint height", f => { record(f.proof.checkpoint).number = "103"; }],
  ["checkpoint hash mismatch", f => { record(f.proof.checkpoint).hash = record(f.proof.block).hash; }],
  ["missing transaction membership", f => { list(record(f.proof.block).transactions).pop(); }],
  ["duplicate transaction membership", f => { list(record(f.proof.block).transactions).push(f.context.transactionId); }],
  ["foreign genesis", f => { record(f.proof.chain).genesisHash = record(f.proof.checkpoint).hash; }],
  ["height overflow", f => { record(f.proof.block).number = (BigInt(1) << BigInt(64)).toString(); }],
  ["wrong token", f => { f.context.token = bytes("99", 20, record(f.context.chain).family === "bsc" ? "0x" : "41"); }],
  ["wrong recipient", f => { f.context.recipient = bytes("99", 20, record(f.context.chain).family === "bsc" ? "0x" : "41"); }],
  ["wrong exact amount", f => { f.context.amountRaw = "1"; }],
  ["missing event", f => { f.context.eventIndex = "123"; }],
  ["negative event index", f => { f.context.eventIndex = "-1"; }],
  ["wrong event signature", f => { list(selected(f).topics)[0] = bytes("ff", 32, record(f.context.chain).family === "bsc" ? "0x" : ""); }],
  ["ERC721-style four topics", f => { list(selected(f).topics).push(list(selected(f).topics)[0]); }],
  ["missing recipient topic", f => { list(selected(f).topics).pop(); }],
  ["nonzero address padding", f => {
    const prefix = record(f.context.chain).family === "bsc" ? "0x" : "";
    list(selected(f).topics)[2] = `${prefix}01${"0".repeat(22)}${"44".repeat(20)}`;
  }],
  ["short topic", f => { list(selected(f).topics)[1] = String(list(selected(f).topics)[1]).slice(0, -2); }],
  ["short data word", f => { selected(f).data = String(selected(f).data).slice(0, -2); }],
  ["extra data word", f => { selected(f).data = `${selected(f).data}${"00".repeat(32)}`; }],
  ["odd byte data", f => { selected(f).data = `${selected(f).data}0`; }],
  ["unsupported event alias", f => { selected(f).event_index = "99"; }],
  ["unsupported context field", f => { f.context.approved = true; }],
];

describe.each([["BSC", bsc], ["TRON", tron]] as const)("%s adversarial evidence", (_name, make) => {
  it.each(sharedFailures)("rejects %s", (_label, mutate) => {
    const fixture = make();
    mutate(fixture);
    expect(() => verify(fixture)).toThrow(ChainEvidenceError);
  });
});

describe("BSC receipt contradictions", () => {
  const failures: [string, (f: Fixture) => void][] = [
    ["failed execution despite finality", f => { f.receipt.status = "0x0"; }],
    ["missing execution status", f => { delete f.receipt.status; }],
    ["numeric execution status", f => { f.receipt.status = 1; }],
    ["leading-zero quantity", f => { f.receipt.blockNumber = "0x064"; }],
    ["pending receipt block", f => { f.receipt.blockHash = null; }],
    ["wrong receipt transaction", f => { f.receipt.transactionHash = bytes("88", 32, "0x"); }],
    ["wrong receipt transaction index", f => { f.receipt.transactionIndex = "0x0"; }],
    ["wrong receipt chain", f => { f.receipt.chainId = "0x1"; }],
    ["unsupported BSC chain", f => { record(f.context.chain).chainId = "1"; }],
    ["wrong log block hash", f => { selected(f).blockHash = bytes("88", 32, "0x"); }],
    ["wrong log block number", f => { selected(f).blockNumber = "0x65"; }],
    ["wrong log transaction", f => { selected(f).transactionHash = bytes("88", 32, "0x"); }],
    ["wrong log transaction index", f => { selected(f).transactionIndex = "0x0"; }],
    ["removed log", f => { selected(f).removed = true; }],
    ["missing removal status", f => { delete selected(f).removed; }],
    ["duplicate event identity", f => { list(f.receipt.logs).push(copy(selected(f))); }],
    ["noncontiguous filtered receipt", f => { selected(f).logIndex = "0x9"; f.context.eventIndex = "9"; }],
    ["reversed logs", f => { list(f.receipt.logs).reverse(); }],
    ["pre-Byzantium root alias", f => { f.receipt.root = bytes("88", 32, "0x"); }],
    ["malformed unrelated log", f => { record(list(f.receipt.logs)[0]).address = "not-hex"; }],
    ["safe instead of finalized", f => { f.proof.finality = "bsc-safe"; }],
    ["reused block hash at another height", f => {
      record(list(f.proof.ancestry)[0]).hash = record(f.proof.block).hash;
    }],
  ];
  it.each(failures)("rejects %s", (_name, mutate) => {
    const fixture = bsc(); mutate(fixture);
    expect(() => verify(fixture)).toThrow(ChainEvidenceError);
  });
  it("rejects a JSON-RPC error envelope rather than accepting its nested receipt-looking data", () => {
    const fixture = bsc();
    expect(() => verifyBscFixtureTransfer(fixture.context, { error: { code: -1 }, result: fixture.receipt }, fixture.proof)).toThrow(ChainEvidenceError);
  });
});

describe("TRON native receipt contradictions", () => {
  const failures: [string, (f: Fixture) => void][] = [
    ["failed contract execution despite solidification", f => { record(f.receipt.receipt).result = "REVERT"; }],
    ["missing execution result", f => { delete record(f.receipt.receipt).result; }],
    ["conflicting top-level result", f => { f.receipt.result = "FAILED"; }],
    ["numeric protobuf enum alias", f => { f.receipt.result = 0; }],
    ["missing native receipt", f => { delete f.receipt.receipt; }],
    ["unsafe numeric height", f => { f.receipt.blockNumber = Number.MAX_SAFE_INTEGER + 1; }],
    ["native signed-int64 height overflow", f => { f.receipt.blockNumber = (BigInt(1) << BigInt(63)).toString(); }],
    ["negative zero height", f => { f.receipt.blockNumber = -0; }],
    ["noncanonical string height", f => { f.receipt.blockNumber = "0100"; }],
    ["receipt transaction mismatch", f => { f.receipt.id = bytes("88", 32); }],
    ["prefixed native transaction ID", f => { f.receipt.id = `0x${f.receipt.id}`; }],
    ["block ID encodes wrong height", f => { record(f.proof.block).hash = tronBlock("101", "aa"); }],
    ["unknown network", f => { record(f.context.chain).network = "unverified"; }],
    ["wrong proof network", f => { record(f.proof.chain).network = "shasta"; }],
    ["Base58 recipient", f => { f.context.recipient = "TFixtureBase58IsUnsupported"; }],
    ["recipient missing 41 prefix", f => { f.context.recipient = bytes("44", 20); }],
    ["native emitter containing 41 prefix", f => { selected(f).address = bytes("22", 20, "41"); }],
    ["native emitter containing 0x prefix", f => { selected(f).address = bytes("22", 20, "0x"); }],
    ["0x-prefixed native topics", f => { list(selected(f).topics)[0] = `0x${transferTopic}`; }],
    ["indexer logIndex alias", f => { selected(f).logIndex = 1; }],
    ["indexer block_hash alias", f => { f.receipt.block_hash = tronBlock("100", "aa"); }],
    ["unconfirmed full-node label", f => { f.proof.finality = "tron-fullnode-success"; }],
  ];
  it.each(failures)("rejects %s", (_name, mutate) => {
    const fixture = tron(); mutate(fixture);
    expect(() => verify(fixture)).toThrow(ChainEvidenceError);
  });
  it("accepts matching success fields and exact decimal string height", () => {
    const fixture = tron(); fixture.receipt.result = "SUCCESS"; fixture.receipt.blockNumber = "100";
    expect(verify(fixture).blockNumber).toBe("100");
  });
});

describe("JSON boundary, ambiguity and resource limits", () => {
  it.each([
    '{"status":"0x0","status":"0x1"}',
    '{"status":"0x0","sta\\u0074us":"0x1"}',
    '{"logs":[{"data":"bad","data":"good"}]}',
    '{"proof":{"canonical":false,"canonical":true}}',
    '{"__proto__":{},"__proto__":{}}',
  ])("rejects duplicate keys before projection: %s", raw => {
    expect(() => parseChainFixtureJson(raw)).toThrow(/duplicate object keys/);
  });
  it("allows repeated names in separate objects and delimiters inside strings", () => {
    const input = { a: [{ id: "a,{}[]:\"" }, { id: "b" }], nested: { a: { id: "c" } } };
    expect(parseChainFixtureJson(JSON.stringify(input))).toEqual(input);
    const fixture = bsc();
    expect(verifyBscFixtureTransfer(fixture.context, parseChainFixtureJson(JSON.stringify(fixture.receipt)), fixture.proof).amountRaw).toBe(fixture.context.amountRaw);
  });
  it.each(["{", "{\"a\":1,}", "undefined", "[NaN]", "[1,,2]"])("rejects malformed JSON %s", value => {
    expect(() => parseChainFixtureJson(value)).toThrow(ChainEvidenceError);
  });
  it("bounds JSON text size and nesting before evidence interpretation", () => {
    expect(() => parseChainFixtureJson(`"${"x".repeat(1_048_576)}"`)).toThrow(/text limit/);
    expect(() => parseChainFixtureJson(`${"[".repeat(65)}0${"]".repeat(65)}`)).toThrow(/nesting limit/);
  });
  it("rejects getters without invoking them, sparse arrays, and prototype objects", () => {
    const fixture = bsc(); let invoked = false;
    Object.defineProperty(fixture.receipt, "status", { enumerable: true, get: () => { invoked = true; return "0x1"; } });
    expect(() => verify(fixture)).toThrow(/plain data/);
    expect(invoked).toBe(false);
    const sparse = bsc(); delete list(sparse.receipt.logs)[0];
    expect(() => verify(sparse)).toThrow(/dense JSON/);
    const inherited = bsc(); inherited.context = Object.create(inherited.context) as JsonObject;
    expect(() => verify(inherited)).toThrow(/JSON data/);
  });
  it("bounds log arrays and ancestry paths", () => {
    const fixture = tron(); fixture.receipt.log = Array.from({ length: 4097 }, () => copy(selected(tron())));
    expect(() => verify(fixture)).toThrow(/bounded array/);
    const excessive = bsc(); excessive.proof.ancestry = Array.from({ length: 1025 }, () => ({}));
    expect(() => verify(excessive)).toThrow(/bounded array/);
  });
  it.each([bsc, tron])("bounds nonselected byte data without silently truncating it", make => {
    const fixture = make(), unrelated = record(list(fixture.receipt.logs ?? fixture.receipt.log)[0]);
    unrelated.data = bytes("00", 65_536, make === bsc ? "0x" : "");
    expect(verify(fixture).amountRaw).toBe(fixture.context.amountRaw);
    unrelated.data = `${unrelated.data}00`;
    expect(() => verify(fixture)).toThrow(/invalid byte encoding/);
  });
  it("rejects unsupported or absent evidence without treating it as failed-chain confirmation", () => {
    const fixture = bsc();
    expect(() => verifyBscFixtureTransfer(fixture.context, null, fixture.proof)).toThrow(ChainEvidenceError);
    expect(() => verifyBscFixtureTransfer(fixture.context, fixture.receipt, undefined)).toThrow(ChainEvidenceError);
    expect(() => verifyTronFixtureTransfer(fixture.context, fixture.receipt, fixture.proof)).toThrow(ChainEvidenceError);
  });
});
