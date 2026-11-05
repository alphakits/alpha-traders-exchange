// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  withDevelopmentInitialAcceptanceInTransaction, type DevelopmentInitialAcceptanceDecision,
  type DevelopmentInitialAcceptanceParticipant,
} from "@/lib/alpha-exchange-repository";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createInitialAcceptanceFixture } from "./initial-acceptance-fixture";
import {
  createDevelopmentInitialMarketplaceWalletCoordinator,
  createDevelopmentMobileInitialMarketplaceWalletCoordinator,
} from "./initial-marketplace-coordinator";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => {
  throw new Error("Ambient database discovery is forbidden in initial marketplace boundary fixtures");
} }));

const MODE = "simulation-only" as const, TIMEOUT = 90_000;
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions",
  "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"] as const;
function environment() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED", "MOBILE_MIN_IOS_VERSION", "MOBILE_MIN_ANDROID_VERSION"]) {
    vi.stubEnv(key, undefined);
  }
}
beforeEach(environment);
afterEach(() => vi.unstubAllEnvs());

async function canonicalRows(tx: WalletSql) {
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const name of TABLES) rows[name] = (await tx.query<{ value: Record<string, unknown> }>(
    `SELECT to_jsonb(t) AS value FROM alpha_exchange.${name} t ORDER BY ${name === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.value);
  return rows;
}

describe("initial canonical participant lifetime and mutation boundary", () => {
  // This group intentionally proves canonical mechanics, not authentication or
  // reservation. A separate real coordinator group below supplies both.
  let directory: string, store: WalletStore;
  let fixture: Awaited<ReturnType<typeof createInitialAcceptanceFixture>>;
  let baseline: Record<string, Record<string, unknown>[]>;
  const decision = (): DevelopmentInitialAcceptanceDecision => ({ requestId: fixture.requestId, actorUserId: fixture.sellerId,
    tradeId: fixture.tradeId, acceptedAtMs: fixture.acceptedAtMs });
  const use = <T>(tx: WalletSql, work: (participant: DevelopmentInitialAcceptanceParticipant) => Promise<T>) =>
    withDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, work);
  const footprint = () => store.transaction(async tx => ({ canonical: await canonicalRows(tx),
    probes: (await tx.query("SELECT id FROM initial_boundary_probe ORDER BY id")).rows }));

  beforeAll(async () => {
    environment();
    directory = await mkdtemp(join(tmpdir(), "alpha-wallet-initial-participant-boundary-"));
    store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    await store.transaction(async tx => {
      fixture = await createInitialAcceptanceFixture({ mode: MODE, tx });
      await tx.exec("CREATE TABLE initial_boundary_probe (id text PRIMARY KEY)");
      baseline = await canonicalRows(tx);
    });
  }, TIMEOUT);
  beforeEach(async () => {
    await store.transaction(async tx => {
      for (const name of [...TABLES].reverse()) await tx.query(`DELETE FROM alpha_exchange.${name}`);
      for (const name of TABLES) for (const row of baseline[name]) {
        await tx.query(`INSERT INTO alpha_exchange.${name} SELECT * FROM jsonb_populate_record(NULL::alpha_exchange.${name},$1::jsonb)`,
          [JSON.stringify(row)]);
      }
      await tx.query("DELETE FROM initial_boundary_probe");
    });
  }, TIMEOUT);
  afterAll(async () => {
    environment();
    try { await store?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("keeps a read-only callback's copied source facts separate from persisted canonical rows", async () => {
    const before = await footprint();
    await store.transaction(tx => use(tx, async participant => {
      participant.marketplace.purchaseRequests[0].usdtAmount = "999";
      participant.marketplace.users[0].disabled = true;
      return { observed: true };
    }));
    expect(await footprint()).toEqual(before);
  });

  it("poisons a swallowed uncloneable decision after earlier companion work", async () => {
    const before = await footprint(); let captured: unknown;
    await expect(store.transaction(tx => use(tx, async participant => {
      await tx.query("INSERT INTO initial_boundary_probe VALUES ('before-malformed-decision')");
      try {
        await participant.accept({ ...decision(), uncloneable: () => undefined } as DevelopmentInitialAcceptanceDecision);
      } catch (error) { captured = error; }
      return null;
    }))).rejects.toThrow();
    expect(captured).toBeInstanceOf(Error);
    expect(await footprint()).toEqual(before);
  });

  it("captures a valid decision before the caller can mutate it during awaited work", async () => {
    const result = await store.transaction(tx => use(tx, async participant => {
      const input = { ...decision() };
      const pending = participant.accept(input);
      input.actorUserId = fixture.buyerId; input.tradeId = "caller-replacement-trade";
      input.acceptedAtMs = fixture.atMs;
      return pending;
    }));
    expect(result.request).toMatchObject({ id: fixture.requestId, tradeId: fixture.tradeId, status: "accepted" });
    expect(result.request.timeline.at(-1)?.actorUserId).toBe(fixture.sellerId);
  });

  it("keeps the accepted result and exposed source copy from rewriting its final integrity basis", async () => {
    await store.transaction(tx => use(tx, async participant => {
      participant.marketplace.purchaseRequests.find(row => row.id === fixture.requestId)!.usdtAmount = "999";
      const result = await participant.accept(decision());
      result.request.usdtAmount = "777"; result.trade.id = "different-trade";
      result.listing.availableAmount = "0";
      return result;
    }));
    const after = await footprint();
    expect(after.canonical.purchase_requests.find(row => row.id === fixture.requestId)?.payload)
      .toMatchObject({ status: "accepted", usdtAmount: "200", tradeId: fixture.tradeId });
    expect(after.canonical.trades[0].id).toBe(fixture.tradeId);
    expect(after.canonical.listings.find(row => row.id === fixture.listingId)?.payload).toMatchObject({ availableAmount: "500" });
  });

  it.each(["read-only", "after-persistence"] as const)("rolls back a changed buyer eligibility dependency %s", async phase => {
    const before = await footprint();
    await expect(store.transaction(tx => use(tx, async participant => {
      await tx.query("INSERT INTO initial_boundary_probe VALUES ('before-buyer-change')");
      if (phase === "after-persistence") await participant.accept(decision());
      await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [fixture.buyerId]);
      return null;
    }))).rejects.toThrow(/canonical.*(?:dependency|basis).*changed/i);
    expect(await footprint()).toEqual(before);
  });

  it("rereads the buyer's other-seller history after actual acceptance persistence", async () => {
    const before = await footprint();
    await expect(store.transaction(tx => use(tx, async participant => {
      await participant.accept(decision());
      await tx.query(`UPDATE alpha_exchange.purchase_requests SET status='accepted',payload=jsonb_set(payload,'{status}','"accepted"') WHERE id=$1`,
        [fixture.buyerHistoryRequestId]);
      return null;
    }))).rejects.toThrow(/unrelated canonical reservation changed/i);
    expect(await footprint()).toEqual(before);
  });

  it("rejects a captured accept callback after its scope ended inside the same physical owner transaction", async () => {
    const before = await footprint(); let retained!: DevelopmentInitialAcceptanceParticipant, captured: unknown;
    await expect(store.transaction(async tx => {
      await use(tx, async participant => { retained = participant; return null; });
      await tx.query("INSERT INTO initial_boundary_probe VALUES ('after-participant-return')");
      try { await retained.accept(decision()); } catch (error) { captured = error; }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(String(captured)).toMatch(/no longer active/i);
    expect(await footprint()).toEqual(before);
  });

  it("does not let a retained callback write after the transaction has committed", async () => {
    const before = await footprint(); let retained!: DevelopmentInitialAcceptanceParticipant;
    await store.transaction(tx => use(tx, async participant => { retained = participant; return null; }));
    await expect(retained.accept(decision())).rejects.toThrow(/no longer active/i);
    expect(await footprint()).toEqual(before);
  });

  it("rejects unawaited acceptance before the callback can commit earlier companion work", async () => {
    const before = await footprint();
    let release!: () => void, observed!: () => void, gateNextContext = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const held = new Promise<void>(resolve => { observed = resolve; });
    let pending: Promise<unknown> | undefined;
    try {
      await expect(store.transaction(async owner => {
        await owner.query("INSERT INTO initial_boundary_probe VALUES ('before-unawaited-acceptance')");
        const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const block = gateNextContext && sql.includes("txid_current()") && sql.includes("current_setting('transaction_isolation')");
          if (block) gateNextContext = false;
          const result = await owner.query<Row>(sql, params);
          if (block) { observed(); await gate; }
          return result;
        } };
        return use(tx, async participant => {
          gateNextContext = true;
          pending = participant.accept(decision()).catch(error => error);
          await held;
          return "callback-returned-with-acceptance-still-running";
        });
      })).rejects.toThrow(/acceptance.*(?:await|complet|progress)|(?:await|complet|progress).*acceptance/i);
    } finally { release(); await pending; }
    expect(await footprint()).toEqual(before);
  });

  it("poisons a swallowed second acceptance rather than committing the first one", async () => {
    const before = await footprint(); let captured: unknown;
    await expect(store.transaction(tx => use(tx, async participant => {
      await participant.accept(decision());
      try { await participant.accept(decision()); } catch (error) { captured = error; }
      return null;
    }))).rejects.toThrow();
    expect(String(captured)).toMatch(/one acceptance only/i);
    expect(await footprint()).toEqual(before);
  });

  it("rolls back actual canonical persistence after a swallowed runtime failure and environment restoration", async () => {
    const before = await footprint(); let captured: unknown, persisted = false;
    await expect(store.transaction(async owner => {
      await owner.query("INSERT INTO initial_boundary_probe VALUES ('before-runtime-change')");
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await owner.query<Row>(sql, params);
        if (sql.includes("initial acceptance: request persistence")) { persisted = true; vi.stubEnv("VERCEL_ENV", "production"); }
        return result;
      } };
      try { await use(tx, participant => participant.accept(decision())); } catch (error) { captured = error; }
      finally { vi.stubEnv("VERCEL_ENV", undefined); }
    })).rejects.toThrow(/hosted runtime/i);
    expect(persisted).toBe(true); expect(String(captured)).toMatch(/hosted runtime/i);
    expect(await footprint()).toEqual(before);
  });

  it("refuses actual autocommit before any canonical lookup", async () => {
    const db = new PGlite(), statements: string[] = [];
    try {
      await db.exec("SET default_transaction_isolation='serializable'; SET alpha_wallet.development_schema='simulation-only';");
      const tx: WalletSql = { exec: async sql => { await db.exec(sql); }, query: (sql, params) => {
        statements.push(sql); return db.query(sql, params);
      } };
      await expect(use(tx, async () => null)).rejects.toThrow(/original writable SERIALIZABLE/i);
      expect(statements.some(sql => sql.includes("alpha_exchange.") || sql.includes("1 / 0"))).toBe(false);
    } finally { await db.close(); }
  }, TIMEOUT);

  it.each([["41", "42"], ["41", "41", "42"]].map(identities => ({ identities })))(
    "does not poison a replacement or uncertified transaction (%#)", async ({ identities }) => {
    const statements: string[] = []; let index = 0;
    const tx: WalletSql = { exec: async () => { throw new Error("Unexpected mutation"); },
      async query<Row extends Record<string, unknown>>(sql: string) {
        statements.push(sql);
        if (sql.includes("txid_current()")) return { rows: [{ transaction_id: identities[Math.min(index++, identities.length - 1)],
          isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
        throw new Error("Unexpected canonical read or abort");
      } };
    await expect(use(tx, async () => null)).rejects.toThrow(/original writable SERIALIZABLE/i);
    expect(statements.some(sql => sql.includes("alpha_exchange.") || sql.includes("1 / 0"))).toBe(false);
  });
});

const syntheticInput = (transport: "web" | "mobile") => ({
  ...(transport === "web" ? { sessionToken: "public-synthetic-web-token" } : {
    accessToken: `atr_at_v1.${"a".repeat(43)}`, metadata: { deviceId: "public-synthetic-device", platform: "ios", appVersion: "1.0.0", locale: "en" },
  }), requestId: "synthetic-request", operationId: "synthetic-transport-operation",
});
function client(transport: "web" | "mobile", store: WalletStore, clock = () => 1_800_000_001_000) {
  return transport === "web" ? createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock })
    : createDevelopmentMobileInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
}

describe.each(["web", "mobile"] as const)("initial %s public input boundary", transport => {
  it.each([
    ["client seller", { actorUserId: "forged-seller" }], ["client role", { canSell: true }],
    ["price", { pricePerUsdt: "0.01" }], ["amount", { usdtAmount: "1" }],
    ["wallet state", { wallet: {} }], ["wallet mapping", { walletTradeId: "replacement-trade" }],
    ["arbitrary command", { command: { type: "pause" } }], ["refresh credential", { refreshToken: "private-refresh-token" }],
  ])("refuses %s before opening a transaction", async (_name, extra) => {
    const transaction = vi.fn(async () => { throw new Error("Unexpected transaction"); });
    const coordinator = client(transport, { transaction, close: async () => undefined });
    await expect(coordinator.acceptRequest({ ...syntheticInput(transport), ...extra } as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not use the other transport's credentials as fallback", async () => {
    const transaction = vi.fn(async () => { throw new Error("Unexpected transaction"); });
    const coordinator = client(transport, { transaction, close: async () => undefined });
    const wrong = transport === "web" ? { accessToken: "replacement-bearer" } : { sessionToken: "replacement-cookie" };
    await expect(coordinator.acceptRequest({ ...syntheticInput(transport), ...wrong } as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("initial coordinator public error sanitization", () => {
  const privateDetail = "synthetic-private-bank-account-and-session-token";
  it.each(["driver", "unknown-commit", "40001", "40P01"] as const)("sanitizes %s without changing its outcome class", async kind => {
    const privateCause = new Error(privateDetail);
    const failure = kind === "unknown-commit" ? new CommitOutcomeUnknownError(privateCause)
      : kind === "driver" ? Object.assign(privateCause, { detail: privateDetail, parameters: [privateDetail] })
        : Object.assign(privateCause, { code: kind });
    const coordinator = client("web", { transaction: async () => { throw failure; }, close: async () => undefined });
    let captured: unknown;
    try { await coordinator.acceptRequest(syntheticInput("web") as never); } catch (error) { captured = error; }
    expect(captured).toMatchObject({ code: kind === "driver" ? "STORAGE_UNAVAILABLE"
      : kind === "unknown-commit" ? "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" : kind });
    expect(String(captured)).not.toContain(privateDetail);
    expect(JSON.stringify(captured)).not.toContain(privateDetail);
    if (kind === "unknown-commit") {
      expect(captured).toBeInstanceOf(CommitOutcomeUnknownError);
      expect(String((captured as Error).cause)).not.toContain(privateDetail);
    } else expect(captured).not.toHaveProperty("cause");
    expect(captured).not.toHaveProperty("parameters"); expect(captured).not.toHaveProperty("detail");
  });
});

describe.each(["web", "mobile"] as const)("initial %s financial receipt boundary", transport => {
  let directory: string, store: WalletStore, fixture: Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "alpha-wallet-initial-receipt-boundary-"));
    store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    fixture = await buildInitialMarketplaceFixture(store);
  }, TIMEOUT);
  afterEach(async () => {
    environment();
    try { await store?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("refuses irrelevant bank consent flags before and after acceptance and keeps public receipts private", async () => {
    const facts = fixture.canonical;
    const coordinator = client(transport, store, () => facts.acceptedAtMs);
    const ownerCredentials = transport === "web" ? facts.webCredentials[facts.ownerId] : facts.mobile.credentials[facts.ownerId];
    const sellerCredentials = transport === "web" ? facts.webCredentials[facts.sellerId] : facts.mobile.credentials[facts.sellerId];
    const activation = await coordinator.activateRequest({ ...ownerCredentials, requestId: facts.requestId,
      operationId: "activate-receipt-boundary", walletListingId: facts.walletListingId,
      walletTradeId: facts.walletTradeId, assetId: facts.assetId } as never);
    const footprint = () => store.transaction(async tx => ({ canonical: await canonicalRows(tx),
      head: (await tx.query("SELECT * FROM alpha_wallet_simulation.head")).rows,
      commandCount: (await tx.query("SELECT count(*)::text AS count FROM alpha_wallet_simulation.commands")).rows,
      acceptance: (await tx.query("SELECT * FROM alpha_wallet_initial_marketplace_simulation.acceptances")).rows,
      publications: (await tx.query("SELECT * FROM alpha_wallet_initial_marketplace_simulation.publications")).rows }));
    const input = { ...sellerCredentials, requestId: facts.requestId, operationId: "accept-receipt-boundary" };
    const before = await footprint();
    await expect(coordinator.acceptRequest({ ...input, safetyAcknowledged: true } as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await footprint()).toEqual(before);
    const acceptance = await coordinator.acceptRequest(input as never);
    const after = await footprint();
    await expect(coordinator.acceptRequest({ ...input, operationId: "altered-bank-flag-retry", safetyAcknowledged: true } as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await footprint()).toEqual(after);
    const recovered = await coordinator.acceptRequest({ ...input, operationId: "valid-original-receipt-retry" } as never);
    expect(recovered).toEqual({ ...acceptance, replayed: true });
    const inspection = await coordinator.inspect({ ...ownerCredentials, requestId: facts.requestId } as never);
    const serialized = JSON.stringify({ activation, acceptance, recovered, inspection });
    for (const key of ["sessionToken", "accessToken", "deviceId", "sellerBankAccountSnapshot", "passwordHash", "canonicalBasis", "destination"]) {
      expect(serialized).not.toContain(`"${key}":`);
    }
    for (const value of [facts.ownerSessionToken, facts.sellerSessionToken, facts.mobile.credentials[facts.sellerId].accessToken,
      facts.initialRequest.buyerReceivingWalletAddress!, facts.initialRequest.sellerBankAccountSnapshot!.bankName,
      facts.initialRequest.sellerBankAccountSnapshot!.accountNumber]) expect(serialized).not.toContain(value);
    expect(acceptance.terms).toMatchObject({ usdtAmount: "200", pricePerUsdt: "3.10", fiatAmount: "626.20", principalRaw: "200000000" });
  }, TIMEOUT);
});
