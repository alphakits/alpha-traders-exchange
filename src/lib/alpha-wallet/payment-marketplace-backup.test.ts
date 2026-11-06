// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPaymentMarketplaceFixture } from "../../../scripts/alpha-wallet/payment-marketplace-fixtures";
import { walletDigest } from "./commands";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { exportCancellationMarketplaceWalletBackup } from "./cancellation-marketplace-backup";
import { exportInitialMarketplaceWalletBackup } from "./initial-marketplace-backup";
import { createDevelopmentPaymentMarketplaceWalletCoordinator } from "./payment-marketplace-coordinator";
import { exportMobilePaymentMarketplaceWalletBackup, exportPaymentMarketplaceWalletBackup,
  inspectRestoredPaymentMarketplaceWallet, restorePaymentMarketplaceWalletBackup } from "./payment-marketplace-backup";
import { inspectPaymentMarketplaceWalletBackup, parsePaymentMarketplaceWalletBackup,
  type PaymentMarketplaceWalletBackupEnvelope } from "./payment-marketplace-backup-manifest";
import { readPaymentMarketplaceRecoveryRows, assertPaymentMarketplaceRecoveryIdentityQuarantine, assertFreshPaymentMarketplaceRecoveryTarget, installPaymentMarketplaceRecoveryRows } from "./payment-marketplace-recovery-store";
import { exportV5WalletBackup } from "./v5-backup";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
let source: WalletStore, fixture: Awaited<ReturnType<typeof buildPaymentMarketplaceFixture>>, backup: string, envelope: PaymentMarketplaceWalletBackupEnvelope;
const stores: WalletStore[] = [], directories: string[] = [];
async function fresh() { const dir = await mkdtemp(join(tmpdir(), "alpha-payment-recovery-")); directories.push(dir);
  const store = await createFileWalletStore({ mode: MODE, dataDir: dir }); stores.push(store); return store; }
const rewrite = (edit: (copy: PaymentMarketplaceWalletBackupEnvelope) => void) => {
  const copy = structuredClone(envelope); edit(copy); const { checksum: _old, ...body } = copy; void _old;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
};
const restore = (store: WalletStore, value = backup) => restorePaymentMarketplaceWalletBackup({ mode: MODE, store, backup: value,
  expectedChecksum: JSON.parse(value).checksum, acknowledgeFreshTarget: true, clock: () => fixture.clock() + 100 });
const wrap = (store: WalletStore, hook: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(hook(tx))), close: async () => undefined,
});
async function namespaces(store: WalletStore) { return store.transaction(async tx => (await tx.query<{ nspname: string }>(
  "SELECT nspname FROM pg_namespace WHERE nspname IN ('alpha_exchange','alpha_wallet_simulation','alpha_wallet_initial_marketplace_simulation','alpha_wallet_cancellation_marketplace_simulation','alpha_wallet_payment_marketplace_simulation') ORDER BY nspname")).rows); }
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  source = await fresh(); fixture = await buildPaymentMarketplaceFixture(source, { dispute: true, pause: true });
  backup = await exportPaymentMarketplaceWalletBackup({ mode: MODE, store: source, ...fixture.ownerInput, clock: fixture.clock });
  envelope = parsePaymentMarketplaceWalletBackup(backup);
}, TIMEOUT);
afterAll(async () => { for (const store of stores) await store.close(); for (const dir of directories) await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); }, TIMEOUT);

