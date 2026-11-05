// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { walletDigest } from "./commands";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import {
  assertInitialMarketplaceCoherence, bindInitialMarketplaceCommand, initializeInitialMarketplaceCoordination,
  insertInitialMarketplaceActivation, readInitialMarketplaceAcceptance, readInitialMarketplaceActivation,
  registerInitialMarketplaceContext, type InitialMarketplaceContext,
} from "./initial-marketplace-coordination-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "./initial-marketplace-coordinator";
import { v3Command } from "./v3-commands";
import { exportV3WalletBackup } from "./v3-backup";
import { createV3DurableWallet } from "./v3-durable";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient production database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
let directory: string, store: WalletStore;
let fixture: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
let previous: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["before"];
let coordinator: ReturnType<typeof createDevelopmentInitialMarketplaceWalletCoordinator>;
const clock = () => fixture.acceptedAtMs;
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-initial-marketplace-storage-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);
async function setup(options: Parameters<typeof buildInitialMarketplaceFixture>[1] = {}) {
  const created = await buildInitialMarketplaceFixture(store, options);
  fixture = created.canonical; previous = created.before;
  coordinator = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
}
const activationInput = () => ({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId,
  walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId, assetId: fixture.assetId, operationId: "initial-storage-activate" });
const activate = () => coordinator.activateRequest(activationInput());
const accept = () => coordinator.acceptRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId,
  operationId: "initial-storage-accept", ...(fixture.initialRequest.paymentMethod === "Bank Transfer" ? {} : { safetyAcknowledged: true as const }) });
const inspect = () => coordinator.inspect({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });
const register = (tx: WalletSql, operation: "activate" | "accept" | "inspect" | "pause" = "inspect") => registerInitialMarketplaceContext({
  mode: MODE, tx, requestId: fixture.requestId, operation, actorUserId: operation === "accept" ? fixture.sellerId : fixture.ownerId,
});
const checkpoint = () => ({ revision: previous.revision, eventHash: previous.eventHash,
  stateHash: walletDigest(previous.state), lastCommandAtMs: previous.lastCommandAtMs });
