// @vitest-environment node
// Binary and relational recovery against real disposable PostgreSQL storage.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { walletDigest } from "./commands";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import {
  exportInitialMarketplaceWalletBackup, inspectInitialMarketplaceWalletBackup,
  inspectRestoredInitialMarketplaceWallet, restoreInitialMarketplaceWalletBackup,
} from "./initial-marketplace-backup";
import { parseInitialMarketplaceWalletBackup } from "./initial-marketplace-backup-manifest";
import { initializeInitialMarketplaceCoordination } from "./initial-marketplace-coordination-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "./initial-marketplace-coordinator";
import { readInitialMarketplaceRecoveryRows } from "./initial-marketplace-recovery-store";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const BINARY = Buffer.from(Array.from({ length: 257 }, (_, index) => index % 256));
const LARGE_VERSION = "9007199254741993";
const BINARY_ID = "initial-recovery-binary-history", NULL_ID = "initial-recovery-null-history";
let directory: string, source: WalletStore;
let fixture: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
let serialized: string, micros: string, now: number, targetIndex = 0;
const targets: WalletStore[] = [];
const ownerInput = () => ({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });
const clock = () => now;
const exportSource = (store = source) => exportInitialMarketplaceWalletBackup({ mode: MODE, store, ...ownerInput(), clock });
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });

