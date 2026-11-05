// @vitest-environment node
// The additive participant uses the real accepted predecessor and opaque successor contexts.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  withDevelopmentCancellationMarketplaceInTransaction,
  withDevelopmentPrepaymentCancellationInTransaction,
  type DevelopmentCancellationMarketplaceParticipant,
  type DevelopmentPrepaymentCancellationDecision,
} from "@/lib/alpha-exchange-repository";
import { buildCancellationMarketplaceFixture } from "../../../scripts/alpha-wallet/cancellation-marketplace-fixtures";
import { resolveDevelopmentCancellationMarketplacePrincipal } from "./cancellation-marketplace-auth";
import {
  assertCancellationMarketplaceCoherence, bindCancellationMarketplaceCommand,
  insertCancellationMarketplaceCancellation, readCancellationMarketplacePredecessor,
  registerCancellationMarketplaceContext, type CancellationMarketplaceContext,
} from "./cancellation-marketplace-coordination-store";
import { cancellationMarketplaceRequestFingerprint } from "./cancellation-marketplace-coordinator";
import { planDevelopmentMarketplaceCancellation } from "./cancellation-marketplace-plan";
import { walletDigest } from "./commands";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createCoordinatedV4DurableWallet } from "./v4-durable";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
let directory: string, store: WalletStore;
let fixture: Awaited<ReturnType<typeof buildCancellationMarketplaceFixture>>;
const rollback = Symbol("rollback focused successor mutation");
async function isolated<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
  let answer: T | undefined;
  try { await store.transaction(async tx => { answer = await work(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
  return answer as T;
}
const canonical = () => fixture.canonical;
const decision = (): DevelopmentPrepaymentCancellationDecision => ({ requestId: canonical().requestId,
  tradeId: canonical().tradeId, actorUserId: canonical().sellerId, cancelledAtMs: fixture.clock() });
const participate = <T>(tx: WalletSql, work: (participant: DevelopmentCancellationMarketplaceParticipant) => Promise<T>) =>
  withDevelopmentCancellationMarketplaceInTransaction({ mode: MODE, tx, requestId: canonical().requestId }, work);
async function context(tx: WalletSql, operation: "cancel" | "inspect" | "upgrade" = "cancel") {
  const actorUserId = operation === "cancel" ? canonical().sellerId : canonical().ownerId;
  const principal = await resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx,
    requestId: canonical().requestId, operation, credentials: { kind: "web", ...canonical().webCredentials[actorUserId] }, clock: fixture.clock });
  const context = await registerCancellationMarketplaceContext({ mode: MODE, tx, requestId: canonical().requestId, actorUserId, operation });
  return { principal, context };
}
async function prepare(tx: WalletSql, participant: DevelopmentCancellationMarketplaceParticipant) {
  const authority = await context(tx);
  const predecessor = await readCancellationMarketplacePredecessor(authority.context);
  const wallet = createCoordinatedV4DurableWallet({ mode: MODE, context: authority.context, clock: fixture.clock });
  const plan = planDevelopmentMarketplaceCancellation({ mode: MODE, actorUserId: canonical().sellerId,
    requestId: canonical().requestId, operationId: "participant-cancellation", cancelledAtMs: fixture.clock(),
    marketplace: participant.marketplace, canonical: participant.canonical, basis: participant.basis, digests: participant.digests,
    ...predecessor, wallet: await wallet.snapshot() });
  await bindCancellationMarketplaceCommand(authority.context, plan.command);
  const execution = await wallet.execute(plan.command);
  return { ...authority, plan, execution };
}
async function finish(prepared: Awaited<ReturnType<typeof prepare>>,
  result: Awaited<ReturnType<DevelopmentCancellationMarketplaceParticipant["cancel"]>>) {
  await insertCancellationMarketplaceCancellation(prepared.context, {
    inputDigest: cancellationMarketplaceRequestFingerprint(canonical().sellerId, canonical().requestId),
    execution: prepared.execution, canonical: result,
  });
  await prepared.principal.assertFresh();
}
async function footprint() {
  return store.transaction(async tx => {
    const tables = ["alpha_exchange.runtime_meta", "alpha_exchange.purchase_requests", "alpha_exchange.listings", "alpha_exchange.trades",
      "alpha_exchange.users", "alpha_exchange.notifications", "alpha_exchange.audit_logs", "alpha_wallet_simulation.commands",
      "alpha_wallet_cancellation_marketplace_simulation.cancellations", "cancellation_participant_probe"];
    const values: Record<string, unknown> = {};
    for (const table of tables) values[table] = (await tx.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    return values;
  });
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-cancellation-participant-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  // Surface the synthetic underlying setup failure if a sanitized public DTO
  // cannot be built; tests never use a different auth resolver or transaction.
  let setupFailure: unknown;
  const observed: WalletStore = { close: async () => undefined,
    transaction: work => store.transaction(tx => work(tx).catch(error => { setupFailure = error; throw error; })) };
  try { fixture = await buildCancellationMarketplaceFixture(observed, { tradeProjection: "pending" }); }
  catch (error) { throw setupFailure ?? error; }
  await store.transaction(tx => tx.exec("CREATE TABLE cancellation_participant_probe (id text PRIMARY KEY)"));
}, TIMEOUT);
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { await store?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);

describe("context-bound cancellation canonical transaction participant", () => {
  it("exports detached immutable physical payloads and complete dependency hashes behind the canonical fences", async () => {
    const statements: string[] = [];
    await isolated(owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), query: (sql, values) => { statements.push(sql); return owner.query(sql, values); } };
      return participate(tx, async participant => {
        expect(participant.canonical.trade).toEqual(participant.basis.rows.trades[0].payload);
        expect(participant.canonical.trade.createdAt).toBe(fixture.acceptance.acceptedAt);
        expect(participant.digests).toEqual({ requestDigest: walletDigest(participant.canonical.request),
          listingDigest: walletDigest(participant.canonical.listing), tradeDigest: walletDigest(participant.canonical.trade),
          marketplaceDigest: walletDigest(participant.basis) });
        expect(Object.keys(participant.basis.rows).sort()).toEqual(["commissions", "disputes", "enforcements", "evidence", "listings", "requests", "trades", "users"]);
        expect(Object.isFrozen(participant.basis.rows.users[0].payload)).toBe(true);
        expect(() => { participant.basis.rows.users[0].sort_index = 999; }).toThrow();
        const current = await participant.snapshot();
        expect(current).toEqual({ marketplace: participant.marketplace, canonical: participant.canonical, basis: participant.basis, digests: participant.digests });
        expect(current.basis).not.toBe(participant.basis);
      });
    });
    const requestFence = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock(61422919"));
    const globalFence = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock(61422917"));
    const runtimeFence = statements.findIndex(sql => /runtime_meta.*FOR UPDATE/i.test(sql));
    const listingFence = statements.findIndex(sql => sql.includes("cancellation marketplace: listing fence"));
    const read = statements.findIndex(sql => sql.includes("initial acceptance: authoritative read"));
    expect(requestFence).toBeLessThan(globalFence); expect(globalFence).toBeLessThan(runtimeFence);
    expect(runtimeFence).toBeLessThan(listingFence); expect(listingFence).toBeLessThan(read);
    expect(statements.some(sql => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))).toBe(false);
  });

  it("captures one exact cancellation before awaiting and rechecks the complete cancelled snapshot", async () => {
    const before = await footprint();
    await isolated(async tx => {
      let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
      await participate(tx, async participant => {
        prepared = await prepare(tx, participant);
        const raw = structuredClone(prepared.plan.canonicalDecision) as {
          -readonly [Key in keyof DevelopmentPrepaymentCancellationDecision]: DevelopmentPrepaymentCancellationDecision[Key];
        };
        const pending = participant.cancel(prepared.context, raw);
        raw.actorUserId = canonical().otherSellerId; raw.tradeId = "changed-trade"; raw.cancelledAtMs += 1000;
        const result = await pending;
        expect(result).toEqual(prepared.plan.canonicalResult);
        await finish(prepared, result);
        const current = await participant.snapshot();
        expect(current.canonical).toEqual({ request: JSON.parse(JSON.stringify(result.request)),
          listing: JSON.parse(JSON.stringify(result.listing)), trade: JSON.parse(JSON.stringify(result.trade)) });
        expect(current.basis.runtime.version).toBe((BigInt(participant.basis.runtime.version) + BigInt(1)).toString());
        expect(Date.parse(current.basis.runtime.updated_at)).toBe(fixture.clock());
        expect(current.basis.rows.trades[0].created_at).toBe(participant.basis.rows.trades[0].created_at);
        expect(current.basis.events.notifications).toHaveLength(participant.basis.events.notifications.length + 2);
        expect(current.basis.events.audits).toHaveLength(participant.basis.events.audits.length + 1);
        expect(current.digests.marketplaceDigest).toBe(walletDigest(current.basis));
        expect(participant.canonical.request.status).toBe("accepted");
      });
      await assertCancellationMarketplaceCoherence(prepared!.context); await prepared!.principal.assertFresh();
      await participate(tx, async participant => { expect(participant.canonical.request.status).toBe("cancelled"); });
    });
    expect(await footprint()).toEqual(before);
  });

  it("keeps the original standalone refusal inside both retained coordinator namespaces", async () => {
    await expect(isolated(tx => withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: canonical().requestId },
      async () => undefined))).rejects.toThrow(/groundwork cannot run/);
  });

  it.each(["cancel", "authorizeUpgrade"] as const)("poisons swallowed forged context in %s after companion work", async method => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO cancellation_participant_probe VALUES ('companion-work')");
      try { await participate(tx, async participant => {
        if (method === "cancel") await participant.cancel({} as CancellationMarketplaceContext, decision());
        else await participant.authorizeUpgrade({} as CancellationMarketplaceContext);
      }); } catch { /* Owner attempts to commit a swallowed participant refusal. */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  });

  it("refuses a genuine context registered for another operation", async () => {
    await expect(isolated(tx => participate(tx, async participant => {
      const authority = await context(tx, "inspect");
      await participant.cancel(authority.context, decision());
    }))).rejects.toThrow(/operation/);
  });

  it("refuses another actor under a genuine same-request cancellation context", async () => {
    await expect(isolated(tx => participate(tx, async participant => {
      const authority = await context(tx);
      await participant.cancel(authority.context, { ...decision(), actorUserId: canonical().buyerId });
    }))).rejects.toThrow(/identity or operation/);
  });

  it("poisons a swallowed uncloneable decision before the first await", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO cancellation_participant_probe VALUES ('clone-failure')");
      try { await participate(tx, async participant => {
        const authority = await context(tx);
        await participant.cancel(authority.context, { ...decision(), privateFunction: () => undefined } as unknown as DevelopmentPrepaymentCancellationDecision);
      }); } catch { /* Swallowed capture failure must not retain the probe. */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  });

  it("requires the callback to await its one complete cancellation", async () => {
    const before = await footprint(); let pending: Promise<unknown> | undefined;
    await expect(store.transaction(async tx => {
      try { await participate(tx, async participant => {
        const prepared = await prepare(tx, participant);
        pending = participant.cancel(prepared.context, prepared.plan.canonicalDecision).catch(error => error);
      }); } catch { /* Intentionally try to rescue the financial command. */ }
    })).rejects.toThrow();
    await pending; expect(await footprint()).toEqual(before);
  });

  it("rejects a second cancellation even if the owner swallows it", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await participate(tx, async participant => {
        const prepared = await prepare(tx, participant);
        const result = await participant.cancel(prepared.context, prepared.plan.canonicalDecision);
        await finish(prepared, result);
        try { await participant.cancel(prepared.context, prepared.plan.canonicalDecision); } catch { /* swallowed */ }
      }); } catch { /* swallowed */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  });

  it.each(["before", "after"] as const)("rechecks raw normalized dependency ordering %s cancellation", async when => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await participate(tx, async participant => {
        const prepared = await prepare(tx, participant);
        const change = () => tx.query("UPDATE alpha_exchange.users SET sort_index=sort_index+200 WHERE id=$1", [canonical().sellerId]);
        if (when === "before") await change();
        const result = await participant.cancel(prepared.context, prepared.plan.canonicalDecision);
        await finish(prepared, result);
        if (when === "after") await change();
      }); } catch { /* Swallowed raw dependency drift must roll back the ledger. */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  });

  it("requires the exact version fence after an awaited upgrade authorization", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await participate(tx, async participant => {
        const authority = await context(tx, "upgrade");
        await participant.authorizeUpgrade(authority.context);
        expect((await participant.snapshot()).basis).toEqual(participant.basis);
        // Authorization alone does not satisfy the final version+1 contract.
      }); } catch { /* Swallowed incomplete upgrade. */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  });

  it("requires the callback to await its upgrade authorization", async () => {
    let pending: Promise<unknown> | undefined;
    await expect(store.transaction(async tx => {
      try { await participate(tx, async participant => {
        const authority = await context(tx, "upgrade");
        pending = participant.authorizeUpgrade(authority.context).catch(error => error);
      }); } catch { /* Swallowed unawaited upgrade. */ }
    })).rejects.toThrow();
    await pending;
  });

  it("expires the participant at the original callback boundary", async () => {
    let retained: DevelopmentCancellationMarketplaceParticipant | undefined;
    await store.transaction(tx => participate(tx, async participant => { retained = participant; }));
    await expect(retained!.snapshot()).rejects.toThrow(/no longer active/);
  });

  it.each(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "SET TRANSACTION READ ONLY", "SET LOCAL alpha_wallet.development_schema='disabled'"])(
    "rejects an uncertified real transaction: %s", async statement => {
      await expect(store.transaction(async tx => { await tx.exec(statement); return participate(tx, async () => undefined); }))
        .rejects.toThrow(/original writable SERIALIZABLE/);
    });

  it("never poisons an uncertified or replacement physical transaction", async () => {
    for (const ids of [["41", "42"], ["41", "41", "42"]]) {
      const statements: string[] = []; let index = 0;
      const tx: WalletSql = { exec: async () => { throw new Error("Unexpected write"); }, async query<Row extends Record<string, unknown>>(sql: string) {
        statements.push(sql);
        if (sql.includes("txid_current()")) return { rows: [{ transaction_id: ids[Math.min(index++, ids.length - 1)],
          isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
        throw new Error("Unexpected canonical read or abort");
      } };
      await expect(participate(tx, async () => undefined)).rejects.toThrow(/original writable SERIALIZABLE/);
      expect(statements.some(sql => sql.includes("1 / 0") || sql.includes("alpha_exchange."))).toBe(false);
    }
  });
});
