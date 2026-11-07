// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR } from "../../../scripts/alpha-wallet/durable-fixtures";
import { walletDigest } from "./commands";
import { createTrustedPaymentFixture } from "./trusted-payment-fixture";
import {
  captureTrustedPaymentManifest, createDevelopmentTrustedPaymentReader, preparedTrustedPaymentEvidenceSchema,
  trustedPaymentDigest, verifyPreparedTrustedPaymentEvidence, type PreparedTrustedPaymentEvidenceV1,
  type TrustedPaymentManifestV1, type TrustedPaymentObservationV1,
} from "./trusted-payment-evidence";
import { v5Command } from "./v5-commands";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
type Fixture = ReturnType<typeof createTrustedPaymentFixture>;
const prepare = async (fixture: Fixture) => fixture.reader().prepare(fixture.request);
const archive = (fixture: Fixture, prepared: unknown) => verifyPreparedTrustedPaymentEvidence({ mode: "simulation-only", manifest: fixture.manifest, prepared });
function rehash(input: PreparedTrustedPaymentEvidenceV1) {
  const { preparationSha256: omitted, ...body } = input; void omitted;
  input.preparationSha256 = trustedPaymentDigest("preparation", body); return input;
}

describe("development fiat evidence derives exact retained claims", () => {
  it.each((["Bank Transfer", "Face-to-Face (Meet in Person)"] as const).flatMap(method =>
    (["tron-sim-usdt", "bsc-sim-binance-peg-usdt"] as const).map(assetId => ({ method, assetId }))))
    ("prepares $method for $assetId without changing money or granting release", async options => {
      const fixture = createTrustedPaymentFixture(options), before = walletDigest(fixture.wallet.state);
      const result = await prepare(fixture);
      expect(result).toMatchObject({ mode: "simulation-only", executionAuthority: false, releaseAuthority: false,
        assurance: "synthetic-source-consistency-only", eligibility: { eligibleForLaterVerification: true },
        observation: { payment: { amountMinor: fixture.observation.payment.amountMinor, recipientAccountId: "fixture-recipient-account" } } });
      expect(result.walletContext.amountMinor).toBe(fixture.observation.payment.amountMinor);
      expect(result.walletContext.paymentInstructionsDigest).toBe(fixture.observation.payment.paymentInstructionsDigest);
      expect(result.walletContext.destinationSha256).not.toBe(result.walletContext.paymentInstructionsDigest);
      expect(walletDigest(fixture.wallet.state)).toBe(before);
      expect(fixture.wallet.state.evidenceOwners.size).toBe(0);
      const trade = [...fixture.wallet.state.trades.values()][0]!;
      expect(trade.status).toBe("payment_reported"); expect(trade.evidence).toBeUndefined(); expect(trade.authorization).toBeUndefined();
      expect(preparedTrustedPaymentEvidenceSchema.safeParse(result).success).toBe(true);
      expect(archive(fixture, JSON.parse(JSON.stringify(result)))).toEqual(result);
    });

  it("source lookup cannot receive a caller's expected amount, recipient or buyer attachment", async () => {
    const fixture = createTrustedPaymentFixture(), queries: unknown[] = [];
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: query => {
      queries.push(query); expect(Object.isFrozen(query)).toBe(true); return fixture.observation;
    } });
    await reader.prepare(fixture.request);
    expect(queries).toEqual([{ sourceId: fixture.request.sourceId, authorityId: fixture.observation.authorityId, transactionId: fixture.request.transactionId }]);
    expect(JSON.stringify(queries)).not.toContain(fixture.observation.payment.amountMinor);
  });

  it("isolates all captured admission, observation and archive records from later mutation", async () => {
    const fixture = createTrustedPaymentFixture(), reader = fixture.reader();
    fixture.manifest.sources[0]!.enabled = false;
    const prepared = await reader.prepare(fixture.request);
    fixture.observation.payment.amountMinor = "1";
    expect(prepared.eligibility.sourceActive).toBe(true);
    expect(prepared.observation.payment.amountMinor).not.toBe("1");
    expect(Object.isFrozen(prepared)).toBe(true); expect(Object.isFrozen(prepared.observation.payment)).toBe(true);
    expect(Object.isFrozen(prepared.walletHistory[0]!.command_json)).toBe(true);
    expect(() => { prepared.observation.status = "reversed"; }).toThrow();
  });

  it("requires the exact full fiat total including the buyer fee, with no amount tolerance", async () => {
    for (const delta of [BigInt(-1), BigInt(1)]) {
      const fixture = createTrustedPaymentFixture();
      fixture.observation.payment.amountMinor = (BigInt(fixture.observation.payment.amountMinor) + delta).toString();
      await expect(prepare(fixture)).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
    }
  });

  it.each([
    ["request", (o: TrustedPaymentObservationV1) => { o.payment.platformRequestId = "other-request"; }],
    ["trade", (o: TrustedPaymentObservationV1) => { o.payment.platformTradeId = "other-trade"; }],
    ["buyer", (o: TrustedPaymentObservationV1) => { o.payment.buyerId = "other-buyer"; }],
    ["seller", (o: TrustedPaymentObservationV1) => { o.payment.sellerId = "other-seller"; }],
    ["recipient", (o: TrustedPaymentObservationV1) => { o.payment.recipientAccountId = "other-recipient-account"; }],
    ["instructions", (o: TrustedPaymentObservationV1) => { o.payment.paymentInstructionsDigest = "f".repeat(64); }],
    ["terms", (o: TrustedPaymentObservationV1) => { o.payment.termsDigest = "f".repeat(64); }],
    ["acceptance", (o: TrustedPaymentObservationV1) => { o.payment.acceptanceKey = "f".repeat(64); }],
    ["claim", (o: TrustedPaymentObservationV1) => { o.payment.claimKey = "f".repeat(64); }],
    ["method", (o: TrustedPaymentObservationV1) => { o.payment.paymentMethod = "Face-to-Face (Meet in Person)"; }],
  ] as const)("refuses substituted %s binding even when all other values match", async (_, mutate) => {
    const fixture = createTrustedPaymentFixture(), before = walletDigest(fixture.wallet.state); mutate(fixture.observation);
    await expect(prepare(fixture)).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
    expect(walletDigest(fixture.wallet.state)).toBe(before);
  });

  it("refuses buyer uploads, seller release clicks and owner assertions as independent evidence", async () => {
    const fixture = createTrustedPaymentFixture();
    for (const forged of [
      { ...fixture.wallet.state.initialPaymentClaimReceipts.values().next().value!.input.claim },
      { ...fixture.observation, kind: "seller_confirmed_funds" },
      { ...fixture.observation, kind: "owner_verified", trusted: true },
    ]) {
      const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: () => forged });
      await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "INVALID_OBSERVATION" });
    }
  });
});

