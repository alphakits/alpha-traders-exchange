// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walletDigest } from "./commands";
import { createTrustedPaymentFixture } from "./trusted-payment-fixture";
import { appendTrustedPaymentJournal, createTrustedPaymentJournalArchive, createTrustedPaymentJournalBackup,
  findTrustedPaymentJournalReceipt, restoreTrustedPaymentJournalArchive, trustedPaymentJournalCommandDigest,
  verifyTrustedPaymentJournalArchive, verifyTrustedPaymentJournalBackup, type TrustedPaymentJournalArchive } from "./trusted-payment-journal-model";

const MODE = "simulation-only" as const;
function runtime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])
    vi.stubEnv(key, undefined);
}
beforeEach(runtime);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function setup(options: Parameters<typeof createTrustedPaymentFixture>[0] = {}) {
  const fixture = createTrustedPaymentFixture(options), prepared = await fixture.reader().prepare(fixture.request);
  const initial = createTrustedPaymentJournalArchive({ mode: MODE, manifest: fixture.manifest, sourceStoreId: "original-source", atMs: fixture.now() });
  const command = { type: "record" as const, operationId: "first-observation", prepared };
  const first = appendTrustedPaymentJournal(initial, command, fixture.now());
  return { fixture, initial, command, first };
}
async function next(value: Awaited<ReturnType<typeof setup>>, operationId: string, archive = value.first.archive) {
  value.fixture.setNow(value.fixture.now() + 1);
  const prepared = await value.fixture.reader().prepare(value.fixture.request);
  return appendTrustedPaymentJournal(archive, { type: "record", operationId, prepared }, value.fixture.now());
}
function pause(archive: TrustedPaymentJournalArchive, atMs: number) {
  return appendTrustedPaymentJournal(archive, { type: "pause", operationId: "stop-source", reasonCode: "maintenance" }, atMs);
}
function reseal(value: TrustedPaymentJournalArchive) {
  const { archiveSha256: _old, ...body } = value; void _old; value.archiveSha256 = walletDigest(body); return value;
}