function guardedRuntime() {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
}
beforeAll(async () => {
  guardedRuntime();
  directory = await mkdtemp(join(tmpdir(), "alpha-initial-recovery-preservation-"));
  source = await createFileWalletStore({ mode: MODE, dataDir: join(directory, "source") });
  fixture = (await buildInitialMarketplaceFixture(source, { initializeCoordination: false })).canonical;
  micros = fixture.at.replace(/\.000Z$/, ".123456Z");
  expect(micros).toMatch(/\.123456Z$/);
  now = fixture.acceptedAtMs;
  await source.transaction(async tx => {
    // The existing authentication policy accepts an owner in the stored roles
    // array. Historical scalar labels are NOT a substitute for that authority.
    await tx.query(`UPDATE alpha_exchange.users SET role='buyer',created_at=$2::timestamptz,updated_at=$2::timestamptz,
      payload=payload || jsonb_build_object('role','buyer','roles',jsonb_build_array('buyer','owner'),
        'createdAt',$2::text,'updatedAt',$2::text) WHERE id=$1`, [fixture.ownerId, micros]);
    for (const [id, bytes] of [[BINARY_ID, BINARY], [NULL_ID, null]] as const) {
      const payload = { id, purchaseRequestId: fixture.buyerHistoryRequestId, side: "buyer", uploadedByUserId: fixture.buyerId,
        mimeType: "application/octet-stream", fileName: `${id}.bin`, sizeBytes: bytes?.byteLength ?? 0, uploadedAt: micros };
      await tx.query(`INSERT INTO alpha_exchange.evidence
        (id,purchase_request_id,side,uploaded_by_user_id,mime_type,file_name,size_bytes,uploaded_at,sort_index,payload,content)
        VALUES ($1,$2,'buyer',$3,$4,$5,$6,$7::timestamptz,$8,$9::jsonb,decode($10::text,'hex'))`,
      [id, payload.purchaseRequestId, payload.uploadedByUserId, payload.mimeType, payload.fileName, payload.sizeBytes,
        micros, id === BINARY_ID ? 101 : 102, JSON.stringify(payload), bytes?.toString("hex") ?? null]);
    }
  });
  await initializeInitialMarketplaceCoordination({ mode: MODE, store: source, acknowledgeDevelopmentSchema: true });
  const coordinator = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store: source, clock });
  await coordinator.activateRequest({ ...ownerInput(), operationId: "preservation-owner-activation",
    assetId: fixture.assetId, walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId });
  await coordinator.acceptRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId,
    operationId: "preservation-seller-acceptance" });
  now += 1000;
  await coordinator.pause({ ...ownerInput(), operationId: "preservation-source-pause" });
  // This monotonic metadata value intentionally exceeds JavaScript's safe
  // integer range; financial command revisions and timestamps remain bounded.
  await source.transaction(tx => tx.query("UPDATE alpha_exchange.runtime_meta SET version=$1::bigint,updated_at=$2::timestamptz WHERE singleton",
    [LARGE_VERSION, micros]));
  serialized = await exportSource();
}, TIMEOUT);
beforeEach(guardedRuntime);
afterEach(async () => {
  const outcomes = await Promise.allSettled(targets.splice(0).map(store => store.close()));
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
}, TIMEOUT);
afterAll(async () => {
  try { await source?.close(); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);

async function target() {
  const store = await createFileWalletStore({ mode: MODE, dataDir: join(directory, `target-${++targetIndex}`) });
  targets.push(store); return store;
}
const expectedChecksum = () => inspectInitialMarketplaceWalletBackup(serialized).checksum;
const restore = (store: WalletStore) => restoreInitialMarketplaceWalletBackup({ mode: MODE, store, backup: serialized,
  acknowledgeFreshTarget: true, expectedChecksum: expectedChecksum(), clock: () => now + 1000 });
async function schemaNames(store: WalletStore) {
  return store.transaction(async tx => (await tx.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%' ORDER BY nspname`)).rows);
}

describe("initial marketplace recovery preserves exact retained storage", () => {
  it("round-trips binary/null historical evidence, microseconds and large int8 metadata without changing original financial history", async () => {
    const envelope = parseInitialMarketplaceWalletBackup(serialized);
    expect(envelope.canonical.runtime_meta[0]).toMatchObject({ version: LARGE_VERSION, updated_at: micros });
    expect(envelope.canonical.users.find(row => row.id === fixture.ownerId)).toMatchObject({ created_at: micros, updated_at: micros });
    const binary = envelope.canonical.evidence.find(row => row.id === BINARY_ID)!;
    expect(binary.content).toBe(BINARY.toString("base64"));
    expect(binary.content!.length).toBeGreaterThan(76);
    expect(binary.content).not.toContain("\n");
    expect(binary.uploaded_at).toBe(micros);
    expect(envelope.canonical.evidence.find(row => row.id === NULL_ID)?.content).toBeNull();

    const restored = await target(), result = await restore(restored);
    expect(result.restored.revision).toBe(envelope.wallet.commands.length + 1);
    const actual = await restored.transaction(async tx => {
      const evidence = (await tx.query<{ id: string; hex: string | null; size: number | null; exact_time: boolean }>(
        `SELECT id,encode(content,'hex') AS hex,octet_length(content) AS size,uploaded_at=$1::timestamptz AS exact_time
          FROM alpha_exchange.evidence ORDER BY id`, [micros])).rows;
      const runtime = (await tx.query<{ version: string; exact_time: boolean }>(
        "SELECT version::text AS version,updated_at=$1::timestamptz AS exact_time FROM alpha_exchange.runtime_meta", [micros])).rows[0];
      const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
        command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
        FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
      return { evidence, runtime, commands, rows: await readInitialMarketplaceRecoveryRows(tx) };
    });
    expect(actual.evidence).toEqual([
      { id: BINARY_ID, hex: BINARY.toString("hex"), size: BINARY.byteLength, exact_time: true },
      { id: NULL_ID, hex: null, size: null, exact_time: true },
    ]);
    expect(actual.runtime).toEqual({ version: LARGE_VERSION, exact_time: true });
    expect(actual.commands.slice(0, -1)).toEqual(envelope.wallet.commands);
    expect(actual.rows).toEqual({ canonical: envelope.canonical, coordination: envelope.coordination });
    const inspected = await inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: restored, expectedChecksum: expectedChecksum() });
    expect(inspected.canonicalDigest).toBe(walletDigest(envelope.canonical));
    expect(inspected.quarantined).toBe(true);
    expect(await exportSource()).toBe(serialized);
  }, TIMEOUT);

  it("authenticates a current multi-role owner while restoring only the original scalar identity and disabled stub", async () => {
    const envelope = parseInitialMarketplaceWalletBackup(serialized);
    expect(envelope.ownerId).toBe(fixture.ownerId);
    expect(envelope.canonical.users.find(row => row.id === fixture.ownerId)?.role).toBe("buyer");
    const restored = await target(); await restore(restored);
    const owner = await restored.transaction(async tx => (await tx.query<{ role: string; payload: Record<string, unknown> }>(
      "SELECT role,payload FROM alpha_exchange.users WHERE id=$1", [fixture.ownerId])).rows[0]);
    expect(owner.role).toBe("buyer");
    expect(owner.payload).toMatchObject({ id: fixture.ownerId, role: "buyer", disabled: true, emailVerified: false,
      recoveryIdentityOnly: true, availabilityStatus: "away", onlineStatus: "offline", createdAt: micros, updatedAt: micros });
    expect(owner.payload).not.toHaveProperty("roles"); expect(owner.payload).not.toHaveProperty("passwordHash");
    expect((await inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: restored, expectedChecksum: expectedChecksum() })).ownerId).toBe(fixture.ownerId);
    await expect(exportInitialMarketplaceWalletBackup({ mode: MODE, store: restored, ...ownerInput(), clock })).rejects.toThrow();
  }, TIMEOUT);

  it("refuses nonzero source and target transaction timezones without changing evidence or creating target schemas", async () => {
    const inNonzeroTimezone = (store: WalletStore): WalletStore => ({ transaction: work => store.transaction(async tx => {
      await tx.exec("SET LOCAL TIME ZONE 'Etc/GMT-2'"); return work(tx);
    }), close: async () => undefined });
    await expect(exportSource(inNonzeroTimezone(source))).rejects.toThrow(/UTC/);
    expect(await exportSource()).toBe(serialized);
    const empty = await target(), before = await schemaNames(empty);
    await expect(restore(inNonzeroTimezone(empty))).rejects.toThrow(/UTC/);
    expect(await schemaNames(empty)).toEqual(before); expect(before).toEqual([]);
  }, TIMEOUT);

  it.each([
    { label: "an extra canonical table", sql: "CREATE TABLE alpha_exchange.unexpected_recovery_data (id text)", reason: /application tables/ },
    { label: "an extra canonical column", sql: "ALTER TABLE alpha_exchange.evidence ADD COLUMN unsupported_label text", reason: /application columns/ },
    { label: "different canonical nullability", sql: "ALTER TABLE alpha_exchange.evidence ALTER COLUMN mime_type DROP NOT NULL", reason: /nullability/ },
    { label: "a partial mobile authentication pair", sql: "DROP TABLE alpha_exchange.mobile_refresh_token_history", reason: /both exact mobile/ },
    { label: "an unrelated schema", sql: "CREATE SCHEMA unrelated_initial_recovery", reason: /schema set/ },
  ])("refuses $label and rolls back the attempted source change", async ({ sql, reason }) => {
    await expect(source.transaction(async tx => {
      await tx.exec(sql);
      return exportSource(bound(tx));
    })).rejects.toThrow(reason);
    expect(await exportSource()).toBe(serialized);
  }, TIMEOUT);
});