describe("negative fiat evidence remains recordable", () => {
  it.each(["pending", "settled", "reversed", "revoked", "rejected"] as const)("retains %s evidence with no ledger authority", async status => {
    const fixture = createTrustedPaymentFixture({ status }), result = await prepare(fixture);
    expect(result.observation.status).toBe(status);
    expect(result.eligibility.sourceReportsSettled).toBe(status === "settled");
    expect(result.eligibility.eligibleForLaterVerification).toBe(status === "settled");
    expect(result.executionAuthority).toBe(false); expect(result.releaseAuthority).toBe(false);
    expect(archive(fixture, result)).toEqual(result);
  });

  it("a later reversal retains one native payment identity and immutable first facts", async () => {
    const fixture = createTrustedPaymentFixture(), first = await prepare(fixture);
    fixture.observation.status = "reversed"; fixture.observation.revision++;
    fixture.observation.observedAtMs = fixture.now(); fixture.setNow(fixture.now() + 1);
    const reversal = await prepare(fixture);
    expect(reversal.nativePaymentKey).toBe(first.nativePaymentKey);
    expect(reversal.paymentFactsSha256).toBe(first.paymentFactsSha256);
    expect(reversal.observationSha256).not.toBe(first.observationSha256);
    expect(reversal.eligibility.eligibleForLaterVerification).toBe(false);
    expect(first.observation.status).toBe("settled");
  });

  it("keeps stable identity from pending to settled while distinguishing observation revisions", async () => {
    const fixture = createTrustedPaymentFixture({ status: "pending" }), first = await prepare(fixture);
    fixture.observation.status = "settled"; fixture.observation.revision++;
    fixture.observation.settledAtMs = fixture.now(); fixture.observation.observedAtMs = fixture.now();
    const settled = await prepare(fixture);
    expect(settled.nativePaymentKey).toBe(first.nativePaymentKey);
    expect(settled.paymentFactsSha256).toBe(first.paymentFactsSha256);
    expect(settled.observationSha256).not.toBe(first.observationSha256);
  });

  it.each([
    ["pause", (f: Fixture) => { f.wallet.step(v5Command("pause", OPERATOR, "fiat-observe-paused", null)); }, "walletUnpaused"],
    ["expired source", (f: Fixture) => { f.manifest.sources[0]!.validUntilMs = f.now(); }, "sourceActive"],
    ["disabled source", (f: Fixture) => { f.manifest.sources[0]!.enabled = false; }, "sourceActive"],
    ["not-yet-valid source", (f: Fixture) => { f.manifest.sources[0]!.validFromMs = f.now() + 1; }, "sourceActive"],
    ["stale observation", (f: Fixture) => { f.setNow(f.observation.observedAtMs + f.manifest.sources[0]!.maxObservationAgeMs); }, "fresh"],
  ] as const)("records settled evidence under %s without marking it eligible", async (_, mutate, flag) => {
    const fixture = createTrustedPaymentFixture(); mutate(fixture);
    const result = await prepare(fixture);
    expect(result.eligibility[flag]).toBe(false); expect(result.eligibility.eligibleForLaterVerification).toBe(false);
    expect(result.observation.status).toBe("settled");
  });

  it("retains independent evidence for a disputed trade without clearing the dispute", async () => {
    const fixture = createTrustedPaymentFixture({ disputed: true }), before = walletDigest(fixture.wallet.state);
    const result = await prepare(fixture);
    expect(result.walletContext.disputed).toBe(true); expect(result.eligibility.undisputed).toBe(false);
    expect(result.eligibility.eligibleForLaterVerification).toBe(false); expect(walletDigest(fixture.wallet.state)).toBe(before);
  });

  it("archival consistency does not pretend an old eligibility result is current authority", async () => {
    const fixture = createTrustedPaymentFixture(), result = await prepare(fixture);
    fixture.setNow(fixture.now() + 120_000);
    expect(archive(fixture, result).eligibility.eligibleForLaterVerification).toBe(true);
    expect((await prepare(fixture)).eligibility.eligibleForLaterVerification).toBe(false);
    expect(result.executionAuthority).toBe(false); expect(result.releaseAuthority).toBe(false);
  });
});

