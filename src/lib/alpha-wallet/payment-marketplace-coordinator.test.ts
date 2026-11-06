// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { buildPaymentMarketplaceFixture, PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE,
  PAYMENT_MARKETPLACE_SYNTHETIC_REASON } from "../../../scripts/alpha-wallet/payment-marketplace-fixtures";
import { walletDigest } from "./commands";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { createDevelopmentPaymentMarketplaceWalletCoordinator } from "./payment-marketplace-coordinator";
import { createV4DurableWallet } from "./v4-durable";
import { verifyV5History } from "./v5-durable";
import { isV5State } from "./v5-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const SCHEMA = "alpha_wallet_payment_marketplace_simulation";
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions",
  "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"] as const;
let directory: string, store: WalletStore;
type Fixture = Awaited<ReturnType<typeof buildPaymentMarketplaceFixture>>;
const claimInput = (f: Fixture, operationId = "integration-payment-claim") => ({ ...f.buyerInput, operationId,
  ...(f.evidence ? { evidence: f.evidence } : {}) });
const disputeInput = (f: Fixture, operationId = "integration-payment-dispute") => ({ ...f.buyerInput, operationId,
  reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON });
const upgradeInput = (f: Fixture, operationId = "integration-payment-upgrade") => ({ ...f.ownerInput, operationId,
  acknowledgeVersionUpgrade: true as const, acknowledgePaymentClaimOnlyProfile: true as const });
const wrapped = (wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
const coordinator = (f: Fixture, target = store, clock = f.clock) =>
  createDevelopmentPaymentMarketplaceWalletCoordinator({ mode: MODE, store: target, clock });

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-payment-coordinator-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);