describe("complete private V5 payment successor recovery", () => {
  it("retains exact V1-V4 history and both predecessors with byte-free public metadata", () => {
    const inspection = inspectPaymentMarketplaceWalletBackup(backup, { expectedChecksum: envelope.checksum });
    expect(inspection).toMatchObject({ halted: true, credentialsIncluded: false, claimCount: 1, disputeCount: 1, evidenceCount: 1, cancellationCount: 0 });
    expect(envelope.wallet.formatVersion).toBe(5); expect(envelope.wallet.paymentContinuation.checkpoint.revision).toBe(fixture.upgrade!.sourceRevision);
    expect(envelope.predecessor.initial.acceptances).toHaveLength(1); expect(envelope.predecessor.cancellation.transitions).toHaveLength(1);
    expect(JSON.stringify(inspection)).not.toContain("reason"); expect(JSON.stringify(inspection)).not.toContain("contentBase64");
    expect(JSON.stringify(envelope.coordination)).not.toContain("contentBase64");
    expect(envelope.canonical.evidence[0].content).toBe(fixture.evidence!.contentBase64);
  });
  it("exports identical bytes through the currently authenticated mobile owner", async () => {
    expect(await exportMobilePaymentMarketplaceWalletBackup({ mode: MODE, store: source, ...fixture.mobileOwnerInput, clock: fixture.clock })).toBe(backup);
  }, TIMEOUT);
  it("old initial, cancellation and isolated exporters retain their old scopes", async () => {
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: source, ...fixture.ownerInput, clock: fixture.clock })).rejects.toThrow();
    await expect(exportCancellationMarketplaceWalletBackup({ mode: MODE, store: source, ...fixture.ownerInput, clock: fixture.clock })).rejects.toThrow();
    await expect(exportV5WalletBackup({ mode: MODE, store: source, clock: fixture.clock })).rejects.toThrow();
  }, TIMEOUT);
  it("requires a separate matching expected checksum", () => {
    expect(() => parsePaymentMarketplaceWalletBackup(backup, "0".repeat(64))).toThrow();
  });
  const changes: Array<[string, (copy: PaymentMarketplaceWalletBackupEnvelope) => void]> = [
    ["changed exact evidence bytes", e => { const bytes = Buffer.from(e.canonical.evidence[0].content!, "base64"); bytes[bytes.length - 1] ^= 1; e.canonical.evidence[0].content = bytes.toString("base64"); }],
    ["missing evidence bytes", e => { e.canonical.evidence[0].content = null; }],
    ["changed evidence MIME", e => { e.canonical.evidence[0].mime_type = "application/pdf"; e.canonical.evidence[0].payload.mimeType = "application/pdf"; }],
    ["changed evidence digest", e => { e.coordination.claims[0].canonical_input.evidence!.contentDigest = "0".repeat(64); }],
    ["remote evidence storage path", e => { e.canonical.evidence[0].payload.storagePath = "https://example.invalid/private.pdf"; }],
    ["changed private dispute reason", e => { e.coordination.dispute_freezes[0].canonical_input.reason = "Changed assertion"; }],
    ["changed dispute evidence linkage", e => { e.canonical.disputes[0].payload.buyerEvidenceId = "unrelated-proof"; }],
    ["missing coordinated dispute", e => { e.coordination.dispute_freezes = []; }],
    ["missing generated notification", e => { const id = e.coordination.claims[0].canonical_result.notifications[0].id; e.canonical.notifications = e.canonical.notifications.filter(row => row.id !== id); }],
    ["missing generated audit", e => { const id = e.coordination.dispute_freezes[0].canonical_result.auditLogs[0].id; e.canonical.audit_logs = e.canonical.audit_logs.filter(row => row.id !== id); }],
    ["missing safe publication", e => { e.coordination.publications.pop(); }],
    ["private reason in public event", e => { (e.coordination.publications[0].payload as Record<string, unknown>).reason = "private assertion"; }],
    ["changed V4 predecessor receipt", e => { e.predecessor.initial.acceptances[0].receipt.principalRaw = "1"; }],
    ["changed V4 continuation", e => { e.predecessor.cancellation.transitions[0].continuation.sourceHaltReason = "forged"; }],
    ["forged cancelled source", e => { e.coordination.transitions[0].source_status = "cancelled"; }],
    ["foreign business actor", e => { e.coordination.claims[0].actor_user_id = e.predecessor.initial.activations[0].seller_id; }],
    ["credential material in canonical history", e => { e.canonical.purchase_requests[0].payload.accessToken = "forbidden"; }],
    ["binary material in financial receipt", e => { (e.coordination.claims[0].receipt as unknown as Record<string, unknown>).contentBase64 = fixture.evidence!.contentBase64; }],
    ["replaced immutable claim basis", e => { e.coordination.claims[0].canonical_basis.request.payload.updatedAt = "2026-01-01T00:00:00.000Z"; }],
    ["missing original acceptance publication", e => { e.predecessor.initial.publications = []; }],
    ["changed normalized trade status", e => { e.canonical.trades[0].status = "completed"; }],
    ["duplicated action row", e => { e.coordination.claims.push(structuredClone(e.coordination.claims[0])); }],
  ];
  it.each(changes)("rejects a rechecksummed bundle with %s", (_name, edit) => { expect(() => parsePaymentMarketplaceWalletBackup(rewrite(edit))).toThrow(); });
  it("restores exact paused history plus one quarantine and no credential authority", async () => {
    const target = await fresh(), result = await restore(target);
    expect(result.restored.revision).toBe(envelope.wallet.checkpoint.revision + 1);
    expect(result.quarantined).toBe(true);
    expect(await inspectRestoredPaymentMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: envelope.checksum })).toMatchObject({ checksum: envelope.checksum, restored: result.restored });
    await target.transaction(async tx => {
      await assertPaymentMarketplaceRecoveryIdentityQuarantine(tx);
      const rows = await readPaymentMarketplaceRecoveryRows(tx);
      expect(rows).toEqual({ canonical: envelope.canonical, predecessor: envelope.predecessor, coordination: envelope.coordination });
      expect((await tx.query("SELECT * FROM alpha_wallet_initial_marketplace_simulation.transaction_contexts")).rows).toEqual([]);
      expect((await tx.query("SELECT * FROM alpha_wallet_cancellation_marketplace_simulation.transaction_contexts")).rows).toEqual([]);
    });
    const coordinator = createDevelopmentPaymentMarketplaceWalletCoordinator({ mode: MODE, store: target, clock: () => fixture.clock() + 101 });
    await expect(coordinator.upgradeRequest({ ...fixture.ownerInput, operationId: "restore-owner-reentry", acknowledgeVersionUpgrade: true,
      acknowledgePaymentClaimOnlyProfile: true })).rejects.toThrow();
    await expect(restore(target)).rejects.toThrow();
    for (const sql of ["UPDATE alpha_exchange.users SET payload=payload", "DELETE FROM alpha_exchange.sessions WHERE false", "TRUNCATE alpha_exchange.evidence",
      "UPDATE alpha_wallet_cancellation_marketplace_simulation.transitions SET profile=profile", "DELETE FROM alpha_wallet_payment_marketplace_simulation.claims WHERE false"]) {
      await expect(target.transaction(tx => tx.query(sql))).rejects.toThrow();
    }
  }, TIMEOUT);
  it.each(["canonical schema", "original initial evidence", "V4 transition", "payment action", "completion receipt"])("rolls back every write after injected failure at %s", async stage => {
    const target = await fresh(); let failed = false;
    const matches = (sql: string) => stage === "canonical schema" ? sql.startsWith("-- DEVELOPMENT ONLY: successor payment recovery canonical")
      : stage === "original initial evidence" ? sql.startsWith("INSERT INTO alpha_wallet_initial_marketplace_simulation.activations")
      : stage === "V4 transition" ? sql.startsWith("INSERT INTO alpha_wallet_cancellation_marketplace_simulation.transitions")
      : stage === "payment action" ? sql.startsWith("INSERT INTO alpha_wallet_payment_marketplace_simulation.claims")
      : sql.startsWith("UPDATE alpha_wallet_payment_marketplace_simulation.recovery_receipts SET receipt=");
    const wrapped = wrap(target, tx => ({ query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => { const r = await tx.query<Row>(sql, values); if (matches(sql)) { failed = true; throw new Error("synthetic recovery checkpoint failure"); } return r; },
      exec: async sql => { await tx.exec(sql); if (matches(sql)) { failed = true; throw new Error("synthetic recovery checkpoint failure"); } } }));
    await expect(restore(wrapped)).rejects.toThrow(); expect(failed).toBe(true); expect(await namespaces(target)).toEqual([]);
  }, TIMEOUT);
  it("inspects a committed target after acknowledgment loss without replaying restore", async () => {
    const target = await fresh(); let lose = true;
    const wrapped: WalletStore = { transaction: async work => { const result = await target.transaction(work); if (lose) { lose = false;
      throw new CommitOutcomeUnknownError(new Error("synthetic committed response loss")); } return result; }, close: async () => undefined };
    await expect(restore(wrapped)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const receipt = await inspectRestoredPaymentMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: envelope.checksum });
    expect(receipt.restored.revision).toBe(envelope.wallet.checkpoint.revision + 1);
    await expect(restore(target)).rejects.toThrow();
  }, TIMEOUT);
  it("keeps an earlier fresh-target certificate when a raw handle is replaced", async () => {
    let current = "101", aborted = false;
    const tx: WalletSql = {
      async query<Row extends Record<string, unknown>>(sql: string): Promise<{ rows: Row[] }> {
        if (sql.includes("SELECT 1 / 0")) { aborted = true; throw new Error("replacement should never be poisoned"); }
        const rows = sql.includes("transaction_isolation") ? [{ transaction_id: current, isolation: "serializable", read_only: "off", development_mode: MODE, time_zone: "UTC" }]
          : sql.includes("txid_current()::text AS transaction_id") ? [{ transaction_id: current }]
          : sql.includes("AS present") ? [{ present: false }] : [];
        return { rows: rows as unknown as Row[] };
      },
      exec: async () => { throw new Error("Replacement must fail before recovery DDL"); },
    };
    await assertFreshPaymentMarketplaceRecoveryTarget(tx);
    current = "202";
    await expect(installPaymentMarketplaceRecoveryRows(tx, { canonical: envelope.canonical, predecessor: envelope.predecessor,
      coordination: envelope.coordination })).rejects.toThrow(/identity changed/);
    expect(aborted).toBe(false);
  });
  it.each(["claim", "dispute"] as const)("SQL deferred seal rejects a missing %s publication even if application coherence checks are suppressed", async operation => {
    const target = await fresh(), f = await buildPaymentMarketplaceFixture(target, { claim: operation === "dispute" });
    let omitted = false;
    const wrapped = wrap(target, tx => ({
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (sql.startsWith("INSERT INTO alpha_wallet_payment_marketplace_simulation.publications")) { omitted = true; return { rows: [] as Row[] }; }
        if (sql === "SELECT alpha_wallet_payment_marketplace_simulation.assert_coherence()") return { rows: [] as Row[] };
        return tx.query<Row>(sql, values);
      }, exec: tx.exec.bind(tx),
    }));
    const coordinator = createDevelopmentPaymentMarketplaceWalletCoordinator({ mode: MODE, store: wrapped, clock: f.clock });
    await expect(operation === "claim" ? coordinator.claimPayment({ ...f.buyerInput, operationId: "deferred-publication-claim", evidence: f.evidence })
      : coordinator.openDispute({ ...f.buyerInput, operationId: "deferred-publication-dispute", reason: "The payment has not been acknowledged." })).rejects.toThrow();
    expect(omitted).toBe(true);
    expect(await f.coordinator.inspect(f.ownerInput)).toMatchObject({ claim: operation === "claim" ? null : expect.anything(), dispute: null });
  }, TIMEOUT);
  it.each([
    ["cancelled archival V4", { cancel: true, pause: true }],
    ["inherited paused V4", { sourcePaused: true }],
    ["claimed Face-to-Face BSC", { paymentMethod: "Face-to-Face", assetId: "bsc-sim-binance-peg-usdt", claim: true, pause: true }],
  ] as const)("round-trips %s without granting new payment authority", async (_name, options) => {
    const alternate = await fresh(), f = await buildPaymentMarketplaceFixture(alternate, options);
    const serialized = await exportPaymentMarketplaceWalletBackup({ mode: MODE, store: alternate, ...f.ownerInput, clock: f.clock });
    const e = parsePaymentMarketplaceWalletBackup(serialized), target = await fresh();
    const result = await restorePaymentMarketplaceWalletBackup({ mode: MODE, store: target, backup: serialized, expectedChecksum: e.checksum,
      acknowledgeFreshTarget: true, clock: () => f.clock() + 100 });
    expect(result.restored.revision).toBe(e.wallet.checkpoint.revision + 1);
    expect((await inspectRestoredPaymentMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: e.checksum })).quarantined).toBe(true);
  }, TIMEOUT);
});