describe("explicit source and recipient admission", () => {
  it.each([
    ["source ID", (m: TrustedPaymentManifestV1) => { m.sources.push(structuredClone(m.sources[0]!)); }],
    ["authority alias", (m: TrustedPaymentManifestV1) => { m.sources.push({ ...structuredClone(m.sources[0]!), sourceId: "another-source" }); }],
    ["recipient account", (m: TrustedPaymentManifestV1) => { m.sources[0]!.recipients.push({ ...m.sources[0]!.recipients[0]!, sellerId: "other-seller" }); }],
    ["recipient instruction alias", (m: TrustedPaymentManifestV1) => { m.sources[0]!.recipients.push({ ...m.sources[0]!.recipients[0]!, recipientAccountId: "other-account" }); }],
    ["invalid interval", (m: TrustedPaymentManifestV1) => { m.sources[0]!.validUntilMs = m.sources[0]!.validFromMs; }],
  ] as const)("refuses ambiguous %s admission", (_, mutate) => {
    const fixture = createTrustedPaymentFixture(); mutate(fixture.manifest);
    expect(() => captureTrustedPaymentManifest(fixture.manifest)).toThrow();
  });

  it.each(["seller", "buyer"] as const)("cannot admit the %s as independent payment evidence authority", async side => {
    const fixture = createTrustedPaymentFixture();
    fixture.manifest.sources[0]!.authorityId = side === "seller" ? fixture.observation.payment.sellerId : fixture.observation.payment.buyerId;
    fixture.observation.authorityId = fixture.manifest.sources[0]!.authorityId;
    await expect(prepare(fixture)).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
  });

  it("rejects a recorded operator relabeled as an independent source before its evidence callback runs", async () => {
    const fixture = createTrustedPaymentFixture();
    fixture.manifest.sources[0]!.authorityId = OPERATOR.id; fixture.observation.authorityId = OPERATOR.id;
    const source = vi.fn(() => fixture.observation);
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: source });
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
    expect(source).not.toHaveBeenCalled();
  });

  it("retains the complete sorted unique recorded-operator exclusion set without claiming provider independence", async () => {
    const fixture = createTrustedPaymentFixture();
    fixture.wallet.step(v5Command("pause", { kind: "operator", id: "z-fixture-operator" }, "operator-z-pause", null));
    fixture.wallet.step(v5Command("pause", { kind: "operator", id: "a-fixture-operator" }, "operator-a-pause", null));
    fixture.wallet.step(v5Command("pause", OPERATOR, "operator-repeated-pause", null));
    const result = await prepare(fixture);
    expect(result.walletContext.recordedOperatorIds).toEqual([OPERATOR.id, "z-fixture-operator", "a-fixture-operator"].sort());
    expect(result.assurance).toBe("synthetic-source-consistency-only"); expect(result.executionAuthority).toBe(false);
    for (const altered of [[], [...result.walletContext.recordedOperatorIds].reverse(), [...result.walletContext.recordedOperatorIds, OPERATOR.id]]) {
      const changed = structuredClone(result); changed.walletContext.recordedOperatorIds = altered;
      expect(() => archive(fixture, rehash(changed))).toThrow();
    }
  });

  it("does not fall back to another seller's current account or invoke its source", async () => {
    const fixture = createTrustedPaymentFixture(); fixture.manifest.sources[0]!.recipients[0]!.paymentInstructionsDigest = "f".repeat(64);
    const source = vi.fn(() => fixture.observation);
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: source });
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "ADMISSION_REFUSED" }); expect(source).not.toHaveBeenCalled();
  });

  it("cannot treat a bank source as an independent cash custodian", async () => {
    const fixture = createTrustedPaymentFixture({ method: "Face-to-Face (Meet in Person)" });
    fixture.manifest.sources[0]!.kind = "synthetic-bank-feed";
    await expect(prepare(fixture)).rejects.toMatchObject({ code: "ADMISSION_REFUSED" });
  });

  it("requires the lookup transaction, source and authority to match the returned record", async () => {
    for (const key of ["transactionId", "sourceId", "authorityId"] as const) {
      const fixture = createTrustedPaymentFixture(); fixture.observation[key] = "other-native-identity";
      await expect(prepare(fixture)).rejects.toMatchObject({ code: "INVALID_OBSERVATION" });
    }
  });
});