async function footprint() {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV5History(commands), canonical: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) canonical[table] = (await tx.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    const predecessor: Record<string, unknown[]> = {};
    for (const [namespace, tables] of [["alpha_wallet_initial_marketplace_simulation", ["activations", "acceptances", "publications"]],
      ["alpha_wallet_cancellation_marketplace_simulation", ["transitions", "cancellations", "publications"]]] as const) {
      for (const table of tables) predecessor[`${namespace}.${table}`] = (await tx.query(
        `SELECT * FROM ${namespace}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    }
    const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA])).rows[0].present;
    const coordination: Record<string, Record<string, unknown>[]> = {};
    if (present) for (const table of ["transitions", "claims", "dispute_freezes", "publications"]) coordination[table] = (await tx.query(
      `SELECT * FROM ${SCHEMA}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    return { commands, snapshot, canonical, predecessor, present, coordination };
  });
}
type Footprint = Awaited<ReturnType<typeof footprint>>;
function assertPrincipalPreserved(before: Footprint, after: Footprint, f: Fixture) {
  expect(after.snapshot.state.accounts).toEqual(before.snapshot.state.accounts);
  expect(after.snapshot.state.journal).toEqual(before.snapshot.state.journal);
  for (const key of ["payouts", "commissions", "evidenceOwners", "deposits", "listings"] as const) {
    expect(after.snapshot.state[key], key).toEqual(before.snapshot.state[key]);
  }
  expect(expectedCustody(after.snapshot.state, f.canonical.assetId)).toBe(expectedCustody(before.snapshot.state, f.canonical.assetId));
  expect(balance(after.snapshot.state, f.canonical.assetId, `trade:${f.canonical.walletTradeId}`))
    .toBe(balance(before.snapshot.state, f.canonical.assetId, `trade:${f.canonical.walletTradeId}`));
  expect(after.snapshot.state.trades.get(f.canonical.walletTradeId)?.evidence).toBeUndefined();
  expect(after.snapshot.state.trades.get(f.canonical.walletTradeId)?.authorization).toBeUndefined();
  expect(after.predecessor).toEqual(before.predecessor);
}

describe("authenticated buyer payment claim and dispute successor", () => {
  it("commits exact bank evidence and a later dispute without moving principal, then recovers both original receipts across web/mobile pause", async () => {
    const f = await buildPaymentMarketplaceFixture(store), before = await footprint();
    const claim = await f.coordinator.claimPayment(claimInput(f)), claimed = await footprint();
    expect(claim).toMatchObject({ replayed: false, actorUserId: f.canonical.buyerId, principalRaw: "200000000",
      transferAmountRaw: "0", tradeReservedRaw: "200000000", paymentVerified: false, releaseAuthorized: false });
    expect(claimed.commands.slice(0, -1)).toEqual(before.commands);
    expect(claimed.commands.at(-1)?.command_type).toBe("claimInitialPayment");
    assertPrincipalPreserved(before, claimed, f);
    expect(claimed.canonical.evidence).toHaveLength(1);
    const content = Buffer.from(PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE.contentBase64, "base64");
    expect(claim.evidence?.contentDigest).toBe(createHash("sha256").update(content).digest("hex"));
    expect(claimed.canonical.evidence[0].content).toBe(`\\x${content.toString("hex")}`);
    const claimedRequest = claimed.canonical.purchase_requests.find(row => row.id === f.canonical.requestId)!;
    expect(claimedRequest).toMatchObject({ status: "payment_sent", payload: { status: "payment_sent", fiatAmount: "626.20",
      pricePerUsdt: "3.10", buyerEvidence: { id: claim.evidence?.evidenceId } } });
    expect((claimedRequest.payload as PurchaseRequest).trustReconciliation).toBeUndefined();
    f.advanceTime();
    const dispute = await f.mobile.openDispute({ ...f.mobileBuyerInput, operationId: "mobile-open-dispute",
      reason: `  ${PAYMENT_MARKETPLACE_SYNTHETIC_REASON}  ` });
    const disputed = await footprint();
    assertPrincipalPreserved(before, disputed, f);
    expect(disputed.canonical.evidence).toEqual(claimed.canonical.evidence);
    expect(disputed.canonical.disputes).toHaveLength(1);
    expect(disputed.canonical.disputes[0]).toMatchObject({ status: "open", payload: {
      reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON, buyerEvidenceId: claim.evidence?.evidenceId } });
    expect(disputed.snapshot.state.trades.get(f.canonical.walletTradeId)).toMatchObject({ status: "payment_reported", disputed: true });
    expect(dispute).toMatchObject({ claimKey: claim.claimKey, disputed: true, principalRaw: "200000000",
      paymentVerified: false, releaseAuthorized: false });
    const publicText = JSON.stringify({ claim, dispute, publications: disputed.coordination.publications });
    expect(publicText).not.toContain(PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE.contentBase64);
    expect(publicText).not.toContain(PAYMENT_MARKETPLACE_SYNTHETIC_REASON);
    expect(publicText).not.toContain("buyer-payment-evidence.png");
    f.advanceTime(); await f.coordinator.pause({ ...f.ownerInput, operationId: "pause-after-dispute" });
    const paused = await footprint();
    expect(await f.mobile.claimPayment({ ...f.mobileBuyerInput, operationId: "mobile-recover-claim", evidence: f.evidence }))
      .toEqual({ ...claim, replayed: true });
    expect(await f.coordinator.openDispute(disputeInput(f, "web-recover-dispute"))).toEqual({ ...dispute, replayed: true });
    expect(await footprint()).toEqual(paused);
    expect(await f.coordinator.inspect(f.ownerInput)).toMatchObject({ marketplace: { status: "payment_sent", disputed: true },
      wallet: { halted: true }, reservation: { listingAvailableRaw: "300000000", tradeReservedRaw: "200000000" } });
  }, TIMEOUT);

  it.each(["ios", "android"] as const)("records Face-to-Face through current %s authority with eighteen-decimal principal", async platform => {
    const f = await buildPaymentMarketplaceFixture(store, { paymentMethod: "Face-to-Face", platform,
      assetId: "bsc-sim-binance-peg-usdt", tradeProjection: "pending" }), before = await footprint();
    const claim = await f.mobile.claimPayment({ ...f.mobileBuyerInput, operationId: "mobile-cash-claim" });
    f.advanceTime(); const dispute = await f.coordinator.openDispute(disputeInput(f));
    const after = await footprint(); assertPrincipalPreserved(before, after, f);
    expect(claim).toMatchObject({ evidence: null, principalRaw: "200000000000000000000", transferAmountRaw: "0" });
    expect(dispute.claimKey).toBe(claim.claimKey); expect(after.canonical.evidence).toHaveLength(0);
    expect(after.canonical.trades[0].sort_index).toBe(31);
    expect(await f.coordinator.claimPayment(claimInput(f, "cash-web-retry"))).toEqual({ ...claim, replayed: true });
  }, TIMEOUT);

  it("requires explicit current-owner profile acknowledgement and preserves both predecessor cohorts", async () => {
    const f = await buildPaymentMarketplaceFixture(store, { upgrade: false }), before = await footprint();
    await expect(f.coordinator.upgradeRequest({ ...upgradeInput(f), sessionToken: f.canonical.sellerSessionToken })).rejects.toThrow();
    const missing = { ...upgradeInput(f) } as Record<string, unknown>; delete missing.acknowledgePaymentClaimOnlyProfile;
    await expect(f.coordinator.upgradeRequest(missing as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await footprint()).toEqual(before);
    const receipt = await f.coordinator.upgradeRequest(upgradeInput(f)), after = await footprint();
    expect(receipt).toMatchObject({ sourceStatus: "accepted", sourcePaused: false, newCancellationSupported: false });
    expect(after.commands.slice(0, -1)).toEqual(before.commands); expect(after.predecessor).toEqual(before.predecessor);
    expect(await f.mobile.upgradeRequest({ ...f.mobileOwnerInput, operationId: "mobile-upgrade-retry",
      acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true })).toEqual({ ...receipt, replayed: true });
    expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it.each(["cancelled", "inherited pause", "V4 pause"] as const)("retains %s as an archival state without new payment authority", async kind => {
    const f = await buildPaymentMarketplaceFixture(store, { ...(kind === "cancelled" ? { cancel: true } :
      kind === "inherited pause" ? { sourcePaused: true } : { pausePredecessor: true }) });
    const before = await footprint();
    await expect(f.coordinator.claimPayment(claimInput(f))).rejects.toThrow();
    await expect(f.coordinator.openDispute(disputeInput(f))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    const inspect = await f.coordinator.inspect(f.ownerInput);
    expect(inspect.reservation.tradeReservedRaw).toBe(kind === "cancelled" ? "0" : "200000000");
    expect(inspect.cancellation !== null).toBe(kind === "cancelled");
    expect(inspect.wallet.halted).toBe(kind !== "cancelled");
  }, TIMEOUT);

  it("refuses seller and unrelated owner claims or disputes and refuses a buyer dispute before a claim", async () => {
    const f = await buildPaymentMarketplaceFixture(store), before = await footprint();
    for (const sessionToken of [f.canonical.sellerSessionToken, f.canonical.ownerSessionToken]) {
      await expect(f.coordinator.claimPayment({ ...claimInput(f), sessionToken })).rejects.toThrow();
      await expect(f.coordinator.openDispute({ ...disputeInput(f), sessionToken })).rejects.toThrow();
    }
    await expect(f.coordinator.openDispute(disputeInput(f))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects caller authority fields, malformed files and contact-bearing reasons without changing the cohort", async () => {
    const f = await buildPaymentMarketplaceFixture(store), before = await footprint();
    for (const extra of [{ actorUserId: f.canonical.sellerId }, { principalRaw: "1" }, { destination: "sim://other" },
      { claimedAtMs: f.clock() }, { evidenceId: "caller-selected" }]) {
      await expect(f.coordinator.claimPayment({ ...claimInput(f), ...extra } as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    for (const evidence of [{ mimeType: "image/png", contentBase64: "invalid" }, { mimeType: "image/jpeg", contentBase64: f.evidence!.contentBase64 },
      { ...f.evidence, fileName: "caller.pdf" }, { mimeType: "text/html", contentBase64: "PGh0bWw+" }]) {
      await expect(f.coordinator.claimPayment({ ...claimInput(f), evidence } as never)).rejects.toThrow();
    }
    for (const reason of [" ", "x".repeat(501), "Contact me at fixture@example.com"]) {
      await expect(f.coordinator.openDispute({ ...disputeInput(f), reason })).rejects.toThrow();
    }
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["Bank Transfer", "Face-to-Face"] as const)("enforces the exact %s attachment rule", async paymentMethod => {
    const f = await buildPaymentMarketplaceFixture(store, { paymentMethod }), before = await footprint();
    await expect(f.coordinator.claimPayment({ ...f.buyerInput, operationId: "wrong-method-evidence",
      ...(paymentMethod === "Face-to-Face" ? { evidence: PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE } : {}) })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("does not reuse original business receipts for changed evidence or dispute reason", async () => {
    const f = await buildPaymentMarketplaceFixture(store, { dispute: true }), before = await footprint();
    const changed = { mimeType: "application/pdf" as const, contentBase64: Buffer.from("%PDF-1.4\nsynthetic different proof\n%%EOF").toString("base64") };
    await expect(f.coordinator.claimPayment({ ...claimInput(f), evidence: changed })).rejects.toMatchObject({ code: "STALE" });
    await expect(f.coordinator.openDispute({ ...disputeInput(f), reason: "A different disputed fact." })).rejects.toMatchObject({ code: "STALE" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rolls back an owner cutover that fails after the transition insert", async () => {
    const f = await buildPaymentMarketplaceFixture(store, { upgrade: false }), before = await footprint(); let injected = false;
    const fault = wrapped(tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await tx.query<Row>(sql, values);
      if (sql.includes(`${SCHEMA}.transitions`) && /INSERT INTO/i.test(sql)) {
        injected = true; await tx.query("SELECT 1 / 0 /* late payment cutover failure */");
      }
      return result;
    } }));
    await expect(coordinator(f, fault).upgradeRequest(upgradeInput(f))).rejects.toThrow();
    expect(injected).toBe(true); expect(await footprint()).toEqual(before);
    expect((await f.coordinator.upgradeRequest(upgradeInput(f))).replayed).toBe(false);
  }, TIMEOUT);

  it("rolls back every claim effect when evidence, notification, audit, receipt or publication persistence fails", async () => {
    const f = await buildPaymentMarketplaceFixture(store), before = await footprint();
    for (const table of ["alpha_exchange.evidence", "alpha_exchange.notifications", "alpha_exchange.audit_logs",
      `${SCHEMA}.claims`, `${SCHEMA}.publications`]) {
      let injected = false;
      const fault = wrapped(tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        if (sql.includes(table) && /INSERT INTO/i.test(sql)) {
          injected = true; await tx.query("SELECT 1 / 0 /* actual late payment claim SQL fault */");
        }
        return result;
      } }));
      await expect(coordinator(f, fault).claimPayment(claimInput(f))).rejects.toThrow();
      expect(injected, table).toBe(true); expect(await footprint(), table).toEqual(before);
    }
  }, TIMEOUT);

  it("rolls back every dispute effect when its row, notice, receipt or publication persistence fails", async () => {
    const f = await buildPaymentMarketplaceFixture(store, { claim: true }), before = await footprint();
    for (const table of ["alpha_exchange.disputes", "alpha_exchange.notifications", `${SCHEMA}.dispute_freezes`, `${SCHEMA}.publications`]) {
      let injected = false;
      const fault = wrapped(tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        if (sql.includes(table) && /INSERT INTO/i.test(sql)) {
          injected = true; await tx.query("SELECT 1 / 0 /* actual late payment dispute SQL fault */");
        }
        return result;
      } }));
      await expect(coordinator(f, fault).openDispute(disputeInput(f))).rejects.toThrow();
      expect(injected, table).toBe(true); expect(await footprint(), table).toEqual(before);
    }
  }, TIMEOUT);

  it.each(["claim", "dispute"] as const)("recovers one original %s across transports after actual commit and a lost response", async operation => {
    const f = await buildPaymentMarketplaceFixture(store, { claim: operation === "dispute" }), before = await footprint();
    let lost = true;
    const uncertain: WalletStore = { async transaction(work) {
      const result = await store.transaction(work);
      if (lost) { lost = false; throw new CommitOutcomeUnknownError(new Error("Synthetic lost payment reply")); }
      return result;
    }, close: async () => undefined };
    const sender = coordinator(f, uncertain);
    await expect(operation === "claim" ? sender.claimPayment(claimInput(f)) : sender.openDispute(disputeInput(f)))
      .rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const committed = await footprint(); expect(committed.commands).toHaveLength(before.commands.length + 1);
    const recovered = operation === "claim" ? await f.mobile.claimPayment({ ...f.mobileBuyerInput, operationId: "lost-claim-retry", evidence: f.evidence })
      : await f.mobile.openDispute({ ...f.mobileBuyerInput, operationId: "lost-dispute-retry", reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON });
    expect(recovered.replayed).toBe(true); expect(recovered.walletRevision).toBe(committed.snapshot.revision);
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it("checks current stored authorization before recovering a paused original receipt", async () => {
    const f = await buildPaymentMarketplaceFixture(store, { claim: true, pause: true });
    await store.transaction(tx => tx.query("DELETE FROM alpha_exchange.sessions WHERE token_hash=$1",
      [createHash("sha256").update(f.canonical.buyerSessionToken).digest("hex")]));
    const before = await footprint();
    await expect(f.coordinator.claimPayment(claimInput(f, "revoked-claim-retry"))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    expect(await f.mobile.claimPayment({ ...f.mobileBuyerInput, operationId: "still-current-mobile", evidence: f.evidence }))
      .toEqual({ ...f.claim, replayed: true });
  }, TIMEOUT);

  it("rolls back the claim when the buyer session expires after canonical persistence", async () => {
    const f = await buildPaymentMarketplaceFixture(store), before = await footprint(); let injected = false;
    const fault = wrapped(tx => ({ ...tx, async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await tx.query<Row>(sql, values);
      if (sql.includes("alpha_exchange.evidence") && /INSERT INTO/i.test(sql)) {
        injected = true; f.setTime(f.canonical.sessionsExpireAtMs);
      }
      return result;
    } }));
    await expect(coordinator(f, fault).claimPayment(claimInput(f))).rejects.toThrow();
    expect(injected).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("fences old cancellation, standalone V4 writes and direct lifecycle or predecessor mutation", async () => {
    const f = await buildPaymentMarketplaceFixture(store), before = await footprint();
    await expect(f.predecessor.coordinator.cancelRequest({ ...f.buyerInput, operationId: "old-cancel-after-payment-upgrade" })).rejects.toThrow();
    await expect(createV4DurableWallet({ mode: MODE, store }).snapshot()).rejects.toThrow();
    for (const sql of ["UPDATE alpha_exchange.purchase_requests SET status='payment_sent' WHERE id=$1",
      "DELETE FROM alpha_wallet_cancellation_marketplace_simulation.cancellations WHERE false",
      "TRUNCATE alpha_wallet_initial_marketplace_simulation.publications"]) {
      await expect(store.transaction(tx => tx.query(sql, sql.includes("$1") ? [f.canonical.requestId] : undefined))).rejects.toThrow();
    }
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("publishes only safe references and keeps exact financial receipt maps coherent", async () => {
    const f = await buildPaymentMarketplaceFixture(store, { dispute: true }), after = await footprint();
    expect(isV5State(after.snapshot.state)).toBe(true);
    if (!isV5State(after.snapshot.state)) throw new Error("Expected V5 fixture");
    expect(after.snapshot.state.initialPaymentClaimReceipts.size).toBe(1);
    expect(after.snapshot.state.initialDisputeFreezeReceipts.size).toBe(1);
    expect(walletDigest(after.coordination.claims[0].receipt)).toBe(walletDigest([...after.snapshot.state.initialPaymentClaimReceipts.values()][0]));
    const publicText = JSON.stringify({ claim: f.claim, dispute: f.dispute, inspection: await f.coordinator.inspect(f.ownerInput),
      publications: after.coordination.publications });
    for (const privateField of ["canonicalBasis", "canonical_input", "passwordHash", "accountNumber", "branchNumber", "sim://",
      f.canonical.buyerSessionToken, f.canonical.ownerSessionToken, PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE.contentBase64,
      PAYMENT_MARKETPLACE_SYNTHETIC_REASON]) expect(publicText).not.toContain(privateField);
  }, TIMEOUT);
});
