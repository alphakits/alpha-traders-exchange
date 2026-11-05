// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildCancellationMarketplaceFixture } from "../../../scripts/alpha-wallet/cancellation-marketplace-fixtures";
import { MAX_WALLET_BACKUP_BYTES, inspectWalletBackup } from "./backup";
import { exportCancellationMarketplaceWalletBackup } from "./cancellation-marketplace-backup";
import { inspectCancellationMarketplaceWalletBackup, parseCancellationMarketplaceWalletBackup,
  type CancellationMarketplaceWalletBackupEnvelope } from "./cancellation-marketplace-backup-manifest";
import { walletDigest } from "./commands";
import { createFileWalletStore } from "./durable-store";
import { inspectInitialMarketplaceWalletBackup } from "./initial-marketplace-backup-manifest";
import { inspectMarketplaceWalletBackup } from "./marketplace-backup-manifest";
import { inspectV3WalletBackup } from "./v3-backup";
import { inspectV4WalletBackup } from "./v4-backup";
import { verifyV4History } from "./v4-durable";
import { isV4State } from "./v4-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
type Sample = { serialized: string; document: CancellationMarketplaceWalletBackupEnvelope; credentials: string[] };
let cancelled: Sample, accepted: Sample, inherited: Sample;
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  const directory = await mkdtemp(join(tmpdir(), "alpha-cancellation-manifest-"));
  const sample = async (name: string, options: Parameters<typeof buildCancellationMarketplaceFixture>[1]) => {
    const store = await createFileWalletStore({ mode: MODE, dataDir: join(directory, name) });
    try {
      const fixture = await buildCancellationMarketplaceFixture(store, options);
      const serialized = await exportCancellationMarketplaceWalletBackup({ mode: MODE, store, ...fixture.ownerInput, clock: () => fixture.clock() + 1000 });
      return { serialized, document: parseCancellationMarketplaceWalletBackup(serialized), credentials: [
        fixture.canonical.ownerSessionToken, fixture.canonical.buyerSessionToken, fixture.canonical.sellerSessionToken,
        ...Object.values(fixture.canonical.mobile.credentials).map(value => value.accessToken),
      ] };
    } finally { await store.close(); }
  };
  try {
    cancelled = await sample("cancelled", { cancel: true, pause: true });
    accepted = await sample("accepted", { assetId: "bsc-sim-binance-peg-usdt", paymentMethod: "Face-to-Face", platform: "android", pause: true });
    inherited = await sample("inherited", { sourcePaused: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);
afterAll(() => vi.unstubAllEnvs());
function resealed(document: CancellationMarketplaceWalletBackupEnvelope) {
  const { checksum: _walletChecksum, ...wallet } = document.wallet; void _walletChecksum;
  document.wallet.checksum = walletDigest(wallet);
  const { checksum: _checksum, ...body } = document; void _checksum;
  document.checksum = walletDigest(body);
  return JSON.stringify(document);
}
function changed(mutate: (document: CancellationMarketplaceWalletBackupEnvelope) => void, source = cancelled) {
  const document = structuredClone(source.document); mutate(document); return resealed(document);
}

describe("cancellation successor recovery manifest", () => {
  it("retains both accepted and cancelled successors with exact original predecessor evidence", () => {
    for (const [sample, count] of [[cancelled, 1], [accepted, 0], [inherited, 0]] as const) {
      const document = parseCancellationMarketplaceWalletBackup(sample.serialized);
      const inspection = inspectCancellationMarketplaceWalletBackup(sample.serialized);
      expect(inspection).toMatchObject({ formatVersion: 1, schemaVersion: "canonical-initial-cancellation-cohort-v1",
        cancellationCount: count, halted: true, credentialsIncluded: false });
      expect(document.wallet).toMatchObject({ formatVersion: 4, scope: "cancellation-marketplace-v4-ledger", sourcePaused: true });
      expect(document.coordination.transitions[0].predecessor).toEqual({ activation: document.predecessor.activations[0],
        acceptance: document.predecessor.acceptances[0], publication: document.predecessor.publications[0] });
      const recovered = verifyV4History(document.wallet.commands);
      expect(isV4State(recovered.state)).toBe(true);
      if (!isV4State(recovered.state)) throw new Error("Missing V4 state");
      expect(recovered.state.initialAcceptanceReceipts.size).toBe(1);
      expect(recovered.state.initialCancellationReceipts.size).toBe(count);
      expect(recovered.state.haltReason).toBeTruthy();
    }
  });
  it("preserves a pause inherited before upgrade without inventing a cancellation or final source pause", () => {
    expect(inherited.document.wallet.commands.at(-1)!.command_type).toBe("continueFromV3");
    expect(inherited.document.wallet.cancellationContinuation.sourceHaltReason).toBeTruthy();
    expect(inherited.document.coordination.cancellations).toHaveLength(0);
    expect(inspectCancellationMarketplaceWalletBackup(inherited.serialized).cancellationCount).toBe(0);
  });
  it("excludes raw account/session material while retaining all canonical financial rows", () => {
    for (const sample of [cancelled, accepted]) {
      for (const token of sample.credentials) {
        expect(sample.serialized).not.toContain(token);
        expect(sample.serialized).not.toContain(createHash("sha256").update(token).digest("hex"));
      }
      for (const word of ["passwordHash", "token_hash", "access_token_hash", "refresh_token_hash", "device_id_hash"]) expect(sample.serialized).not.toContain(word);
      expect(sample.document.canonical.users.every(user => !Object.hasOwn(user, "payload"))).toBe(true);
      expect(sample.document.coordination.cancellations.every(row => !Object.hasOwn(row.canonical_basis, "users"))).toBe(true);
    }
  });
  it("returns detached metadata without canonical payloads, destinations or command inputs", () => {
    const result = inspectCancellationMarketplaceWalletBackup(cancelled.serialized, { expectedChecksum: cancelled.document.checksum });
    expect(result.commandCount).toBe(cancelled.document.wallet.commands.length);
    expect(result.predecessorRowCounts).toEqual({ activations: 1, acceptances: 1, publications: 1 });
    expect(JSON.stringify(result)).not.toContain("canonical_basis");
    expect(JSON.stringify(result)).not.toContain("buyerReceivingWalletAddress");
    result.checkpoint.revision = 0;
    expect(inspectCancellationMarketplaceWalletBackup(cancelled.serialized).checkpoint.revision).toBeGreaterThan(0);
    expect(() => inspectCancellationMarketplaceWalletBackup(cancelled.serialized, { expectedChecksum: "f".repeat(64) })).toThrow();
  });
  it.each([
    ["standalone v1", inspectWalletBackup], ["isolated v3", inspectV3WalletBackup], ["isolated v4", inspectV4WalletBackup],
    ["amount correction", inspectMarketplaceWalletBackup], ["initial cohort", inspectInitialMarketplaceWalletBackup],
  ] as const)("keeps %s readers closed to the successor format", (_name, reader) => {
    expect(() => reader(cancelled.serialized)).toThrow();
  });
  const mutations: [string, (document: CancellationMarketplaceWalletBackupEnvelope) => void][] = [
    ["old outer profile", d => { (d as unknown as { schemaVersion: string }).schemaVersion = "canonical-initial-cohort-v1"; }],
    ["old nested scope", d => { (d.wallet as unknown as { scope: string }).scope = "isolated-v4-ledger"; }],
    ["false paused assertion", d => { (d.wallet as unknown as { sourcePaused: boolean }).sourcePaused = false; }],
    ["missing original command", d => { d.wallet.commands.splice(1, 1); }],
    ["changed historical state hash", d => { d.wallet.commands[0].state_hash = "e".repeat(64); }],
    ["changed inherited halt", d => { d.wallet.cancellationContinuation.sourceHaltReason = "invented"; }],
    ["changed v2 continuation", d => { d.wallet.continuation.commandRevision += 1; }],
    ["changed v3 continuation", d => { d.wallet.initialContinuation.commandKey = "changed"; }],
    ["changed original activation digest", d => { d.predecessor.activations[0].input_digest = "e".repeat(64); }],
    ["changed original acceptance receipt", d => { d.predecessor.acceptances[0].receipt.principalRaw = "1"; }],
    ["missing original publication", d => { d.predecessor.publications = []; }],
    ["changed original publication", d => { d.predecessor.publications[0].payload.walletRevision += 1; }],
    ["changed upgrade fingerprint", d => { d.coordination.transitions[0].input_digest = "e".repeat(64); }],
    ["changed upgrade command", d => { d.coordination.transitions[0].wallet_command_key = "changed"; }],
    ["changed upgrade event", d => { d.coordination.transitions[0].wallet_event_hash = "e".repeat(64); }],
    ["changed duplicated predecessor", d => { d.coordination.transitions[0].predecessor.activation.actor_user_id = "other-owner"; }],
    ["changed cancellation receipt", d => { d.coordination.cancellations[0].receipt.transferAmountRaw = "0"; }],
    ["changed cancellation actor", d => { d.coordination.cancellations[0].actor_user_id = d.ownerId; }],
    ["changed cancellation fingerprint", d => { d.coordination.cancellations[0].input_digest = "e".repeat(64); }],
    ["changed cancellation prestate", d => { d.coordination.cancellations[0].canonical_basis.request.payload.usdtAmount = "1"; }],
    ["changed recorded role", d => { d.coordination.cancellations[0].canonical_basis.actorRole = "owner"; }],
    ["changed cancellation result", d => { d.coordination.cancellations[0].canonical_result.request.status = "accepted"; }],
    ["missing cancellation publication", d => { d.coordination.publications = []; }],
    ["changed cancellation publication", d => { d.coordination.publications[0].payload.termsDigest = "e".repeat(64); }],
    ["reversed notification identities", d => { d.coordination.publications[0].payload.notificationIds.reverse(); }],
    ["missing cancellation audit", d => { d.canonical.audit_logs = d.canonical.audit_logs.filter(row => row.id !== d.coordination.publications[0].payload.auditId); }],
    ["changed reopened listing", d => { const row = d.canonical.listings.find(row => row.id === d.predecessor.activations[0].platform_listing_id)!; row.status = "matched"; row.payload.status = "matched"; }],
    ["missing physical trade", d => { d.canonical.trades = d.canonical.trades.filter(row => row.id !== d.predecessor.activations[0].platform_trade_id); }],
    ["changed sibling payload", d => { const row = d.canonical.purchase_requests.find(row => row.id !== d.requestId
      && row.listing_id === d.predecessor.activations[0].platform_listing_id)!; row.payload.buyerNotes = "changed"; }],
    ["credential in canonical payload", d => { d.canonical.purchase_requests[0].payload.passwordHash = "forbidden"; }],
    ["credential in predecessor provenance", d => { d.predecessor.activations[0].canonical_basis.request.payload.accessToken = "forbidden"; }],
    ["private users in cancellation basis", d => { Object.assign(d.coordination.cancellations[0].canonical_basis, { users: [{ passwordHash: "forbidden" }] }); }],
    ["changed row chronology", d => { d.canonical.users[0].updated_at = "1970-01-01T00:00:00.000000Z"; }],
  ];
  it.each(mutations)("rejects %s even after both checksums are recomputed", (_name, mutate) => {
    const serialized = changed(mutate);
    expect(() => parseCancellationMarketplaceWalletBackup(serialized)).toThrow();
  });
  it("refuses new cancellation or unbound trade rows in an accepted-only successor", () => {
    expect(() => parseCancellationMarketplaceWalletBackup(changed(d => { d.coordination.cancellations = structuredClone(cancelled.document.coordination.cancellations); }, accepted))).toThrow();
  });
  it("refuses truncated, oversized, prototype and deeply nested documents", () => {
    expect(() => parseCancellationMarketplaceWalletBackup(cancelled.serialized.slice(0, -1))).toThrow();
    expect(() => parseCancellationMarketplaceWalletBackup(" ".repeat(MAX_WALLET_BACKUP_BYTES + 1))).toThrow();
    const prototype = cancelled.serialized.replace('"canonical": {', '"canonical": {"__proto__": {},');
    expect(() => parseCancellationMarketplaceWalletBackup(prototype)).toThrow();
    let nested: unknown = null;
    for (let index = 0; index < 70; index++) nested = { nested };
    expect(() => parseCancellationMarketplaceWalletBackup(changed(d => { d.canonical.purchase_requests[0].payload.deep = nested; }))).toThrow();
  });
});