describe("retained history, time and archival integrity", () => {
  it("rejects a source read if the wallet pauses before the second retained read", async () => {
    const fixture = createTrustedPaymentFixture(), before = walletDigest(fixture.wallet.state);
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: () => {
      fixture.wallet.step(v5Command("pause", OPERATOR, "fiat-concurrent-pause", null)); return fixture.observation;
    } });
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "STALE_CHECKPOINT" });
    expect(walletDigest(fixture.wallet.state)).not.toBe(before);
    expect(fixture.wallet.state.evidenceOwners.size).toBe(0);
  });

  it("requires a real retained V5 claim rather than a caller-supplied verified flag or hash", async () => {
    const fixture = createTrustedPaymentFixture(); fixture.wallet.records.pop();
    await expect(prepare(fixture)).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
  });

  it("refuses damaged retained command history before calling the source", async () => {
    const fixture = createTrustedPaymentFixture(); fixture.wallet.records[0]!.event_hash = "f".repeat(64);
    const source = vi.fn(() => fixture.observation);
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: source });
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "INVALID_HISTORY" }); expect(source).not.toHaveBeenCalled();
  });

  it.each([
    ["pre-acceptance payment", (f: Fixture) => { f.observation.occurredAtMs = 1; }],
    ["future observation", (f: Fixture) => { f.observation.observedAtMs = f.now() + 1; }],
    ["settlement before receipt", (f: Fixture) => { f.observation.settledAtMs = f.observation.occurredAtMs - 1; }],
    ["settlement after observation", (f: Fixture) => { f.observation.settledAtMs = f.observation.observedAtMs + 1; }],
    ["settled without time", (f: Fixture) => { f.observation.settledAtMs = null; }],
    ["pending with settlement time", (f: Fixture) => { f.observation.status = "pending"; }],
    ["reversed without prior settlement", (f: Fixture) => { f.observation.status = "reversed"; f.observation.settledAtMs = null; }],
  ] as const)("refuses impossible %s chronology", async (_, mutate) => {
    const fixture = createTrustedPaymentFixture(); mutate(fixture);
    await expect(prepare(fixture)).rejects.toMatchObject({ code: "INVALID_OBSERVATION" });
  });

  it("rejects backwards or excessively old preparation clocks", async () => {
    for (const delta of [-1, 30_000]) {
      const fixture = createTrustedPaymentFixture(); let calls = 0;
      const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), clock: () => fixture.now() + (calls++ === 0 ? 0 : delta) });
      await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "TIMEOUT" });
    }
  });

  it("supports ordinary asynchronous fixture adapters", async () => {
    const fixture = createTrustedPaymentFixture();
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(),
      readWalletHistory: async () => fixture.wallet.records, readEvidence: async () => fixture.observation });
    expect((await reader.prepare(fixture.request)).eligibility.eligibleForLaterVerification).toBe(true);
  });

  it("times out a source that never returns and produces no partially prepared result", async () => {
    const fixture = createTrustedPaymentFixture(), before = walletDigest(fixture.wallet.state);
    vi.useFakeTimers();
    const source = vi.fn(() => new Promise<unknown>(() => {}));
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: source });
    const outcome = expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30_001); await outcome;
    expect(source).toHaveBeenCalledTimes(1); expect(walletDigest(fixture.wallet.state)).toBe(before);
  });

  it.each([
    ["eligible flag", (p: PreparedTrustedPaymentEvidenceV1) => { p.eligibility.eligibleForLaterVerification = false; }],
    ["reservation", (p: PreparedTrustedPaymentEvidenceV1) => { p.walletContext.principalRaw = "1"; }],
    ["claim digest", (p: PreparedTrustedPaymentEvidenceV1) => { p.walletContext.claimReceiptSha256 = "f".repeat(64); }],
    ["recipient commitment", (p: PreparedTrustedPaymentEvidenceV1) => { p.walletContext.paymentInstructionsDigest = "f".repeat(64); }],
    ["native identity", (p: PreparedTrustedPaymentEvidenceV1) => { p.nativePaymentKey = "f".repeat(64); }],
    ["source evidence hash", (p: PreparedTrustedPaymentEvidenceV1) => { p.observationSha256 = "f".repeat(64); }],
    ["immutable first facts", (p: PreparedTrustedPaymentEvidenceV1) => { p.paymentFactsSha256 = "f".repeat(64); }],
    ["checkpoint", (p: PreparedTrustedPaymentEvidenceV1) => { p.walletContext.checkpoint.revision++; }],
  ] as const)("replays and refuses altered %s even after recomputing the outer digest", async (_, mutate) => {
    const fixture = createTrustedPaymentFixture(), input = structuredClone(await prepare(fixture)); mutate(input); rehash(input);
    expect(() => archive(fixture, input)).toThrow();
  });
});