describe("retained development fiat evidence journal", () => {
  it.each([
    ["Bank Transfer", "tron-sim-usdt"], ["Bank Transfer", "bsc-sim-binance-peg-usdt"],
    ["Face-to-Face (Meet in Person)", "tron-sim-usdt"], ["Face-to-Face (Meet in Person)", "bsc-sim-binance-peg-usdt"],
  ] as const)("retains exact %s evidence for %s without granting financial authority", async (method, assetId) => {
    const { initial, first, command } = await setup({ method, assetId });
    expect(initial.checkpoint.revision).toBe(0);
    expect(first.receipt).toMatchObject({ revision: 1, disposition: "recorded", executionAuthority: false, releaseAuthority: false });
    expect(first.archive.state.payments[0]).toMatchObject({ nativePaymentKey: command.prepared.nativePaymentKey,
      platformRequestId: command.prepared.walletContext.platformRequestId, latestSourceRevision: 1 });
    expect(verifyTrustedPaymentJournalArchive(JSON.parse(JSON.stringify(first.archive)))).toEqual(first.archive);
    expect(first.archive.records[0].command).toEqual(command);
    expect(Object.isFrozen(first.archive.state.payments[0].revisions)).toBe(true);
    expect(first.archive).not.toHaveProperty("accounts"); expect(first.archive).not.toHaveProperty("payouts");
  });

  it("recovers an original receipt after pause without confusing that historical result with current eligibility", async () => {
    const { first, command, fixture } = await setup();
    const stopped = pause(first.archive, fixture.now() + 1);
    const retry = appendTrustedPaymentJournal(stopped.archive, command, fixture.now() + 86_400_000);
    expect(retry).toEqual({ archive: stopped.archive, receipt: first.receipt, replayed: true });
    expect(retry.receipt.status).toBe("recording"); expect(retry.archive.state.status).toBe("paused");
    expect(findTrustedPaymentJournalReceipt(stopped.archive, { operationId: command.operationId, inputHash: trustedPaymentJournalCommandDigest(command) })).toEqual(first.receipt);
    expect(() => appendTrustedPaymentJournal(stopped.archive, { ...command, operationId: "new-after-pause" }, fixture.now() + 2)).toThrow(/stopped/i);
  });

  it("records matching corroboration without assigning the same native payment twice", async () => {
    const value = await setup(), second = await next(value, "another-delivery");
    expect(second.receipt.disposition).toBe("corroborated");
    expect(second.archive.state.payments).toHaveLength(1); expect(second.archive.state.payments[0].revisions).toHaveLength(1);
    expect(second.archive.records).toHaveLength(2);
  });

  it("keeps a new valid preparation under an existing operation identity as an immutable conflict", async () => {
    const value = await setup(), conflict = await next(value, value.command.operationId);
    expect(conflict.receipt.disposition).toBe("operation-conflict-quarantined");
    expect(conflict.archive.records[0]).toEqual(value.first.archive.records[0]);
    expect(conflict.archive.state.status).toBe("quarantined");
    const retry = appendTrustedPaymentJournal(conflict.archive, conflict.archive.records[1].command, value.fixture.now() + 1);
    expect(retry.receipt).toEqual(conflict.receipt); expect(retry.replayed).toBe(true);
    expect(appendTrustedPaymentJournal(conflict.archive, value.command, value.fixture.now() + 1).receipt).toEqual(value.first.receipt);
  });

  it("quarantines changed first payment facts even when a new preparation is self-consistent", async () => {
    const value = await setup(); value.fixture.observation.occurredAtMs += 1;
    const changed = await next(value, "changed-native-payment");
    expect(changed.receipt.disposition).toBe("payment-conflict-quarantined");
    expect(changed.archive.state.payments).toEqual(value.first.archive.state.payments);
    expect(changed.archive.records[1].command.type).toBe("record");
  });

  it("quarantines reuse of one native payment across independently replayable but different accepted terms", async () => {
    const original = await setup({ amount: "200" }), alternate = createTrustedPaymentFixture({ amount: "201" });
    // Both preparations come from actual complete V1–V5 histories and validate independently.
    // Matching manifest/native identity must still not reassign the first payment's immutable claim facts.
    const prepared = await alternate.reader().prepare(alternate.request);
    expect(prepared.manifestSha256).toBe(original.command.prepared.manifestSha256);
    expect(prepared.nativePaymentKey).toBe(original.command.prepared.nativePaymentKey);
    expect(prepared.walletContext.termsDigest).not.toBe(original.command.prepared.walletContext.termsDigest);
    expect(prepared.walletContext.claimReceiptSha256).not.toBe(original.command.prepared.walletContext.claimReceiptSha256);
    expect(prepared.paymentFactsSha256).not.toBe(original.command.prepared.paymentFactsSha256);
    const conflict = appendTrustedPaymentJournal(original.first.archive,
      { type: "record", operationId: "alternate-coherent-claim", prepared }, alternate.now());
    expect(conflict.receipt.disposition).toBe("payment-conflict-quarantined");
    expect(conflict.archive.state.status).toBe("quarantined");
    expect(conflict.archive.state.payments).toEqual(original.first.archive.state.payments);
    expect(conflict.archive.records[0]).toEqual(original.first.archive.records[0]);
    expect(conflict.archive.records[1].command).toMatchObject({ prepared: { walletContext: { principalRaw: prepared.walletContext.principalRaw } } });
  });

  it("quarantines contradictory source bytes at the same source revision", async () => {
    const value = await setup(); value.fixture.observation.observedAtMs += 1;
    const changed = await next(value, "same-revision-different-evidence");
    expect(changed.receipt.disposition).toBe("revision-conflict-quarantined");
    expect(changed.archive.state.payments[0].latestSourceRevision).toBe(1);
  });

  it("advances pending to settled only under the next immutable source revision", async () => {
    const value = await setup({ status: "pending" });
    value.fixture.observation.revision = 2; value.fixture.observation.status = "settled";
    value.fixture.observation.settledAtMs = value.fixture.now() - 1;
    const settled = await next(value, "source-settled");
    expect(settled.receipt.disposition).toBe("recorded");
    expect(settled.archive.state.payments[0].revisions.map(row => row.status)).toEqual(["pending", "settled"]);
    expect(settled.receipt.releaseAuthority).toBe(false);
    const stale = appendTrustedPaymentJournal(settled.archive, { ...value.command, operationId: "old-source-redelivery" }, value.fixture.now());
    expect(stale.receipt.disposition).toBe("stale-corroboration");
    expect(stale.archive.state.payments[0].latestSourceRevision).toBe(2);
  });

  it.each(["reversed", "revoked", "rejected"] as const)("retains a first %s observation and stops future recording", async sourceStatus => {
    const value = await setup({ status: sourceStatus });
    expect(value.first.archive.state.status).toBe("quarantined");
    expect(value.first.archive.state.payments[0].revisions[0].status).toBe(sourceStatus);
    expect(value.first.archive.records[0].command).toEqual(value.command);
    expect(() => appendTrustedPaymentJournal(value.first.archive, { ...value.command, operationId: "cannot-resume" }, value.fixture.now())).toThrow(/stopped/i);
  });

  it.each(["reversed", "revoked"] as const)("retains a later %s event without deleting or reassigning the original credit", async sourceStatus => {
    const value = await setup(); value.fixture.observation.revision = 2; value.fixture.observation.status = sourceStatus;
    const stopped = await next(value, "adverse-source-event");
    expect(stopped.archive.state.status).toBe("quarantined");
    expect(stopped.archive.state.payments[0].revisions.map(row => row.status)).toEqual(["settled", sourceStatus]);
    expect(stopped.archive.records[0]).toEqual(value.first.archive.records[0]);
    expect(appendTrustedPaymentJournal(stopped.archive, value.command, value.fixture.now()).receipt).toEqual(value.first.receipt);
  });

  it("refuses to skip unobserved native revisions or start after an unseen revocation", async () => {
    const value = await setup(); value.fixture.observation.revision = 3;
    expect((await next(value, "skipped-source-revision")).receipt.disposition).toBe("revision-gap-quarantined");
    value.fixture.observation.transactionId = "another-native-payment";
    const freshPrepared = await value.fixture.reader().prepare({ ...value.fixture.request, transactionId: value.fixture.observation.transactionId });
    const gap = appendTrustedPaymentJournal(value.initial, { type: "record", operationId: "first-at-three", prepared: freshPrepared }, value.fixture.now());
    expect(gap.receipt.disposition).toBe("revision-gap-quarantined"); expect(gap.archive.state.payments).toHaveLength(0);
  });

  it.each(["settlement-time", "observed-clock", "settled-to-pending"] as const)("retains and quarantines source regression: %s", async mutation => {
    const value = await setup(); value.fixture.observation.revision = 2;
    if (mutation === "settlement-time") value.fixture.observation.settledAtMs! += 1;
    if (mutation === "observed-clock") value.fixture.observation.observedAtMs -= 1;
    if (mutation === "settled-to-pending") { value.fixture.observation.status = "pending"; value.fixture.observation.settledAtMs = null; }
    const stopped = await next(value, "regressive-source");
    expect(stopped.receipt.disposition).toBe("status-regression-quarantined");
    expect(stopped.archive.records).toHaveLength(2); expect(stopped.archive.state.payments[0].latestSourceRevision).toBe(1);
  });

  it("records stale or disputed historical evidence without inventing a live eligibility result", async () => {
    const value = await setup({ disputed: true });
    expect(value.command.prepared.eligibility.eligibleForLaterVerification).toBe(false);
    expect(value.first.receipt).not.toHaveProperty("eligibleForLaterVerification");
    value.fixture.setNow(value.fixture.now() + 100_000);
    const stale = await next(value, "stale-corroboration");
    expect(stale.receipt.disposition).toBe("corroborated");
    expect(stale.archive.records[1].command).toMatchObject({ prepared: { eligibility: { fresh: false, undisputed: false } } });
  });

  it("rejects prepared evidence tampering and executable input before an immutable record exists", async () => {
    const value = await setup(), changed = structuredClone(value.command);
    changed.prepared.observation.payment.amountMinor = "1";
    expect(() => appendTrustedPaymentJournal(value.initial, changed, value.fixture.now())).toThrow();
    let invoked = false;
    const executable = { type: "pause", operationId: "bad", get reasonCode() { invoked = true; return "maintenance"; } };
    expect(() => appendTrustedPaymentJournal(value.initial, executable, value.fixture.now())).toThrow(); expect(invoked).toBe(false);
    expect(value.initial.records).toHaveLength(0);
  });

  it("refuses new records before their preparation time and clocks before durable history", async () => {
    const value = await setup();
    expect(() => appendTrustedPaymentJournal(value.initial, value.command, value.fixture.now() - 1)).toThrow(/clock|future/i);
    expect(() => pause(value.first.archive, value.fixture.now() - 1)).toThrow(/clock/i);
  });

  it.each(["head", "projection", "receipt", "event", "duplicate", "omission", "admission"] as const)("rejects recomputed outer archive tampering: %s", async part => {
    const value = await setup(), changed = structuredClone(value.first.archive);
    if (part === "head") changed.checkpoint.revision = 0;
    if (part === "projection") changed.state.payments = [];
    if (part === "receipt") changed.records[0].receipt.releaseAuthority = true as false;
    if (part === "event") changed.records[0].eventHash = "e".repeat(64);
    if (part === "duplicate") changed.records.push(structuredClone(changed.records[0]));
    if (part === "omission") changed.records = [];
    if (part === "admission") changed.bootstrap.manifest.sources[0].enabled = false;
    expect(() => verifyTrustedPaymentJournalArchive(reseal(changed))).toThrow();
  });

  it("exports only a stopped original and restores exact history into permanent quarantine", async () => {
    const value = await setup(); expect(() => createTrustedPaymentJournalBackup(value.first.archive, value.fixture.now())).toThrow(/stopped/i);
    const stopped = pause(value.first.archive, value.fixture.now() + 1).archive;
    const backup = createTrustedPaymentJournalBackup(stopped, value.fixture.now() + 2);
    expect(verifyTrustedPaymentJournalBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
    const restored = restoreTrustedPaymentJournalArchive({ backup, operationId: "restore", targetStoreId: "fresh-target", atMs: value.fixture.now() + 3 });
    expect(restored.records.slice(0, stopped.records.length)).toEqual(stopped.records);
    expect(restored.state).toMatchObject({ status: "quarantined", haltReason: "restored-copy", restoredTargetStoreId: "fresh-target" });
    expect(verifyTrustedPaymentJournalArchive(restored)).toEqual(restored);
    expect(appendTrustedPaymentJournal(restored, value.command, value.fixture.now() + 4).receipt).toEqual(value.first.receipt);
    expect(() => appendTrustedPaymentJournal(restored, { ...value.command, operationId: "resume" }, value.fixture.now() + 4)).toThrow(/stopped/i);
    expect(() => createTrustedPaymentJournalBackup(restored, value.fixture.now() + 4)).toThrow(/original source/i);
    expect(restored).not.toHaveProperty("sourceHasNoLaterCommands");
  });

  it("rejects same-source restore, transport identity collision and a stale restore clock", async () => {
    const value = await setup(), stopped = pause(value.first.archive, value.fixture.now() + 1).archive;
    const backup = createTrustedPaymentJournalBackup(stopped, value.fixture.now() + 2);
    const options = { backup, operationId: "restore", targetStoreId: "target", atMs: value.fixture.now() + 3 };
    expect(() => restoreTrustedPaymentJournalArchive({ ...options, targetStoreId: stopped.bootstrap.sourceStoreId })).toThrow();
    expect(() => restoreTrustedPaymentJournalArchive({ ...options, operationId: value.command.operationId })).toThrow(/collides/i);
    expect(() => restoreTrustedPaymentJournalArchive({ ...options, atMs: value.fixture.now() + 1 })).toThrow();
    const changed = structuredClone(backup); changed.backupSha256 = "a".repeat(64);
    expect(() => restoreTrustedPaymentJournalArchive({ ...options, backup: changed })).toThrow();
  });

  it("reaches the real evidence growth bound with enough space left to stop, back up and quarantine a restore", async () => {
    const value = await setup(); let archive = value.first.archive, boundReached = false;
    for (let ordinal = 2; ordinal <= 130; ordinal++) {
      try {
        archive = appendTrustedPaymentJournal(archive, { ...value.command, operationId: `delivery-${ordinal}` }, value.fixture.now()).archive;
      } catch (error) {
        expect(error).toMatchObject({ code: "RESOURCE_LIMIT" }); boundReached = true; break;
      }
    }
    expect(boundReached).toBe(true); expect(archive.state.status).toBe("recording");
    expect(archive.records.length).toBeGreaterThan(2); expect(archive.records.length).toBeLessThanOrEqual(126);
    const stopped = pause(archive, value.fixture.now() + 1).archive;
    const backup = createTrustedPaymentJournalBackup(stopped, value.fixture.now() + 2);
    const restored = restoreTrustedPaymentJournalArchive({ backup, operationId: "capacity-restore", targetStoreId: "capacity-target", atMs: value.fixture.now() + 3 });
    expect(restored.state.status).toBe("quarantined");
    expect(restored.records.slice(0, stopped.records.length)).toEqual(stopped.records);
    expect(verifyTrustedPaymentJournalArchive(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
  }, 120_000);

  it("refuses production and signing runtimes even for historical inspection", async () => {
    const value = await setup(); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1");
    expect(() => verifyTrustedPaymentJournalArchive(value.first.archive)).toThrow(/simulation/i);
    expect(() => trustedPaymentJournalCommandDigest(value.command)).toThrow(/simulation/i);
  });
});
