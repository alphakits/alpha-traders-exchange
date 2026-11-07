// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, OPERATOR } from "../../../scripts/alpha-wallet/durable-fixtures";
import { v5FixtureDisputeInput } from "../../../scripts/alpha-wallet/v5-durable-fixtures";
import { walletDigest } from "./commands";
import { createTrustedPaymentFixture } from "./trusted-payment-fixture";
import { appendTrustedPaymentJournal, createTrustedPaymentJournalArchive } from "./trusted-payment-journal-model";
import { v5Command } from "./v5-commands";
import { appendReleaseConsent, createReleaseConsentArchive, createReleaseConsentBackup, findReleaseConsentReceipt,
  inspectReleaseConsent, releaseConsentCommandDigest, releaseConsentCurrentBasisFromHistory, restoreReleaseConsentArchive,
  verifyReleaseConsentArchive, verifyReleaseConsentBackup, type ReleaseConsentArchive, type ReleaseConsentCurrentBasis } from "./release-consent-model";

const MODE = "simulation-only" as const, OWNER = "enrolling-owner", CANONICAL = "c".repeat(64);
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])
    vi.stubEnv(key, undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function current(fixture: ReturnType<typeof createTrustedPaymentFixture>, canonicalBasisSha256 = CANONICAL): ReleaseConsentCurrentBasis {
  return releaseConsentCurrentBasisFromHistory({ requestId: fixture.request.requestId, walletHistory: fixture.wallet.records, canonicalBasisSha256 });
}
async function setup(options: Parameters<typeof createTrustedPaymentFixture>[0] = {}, configure?: (fixture: ReturnType<typeof createTrustedPaymentFixture>) => void) {
  const fixture = createTrustedPaymentFixture(options); configure?.(fixture);
  const prepared = await fixture.reader().prepare(fixture.request), basis = current(fixture);
  const input = { mode: MODE, manifest: fixture.manifest, sourceStoreId: "physical-source", enrollingOwnerId: OWNER,
    enrollmentOperationId: "enroll", prepared, currentBasis: basis, atMs: fixture.now() };
  const archive = createReleaseConsentArchive(input);
  return { fixture, prepared, basis, input, archive, seller: prepared.walletContext.sellerId };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function grant(value: Fixture, archive = value.archive, operationId = "seller-consent", basis = current(value.fixture), sessionExpiresAtMs = value.fixture.now() + 100_000) {
  const inspection = inspectReleaseConsent(archive, basis, value.fixture.now());
  const command = { type: "consent" as const, operationId, actorUserId: value.seller,
    reviewedBasisSha256: inspection.reviewedBasisSha256!, sessionExpiresAtMs };
  return { ...appendReleaseConsent(archive, command, basis, value.fixture.now()), command };
}
async function observe(value: Fixture, archive = value.archive, operationId = "source-observation") {
  value.fixture.setNow(Math.max(value.fixture.now() + 1, value.fixture.wallet.at + 100));
  const prepared = await value.fixture.reader().prepare(value.fixture.request), basis = current(value.fixture);
  const command = { type: "observe" as const, operationId, actorUserId: OWNER, prepared };
  return { ...appendReleaseConsent(archive, command, basis, value.fixture.now()), command, basis };
}
function pause(value: Fixture, archive: ReleaseConsentArchive, operationId = "pause") {
  const command = { type: "pause" as const, operationId, actorUserId: OWNER, reasonCode: "maintenance" as const };
  return { ...appendReleaseConsent(archive, command, current(value.fixture), value.fixture.now()), command };
}
function revoke(value: Fixture, archive: ReleaseConsentArchive, consentOperationId = "seller-consent", operationId = "withdraw-consent") {
  const command = { type: "revoke" as const, operationId, actorUserId: value.seller, consentOperationId };
  return { ...appendReleaseConsent(archive, command, current(value.fixture), value.fixture.now()), command };
}
function reseal(archive: ReleaseConsentArchive) {
  const { archiveSha256: _old, ...body } = archive; void _old;
  archive.archiveSha256 = walletDigest(body); return archive;
}

describe("revocable development release consent model", () => {
  it.each([
    ["Bank Transfer", "tron-sim-usdt"], ["Bank Transfer", "bsc-sim-binance-peg-usdt"],
    ["Face-to-Face (Meet in Person)", "tron-sim-usdt"], ["Face-to-Face (Meet in Person)", "bsc-sim-binance-peg-usdt"],
  ] as const)("retains exact %s/%s seller consent without changing the full V5 financial state", async (method, assetId) => {
    const value = await setup({ method, assetId }), originalStateHash = walletDigest(value.fixture.wallet.state);
    const before = inspectReleaseConsent(value.archive, value.basis, value.fixture.now());
    expect(before).toMatchObject({ canConsent: true, currentPreconditionsMatch: false, executionAuthority: false, releaseAuthority: false });
    expect(before.reasons).toEqual(["no-seller-consent"]);
    const accepted = grant(value), inspection = inspectReleaseConsent(accepted.archive, value.basis, value.fixture.now());
    expect(accepted.receipt).toMatchObject({ commandType: "consent", actorUserId: value.seller, disposition: "consented",
      executionAuthority: false, releaseAuthority: false });
    expect(inspection).toMatchObject({ canConsent: true, currentPreconditionsMatch: true, executionAuthority: false, releaseAuthority: false });
    expect(inspection.reviewedBasis).toMatchObject({ principalRaw: value.prepared.walletContext.principalRaw,
      amountMinor: value.prepared.walletContext.amountMinor, destinationSha256: value.prepared.walletContext.destinationSha256,
      claimReceiptSha256: value.prepared.walletContext.claimReceiptSha256, nativePaymentKey: value.prepared.nativePaymentKey });
    expect(walletDigest(value.fixture.wallet.state)).toBe(originalStateHash);
    expect(accepted.archive.state).not.toHaveProperty("accounts"); expect(accepted.archive.state).not.toHaveProperty("payouts");
    expect(verifyReleaseConsentArchive(JSON.parse(JSON.stringify(accepted.archive)))).toEqual(accepted.archive);
    expect(Object.isFrozen(accepted.archive.state.consents[0].currentBasis.walletCheckpoint)).toBe(true);
  });

  it("uses exactly the frozen source journal transitions and projections", async () => {
    const value = await setup();
    let source = createTrustedPaymentJournalArchive({ mode: MODE, manifest: value.fixture.manifest, sourceStoreId: value.input.sourceStoreId, atMs: value.fixture.now() });
    source = appendTrustedPaymentJournal(source, { type: "record", operationId: value.input.enrollmentOperationId, prepared: value.prepared }, value.fixture.now()).archive;
    expect(value.archive.state.source).toEqual(source.state); expect(value.archive.state.sourceCheckpoint).toEqual(source.checkpoint);
    const observed = await observe(value);
    source = appendTrustedPaymentJournal(source, { type: "record", operationId: observed.command.operationId, prepared: observed.command.prepared }, value.fixture.now()).archive;
    expect(observed.archive.state.source).toEqual(source.state); expect(observed.archive.state.sourceCheckpoint).toEqual(source.checkpoint);
    expect(observed.archive).not.toHaveProperty("sourceJournal");
  });

  it("does not allow a pending source receipt or a fabricated eligibility flag to grant consent", async () => {
    const value = await setup({ status: "pending" });
    expect(inspectReleaseConsent(value.archive, value.basis, value.fixture.now())).toMatchObject({ canConsent: false, currentPreconditionsMatch: false });
    expect(() => grant(value)).toThrow(/fresh settled source basis/i);
    const fabricated = structuredClone(value.input); fabricated.prepared.eligibility.eligibleForLaterVerification = true;
    expect(() => createReleaseConsentArchive(fabricated)).toThrow();
    value.fixture.observation.revision = 2; value.fixture.observation.status = "settled";
    value.fixture.observation.settledAtMs = value.fixture.now() - 1;
    const settled = await observe(value), consented = grant(value, settled.archive);
    expect(inspectReleaseConsent(consented.archive, current(value.fixture), value.fixture.now()).currentPreconditionsMatch).toBe(true);
  });

  it("retains a consent across exact same-revision source corroboration without refreshing its deadline", async () => {
    const value = await setup(), accepted = grant(value), original = accepted.archive.state.consents[0];
    const observed = await observe(value, accepted.archive);
    expect(observed.receipt.disposition).toBe("corroborated");
    expect(observed.archive.state.consents[0]).toEqual(original);
    expect(inspectReleaseConsent(observed.archive, current(value.fixture), value.fixture.now())).toMatchObject({
      currentPreconditionsMatch: true, reviewedBasisSha256: accepted.command.reviewedBasisSha256, validUntilMs: original.expiresAtMs });
  });

  it("invalidates an earlier consent on every new source revision and requires a new explicit reviewed consent", async () => {
    const value = await setup(), accepted = grant(value);
    value.fixture.observation.revision = 2; value.fixture.observation.observedAtMs = value.fixture.now();
    const observed = await observe(value, accepted.archive), inspection = inspectReleaseConsent(observed.archive, current(value.fixture), value.fixture.now());
    expect(inspection).toMatchObject({ canConsent: true, currentPreconditionsMatch: false });
    expect(inspection.reasons).toContain("reviewed-basis-changed");
    expect(() => appendReleaseConsent(observed.archive, { ...accepted.command, operationId: "stale-new-consent" }, current(value.fixture), value.fixture.now())).toThrow(/exact reviewed/i);
    const renewed = grant(value, observed.archive, "new-explicit-consent");
    expect(inspectReleaseConsent(renewed.archive, current(value.fixture), value.fixture.now()).currentPreconditionsMatch).toBe(true);
    expect(renewed.archive.state.consents[0]).toEqual(accepted.archive.state.consents[0]);
  });

  it("does not let a stale source revision replace the current settled revision or renew its consent", async () => {
    const value = await setup({ status: "pending" });
    value.fixture.observation.revision = 2; value.fixture.observation.status = "settled"; value.fixture.observation.settledAtMs = value.fixture.now() - 1;
    const observed = await observe(value), consented = grant(value, observed.archive);
    const stale = appendReleaseConsent(consented.archive, { type: "observe", operationId: "old-revision-redelivery", actorUserId: OWNER,
      prepared: value.prepared }, current(value.fixture), value.fixture.now());
    expect(stale.receipt.disposition).toBe("stale-corroboration");
    expect(stale.archive.state.latestPreparationSha256).toBe(observed.command.prepared.preparationSha256);
    expect(inspectReleaseConsent(stale.archive, current(value.fixture), value.fixture.now()).currentPreconditionsMatch).toBe(true);
  });

  it.each(["reversed", "revoked", "rejected"] as const)("retains a first %s source observation as a permanent hold", async status => {
    const value = await setup({ status });
    expect(value.archive.state.status).toBe("quarantined");
    expect(value.archive.state.source.payments[0].revisions[0].status).toBe(status);
    expect(inspectReleaseConsent(value.archive, value.basis, value.fixture.now()).currentPreconditionsMatch).toBe(false);
    expect(() => grant(value)).toThrow(/stopped/i);
  });

  it.each(["reversed", "revoked"] as const)("keeps the old consent receipt but invalidates all matching on later source %s", async status => {
    const value = await setup(), accepted = grant(value);
    value.fixture.observation.revision = 2; value.fixture.observation.status = status;
    const observed = await observe(value, accepted.archive);
    expect(observed.receipt.disposition).toBe(status === "reversed" ? "source-reversal-quarantined" : "source-revocation-quarantined");
    expect(observed.archive.state.source.payments[0].revisions.map(row => row.status)).toEqual(["settled", status]);
    const retry = appendReleaseConsent(observed.archive, accepted.command, current(value.fixture), value.fixture.now());
    expect(retry).toEqual({ archive: observed.archive, receipt: accepted.receipt, replayed: true });
    expect(inspectReleaseConsent(retry.archive, current(value.fixture), value.fixture.now()).currentPreconditionsMatch).toBe(false);
  });

  it.each(["revision-gap", "same-revision", "changed-facts", "settlement-time", "observed-clock", "settled-to-pending"] as const)(
    "retains and quarantines the original source consistency conflict: %s", async mutation => {
      const value = await setup(), accepted = grant(value);
      if (mutation !== "same-revision" && mutation !== "changed-facts") value.fixture.observation.revision = 2;
      if (mutation === "revision-gap") value.fixture.observation.revision = 3;
      if (mutation === "same-revision") value.fixture.observation.observedAtMs += 1;
      if (mutation === "changed-facts") value.fixture.observation.occurredAtMs += 1;
      if (mutation === "settlement-time") value.fixture.observation.settledAtMs! += 1;
      if (mutation === "observed-clock") value.fixture.observation.observedAtMs -= 1;
      if (mutation === "settled-to-pending") { value.fixture.observation.status = "pending"; value.fixture.observation.settledAtMs = null; }
      const observed = await observe(value, accepted.archive);
      expect(observed.receipt.disposition).toMatch(/-quarantined$/); expect(observed.archive.state.status).toBe("quarantined");
      expect(observed.archive.records.at(-1)!.command).toEqual(observed.command);
      expect(inspectReleaseConsent(observed.archive, current(value.fixture), value.fixture.now()).currentPreconditionsMatch).toBe(false);
      expect(appendReleaseConsent(observed.archive, observed.command, current(value.fixture), value.fixture.now()).receipt).toEqual(observed.receipt);
    });

  it("refuses another native payment identity and retains a coherent alternate original claim as a conflict", async () => {
    const value = await setup(), alternate = createTrustedPaymentFixture({ amount: "201" });
    const prepared = await alternate.reader().prepare(alternate.request);
    const conflict = appendReleaseConsent(value.archive, { type: "observe", operationId: "alternate-original-claim", actorUserId: OWNER, prepared }, current(alternate), alternate.now());
    expect(conflict.receipt.disposition).toBe("payment-conflict-quarantined");
    expect(conflict.archive.bootstrap.initialPrepared).toEqual(value.prepared);
    value.fixture.observation.transactionId = "another-native-payment";
    const unrelated = await value.fixture.reader().prepare({ ...value.fixture.request, transactionId: value.fixture.observation.transactionId });
    expect(() => appendReleaseConsent(value.archive, { type: "observe", operationId: "unrelated", actorUserId: OWNER, prepared: unrelated }, value.basis, value.fixture.now())).toThrow(/exactly one original native/i);
  });

  it.each(["dispute", "pause"] as const)("preserves the original V5 %s exit and invalidates consent from its actual changed history", async action => {
    const value = await setup(), accepted = grant(value);
    if (action === "dispute") value.fixture.wallet.step(v5Command("freezeInitialDispute", BUYER, "buyer-exit", v5FixtureDisputeInput(value.fixture.wallet.snapshot(), value.fixture.wallet.at + 1)));
    else value.fixture.wallet.step(v5Command("pause", OPERATOR, "owner-exit", null));
    const changed = current(value.fixture), beforeObservation = inspectReleaseConsent(accepted.archive, changed, value.fixture.now());
    expect(beforeObservation.currentPreconditionsMatch).toBe(false);
    expect(beforeObservation.reasons).toContain(action === "dispute" ? "trade-disputed" : "wallet-paused");
    const observed = await observe(value, accepted.archive);
    expect(observed.receipt.disposition).toBe("corroborated");
    expect(inspectReleaseConsent(observed.archive, current(value.fixture), value.fixture.now())).toMatchObject({ canConsent: false, currentPreconditionsMatch: false });
    expect(appendReleaseConsent(observed.archive, accepted.command, changed, value.fixture.now()).receipt).toEqual(accepted.receipt);
  });

  it("quarantines attempted rollback from a retained later wallet history even with an exact old source observation", async () => {
    const value = await setup(); value.fixture.wallet.step(v5Command("pause", OPERATOR, "stop-wallet", null));
    const observed = await observe(value);
    const rollback = appendReleaseConsent(observed.archive, { type: "observe", operationId: "rollback-current-history", actorUserId: OWNER,
      prepared: value.prepared }, value.basis, value.fixture.now());
    expect(rollback.receipt.disposition).toBe("payment-conflict-quarantined");
    expect(rollback.archive.state.latestPreparationSha256).toBe(observed.command.prepared.preparationSha256);
  });

  it("requires the exact canonical and seller-account commitment reviewed by the seller", async () => {
    const value = await setup(), accepted = grant(value), changed = current(value.fixture, "d".repeat(64));
    const inspection = inspectReleaseConsent(accepted.archive, changed, value.fixture.now());
    expect(inspection).toMatchObject({ canConsent: true, currentPreconditionsMatch: false });
    expect(inspection.reasons).toContain("reviewed-basis-changed");
    expect(() => appendReleaseConsent(accepted.archive, { ...accepted.command, operationId: "different-canonical" }, changed, value.fixture.now())).toThrow(/exact reviewed/i);
    const newConsent = grant(value, accepted.archive, "new-canonical-review", changed);
    expect(inspectReleaseConsent(newConsent.archive, changed, value.fixture.now()).currentPreconditionsMatch).toBe(true);
  });

  it("rejects source preparation obtained before the actual current V5 checkpoint", async () => {
    const value = await setup(); value.fixture.wallet.step(v5Command("pause", OPERATOR, "wallet-pause", null));
    expect(() => appendReleaseConsent(value.archive, { type: "observe", operationId: "stale-prepared", actorUserId: OWNER, prepared: value.prepared },
      current(value.fixture), value.fixture.now())).toThrow(/actual current V5/i);
  });

  it("expires at the original observation freshness boundary and does not trust historical eligibility", async () => {
    const value = await setup(), accepted = grant(value), deadline = value.prepared.observation.observedAtMs + value.fixture.manifest.sources[0].maxObservationAgeMs;
    expect(value.prepared.eligibility.eligibleForLaterVerification).toBe(true);
    expect(inspectReleaseConsent(accepted.archive, value.basis, deadline - 1).currentPreconditionsMatch).toBe(true);
    expect(inspectReleaseConsent(accepted.archive, value.basis, deadline)).toMatchObject({ canConsent: false, currentPreconditionsMatch: false });
    expect(appendReleaseConsent(accepted.archive, accepted.command, value.basis, deadline + 1).receipt).toEqual(accepted.receipt);
    expect(accepted.archive.state.consents[0].expiresAtMs).toBe(deadline);
  });

  it.each(["disabled", "not-yet-valid", "expired"] as const)("retains a settled observation but cannot consent when the admission is %s", async condition => {
    const value = await setup({}, fixture => {
      if (condition === "disabled") fixture.manifest.sources[0].enabled = false;
      if (condition === "not-yet-valid") fixture.manifest.sources[0].validFromMs = fixture.now() + 1;
      if (condition === "expired") fixture.manifest.sources[0].validUntilMs = fixture.now();
    });
    expect(inspectReleaseConsent(value.archive, value.basis, value.fixture.now())).toMatchObject({ canConsent: false, currentPreconditionsMatch: false });
    expect(() => grant(value)).toThrow(/fresh settled source/i);
  });

  it("limits consent to the earliest original source admission and authenticated seller session deadline", async () => {
    const value = await setup({}, fixture => { fixture.manifest.sources[0].validUntilMs = fixture.now() + 20; });
    const sourceBound = grant(value);
    expect(sourceBound.archive.state.consents[0].expiresAtMs).toBe(value.fixture.now() + 20);
    const sessionBound = grant(value, value.archive, "short-seller-session", value.basis, value.fixture.now() + 5);
    expect(sessionBound.archive.state.consents[0].expiresAtMs).toBe(value.fixture.now() + 5);
    expect(inspectReleaseConsent(sessionBound.archive, value.basis, value.fixture.now() + 5)).toMatchObject({ canConsent: true, currentPreconditionsMatch: false });
    expect(() => grant(value, value.archive, "expired-seller-session", value.basis, value.fixture.now())).toThrow(/expired current session/i);
  });

  it.each(["buyer", "owner", "source"] as const)("cannot substitute the %s for the exact retained seller", async actor => {
    const value = await setup(), reviewed = inspectReleaseConsent(value.archive, value.basis, value.fixture.now());
    const actorUserId = actor === "buyer" ? value.prepared.walletContext.buyerId : actor === "owner" ? OWNER : value.prepared.observation.authorityId;
    expect(() => appendReleaseConsent(value.archive, { type: "consent", operationId: "wrong-actor", actorUserId,
      reviewedBasisSha256: reviewed.reviewedBasisSha256!, sessionExpiresAtMs: value.fixture.now() + 1000 }, value.basis, value.fixture.now())).toThrow();
    const accepted = grant(value);
    expect(() => appendReleaseConsent(accepted.archive, { type: "revoke", operationId: "wrong-withdrawal", actorUserId,
      consentOperationId: accepted.command.operationId }, value.basis, value.fixture.now())).toThrow();
  });

  it("excludes the enrolling owner and all later platform actors from every admitted source authority", async () => {
    const value = await setup();
    expect(() => createReleaseConsentArchive({ ...value.input, enrollingOwnerId: value.prepared.observation.authorityId })).toThrow(/source authority/i);
    for (const type of ["observe", "pause"] as const) {
      const command = type === "observe" ? { type, operationId: "source-as-owner", actorUserId: value.prepared.observation.authorityId, prepared: value.prepared }
        : { type, operationId: "source-as-owner", actorUserId: value.prepared.observation.authorityId, reasonCode: "maintenance" };
      expect(() => appendReleaseConsent(value.archive, command, value.basis, value.fixture.now())).toThrow(/source authority/i);
    }
  });

  it("records exact seller withdrawal without deleting consent, and requires an explicit new operation for renewed consent", async () => {
    const value = await setup(), accepted = grant(value), withdrawn = revoke(value, accepted.archive);
    expect(withdrawn.receipt.disposition).toBe("consent-revoked");
    expect(inspectReleaseConsent(withdrawn.archive, value.basis, value.fixture.now())).toMatchObject({ canConsent: true, currentPreconditionsMatch: false });
    const retry = appendReleaseConsent(withdrawn.archive, accepted.command, value.basis, value.fixture.now());
    expect(retry.receipt).toEqual(accepted.receipt); expect(retry.replayed).toBe(true);
    expect(inspectReleaseConsent(retry.archive, value.basis, value.fixture.now()).currentPreconditionsMatch).toBe(false);
    const redundant = revoke(value, withdrawn.archive, accepted.command.operationId, "another-withdrawal");
    expect(redundant.receipt.disposition).toBe("consent-already-revoked");
    expect(redundant.archive.state.consents[0].revokedByOperationId).toBe(withdrawn.command.operationId);
    const renewed = grant(value, redundant.archive, "new-explicit-consent");
    expect(inspectReleaseConsent(renewed.archive, value.basis, value.fixture.now()).currentPreconditionsMatch).toBe(true);
    expect(appendReleaseConsent(renewed.archive, withdrawn.command, value.basis, value.fixture.now()).archive).toEqual(renewed.archive);
    expect(() => revoke(value, renewed.archive, "unknown-consent", "unknown-withdrawal")).toThrow(/exact retained consent/i);
  });

  it("retains same-operation changed intent as quarantine and never extends the original authenticated deadline", async () => {
    const value = await setup(), accepted = grant(value);
    const conflictCommand = { ...accepted.command, sessionExpiresAtMs: accepted.command.sessionExpiresAtMs + 1 };
    const conflict = appendReleaseConsent(accepted.archive, conflictCommand, value.basis, value.fixture.now());
    expect(conflict.receipt.disposition).toBe("operation-conflict-quarantined");
    expect(conflict.archive.state.consents).toEqual(accepted.archive.state.consents);
    expect(appendReleaseConsent(conflict.archive, conflictCommand, value.basis, value.fixture.now()).receipt).toEqual(conflict.receipt);
    expect(appendReleaseConsent(conflict.archive, accepted.command, value.basis, value.fixture.now()).receipt).toEqual(accepted.receipt);
    expect(inspectReleaseConsent(conflict.archive, value.basis, value.fixture.now()).currentPreconditionsMatch).toBe(false);
  });

  it("fences new commands after owner pause while preserving exact historical receipt lookup", async () => {
    const value = await setup(), accepted = grant(value), stopped = pause(value, accepted.archive);
    expect(stopped.archive.state.status).toBe("paused");
    expect(inspectReleaseConsent(stopped.archive, value.basis, value.fixture.now()).currentPreconditionsMatch).toBe(false);
    expect(findReleaseConsentReceipt(stopped.archive, { operationId: accepted.command.operationId,
      inputHash: releaseConsentCommandDigest(accepted.command) })).toEqual(accepted.receipt);
    expect(appendReleaseConsent(stopped.archive, accepted.command, value.basis, value.fixture.now() + 86_400_000).receipt).toEqual(accepted.receipt);
    expect(() => grant(value, stopped.archive, "new-after-stop")).toThrow(/stopped/i);
    expect(() => revoke(value, stopped.archive)).toThrow(/stopped/i);
  });

  it.each(["disputed", "paused"] as const)("does not enroll an already %s V5 wallet", async flag => {
    const fixture = createTrustedPaymentFixture({ [flag]: true }), prepared = await fixture.reader().prepare(fixture.request);
    expect(() => createReleaseConsentArchive({ mode: MODE, manifest: fixture.manifest, sourceStoreId: "store", enrollingOwnerId: OWNER,
      enrollmentOperationId: "enroll", prepared, currentBasis: current(fixture), atMs: fixture.now() })).toThrow(/unpaused and undisputed/i);
  });

  it("exports only a stopped original and preserves the entire consent history in a permanent restored quarantine", async () => {
    const value = await setup(), accepted = grant(value);
    expect(() => createReleaseConsentBackup(accepted.archive, value.fixture.now())).toThrow(/stopped original/i);
    const stopped = pause(value, accepted.archive), backup = createReleaseConsentBackup(stopped.archive, value.fixture.now() + 1);
    expect(verifyReleaseConsentBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
    const restored = restoreReleaseConsentArchive({ backup, operationId: "restore", targetStoreId: "fresh-physical-target", atMs: value.fixture.now() + 2 });
    expect(restored.records.slice(0, stopped.archive.records.length)).toEqual(stopped.archive.records);
    expect(restored.state).toMatchObject({ status: "quarantined", haltReason: "restored-copy", restoredTargetStoreId: "fresh-physical-target" });
    expect(verifyReleaseConsentArchive(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
    expect(appendReleaseConsent(restored, accepted.command, value.basis, value.fixture.now() + 3).receipt).toEqual(accepted.receipt);
    expect(inspectReleaseConsent(restored, value.basis, value.fixture.now() + 3).currentPreconditionsMatch).toBe(false);
    expect(() => createReleaseConsentBackup(restored, value.fixture.now() + 3)).toThrow(/stopped original/i);
    expect(() => appendReleaseConsent(restored, { ...accepted.command, operationId: "restore-resume" }, value.basis, value.fixture.now() + 3)).toThrow(/stopped/i);
    expect(restored).not.toHaveProperty("sourceHasNoLaterCommands");
  });

  it("rejects same-source restore, operation collision, stale restore clock and forged backup bytes", async () => {
    const value = await setup(), stopped = pause(value, value.archive).archive, backup = createReleaseConsentBackup(stopped, value.fixture.now() + 1);
    const options = { backup, operationId: "restore", targetStoreId: "fresh-target", atMs: value.fixture.now() + 2 };
    expect(() => restoreReleaseConsentArchive({ ...options, targetStoreId: value.archive.bootstrap.sourceStoreId })).toThrow();
    expect(() => restoreReleaseConsentArchive({ ...options, operationId: "enroll" })).toThrow(/collides/i);
    expect(() => restoreReleaseConsentArchive({ ...options, atMs: value.fixture.now() })).toThrow();
    expect(() => restoreReleaseConsentArchive({ ...options, backup: { ...backup, backupSha256: "a".repeat(64) } })).toThrow();
  });

  it.each(["head", "projection", "receipt", "event", "duplicate", "omission", "admission", "basis", "source-projection", "consent-expiry"] as const)(
    "rejects recomputed outer archive tampering: %s", async part => {
      const value = await setup(), accepted = grant(value), changed = structuredClone(accepted.archive);
      if (part === "head") changed.checkpoint.revision = 1;
      if (part === "projection") changed.state.activeConsentOperationId = null;
      if (part === "receipt") changed.records[1].receipt.releaseAuthority = true as false;
      if (part === "event") changed.records[1].eventHash = "e".repeat(64);
      if (part === "duplicate") changed.records.push(structuredClone(changed.records[1]));
      if (part === "omission") changed.records.splice(0, 1);
      if (part === "admission") changed.bootstrap.manifest.sources[0].enabled = false;
      if (part === "basis") changed.records[1].currentBasis.canonicalBasisSha256 = "e".repeat(64);
      if (part === "source-projection") changed.state.source.payments = [];
      if (part === "consent-expiry") changed.state.consents[0].expiresAtMs += 1;
      expect(() => verifyReleaseConsentArchive(reseal(changed))).toThrow();
    });

  it("captures executable and proxy inputs without invoking them or allowing reentrant writes", async () => {
    const value = await setup(); let calls = 0;
    const executable = { type: "pause", operationId: "getter", actorUserId: OWNER, get reasonCode() { calls++; return "maintenance"; } };
    expect(() => appendReleaseConsent(value.archive, executable, value.basis, value.fixture.now())).toThrow();
    const proxy = new Proxy({}, { get() { calls++; throw new Error("must not execute"); }, ownKeys() { calls++; return []; }, getPrototypeOf() { calls++; return Object.prototype; } });
    expect(() => appendReleaseConsent(value.archive, proxy, value.basis, value.fixture.now())).toThrow();
    expect(() => verifyReleaseConsentArchive(proxy)).toThrow();
    expect(() => inspectReleaseConsent(value.archive, proxy as ReleaseConsentCurrentBasis, value.fixture.now())).toThrow();
    expect(calls).toBe(0); expect(value.archive.records).toHaveLength(1);
  });

  it.each([NaN, Infinity, -1, -0, 0, 1.5])("rejects an inexact or invalid clock %s", async atMs => {
    const value = await setup();
    expect(() => inspectReleaseConsent(value.archive, value.basis, atMs)).toThrow();
    expect(() => appendReleaseConsent(value.archive, { type: "pause", operationId: "bad-clock", actorUserId: OWNER, reasonCode: "maintenance" }, value.basis, atMs)).toThrow();
  });

  it("rejects a new command before retained history, and refuses hosted or live runtimes", async () => {
    const value = await setup();
    expect(() => appendReleaseConsent(value.archive, { type: "pause", operationId: "backwards-clock", actorUserId: OWNER, reasonCode: "maintenance" }, value.basis, value.fixture.now() - 1)).toThrow(/clock/i);
    vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true");
    expect(() => verifyReleaseConsentArchive(value.archive)).toThrow(/simulation-only runtime/i);
    expect(() => inspectReleaseConsent(value.archive, value.basis, value.fixture.now())).toThrow(/simulation-only runtime/i);
  });

  it("reaches the real bounded evidence capacity while retaining enough space to stop, export and restore", async () => {
    const value = await setup(); let archive = value.archive, bounded = false;
    for (let index = 1; index <= 130; index++) {
      try {
        archive = appendReleaseConsent(archive, { type: "observe", operationId: `source-delivery-${index}`, actorUserId: OWNER,
          prepared: value.prepared }, value.basis, value.fixture.now()).archive;
      } catch (error) { expect(error).toMatchObject({ code: "RESOURCE_LIMIT" }); bounded = true; break; }
    }
    expect(bounded).toBe(true); expect(archive.records.length).toBeGreaterThan(2); expect(archive.records.length).toBeLessThanOrEqual(126);
    const stopped = pause(value, archive).archive, backup = createReleaseConsentBackup(stopped, value.fixture.now() + 1);
    const restored = restoreReleaseConsentArchive({ backup, operationId: "capacity-restore", targetStoreId: "capacity-target", atMs: value.fixture.now() + 2 });
    expect(restored.state.status).toBe("quarantined"); expect(restored.records.length).toBe(archive.records.length + 2);
  }, 180_000);
});