describe("fiat evidence input and runtime boundary", () => {
  it("never invokes getters, thenables or proxy traps in provider data", async () => {
    const fixture = createTrustedPaymentFixture(); let calls = 0;
    const accessor = { ...fixture.observation };
    Object.defineProperty(accessor, "status", { enumerable: true, get() { calls++; return "settled"; } });
    const thenable = Object.defineProperty({}, "then", { enumerable: true, get() { calls++; throw new Error("private-bank-secret"); } });
    const proxy = new Proxy({}, { get() { calls++; throw new Error("private-bank-secret"); }, getPrototypeOf() { calls++; throw new Error("private-bank-secret"); }, ownKeys() { calls++; throw new Error("private-bank-secret"); } });
    for (const evidence of [accessor, thenable, proxy]) {
      const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: () => evidence });
      await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(calls).toBe(0);
  });

  it("captures options without executing caller accessors", () => {
    const fixture = createTrustedPaymentFixture(); let called = false;
    const input = fixture.readerOptions(); Object.defineProperty(input, "manifest", { get() { called = true; return fixture.manifest; } });
    expect(() => createDevelopmentTrustedPaymentReader(input)).toThrow(); expect(called).toBe(false);
  });

  it("sanitizes synchronous and asynchronous provider errors, including thrown proxies", async () => {
    const fixture = createTrustedPaymentFixture(), sourceError = new Proxy({}, { getPrototypeOf() { throw new Error("private-bank-secret"); } });
    for (const callback of [() => { throw sourceError; }, async () => { throw new Error("private-bank-secret"); }]) {
      const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: callback });
      await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "SOURCE_FAILURE", message: "Fiat fixture evidence adapter failed" });
    }
  });

  it("refuses missing, unexpected and noncanonical fields instead of coercing evidence", async () => {
    const fixture = createTrustedPaymentFixture();
    for (const observation of [
      { ...fixture.observation, revision: "1" }, { ...fixture.observation, revision: 0 },
      { ...fixture.observation, observedAtMs: NaN }, { ...fixture.observation, privateAccountNumber: "private-bank-secret" },
      { ...fixture.observation, payment: { ...fixture.observation.payment, amountMinor: "01" } },
      { ...fixture.observation, payment: { ...fixture.observation.payment, currency: "USD" } },
    ]) {
      const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: () => observation });
      await expect(reader.prepare(fixture.request)).rejects.toThrow();
    }
    const reader = fixture.reader();
    await expect(reader.prepare({ ...fixture.request, amountMinor: "1" } as typeof fixture.request)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("enforces finite input bounds before replay or source execution", async () => {
    const fixture = createTrustedPaymentFixture(), source = vi.fn(() => fixture.observation);
    const history = Array.from({ length: 257 }, () => fixture.wallet.records[0]!);
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readWalletHistory: () => history, readEvidence: source });
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "INVALID_HISTORY" }); expect(source).not.toHaveBeenCalled();
    const huge = { ...fixture.observation, transactionId: "x".repeat(32_769) };
    await expect(createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: () => huge }).prepare(fixture.request))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a runtime switch while an independent source read is in progress", async () => {
    const fixture = createTrustedPaymentFixture();
    const reader = createDevelopmentTrustedPaymentReader({ ...fixture.readerOptions(), readEvidence: () => {
      vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1"); return fixture.observation;
    } });
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "RUNTIME_REFUSED" });
  });

  it.each(["NODE_ENV", "VERCEL", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])("refuses unsafe runtime %s", async variable => {
    const fixture = createTrustedPaymentFixture(), reader = fixture.reader();
    vi.stubEnv(variable, variable === "NODE_ENV" ? "production" : "1");
    expect(() => createDevelopmentTrustedPaymentReader(fixture.readerOptions())).toThrow();
    await expect(reader.prepare(fixture.request)).rejects.toMatchObject({ code: "RUNTIME_REFUSED" });
  });
});
