// @vitest-environment node

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDepositObservationAdmissionFixture } from "../../../scripts/alpha-wallet/deposit-observation-fixtures";
import {
  captureDepositInboxManifest, normalizeDepositInboxEndpoint, resolveDepositInboxCandidate,
  type DepositInboxAdmission, type DepositInboxManifestV1,
} from "./deposit-inbox-admission";
import { DepositInboxError, type DepositInboxErrorCode } from "./deposit-inbox-data";

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
type Manifest = Mutable<DepositInboxManifestV1>;
const runtimeFlags = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
  "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"] as const;
const UINT256 = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
const UINT64 = ((BigInt(1) << BigInt(64)) - BigInt(1)).toString();
let ambientFetch = vi.fn();

function fixture(family: "bsc" | "tron" = "bsc") {
  const value = createDepositObservationAdmissionFixture(family);
  return { ...value, manifest: structuredClone(value.manifest) as Manifest };
}
function combined() {
  const bsc = fixture(), tron = fixture("tron");
  const manifest: Manifest = { ...bsc.manifest, inboxId: "combined-inbox",
    chains: [...bsc.manifest.chains, ...tron.manifest.chains], assets: [...bsc.manifest.assets, ...tron.manifest.assets],
    sources: [...bsc.manifest.sources, ...tron.manifest.sources], sourceSets: [...bsc.manifest.sourceSets, ...tron.manifest.sourceSets],
    assignments: [...bsc.manifest.assignments, ...tron.manifest.assignments],
    workers: [
      { workerId: "bsc-only", sourceSetIds: [bsc.sourceSetId], assignmentIds: [bsc.assignmentId] },
      { workerId: "both-chains", sourceSetIds: [tron.sourceSetId, bsc.sourceSetId], assignmentIds: [tron.assignmentId, bsc.assignmentId] },
    ],
  };
  return { bsc, tron, manifest };
}
function refused(operation: () => unknown, code: DepositInboxErrorCode = "INVALID_INPUT"): DepositInboxError {
  let error: unknown;
  try { operation(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(DepositInboxError);
  expect(error).toMatchObject({ code, creditAuthority: false });
  return error as DepositInboxError;
}
function assertFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertFrozen(child);
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of runtimeFlags) vi.stubEnv(flag, undefined);
  ambientFetch = vi.fn(() => { throw new Error("Ambient network forbidden"); });
  vi.stubGlobal("fetch", ambientFetch);
});
afterEach(() => {
  expect(ambientFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("immutable development deposit admission", () => {
  it.each(["bsc", "tron"] as const)("captures %s attribution and exact frozen-observer context without custody or credit authority", family => {
    const value = fixture(family), admission = captureDepositInboxManifest(value.manifest);
    const resolved = resolveDepositInboxCandidate(admission, value.workerId, value.candidate);
    expect(resolved.context).toEqual(value.fixture.context);
    expect(resolved.context.chain).not.toHaveProperty("chainKey");
    expect(resolved).toMatchObject({ mode: "simulation-only", creditAuthority: false,
      assignment: { beneficiaryRef: "fixture-seller", purpose: "principal", admissionKind: "synthetic-fixture" },
      asset: { token: value.fixture.context.token }, manifestSha256: admission.manifestSha256,
      assignmentSha256: admission.assignmentHashes[value.assignmentId], sourceSetSha256: admission.sourceSetHashes[value.sourceSetId],
      workerSha256: admission.workerHashes[value.workerId] });
    expect(Object.values(admission.chainHashes)).toHaveLength(1);
    expect(admission.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(admission)).not.toContain("https://");
    assertFrozen(admission); assertFrozen(resolved);
  });

  it("captures all nested data before caller mutation and permits an explicit trusted recapture", () => {
    const value = fixture(), admission = captureDepositInboxManifest(value.manifest);
    const candidate = { ...value.candidate }, resolved = resolveDepositInboxCandidate(admission, value.workerId, candidate);
    value.manifest.assignments[0].beneficiaryRef = "changed-seller";
    value.manifest.assignments[0].recipient = `0x${"ff".repeat(20)}`;
    value.manifest.sourceSets[0].policy.maxAncestry = 0;
    value.manifest.workers[0].assignmentIds.length = 0;
    candidate.amountRaw = "1";
    expect(resolved.assignment.beneficiaryRef).toBe("fixture-seller");
    expect(resolved.context.recipient).toBe(value.fixture.context.recipient);
    expect(resolved.context.amountRaw).toBe(value.fixture.context.amountRaw);
    expect(resolved.policy.maxAncestry).toBe(64);
    expect(admission.manifest.workers[0].assignmentIds).toEqual([value.assignmentId]);
    expect(captureDepositInboxManifest(admission.manifest)).toEqual(admission);
  });

  it("canonicalizes record order, scope order, object keys, host case and native hex case", () => {
    const { manifest } = combined(), expected = captureDepositInboxManifest(manifest);
    const changed = structuredClone(manifest);
    for (const chain of changed.chains) chain.genesisHash = chain.genesisHash.slice(0, chain.family === "bsc" ? 2 : 0)
      + chain.genesisHash.slice(chain.family === "bsc" ? 2 : 0).toUpperCase();
    for (const asset of changed.assets) asset.token = asset.token.slice(0, 2) + asset.token.slice(2).toUpperCase();
    for (const assignment of changed.assignments) assignment.recipient = assignment.recipient.slice(0, 2) + assignment.recipient.slice(2).toUpperCase();
    for (const source of changed.sources) { source.host = source.host.toUpperCase(); source.endpointSha256 = source.endpointSha256.toUpperCase(); }
    for (const rows of [changed.chains, changed.assets, changed.sources, changed.sourceSets, changed.assignments, changed.workers]) rows.reverse();
    for (const worker of changed.workers) { worker.sourceSetIds.reverse(); worker.assignmentIds.reverse(); }
    expect(captureDepositInboxManifest(reverseKeys(changed))).toEqual(expected);
  });

  it("binds dependency hashes to asset metadata, assignment identity, pair policy and endpoint commitments", () => {
    const value = fixture(), original = captureDepositInboxManifest(value.manifest);
    const changes: Array<[keyof DepositInboxAdmission, (manifest: Manifest) => void]> = [
      ["assetHashes", manifest => { manifest.assets[0].decimals = 6; }],
      ["assignmentHashes", manifest => { manifest.assignments[0].beneficiaryRef = "another-seller"; }],
      ["sourceSetHashes", manifest => { manifest.sourceSets[0].policy.maxAncestry = 63; }],
      ["sourceHashes", manifest => { manifest.sources[0].endpointSha256 = "ab".repeat(32); }],
    ];
    for (const [field, change] of changes) {
      const next = structuredClone(value.manifest); change(next);
      const captured = captureDepositInboxManifest(next);
      expect(captured.manifestSha256).not.toBe(original.manifestSha256);
      expect(captured[field]).not.toEqual(original[field]);
      expect(captured.workerHashes).not.toEqual(original.workerHashes);
      expect(captured.chainHashes).toEqual(original.chainHashes);
    }
  });

  it("distinguishes principal and commission while never using an amount to select the beneficiary", () => {
    const value = fixture(); value.manifest.assignments[0].purpose = "commission";
    const admission = captureDepositInboxManifest(value.manifest);
    for (const amountRaw of ["1", UINT256]) {
      const resolved = resolveDepositInboxCandidate(admission, value.workerId, { ...value.candidate, amountRaw });
      expect(resolved.assignment).toMatchObject({ purpose: "commission", beneficiaryRef: "fixture-seller" });
      expect(resolved.context.amountRaw).toBe(amountRaw);
    }
  });

  it.each(["chains", "assets", "sources", "sourceSets", "assignments", "workers"] as const)("refuses duplicate %s IDs", field => {
    const value = fixture(); Object.assign(value.manifest, { [field]: [...value.manifest[field], value.manifest[field][0]] });
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it("refuses asset aliases after native-address normalization", () => {
    const value = fixture(); value.manifest.assets[0].token = `0x${"ab".repeat(20)}`;
    value.manifest.assets.push({ ...value.manifest.assets[0], assetRef: "other-label", token: `0x${"AB".repeat(20)}` });
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it("refuses two TRON network labels for the same native genesis", () => {
    const value = fixture("tron"), chain = value.manifest.chains[0];
    if (chain.family !== "tron") throw new Error("Expected TRON fixture");
    value.manifest.chains.push({ ...chain, network: "shasta", chainKey: `tron:shasta:${chain.genesisHash}` });
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it.each(["asset", "purpose", "beneficiary", "domain"] as const)("refuses assignment reuse of one normalized chain/address across %s changes", change => {
    const value = fixture(); value.manifest.assignments[0].recipient = `0x${"ab".repeat(20)}`;
    const other = { ...value.manifest.assignments[0], assignmentId: "second-assignment", recipient: `0x${"AB".repeat(20)}` };
    if (change === "asset") { value.manifest.assets.push({ ...value.manifest.assets[0], assetRef: "second-asset", token: `0x${"cc".repeat(20)}` }); other.assetRef = "second-asset"; }
    if (change === "purpose") other.purpose = "commission";
    if (change === "beneficiary") other.beneficiaryRef = "another-beneficiary";
    if (change === "domain") other.custodyDomainId = "another-domain";
    value.manifest.assignments.push(other);
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it.each(["id", "host", "group"] as const)("refuses a source pair sharing a declared %s", field => {
    const value = fixture();
    if (field === "id") value.manifest.sourceSets[0].finalitySourceId = value.manifest.sourceSets[0].executionSourceId;
    if (field === "host") value.manifest.sources[1].host = value.manifest.sources[0].host.toUpperCase();
    if (field === "group") value.manifest.sources[1].independenceGroup = value.manifest.sources[0].independenceGroup;
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it("refuses two source labels for the same committed endpoint", () => {
    const value = fixture(); value.manifest.sources[1].endpointSha256 = value.manifest.sources[0].endpointSha256.toUpperCase();
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it.each<[string, (manifest: Manifest) => void]>([
    ["asset chain", manifest => { manifest.assets[0].chainKey = "unknown-chain"; }],
    ["source-set chain", manifest => { manifest.sourceSets[0].chainKey = "unknown-chain"; }],
    ["execution source", manifest => { manifest.sourceSets[0].executionSourceId = "unknown-source"; }],
    ["finality source", manifest => { manifest.sourceSets[0].finalitySourceId = "unknown-source"; }],
    ["assignment asset", manifest => { manifest.assignments[0].assetRef = "unknown-asset"; }],
    ["worker assignment", manifest => { manifest.workers[0].assignmentIds = ["unknown-assignment"]; }],
    ["worker source set", manifest => { manifest.workers[0].sourceSetIds = ["unknown-source-set"]; }],
    ["duplicate scoped assignment", manifest => { manifest.workers[0].assignmentIds.push(manifest.workers[0].assignmentIds[0]); }],
    ["duplicate scoped source set", manifest => { manifest.workers[0].sourceSetIds.push(manifest.workers[0].sourceSetIds[0]); }],
  ])("refuses dangling or repeated %s references", (_label, change) => {
    const value = fixture(); change(value.manifest);
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
  });

  it("requires every worker's scoped source and assignment chains to be compatible", () => {
    const { bsc, tron, manifest } = combined();
    manifest.workers[0] = { workerId: "unusable", assignmentIds: [bsc.assignmentId], sourceSetIds: [tron.sourceSetId] };
    refused(() => captureDepositInboxManifest(manifest), "ADMISSION_REFUSED");
  });

  it.each(["chains", "assets", "sources", "sourceSets", "assignments", "workers"] as const)("enforces the %s collection bound before accepting records", field => {
    const value = fixture(), bounds = { chains: 2, assets: 4, sources: 8, sourceSets: 4, assignments: 64, workers: 16 };
    Object.assign(value.manifest, { [field]: Array.from({ length: bounds[field] + 1 }, () => structuredClone(value.manifest[field][0])) });
    refused(() => captureDepositInboxManifest(value.manifest));
  });

  it.each(["chains", "assets", "sources", "sourceSets", "assignments", "workers"] as const)("requires nonempty %s admission", field => {
    const value = fixture(); Object.assign(value.manifest, { [field]: [] });
    refused(() => captureDepositInboxManifest(value.manifest));
  });

  it("admits the maximum 64 distinct addresses and 16 worker scopes without losing exact identity", () => {
    const value = fixture();
    value.manifest.assignments = Array.from({ length: 64 }, (_, index) => ({ ...value.manifest.assignments[0],
      assignmentId: `assignment-${String(index).padStart(2, "0")}`, recipient: `0x${(index + 1).toString(16).padStart(40, "0")}` }));
    value.manifest.workers = Array.from({ length: 16 }, (_, index) => ({ workerId: `worker-${index}`,
      sourceSetIds: [value.sourceSetId], assignmentIds: value.manifest.assignments.map(item => item.assignmentId) }));
    const admission = captureDepositInboxManifest(value.manifest);
    expect(admission.manifest.assignments).toHaveLength(64); expect(admission.manifest.workers).toHaveLength(16);
    const selected = value.manifest.assignments[63];
    expect(resolveDepositInboxCandidate(admission, "worker-15", { ...value.candidate, assignmentId: selected.assignmentId }).context.recipient).toBe(selected.recipient);
  });

  it.each<[string, (manifest: Manifest) => void]>([
    ["top-level extension", manifest => { Object.assign(manifest, { endpoint: "https://private.fixture.invalid" }); }],
    ["operational source URL", manifest => { Object.assign(manifest.sources[0], { endpoint: "https://private.fixture.invalid" }); }],
    ["source credential", manifest => { Object.assign(manifest.sources[0], { apiKey: "sensitive-test-value" }); }],
    ["asset profile", manifest => { Object.assign(manifest.assets[0], { transferProfile: "arbitrary-token-v2" }); }],
    ["source profile", manifest => { Object.assign(manifest.sources[0], { responseProfile: "arbitrary-rpc-v2" }); }],
    ["custody proof flag", manifest => { Object.assign(manifest.assignments[0], { owned: true }); }],
    ["production admission", manifest => { Object.assign(manifest.assignments[0], { admissionKind: "production-custody" }); }],
    ["credit authority", manifest => { Object.assign(manifest, { creditAuthority: true }); }],
    ["profile version", manifest => { Object.assign(manifest, { formatVersion: 2 }); }],
    ["live mode", manifest => { Object.assign(manifest, { mode: "live" }); }],
    ["missing exact policy", manifest => { Reflect.deleteProperty(manifest.sourceSets[0].policy, "maxAncestry"); }],
    ["unknown policy field", manifest => { Object.assign(manifest.sourceSets[0].policy, { confirmations: 1 }); }],
  ])("refuses %s in the closed manifest", (_label, change) => {
    const value = fixture(); change(value.manifest);
    const error = refused(() => captureDepositInboxManifest(value.manifest));
    expect(error.message).not.toContain("sensitive-test-value"); expect(error.message).not.toContain("https://");
  });

  it.each(["", "x".repeat(101), "has space", "non-ascii-é", "constructor", "prototype", "__proto__"])("refuses unsupported identifier %s", inboxId => {
    const value = fixture(); value.manifest.inboxId = inboxId;
    refused(() => captureDepositInboxManifest(value.manifest));
  });

  it.each(["one-label", "127.0.0.1", "[::1]", "https://example.invalid", "example.invalid:443", "a..invalid", "-bad.invalid"])("refuses a non-normalizable admitted host %s", host => {
    const value = fixture(); value.manifest.sources[0].host = host;
    refused(() => captureDepositInboxManifest(value.manifest));
  });

  it.each<[string, unknown]>([["decimals", -1], ["decimals", 256], ["decimals", 1.5], ["decimals", -0],
    ["maxAncestry", -1], ["maxAncestry", 65], ["maxAncestry", "64"],
    ["maxCheckpointAgeMs", 0], ["maxCheckpointAgeMs", 600_001], ["maxFutureSkewMs", -1], ["maxFutureSkewMs", 30_001],
    ["maxFutureSkewMs", Number.NaN], ["maxFutureSkewMs", Infinity], ["maxFutureSkewMs", Number.MAX_SAFE_INTEGER + 1]])(
    "refuses out-of-profile numeric %s=%s", (key, value) => {
      const data = fixture(); Object.assign(key === "decimals" ? data.manifest.assets[0] : data.manifest.sourceSets[0].policy, { [key]: value });
      refused(() => captureDepositInboxManifest(data.manifest));
    });

  it("preserves explicit policy and descriptive decimal endpoints", () => {
    for (const decimals of [0, 255]) {
      const value = fixture(); value.manifest.assets[0].decimals = decimals;
      value.manifest.sourceSets[0].policy = { maxAncestry: 0, maxCheckpointAgeMs: 600_000, maxFutureSkewMs: 30_000 };
      expect(captureDepositInboxManifest(value.manifest).manifest.assets[0].decimals).toBe(decimals);
    }
  });
});

describe("native candidate binding", () => {
  it.each(["bsc", "tron"] as const)("preserves uint256 raw units and uint64 event indices exactly for %s", family => {
    const value = fixture(family), admission = captureDepositInboxManifest(value.manifest);
    const transactionId = family === "bsc" ? `0x${"AB".repeat(32)}` : "AB".repeat(32);
    const result = resolveDepositInboxCandidate(admission, value.workerId,
      { ...value.candidate, amountRaw: UINT256, eventIndex: UINT64, transactionId });
    expect(result.context).toMatchObject({ amountRaw: UINT256, eventIndex: UINT64, transactionId: transactionId.toLowerCase() });
  });

  it.each([0, 1, -1, "0", "-1", "01", "1.0", "1e3", " 1", "+1", "", (BigInt(UINT256) + BigInt(1)).toString(), "9".repeat(79)])(
    "refuses noncanonical or overflowing raw amount case %# (%s)", amountRaw => {
      const value = fixture(), admission = captureDepositInboxManifest(value.manifest);
      refused(() => resolveDepositInboxCandidate(admission, value.workerId, { ...value.candidate, amountRaw }));
    });

  it.each([0, -1, "-1", "00", "01", "1.0", "1e3", " 0", "+0", "", (BigInt(UINT64) + BigInt(1)).toString()])(
    "refuses noncanonical or overflowing event index case %# (%s)", eventIndex => {
      const value = fixture(), admission = captureDepositInboxManifest(value.manifest);
      refused(() => resolveDepositInboxCandidate(admission, value.workerId, { ...value.candidate, eventIndex }));
    });

  it.each(["recipient", "token", "beneficiaryRef", "purpose", "assetRef", "workerId", "creditAuthority", "context"])("refuses candidate attribution injection through %s", field => {
    const value = fixture(), admission = captureDepositInboxManifest(value.manifest);
    refused(() => resolveDepositInboxCandidate(admission, value.workerId, { ...value.candidate, [field]: "untrusted" }));
  });

  it.each(["assignment", "sourceSet", "worker", "cross-chain"] as const)("refuses %s scope escalation", attack => {
    const { manifest, bsc, tron } = combined(), admission = captureDepositInboxManifest(manifest);
    const candidate = { ...bsc.candidate };
    let worker = "bsc-only";
    if (attack === "assignment") candidate.assignmentId = tron.assignmentId;
    if (attack === "sourceSet") candidate.sourceSetId = tron.sourceSetId;
    if (attack === "worker") worker = "unadmitted-worker";
    if (attack === "cross-chain") { worker = "both-chains"; candidate.sourceSetId = tron.sourceSetId; }
    refused(() => resolveDepositInboxCandidate(admission, worker, candidate), "ADMISSION_REFUSED");
  });

  it.each(["bsc", "tron"] as const)("refuses other-family addresses, transactions and malformed genesis on %s", family => {
    const value = fixture(family), other = fixture(family === "bsc" ? "tron" : "bsc");
    const badToken = structuredClone(value.manifest); badToken.assets[0].token = other.fixture.context.token;
    refused(() => captureDepositInboxManifest(badToken));
    const badRecipient = structuredClone(value.manifest); badRecipient.assignments[0].recipient = other.fixture.context.recipient;
    refused(() => captureDepositInboxManifest(badRecipient));
    const badGenesis = structuredClone(value.manifest); badGenesis.chains[0].genesisHash = other.fixture.context.chain.genesisHash;
    refused(() => captureDepositInboxManifest(badGenesis));
    const admission = captureDepositInboxManifest(value.manifest);
    refused(() => resolveDepositInboxCandidate(admission, value.workerId, { ...value.candidate, transactionId: other.candidate.transactionId }));
  });

  it("refuses invented chain aliases and non-genesis TRON identifiers", () => {
    const value = fixture(); value.manifest.chains[0].chainKey = "bsc:fixture-alias";
    refused(() => captureDepositInboxManifest(value.manifest), "ADMISSION_REFUSED");
    const tron = fixture("tron"); tron.manifest.chains[0].genesisHash = "ab".repeat(32);
    refused(() => captureDepositInboxManifest(tron.manifest));
  });

  it("refuses serialized or forged admission lookalikes without reading their fields", () => {
    const value = fixture(), admission = captureDepositInboxManifest(value.manifest), getter = vi.fn(() => admission.manifest);
    refused(() => resolveDepositInboxCandidate(structuredClone(admission), value.workerId, value.candidate), "ADMISSION_REFUSED");
    const fake = Object.defineProperty({}, "manifest", { enumerable: true, get: getter });
    refused(() => resolveDepositInboxCandidate(fake as DepositInboxAdmission, value.workerId, value.candidate), "ADMISSION_REFUSED");
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("inert, bounded inputs and runtime refusal", () => {
  it.each(["top-level", "nested", "array-entry"] as const)("refuses %s getters without executing them", location => {
    const value = fixture(), getter = vi.fn(() => "sensitive-getter-value");
    const target = location === "top-level" ? value.manifest : location === "nested" ? value.manifest.assignments[0] : value.manifest.chains;
    Object.defineProperty(target, location === "top-level" ? "inboxId" : location === "nested" ? "recipient" : "0", { enumerable: true, configurable: true, get: getter });
    const error = refused(() => captureDepositInboxManifest(value.manifest));
    expect(getter).not.toHaveBeenCalled(); expect(error.message).not.toContain("sensitive-getter-value");
  });

  it.each(["manifest", "nested", "candidate", "admission", "workerId", "endpoint"] as const)("refuses a %s Proxy without invoking traps", location => {
    const value = fixture(), admission = captureDepositInboxManifest(value.manifest);
    const trap = vi.fn(() => { throw new Error("sensitive-proxy-value"); });
    const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    if (location === "manifest") refused(() => captureDepositInboxManifest(proxy));
    if (location === "nested") { Object.assign(value.manifest.assignments[0], { beneficiaryRef: proxy }); refused(() => captureDepositInboxManifest(value.manifest)); }
    if (location === "candidate") refused(() => resolveDepositInboxCandidate(admission, value.workerId, proxy));
    if (location === "admission") refused(() => resolveDepositInboxCandidate(proxy as DepositInboxAdmission, value.workerId, value.candidate), "ADMISSION_REFUSED");
    if (location === "workerId") refused(() => resolveDepositInboxCandidate(admission, proxy as unknown as string, value.candidate));
    if (location === "endpoint") refused(() => normalizeDepositInboxEndpoint(proxy));
    expect(trap).not.toHaveBeenCalled();
  });

  it.each(["symbol", "nonenumerable", "cycle", "sparse", "toJSON", "class"] as const)("refuses %s data instead of silently dropping it", kind => {
    const value = fixture(), callback = vi.fn(() => "sensitive-callback-value");
    if (kind === "symbol") Object.assign(value.manifest, { [Symbol("hidden")]: true });
    if (kind === "nonenumerable") Object.defineProperty(value.manifest, "hidden", { value: true });
    if (kind === "cycle") Object.assign(value.manifest, { loop: value.manifest });
    if (kind === "sparse") Reflect.deleteProperty(value.manifest.sources, "0");
    if (kind === "toJSON") Object.assign(value.manifest, { toJSON: callback });
    if (kind === "class") Object.setPrototypeOf(value.manifest, new (class UnsupportedRecord {})());
    refused(() => captureDepositInboxManifest(value.manifest)); expect(callback).not.toHaveBeenCalled();
  });

  it.each(["string", "depth", "nodes"] as const)("bounds untrusted %s structure before schema parsing", kind => {
    const value = fixture();
    if (kind === "string") Object.assign(value.manifest, { extra: "x".repeat(2049) });
    if (kind === "nodes") Object.assign(value.manifest, { extra: Array.from({ length: 8193 }, () => 0) });
    if (kind === "depth") { let extra: unknown = 0; for (let index = 0; index < 13; index++) extra = [extra]; Object.assign(value.manifest, { extra }); }
    refused(() => captureDepositInboxManifest(value.manifest), "RESOURCE_LIMIT");
  });

  it.each([...runtimeFlags, "NODE_ENV"])("rejects %s before touching untrusted inputs", flag => {
    const value = fixture(), admission = captureDepositInboxManifest(value.manifest), getter = vi.fn();
    const hostile = Object.defineProperty({}, "mode", { enumerable: true, get: getter });
    vi.stubEnv(flag, flag === "NODE_ENV" ? "production" : "true");
    refused(() => captureDepositInboxManifest(hostile), "RUNTIME_REFUSED");
    refused(() => resolveDepositInboxCandidate(admission, value.workerId, hostile), "RUNTIME_REFUSED");
    refused(() => normalizeDepositInboxEndpoint(hostile), "RUNTIME_REFUSED");
    expect(getter).not.toHaveBeenCalled();
  });

  it("requires an explicit local test or development environment", () => {
    const value = fixture(); vi.stubEnv("NODE_ENV", undefined);
    refused(() => captureDepositInboxManifest(value.manifest), "RUNTIME_REFUSED");
    vi.stubEnv("NODE_ENV", "development"); expect(captureDepositInboxManifest(value.manifest).manifest.mode).toBe("simulation-only");
  });
});

describe("normalized operational endpoint commitments", () => {
  it("commits the exact normalized URL.href with ordinary SHA-256", () => {
    const endpoint = "https://node.fixture.invalid/api/rpc", supplied = "https://NODE.FIXTURE.INVALID:443/api/old/../rpc";
    expect(normalizeDepositInboxEndpoint(supplied)).toEqual({ endpoint, host: "node.fixture.invalid",
      endpointSha256: createHash("sha256").update(endpoint).digest("hex") });
    expect(Object.isFrozen(normalizeDepositInboxEndpoint(supplied))).toBe(true);
    expect(normalizeDepositInboxEndpoint("https://node.fixture.invalid:8443/rpc").host).toBe("node.fixture.invalid");
  });

  it.each(["", "not-a-url", "http://node.fixture.invalid", "https://127.0.0.1/rpc", "https://[::1]/rpc",
    "https://localhost/rpc", "https://node.fixture.invalid?", "https://node.fixture.invalid#", "https://node.fixture.invalid?key=secret",
    "https://node.fixture.invalid#secret", "https://secret:password@node.fixture.invalid/rpc", "https://node.fixture.invalid/" + "x".repeat(2048),
    1, null, {}, new URL("https://node.fixture.invalid")])("refuses unsupported endpoint %s", endpoint => {
    const error = refused(() => normalizeDepositInboxEndpoint(endpoint));
    expect(error.message).not.toContain("password"); expect(error.message).not.toContain("secret");
  });
});
