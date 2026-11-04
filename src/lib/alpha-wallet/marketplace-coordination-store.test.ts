// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mutateDevelopmentFocusedTradeInTransaction } from "@/lib/alpha-exchange-repository";
import { BUYER, FIXTURE_TIME, OPERATOR, SELLER, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "./durable";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createMarketplaceCoordinationFixture } from "./marketplace-coordination-fixture";
import { assertMarketplaceCoherence, bindMarketplaceCommand, initializeMarketplaceCoordination,
  readMarketplaceAcceptance, readMarketplaceEnrollment, registerMarketplaceContext,
  type MarketplaceContext } from "./marketplace-coordination-store";
import { createDevelopmentMarketplaceWalletCoordinator } from "./marketplace-coordinator";
import { simulatedDestination } from "./sandbox";
import { v2Command, type V2Command } from "./v2-commands";
import { exportVersionedWalletBackup } from "./versioned-backup";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient production database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
let directory: string, store: WalletStore;
let fixture: Awaited<ReturnType<typeof createMarketplaceCoordinationFixture>>;
let coordinator: ReturnType<typeof createDevelopmentMarketplaceWalletCoordinator>;
const clock = () => FIXTURE_TIME + 1000;

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-marketplace-storage-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await initializeDurableWallet(store);
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function setup(initialize = true) {
  fixture = await store.transaction(tx => createMarketplaceCoordinationFixture({ mode: MODE, tx }));
  const v1 = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(v1).fundedListing("500", fixture.listingId);
  await v1.execute(walletCommand("reserveTrade", BUYER, "storage-reserve", {
    id: fixture.tradeId, listingId: fixture.listingId, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
  }));
  const previous = await createVersionedDurableWallet({ mode: MODE, store }).snapshot();
  await upgradeDurableWalletV2({ mode: MODE, store, acknowledgeVersionUpgrade: true, clock: () => FIXTURE_TIME,
    command: v2Command("continueFromV1", OPERATOR, "storage-upgrade", { checkpoint: {
      revision: previous.revision, eventHash: previous.eventHash, stateHash: walletDigest(previous.state), lastCommandAtMs: previous.lastCommandAtMs,
    } }) });
  if (initialize) await initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true });
  coordinator = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store, clock });
}
function enroll() {
  return coordinator.enrollReservedTrade({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId,
    walletListingId: fixture.listingId, walletTradeId: fixture.tradeId, assetId: TRON, operationId: "storage-enroll" });
}
function accept() {
  return coordinator.acceptAmountCorrection({ sessionToken: fixture.buyerSessionToken, requestId: fixture.requestId,
    proposalId: fixture.proposalId, expectedBindingRevision: 0, operationId: "storage-accept" });
}
const inspect = () => coordinator.inspect({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });
async function footprint() {
  return store.transaction(async tx => ({
    commands: (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows,
    head: (await tx.query("SELECT format_version,revision,last_event_hash FROM alpha_wallet_simulation.head")).rows,
    requests: (await tx.query("SELECT * FROM alpha_exchange.purchase_requests ORDER BY id")).rows,
    listings: (await tx.query("SELECT * FROM alpha_exchange.listings ORDER BY id")).rows,
    enrollment: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.enrollments")).rows,
    acceptance: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.acceptances")).rows,
    publication: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.publications")).rows,
    runtime: (await tx.query("SELECT version::text FROM alpha_exchange.runtime_meta")).rows,
    notifications: (await tx.query("SELECT * FROM alpha_exchange.notifications ORDER BY id")).rows,
    audits: (await tx.query("SELECT * FROM alpha_exchange.audit_logs ORDER BY id")).rows,
  }));
}

describe("development marketplace storage and whole-listing fences", () => {
  it("requires explicit fresh verified v2 initialization, defaults to no client grants and preserves all old wallet rows", async () => {
    await setup(false);
    const before = await store.transaction(async tx => (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows);
    await expect(initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: false as true })).rejects.toThrow(/acknowledgement/);
    await initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true });
    await expect(initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true })).rejects.toThrow(/already exists/);
    const facts = await store.transaction(async tx => {
      await tx.exec("CREATE ROLE marketplace_unprivileged");
      return {
        commands: (await tx.query("SELECT * FROM alpha_wallet_simulation.commands ORDER BY revision")).rows,
        tables: (await tx.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='alpha_wallet_marketplace_simulation' AND relkind='r' ORDER BY relname`)).rows,
        access: (await tx.query(`SELECT has_schema_privilege('marketplace_unprivileged','alpha_wallet_marketplace_simulation','USAGE') schema_access,
          has_table_privilege('marketplace_unprivileged','alpha_wallet_marketplace_simulation.enrollments','SELECT,INSERT,UPDATE,DELETE') table_access,
          has_function_privilege('marketplace_unprivileged','alpha_wallet_marketplace_simulation.require_context()','EXECUTE') function_access`)).rows[0],
      };
    });
    expect(facts.commands).toEqual(before);
    expect(facts.tables).toHaveLength(4);
    for (const table of facts.tables) expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(facts.access).toEqual({ schema_access: false, table_access: false, function_access: false });
  }, TIMEOUT);

  it("rejects a partial schema install and a v1-only initializer atomically", async () => {
    await expect(initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true })).rejects.toThrow(/verified v2/);
    await setup(false);
    await store.transaction(tx => tx.exec("DROP TABLE alpha_exchange.commissions"));
    await expect(initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true })).rejects.toThrow();
    const present = await store.transaction(async tx => (await tx.query("SELECT 1 FROM pg_namespace WHERE nspname='alpha_wallet_marketplace_simulation'")).rows);
    expect(present).toEqual([]);
    expect((await createVersionedDurableWallet({ mode: MODE, store }).snapshot()).engineVersion).toBe("alpha-wallet-simulation-v2");
  }, TIMEOUT);

  it("fences standalone snapshot, export, payout recovery and inherited wallet commands after activation", async () => {
    await setup(); await enroll();
    const before = await footprint();
    const standalone = createVersionedDurableWallet({ mode: MODE, store, clock });
    await expect(standalone.snapshot()).rejects.toThrow(/registered same-transaction/);
    await expect(exportVersionedWalletBackup({ mode: MODE, store, clock })).rejects.toThrow(/registered same-transaction/);
    await expect(standalone.recoverPayouts()).rejects.toThrow(/registered same-transaction/);
    for (const command of [v2Command("cancelTrade", BUYER, "direct-cancel", fixture.tradeId),
      v2Command("markBuyerPaid", BUYER, "direct-pay", fixture.tradeId),
      v2Command("closeListing", SELLER, "direct-close", fixture.listingId)]) {
      await expect(standalone.execute(command)).rejects.toThrow(/registered same-transaction/);
    }
    await expect(inspect()).resolves.toMatchObject({ requestId: fixture.requestId });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("permits an explicit inspect context to read but never to append a wallet command, even before activation", async () => {
    await setup();
    for (const active of [false, true]) {
      if (active) await enroll();
      const before = await footprint();
      await expect(store.transaction(async tx => {
        await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "inspect", actorUserId: fixture.ownerId });
        const wallet = createVersionedDurableWallet({ mode: MODE, store: bound(tx), clock });
        await wallet.snapshot();
        await wallet.execute(v2Command("pause", { kind: "operator", id: fixture.ownerId }, "inspect-cannot-pause", null));
      })).rejects.toThrow(/exact registered coordinator intent/);
      expect(await footprint()).toEqual(before);
    }
  }, TIMEOUT);

  it("does not treat a simulation GUC or an unbound acceptance context as financial authorization", async () => {
    await setup(); await enroll();
    const before = await footprint();
    for (const registered of [false, true]) {
      await expect(store.transaction(async tx => {
        if (registered) await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "accept", actorUserId: fixture.buyerId });
        await tx.query("SELECT set_config('alpha_wallet.marketplace_coordinator','simulation-only',true)");
        await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{usdtAmount}','\"300\"') WHERE id=$1", [fixture.requestId]);
      })).rejects.toThrow(/registered same-transaction|appended marketplace receipt/);
    }
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("blocks legacy canonical, sibling, inventory, evidence, dispute, trade and commission writes on the enrolled listing", async () => {
    await setup(); await enroll();
    const before = await footprint();
    const attacks: [string, unknown[]?][] = [
      ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{fundsReceivedAt}','\"2026-11-01T00:00:00.000Z\"') WHERE id=$1", [fixture.requestId]],
      ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{termsProposal,status}','\"declined\"') WHERE id=$1", [fixture.requestId]],
      ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{sellerBankAccountSnapshot,accountNumber}','\"changed\"') WHERE id=$1", [fixture.requestId]],
      ["UPDATE alpha_exchange.purchase_requests SET status='accepted',payload=jsonb_set(payload,'{status}','\"accepted\"') WHERE id=$1", [fixture.otherRequestId]],
      ["UPDATE alpha_exchange.purchase_requests SET listing_id='other-listing',payload=jsonb_set(payload,'{listingId}','\"other-listing\"') WHERE id=$1", [fixture.otherRequestId]],
      ["DELETE FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.otherRequestId]],
      ["UPDATE alpha_exchange.listings SET payload=jsonb_set(payload,'{availableAmount}','\"999\"') WHERE id=$1", [fixture.listingId]],
      ["DELETE FROM alpha_exchange.listings WHERE id=$1", [fixture.listingId]],
      ["INSERT INTO alpha_exchange.evidence (id,purchase_request_id,payload) VALUES ('new-evidence',$1,'{}')", [fixture.otherRequestId]],
      ["INSERT INTO alpha_exchange.disputes (id,purchase_request_id,payload) VALUES ('new-dispute',$1,'{}')", [fixture.requestId]],
      ["INSERT INTO alpha_exchange.trades (id,purchase_request_id,listing_id,seller_id,buyer_id,status,payload) VALUES ('new-trade',$1,$2,$3,$4,'completed','{}')", [fixture.requestId, fixture.listingId, fixture.sellerId, fixture.buyerId]],
      ["INSERT INTO alpha_exchange.commissions (id,seller_id,purchase_request_id,listing_id,payload) VALUES ('new-commission',$1,$2,$3,'{}')", [fixture.sellerId, fixture.requestId, fixture.listingId]],
      ["INSERT INTO alpha_exchange.evidence (id,purchase_request_id,payload) VALUES ('alias-evidence','unrelated',jsonb_build_object('purchaseRequestId',$1::text))", [fixture.requestId]],
      ["INSERT INTO alpha_exchange.notifications (id,user_id,category,is_read,created_at,sort_index,payload) VALUES ('trade-only',$1,'trade',false,$2,0,jsonb_build_object('relatedTradeId',$3::text))", [fixture.sellerId, fixture.at, fixture.tradeId]],
      ["INSERT INTO alpha_exchange.listings (id,seller_id,payload) VALUES ('shadow-listing',$1,jsonb_build_object('id',$2::text))", [fixture.sellerId, fixture.listingId]],
      ["INSERT INTO alpha_exchange.trades (id,purchase_request_id,listing_id,seller_id,buyer_id,status,payload) VALUES ('shadow-trade','unrelated-request','unrelated-listing',$1,$2,'completed',jsonb_build_object('id',$3::text))", [fixture.sellerId, fixture.buyerId, fixture.tradeId]],
      ["INSERT INTO alpha_exchange.purchase_requests SELECT 'new-request','new-trade',listing_id,buyer_id,seller_id,status,updated_at,payload FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.otherRequestId]],
    ];
    for (const [sql, params] of attacks) await expect(store.transaction(tx => tx.query(sql, params))).rejects.toThrow(/registered same-transaction|fenced/);
    await expect(store.transaction(tx => mutateDevelopmentFocusedTradeInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, db => {
      db.purchaseRequests.find(row => row.id === fixture.requestId)!.buyerNotes = "legacy focused write";
      return db;
    }))).rejects.toThrow(/registered same-transaction|fenced/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("blocks moving unrelated identities into a protected listing but allows unrelated and identical writes", async () => {
    await setup();
    await store.transaction(async tx => {
      await tx.query(`INSERT INTO alpha_exchange.listings (id,seller_id,payload,status,active_trade_request_id)
        VALUES ('unrelated-listing',$1,jsonb_build_object('id','unrelated-listing','sellerId',$1::text,'status','active'),'active',null)`, [fixture.sellerId]);
      await tx.query(`INSERT INTO alpha_exchange.purchase_requests SELECT 'unrelated-request','unrelated-trade','unrelated-listing',buyer_id,seller_id,status,updated_at,
        payload || '{"id":"unrelated-request","tradeId":"unrelated-trade","listingId":"unrelated-listing"}'::jsonb
        FROM alpha_exchange.purchase_requests WHERE id=$1`, [fixture.otherRequestId]);
      await tx.query("INSERT INTO alpha_exchange.evidence VALUES ('unrelated-evidence','unrelated-request','{}')");
    });
    await enroll();
    await expect(store.transaction(tx => tx.query("UPDATE alpha_exchange.evidence SET purchase_request_id=$1 WHERE id='unrelated-evidence'", [fixture.requestId]))).rejects.toThrow(/registered same-transaction|fenced/);
    await expect(store.transaction(tx => tx.query("UPDATE alpha_exchange.purchase_requests SET listing_id=$1 WHERE id='unrelated-request'", [fixture.listingId]))).rejects.toThrow(/registered same-transaction|fenced/);
    await store.transaction(async tx => {
      await tx.query("UPDATE alpha_exchange.evidence SET payload='{\"unrelated\":true}' WHERE id='unrelated-evidence'");
      await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE listing_id=$1", [fixture.listingId]);
      await tx.query("UPDATE alpha_exchange.listings SET payload=payload WHERE id=$1", [fixture.listingId]);
    });
    await expect(inspect()).resolves.toMatchObject({ requestId: fixture.requestId });
  }, TIMEOUT);

  it("rejects all protected truncations and immutable receipt/publication/context edits", async () => {
    await setup(); await enroll(); await accept();
    const before = await footprint();
    for (const table of ["purchase_requests", "listings", "evidence", "disputes", "trades", "commissions", "notifications", "audit_logs"]) {
      await expect(store.transaction(tx => tx.exec(`TRUNCATE alpha_exchange.${table} CASCADE`))).rejects.toThrow(/immutable/);
    }
    for (const table of ["enrollments", "acceptances", "publications", "transaction_contexts"]) {
      await expect(store.transaction(tx => tx.exec(`DELETE FROM alpha_wallet_marketplace_simulation.${table}`))).rejects.toThrow(/immutable/);
      await expect(store.transaction(tx => tx.exec(`TRUNCATE alpha_wallet_marketplace_simulation.${table} CASCADE`))).rejects.toThrow(/immutable/);
    }
    await expect(store.transaction(tx => tx.exec("UPDATE alpha_wallet_marketplace_simulation.acceptances SET input_digest=repeat('0',64)"))).rejects.toThrow(/immutable/);
    await expect(store.transaction(tx => tx.exec("UPDATE alpha_exchange.notifications SET is_read=true"))).rejects.toThrow(/registered same-transaction|fenced/);
    await expect(store.transaction(tx => tx.exec("DELETE FROM alpha_exchange.audit_logs"))).rejects.toThrow(/registered same-transaction|fenced/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("requires command, enrollment and physical canonical activation to commit together", async () => {
    await setup();
    const before = await footprint();
    for (const omit of ["command", "enrollment"] as const) {
      await expect(store.transaction(async tx => {
        const context = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "enroll", actorUserId: fixture.ownerId });
        const wallet = createVersionedDurableWallet({ mode: MODE, store: bound(tx), clock });
        const snapshot = await wallet.snapshot();
        const terms = describeDevelopmentTradeTerms({ mode: MODE, request: fixture.initialRequest, assetId: TRON, walletListingId: fixture.listingId });
        const command = v2Command("enrollReservedTrade", { kind: "operator", id: fixture.ownerId }, `partial-${omit}`, {
          walletTradeId: fixture.tradeId, terms: terms.terms, termsDigest: terms.digest,
          expectedWallet: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs },
          walletTradeDigest: walletDigest(snapshot.state.trades.get(fixture.tradeId)),
        });
        await bindMarketplaceCommand(context, command);
        if (omit !== "command") await wallet.execute(command);
      })).rejects.toThrow(/intent must commit|must commit together/);
      expect(await footprint()).toEqual(before);
    }
    await enroll();
    const after = await footprint();
    expect(Number((after.runtime[0] as { version: string }).version)).toBe(Number(fixture.initialRuntimeVersion) + 1);
    expect(after.enrollment).toHaveLength(1);
  }, TIMEOUT);

  it("rejects forged contexts and stale transaction handles; a caught semantic proof rejection aborts its certified transaction", async () => {
    await setup();
    await expect(readMarketplaceEnrollment({} as MarketplaceContext)).rejects.toThrow(/opaque/);
    let expired!: MarketplaceContext;
    await store.transaction(async tx => {
      expired = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "inspect", actorUserId: fixture.ownerId });
      await assertMarketplaceCoherence(expired);
    });
    await expect(readMarketplaceEnrollment(expired)).rejects.toThrow(/no longer active/);
    const before = await footprint();
    await expect(store.transaction(async tx => {
      const context = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "enroll", actorUserId: fixture.ownerId });
      await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+100 WHERE singleton=true");
      try { await readMarketplaceAcceptance(context, "invalid proposal with spaces"); } catch { /* deliberate bad caller */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("preserves exact historical reads and owner pause while the cohort blocks resume", async () => {
    await setup(); await enroll(); await accept();
    const pauseInput = { sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId, operationId: "storage-pause" };
    const paused = await coordinator.pause(pauseInput);
    expect(paused).toMatchObject({ halted: true, replayed: false });
    const before = await footprint();
    expect(await coordinator.pause(pauseInput)).toEqual({ ...paused, replayed: true });
    await expect(inspect()).resolves.toMatchObject({ wallet: { halted: true } });
    await store.transaction(async tx => {
      const context = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "accept", actorUserId: fixture.buyerId });
      const original = await readMarketplaceAcceptance(context, fixture.proposalId);
      expect(original?.publicationId).toBe(`wallet-publication-${original?.receipt.acceptanceKey}`);
      await assertMarketplaceCoherence(context);
    });
    await expect(store.transaction(async tx => {
      const context = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "pause", actorUserId: fixture.ownerId });
      const unsupported = { ...v2Command("pause", { kind: "operator", id: fixture.ownerId }, "forbidden-resume", null), type: "resume" } as unknown as V2Command;
      await bindMarketplaceCommand(context, unsupported);
    })).rejects.toThrow(/Invalid discriminator|No matching discriminator/);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("revalidates retained enrollment and acceptance event hashes before historical receipt recovery", async () => {
    await setup(); await enroll(); await accept();
    const before = await footprint();
    for (const [table, original] of [["enrollments", before.enrollment[0]], ["acceptances", before.acceptance[0]]] as const) {
      // Deliberate privileged corruption in this disposable fixture models a
      // damaged/imported retained row; normal SQL UPDATE is separately denied.
      const setHash = async (hash: string) => store.transaction(async tx => {
        await tx.exec(`ALTER TABLE alpha_wallet_marketplace_simulation.${table} DISABLE TRIGGER immutable_records`);
        await tx.query(`UPDATE alpha_wallet_marketplace_simulation.${table} SET wallet_event_hash=$1`, [hash]);
        await tx.exec(`ALTER TABLE alpha_wallet_marketplace_simulation.${table} ENABLE TRIGGER immutable_records`);
      });
      await setHash("f".repeat(64));
      await expect(inspect()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
      await expect(table === "enrollments" ? enroll() : accept()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
      await expect(store.transaction(async tx => {
        const context = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "inspect", actorUserId: fixture.ownerId });
        await assertMarketplaceCoherence(context);
      })).rejects.toThrow(/Retained marketplace/);
      await setHash(original.wallet_event_hash as string);
    }
    expect(await footprint()).toEqual(before);
    await expect(inspect()).resolves.toMatchObject({ requestId: fixture.requestId });
  }, TIMEOUT);

  it("rolls back incomplete acceptance even when a participant silently omits persistence and the explicit coherence call", async () => {
    await setup(); await enroll();
    const before = await footprint();
    for (const omitted of [/UPDATE alpha_exchange\.purchase_requests SET payload\s*=/i,
      /INSERT INTO alpha_exchange\.notifications/i, /INSERT INTO alpha_wallet_marketplace_simulation\.publications/i]) {
      let omittedPersistence = false, omittedCheck = false;
      const incomplete: WalletStore = {
        close: async () => undefined,
        transaction: work => store.transaction(async ownerTx => {
          const tx: WalletSql = {
            exec: sql => ownerTx.exec(sql),
            async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
              if (omitted.test(sql)) { omittedPersistence = true; return { rows: [] as Row[] }; }
              if (sql === "SELECT alpha_wallet_marketplace_simulation.assert_coherence()") {
                omittedCheck = true; return { rows: [] as Row[] };
              }
              return ownerTx.query<Row>(sql, params);
            },
          };
          return work(tx);
        }),
      };
      const faulty = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store: incomplete, clock });
      await expect(faulty.acceptAmountCorrection({ sessionToken: fixture.buyerSessionToken, requestId: fixture.requestId,
        proposalId: fixture.proposalId, expectedBindingRevision: 0, operationId: "storage-incomplete-accept" })).rejects.toThrow();
      expect(omittedPersistence).toBe(true);
      // A missing publication is rejected by the event INSERT's immediate guard;
      // missing request/notification reach the independently deferred commit check.
      if (!omitted.source.includes("publications")) expect(omittedCheck).toBe(true);
      expect(await footprint()).toEqual(before);
    }
  }, TIMEOUT);

  it("checks retained normalized listing lifecycle and active-request columns against canonical JSON", async () => {
    await setup(); await enroll();
    const before = await footprint();
    for (const [column, replacement, original] of [["status", "active", "matched"],
      ["active_trade_request_id", null, fixture.requestId]] as const) {
      const setValue = async (value: string | null) => store.transaction(async tx => {
        // The normal write guard rejects this; corruption recovery must also
        // reject a retained normalized/JSON mismatch independently of TS reads.
        await tx.exec("ALTER TABLE alpha_exchange.listings DISABLE TRIGGER marketplace_listing_fence");
        await tx.query(`UPDATE alpha_exchange.listings SET ${column}=$2 WHERE id=$1`, [fixture.listingId, value]);
        await tx.exec("ALTER TABLE alpha_exchange.listings ENABLE TRIGGER marketplace_listing_fence");
      });
      await setValue(replacement);
      await expect(store.transaction(async tx => {
        const context = await registerMarketplaceContext({ mode: MODE, tx, requestId: fixture.requestId, operation: "inspect", actorUserId: fixture.ownerId });
        await assertMarketplaceCoherence(context);
      })).rejects.toThrow(/Canonical marketplace identities/);
      await setValue(original);
    }
    expect(await footprint()).toEqual(before);
    await expect(inspect()).resolves.toMatchObject({ requestId: fixture.requestId });
  }, TIMEOUT);

  it("physically versions the listing for an unenrolled auxiliary write while preserving its canonical payload", async () => {
    await setup();
    const listing = () => store.transaction(async tx => (await tx.query<{ version: string; payload: unknown }>(
      "SELECT xmin::text AS version,payload FROM alpha_exchange.listings WHERE id=$1", [fixture.listingId])).rows[0]);
    const before = await listing();
    await store.transaction(tx => tx.query("INSERT INTO alpha_exchange.evidence (id,purchase_request_id,payload) VALUES ('preactivation-evidence',$1,'{}')", [fixture.requestId]));
    const after = await listing();
    expect(after.version).not.toBe(before.version);
    expect(after.payload).toEqual(before.payload);
    await store.transaction(tx => tx.query("DELETE FROM alpha_exchange.evidence WHERE id='preactivation-evidence'"));
    expect((await listing()).payload).toEqual(before.payload);
    await expect(enroll()).resolves.toMatchObject({ replayed: false });
  }, TIMEOUT);
});