async function footprint() {
  return store.transaction(async tx => ({
    commands: (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows,
    head: (await tx.query("SELECT format_version,revision,last_event_hash FROM alpha_wallet_simulation.head")).rows,
    journals: (await tx.query("SELECT * FROM alpha_wallet_simulation.journals ORDER BY journal_id")).rows,
    entries: (await tx.query("SELECT * FROM alpha_wallet_simulation.entries ORDER BY journal_id,account")).rows,
    requests: (await tx.query("SELECT * FROM alpha_exchange.purchase_requests ORDER BY id")).rows,
    listings: (await tx.query("SELECT * FROM alpha_exchange.listings ORDER BY id")).rows,
    trades: (await tx.query("SELECT * FROM alpha_exchange.trades ORDER BY id")).rows,
    activations: (await tx.query("SELECT * FROM alpha_wallet_initial_marketplace_simulation.activations")).rows,
    acceptances: (await tx.query("SELECT * FROM alpha_wallet_initial_marketplace_simulation.acceptances")).rows,
    publications: (await tx.query("SELECT * FROM alpha_wallet_initial_marketplace_simulation.publications")).rows,
    runtime: (await tx.query("SELECT version::text FROM alpha_exchange.runtime_meta")).rows,
    notifications: (await tx.query("SELECT * FROM alpha_exchange.notifications ORDER BY id")).rows,
    audits: (await tx.query("SELECT * FROM alpha_exchange.audit_logs ORDER BY id")).rows,
  }));
}

describe("separate v3 initial marketplace storage", () => {
  it("requires explicit fresh initialization, preserves old history and denies public/client grants", async () => {
    await setup({ initializeCoordination: false });
    const before = await store.transaction(async tx => (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows);
    await expect(initializeInitialMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: false as true })).rejects.toThrow(/acknowledgement/);
    await initializeInitialMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true });
    await expect(initializeInitialMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true })).rejects.toThrow(/fresh namespace/);
    const facts = await store.transaction(async tx => {
      await tx.exec("CREATE ROLE initial_marketplace_unprivileged");
      return {
        commands: (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows,
        tables: (await tx.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='alpha_wallet_initial_marketplace_simulation' AND relkind='r' ORDER BY relname`)).rows,
        access: (await tx.query(`SELECT has_schema_privilege('initial_marketplace_unprivileged','alpha_wallet_initial_marketplace_simulation','USAGE') schema_access,
          has_table_privilege('initial_marketplace_unprivileged','alpha_wallet_initial_marketplace_simulation.activations','SELECT,INSERT,UPDATE,DELETE') table_access,
          has_function_privilege('initial_marketplace_unprivileged','alpha_wallet_initial_marketplace_simulation.require_context()','EXECUTE') function_access`)).rows[0],
      };
    });
    expect(facts.commands).toEqual(before); expect(facts.tables).toHaveLength(4);
    for (const table of facts.tables) expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(facts.access).toEqual({ schema_access: false, table_access: false, function_access: false });
  }, TIMEOUT);

  it("rolls back partial schema installation when a required canonical dependency is absent", async () => {
    await setup({ initializeCoordination: false });
    await store.transaction(tx => tx.exec("DROP TABLE alpha_exchange.marketplace_enforcement_records"));
    await expect(initializeInitialMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true })).rejects.toThrow();
    const namespaces = await store.transaction(async tx => (await tx.query(
      "SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_initial_marketplace_simulation'")).rows);
    expect(namespaces).toEqual([]);
    expect((await createV3DurableWallet({ mode: MODE, store }).snapshot()).revision).toBe(previous.revision);
  }, TIMEOUT);

  it("refuses even an empty old correction coordination namespace", async () => {
    await setup({ initializeCoordination: false });
    await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation"));
    await expect(initializeInitialMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true })).rejects.toThrow(/every existing coordination/);
    expect(await store.transaction(async tx => (await tx.query(
      "SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_initial_marketplace_simulation'")).rows)).toEqual([]);
  }, TIMEOUT);

  it.each(["absent", "pending"] as const)("commits the one exact initial financial/canonical transition with %s physical trade before acceptance", async tradeProjection => {
    await setup({ tradeProjection }); await activate();
    const prior = await footprint();
    const receipt = await accept();
    const current = await inspect(), after = await footprint();
    expect(current).toMatchObject({ marketplace: { status: "accepted", tradeId: fixture.tradeId },
      reservation: { listingAvailableRaw: "300000000", tradeReservedRaw: "200000000" }, acceptance: { replayed: true } });
    expect(receipt).toMatchObject({ replayed: false, platformTradeId: fixture.tradeId, walletTradeId: fixture.walletTradeId,
      principalRaw: "200000000", terms: { pricePerUsdt: "3.10", fiatAmount: "626.20" } });
    expect(after.commands).toHaveLength(prior.commands.length + 1);
    expect(after.journals).toHaveLength(prior.journals.length + 1);
    expect(after.acceptances).toHaveLength(1); expect(after.publications).toHaveLength(1);
    expect(after.trades).toHaveLength(1); expect(after.notifications).toHaveLength(1); expect(after.audits).toHaveLength(1);
    expect(after.requests.find(row => row.id === fixture.otherRequestId)).toEqual(prior.requests.find(row => row.id === fixture.otherRequestId));
    expect(JSON.stringify(after.publications)).not.toMatch(/accountNumber|branchNumber|destination|password|Token|session/i);
    expect(await accept()).toEqual({ ...receipt, replayed: true });
    expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it("blocks standalone wallet head, export and command access immediately after explicit initialization", async () => {
    await setup();
    const before = await footprint(), wallet = createV3DurableWallet({ mode: MODE, store, clock });
    await expect(wallet.snapshot()).rejects.toThrow(/registered same-transaction/);
    await expect(wallet.recoverPayouts()).rejects.toThrow(/registered same-transaction/);
    await expect(exportV3WalletBackup({ mode: MODE, store, clock })).rejects.toThrow();
    await expect(wallet.execute(v3Command("pause", { kind: "operator", id: fixture.ownerId }, "standalone-pause", null))).rejects.toThrow(/registered same-transaction/);
    expect(await footprint()).toEqual(before);
    await expect(inspect()).resolves.toMatchObject({ activation: null, acceptance: null });
  }, TIMEOUT);

  it("does not convert an inspect context or a simulation setting into financial authority", async () => {
    await setup();
    const before = await footprint();
    await expect(store.transaction(async tx => {
      await register(tx);
      const wallet = createV3DurableWallet({ mode: MODE, store: bound(tx), clock });
      await wallet.snapshot();
      await wallet.execute(v3Command("pause", { kind: "operator", id: fixture.ownerId }, "inspect-cannot-write", null));
    })).rejects.toThrow(/exact registered coordinator intent/);
    await activate();
    const active = await footprint();
    for (const useContext of [false, true]) {
      await expect(store.transaction(async tx => {
        if (useContext) await register(tx, "accept");
        await tx.query("SELECT set_config('alpha_wallet.initial_coordinator','simulation-only',true)");
        await tx.query("UPDATE alpha_exchange.purchase_requests SET status='accepted' WHERE id=$1", [fixture.requestId]);
      })).rejects.toThrow(/registered same-transaction|fenced/);
    }
    expect(await footprint()).toEqual(active);
    expect(active.commands).toEqual(before.commands);
  }, TIMEOUT);

  it("rejects a stale activation checkpoint and never commits its mapping or physical fence", async () => {
    await setup(); const before = await footprint();
    await expect(store.transaction(async tx => {
      const context = await register(tx, "activate");
      await insertInitialMarketplaceActivation(context, { inputDigest: "1".repeat(64),
        mapping: { assetId: fixture.assetId, walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId },
        walletCheckpoint: { ...checkpoint(), eventHash: "0".repeat(64) } });
    })).rejects.toThrow(/exact pending canonical basis and verified v3 checkpoint/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects forged and expired contexts without aborting a replacement transaction", async () => {
    await setup();
    await expect(readInitialMarketplaceActivation({} as InitialMarketplaceContext)).rejects.toThrow(/opaque/);
    let expired!: InitialMarketplaceContext;
    await store.transaction(async tx => { expired = await register(tx); await assertInitialMarketplaceCoherence(expired); });
    await expect(readInitialMarketplaceAcceptance(expired)).rejects.toThrow(/no longer active/);
    await expect(inspect()).resolves.toMatchObject({ activation: null });
  }, TIMEOUT);

  it.each(["uncloneable", "non-string-mapping", "runtime-refusal"] as const)("poisons previously changed certified transactions after a swallowed %s failure", async failure => {
    await setup(); const before = await footprint();
    await expect(store.transaction(async tx => {
      const context = await register(tx, "activate");
      await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+100 WHERE singleton=true");
      const options = { inputDigest: "a".repeat(64),
        mapping: { assetId: fixture.assetId, walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId }, walletCheckpoint: checkpoint() };
      try {
        if (failure === "uncloneable") await insertInitialMarketplaceActivation(context, { ...options, inputDigest: (() => "bad") as unknown as string });
        else if (failure === "non-string-mapping") await insertInitialMarketplaceActivation(context,
          { ...options, mapping: { ...options.mapping, walletTradeId: 123 as unknown as string } });
        else {
          vi.stubEnv("VERCEL", "1");
          try { await readInitialMarketplaceActivation(context); } finally { vi.stubEnv("VERCEL", undefined); }
        }
      } catch { /* A bad caller must not make prior work committable. */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("fences target/sibling lifecycle, bank snapshots, physical trade, inventory and auxiliary alias writes", async () => {
    await setup(); await activate(); const before = await footprint();
    const attacks: [string, unknown[]?][] = [
      ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{sellerBankAccountSnapshot,accountNumber}','\"changed\"') WHERE id=$1", [fixture.requestId]],
      ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{fundsReceivedAt}','\"2027-01-15T08:00:00.000Z\"') WHERE id=$1", [fixture.requestId]],
      ["UPDATE alpha_exchange.purchase_requests SET status='accepted',payload=jsonb_set(payload,'{status}','\"accepted\"') WHERE id=$1", [fixture.otherRequestId]],
      ["UPDATE alpha_exchange.purchase_requests SET listing_id=$2 WHERE id=$1", [fixture.otherRequestId, fixture.otherListingId]],
      ["DELETE FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.otherRequestId]],
      ["UPDATE alpha_exchange.listings SET payload=jsonb_set(payload,'{availableAmount}','\"999\"') WHERE id=$1", [fixture.listingId]],
      ["DELETE FROM alpha_exchange.listings WHERE id=$1", [fixture.listingId]],
      [`INSERT INTO alpha_exchange.evidence VALUES ('direct-evidence',$1,'buyer',$2,'image/png','fixture.png',1,$3,0,'{}',NULL)`, [fixture.requestId, fixture.buyerId, fixture.at]],
      [`INSERT INTO alpha_exchange.evidence VALUES ('alias-evidence','unrelated','buyer',$2,'image/png','fixture.png',1,$3,0,
        jsonb_build_object('purchaseRequestId',$1::text),NULL)`, [fixture.requestId, fixture.buyerId, fixture.at]],
      [`INSERT INTO alpha_exchange.trades VALUES ('shadow-trade','unrelated','unrelated-listing',$1,$2,'completed',NULL,$3,$3,0,
        jsonb_build_object('id',$4::text))`, [fixture.sellerId, fixture.buyerId, fixture.at, fixture.tradeId]],
      [`INSERT INTO alpha_exchange.listings SELECT 'shadow-listing',seller_id,status,NULL,expires_at,created_at,updated_at,99,payload
        FROM alpha_exchange.listings WHERE id=$1`, [fixture.listingId]],
    ];
    for (const [sql, params] of attacks) await expect(store.transaction(tx => tx.query(sql, params))).rejects.toThrow(/registered same-transaction|fenced/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("preserves unrelated canonical history and account revocation while physically ordering dependency changes", async () => {
    await setup(); await activate();
    const before = await footprint();
    await store.transaction(async tx => {
      await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=payload||'{\"buyerNotes\":\"updated unrelated history\"}'::jsonb WHERE id=$1", [fixture.buyerHistoryRequestId]);
      await tx.query("UPDATE alpha_exchange.users SET payload=payload||'{\"disabled\":true}'::jsonb WHERE id=$1", [fixture.sellerId]);
    });
    const after = await footprint();
    expect(Number(after.runtime[0].version)).toBeGreaterThan(Number(before.runtime[0].version));
    expect(after.activations).toEqual(before.activations);
    expect(after.requests.find(row => row.id === fixture.requestId)).toEqual(before.requests.find(row => row.id === fixture.requestId));
    await expect(accept()).rejects.toMatchObject({ code: "WALLET_ACCOUNT_DISABLED" });
    await expect(inspect()).resolves.toMatchObject({ acceptance: null, marketplace: { status: "pending" } });
  }, TIMEOUT);

  it("preserves participant identities and the canonical runtime fence while permitting account revocation", async () => {
    await setup(); await activate(); const before = await footprint();
    const attacks: [string, unknown[]?][] = [
      ["DELETE FROM alpha_exchange.users WHERE id=$1", [fixture.buyerId]],
      ["UPDATE alpha_exchange.users SET id='reassigned-buyer' WHERE id=$1", [fixture.buyerId]],
      ["UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{id}','\"reassigned-buyer\"') WHERE id=$1", [fixture.buyerId]],
      ["UPDATE alpha_exchange.users SET seller_status='suspended' WHERE id=$1", [fixture.sellerId]],
      ["DELETE FROM alpha_exchange.runtime_meta"],
      ["TRUNCATE alpha_exchange.runtime_meta"],
      ["UPDATE alpha_exchange.runtime_meta SET singleton=false"],
      ["UPDATE alpha_exchange.runtime_meta SET version=version-1"],
      ["INSERT INTO alpha_exchange.runtime_meta VALUES(false,0,now())"],
      ["TRUNCATE alpha_exchange.users CASCADE"],
      ["TRUNCATE alpha_exchange.marketplace_enforcement_records"],
    ];
    for (const [sql, params] of attacks) await expect(store.transaction(tx => tx.query(sql, params))).rejects.toThrow(/identities|immutable|runtime fence/);
    expect(await footprint()).toEqual(before);
    await store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET seller_status='suspended',payload=jsonb_set(payload,'{sellerStatus}','\"suspended\"') WHERE id=$1", [fixture.sellerId]));
    await expect(accept()).rejects.toMatchObject({ code: "ACTOR" });
    await expect(coordinator.pause({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId, operationId: "pause-revoked-cohort" }))
      .resolves.toMatchObject({ halted: true });
  }, TIMEOUT);

  it("physically versions canonical listing and runtime for preactivation auxiliary writes without changing payload", async () => {
    await setup();
    const row = () => store.transaction(async tx => (await tx.query<{ version: string; payload: unknown; runtime: string }>(
      "SELECT xmin::text AS version,payload,(SELECT version::text FROM alpha_exchange.runtime_meta WHERE singleton) AS runtime FROM alpha_exchange.listings WHERE id=$1", [fixture.listingId])).rows[0]);
    const before = await row();
    await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.evidence VALUES ('before-activation',$1,'buyer',$2,
      'image/png','fixture.png',1,$3,0,'{}',NULL)`, [fixture.requestId, fixture.buyerId, fixture.at]));
    const after = await row();
    expect(after.version).not.toBe(before.version); expect(Number(after.runtime)).toBeGreaterThan(Number(before.runtime));
    expect(after.payload).toEqual(before.payload);
    await store.transaction(tx => tx.query("DELETE FROM alpha_exchange.evidence WHERE id='before-activation'"));
    await expect(activate()).resolves.toMatchObject({ replayed: false });
  }, TIMEOUT);

  it("rejects protected truncations and immutable activation, receipt, publication and context edits", async () => {
    await setup(); await activate(); await accept(); const before = await footprint();
    for (const table of ["purchase_requests", "listings", "evidence", "disputes", "trades", "commissions", "notifications", "audit_logs"]) {
      await expect(store.transaction(tx => tx.exec(`TRUNCATE alpha_exchange.${table} CASCADE`))).rejects.toThrow(/immutable/);
    }
    for (const table of ["activations", "acceptances", "publications", "transaction_contexts"]) {
      await expect(store.transaction(tx => tx.exec(`DELETE FROM alpha_wallet_initial_marketplace_simulation.${table}`))).rejects.toThrow(/immutable/);
      await expect(store.transaction(tx => tx.exec(`TRUNCATE alpha_wallet_initial_marketplace_simulation.${table} CASCADE`))).rejects.toThrow(/immutable/);
    }
    await expect(store.transaction(tx => tx.exec("UPDATE alpha_wallet_initial_marketplace_simulation.acceptances SET input_digest=repeat('0',64)"))).rejects.toThrow(/immutable/);
    await expect(store.transaction(tx => tx.exec("UPDATE alpha_exchange.notifications SET is_read=true"))).rejects.toThrow(/registered same-transaction/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("requires a bound intent to commit the exact command even if the caller omits financial execution", async () => {
    await setup(); const before = await footprint();
    await expect(store.transaction(async tx => {
      const context = await register(tx, "pause");
      await bindInitialMarketplaceCommand(context, v3Command("pause", { kind: "operator", id: fixture.ownerId }, "omitted-pause-command", null));
    })).rejects.toThrow(/bound initial marketplace intent must commit/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["notifications", "audit_logs", "publications"] as const)("independently rolls back absent %s even if explicit coherence is omitted", async omitted => {
    await setup(); await activate(); const before = await footprint();
    let omittedWrite = false, omittedCheck = false;
    const target = omitted === "publications" ? "alpha_wallet_initial_marketplace_simulation.publications" : `alpha_exchange.${omitted}`;
    const faultyStore: WalletStore = {
      close: async () => undefined,
      transaction: work => store.transaction(async ownerTx => work({
        exec: sql => ownerTx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          if (sql.includes(`INSERT INTO ${target}`)) { omittedWrite = true; return { rows: [] as Row[] }; }
          if (sql === "SELECT alpha_wallet_initial_marketplace_simulation.assert_coherence()") {
            omittedCheck = true; return { rows: [] as Row[] };
          }
          return ownerTx.query<Row>(sql, values);
        },
      })),
    };
    const faulty = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store: faultyStore, clock });
    await expect(faulty.acceptRequest({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId, operationId: "missing-event" })).rejects.toThrow();
    expect(omittedWrite).toBe(true); expect(omittedCheck).toBe(true);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rechecks late canonical changes after an earlier explicit/deferred coherence pass", async () => {
    await setup(); await activate(); await accept(); const before = await footprint();
    await expect(store.transaction(async tx => {
      const context = await register(tx);
      await assertInitialMarketplaceCoherence(context);
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      // Deliberate privileged fault injection isolates the independent deferred
      // validator. Ordinary notification changes are refused by the row fence.
      await tx.exec("ALTER TABLE alpha_exchange.notifications DISABLE TRIGGER initial_marketplace_listing_fence");
      await tx.query("UPDATE alpha_exchange.notifications SET payload=payload||'{\"message\":\"corrupt late event\"}'::jsonb");
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.exec("ALTER TABLE alpha_exchange.notifications ENABLE TRIGGER initial_marketplace_listing_fence");
    })).rejects.toThrow(/exact canonical notification/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("revalidates retained activation checkpoints and receipt event hashes independently of immutable-row guards", async () => {
    await setup(); await activate(); await accept(); const before = await footprint();
    for (const table of ["activations", "acceptances"] as const) {
      const original = table === "activations" ? before.activations[0].wallet_checkpoint : before.acceptances[0].wallet_event_hash;
      const replacement = table === "activations" ? { ...(original as Record<string, unknown>), eventHash: "f".repeat(64) } : "f".repeat(64);
      const set = async (value: unknown) => store.transaction(async tx => {
        await tx.exec(`ALTER TABLE alpha_wallet_initial_marketplace_simulation.${table} DISABLE TRIGGER immutable_records`);
        if (table === "activations") await tx.query("UPDATE alpha_wallet_initial_marketplace_simulation.activations SET wallet_checkpoint=$1::jsonb", [JSON.stringify(value)]);
        else await tx.query("UPDATE alpha_wallet_initial_marketplace_simulation.acceptances SET wallet_event_hash=$1", [value]);
        await tx.exec(`ALTER TABLE alpha_wallet_initial_marketplace_simulation.${table} ENABLE TRIGGER immutable_records`);
      });
      await set(replacement);
      await expect(inspect()).rejects.toThrow();
      await expect(accept()).rejects.toThrow();
      await expect(store.transaction(async tx => assertInitialMarketplaceCoherence(await register(tx)))).rejects.toThrow(/Retained initial marketplace/);
      await set(original);
    }
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("supports historical receipts and owner pause without enabling resume or standalone recovery", async () => {
    await setup(); await activate(); const accepted = await accept();
    const paused = await coordinator.pause({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId, operationId: "storage-owner-pause" });
    expect(paused).toMatchObject({ halted: true, replayed: false });
    const before = await footprint();
    expect(await accept()).toEqual({ ...accepted, replayed: true });
    expect(await coordinator.pause({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId, operationId: "storage-owner-pause" }))
      .toEqual({ ...paused, replayed: true });
    await expect(inspect()).resolves.toMatchObject({ wallet: { halted: true } });
    await expect(exportV3WalletBackup({ mode: MODE, store, clock })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
});
