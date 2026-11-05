// @vitest-environment node
// Fixed real stored readers, disposable canonical records and public synthetic credentials.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mutateDevelopmentInitialAcceptanceInTransaction } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import {
  resolveDevelopmentCancellationMarketplacePrincipal,
  type DevelopmentCancellationMarketplaceAuthOperation,
  type DevelopmentCancellationMarketplaceCredentials,
} from "./cancellation-marketplace-auth";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createInitialMarketplaceFixture } from "./initial-marketplace-fixture";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient auth discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 90_000;
const FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof createInitialMarketplaceFixture>>;
const rollback = Symbol("rollback synthetic test mutation");
async function isolated<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
  let value: T | undefined;
  try { await store.transaction(async tx => { value = await work(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
  return value as T;
}
function credentials(userId: string, kind: "web" | "mobile" = "web"): DevelopmentCancellationMarketplaceCredentials {
  return kind === "web" ? { kind, ...fixture.webCredentials[userId] } : { kind, ...structuredClone(fixture.mobile.credentials[userId]) };
}
function resolve(tx: WalletSql, userId = fixture.sellerId, kind: "web" | "mobile" = "web",
  operation: DevelopmentCancellationMarketplaceAuthOperation = "cancel") {
  return resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
    credentials: credentials(userId, kind), operation, clock: () => now });
}
async function patchUser(tx: WalletSql, userId: string, patch: Partial<AlphaExchangeUser>) {
  const user = { ...(await tx.query<{ payload: AlphaExchangeUser }>("SELECT payload FROM alpha_exchange.users WHERE id=$1", [userId])).rows[0].payload, ...patch };
  await tx.query("UPDATE alpha_exchange.users SET role=$2,seller_status=$3,email=$4,payload=$5::jsonb WHERE id=$1",
    [userId, user.role, user.sellerStatus, user.email, JSON.stringify(user)]);
}
function requestStatus(tx: WalletSql, status: "accepted" | "cancelled") {
  return tx.query("UPDATE alpha_exchange.purchase_requests SET status=$2,payload=jsonb_set(payload,'{status}',to_jsonb($2::text)) WHERE id=$1", [fixture.requestId, status]);
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-cancellation-auth-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  fixture = await store.transaction(tx => createInitialMarketplaceFixture({ mode: MODE, tx }));
  await store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => ({
    requestId: fixture.requestId, tradeId: fixture.tradeId, actorUserId: fixture.sellerId, acceptedAtMs: fixture.acceptedAtMs,
  })));
  await store.transaction(tx => tx.exec("CREATE TABLE cancellation_auth_probe (id text PRIMARY KEY)"));
}, TIMEOUT);
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  now = fixture.acceptedAtMs + 1000;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { await store?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);

describe("current stored cancellation marketplace authority", () => {
  it.each([ ["web", "seller"], ["web", "buyer"], ["mobile", "seller"], ["mobile", "buyer"] ] as const)(
    "derives the retained %s %s without exposing records or new-trade capabilities", async (kind, side) => {
      const userId = side === "seller" ? fixture.sellerId : fixture.buyerId;
      const statements: string[] = [];
      const principal = await isolated(async owner => {
        const tx: WalletSql = { exec: sql => owner.exec(sql), query: (sql, values) => { statements.push(sql); return owner.query(sql, values); } };
        const principal = await resolve(tx, userId, kind); await principal.assertFresh(); return principal;
      });
      expect(principal).toMatchObject({ userId, actorKind: side, isOwner: false });
      expect(Object.isFrozen(principal)).toBe(true);
      expect(Object.keys(principal).sort()).toEqual(["actorKind", "assertFresh", "isOwner", "sessionExpiresAtMs", "userId"]);
      expect(statements.filter(sql => sql.includes("authority: retained request identity"))).toHaveLength(2);
      expect(statements.some(sql => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))).toBe(false);
      for (const secret of [fixture.sellerSessionToken, fixture.buyerSessionToken, "passwordHash", "account_payload", "deviceId", "canSell", "canBuy"]) {
        expect(JSON.stringify(principal)).not.toContain(secret);
      }
    });

  it.each(["upgrade", "inspect", "pause", "export"] as const)("uses current owner authority for %s", async operation => {
    await isolated(async tx => {
      expect(await resolve(tx, fixture.ownerId, "web", operation)).toMatchObject({ userId: fixture.ownerId, actorKind: "operator", isOwner: true });
    });
    await expect(isolated(tx => resolve(tx, fixture.sellerId, "web", operation))).rejects.toMatchObject({ code: "WALLET_CANCELLATION_OWNER_REQUIRED" });
  });

  it.each(["ownerId", "otherSellerId", "otherBuyerId"] as const)("does not turn an unrelated %s into a cancelling party", async name => {
    await expect(isolated(tx => resolve(tx, fixture[name]))).rejects.toMatchObject({ code: "WALLET_CANCELLATION_PARTICIPANT_REQUIRED" });
  });

  it.each([ ["web", "seller"], ["mobile", "seller"], ["web", "buyer"], ["mobile", "buyer"] ] as const)(
    "allows a retained %s %s after new-trade eligibility is lost", async (kind, side) => {
      await isolated(async tx => {
        const userId = side === "seller" ? fixture.sellerId : fixture.buyerId;
        await patchUser(tx, userId, side === "seller" ? { sellerStatus: "suspended" } : { role: "guest", roles: [] });
        const principal = await resolve(tx, userId, kind); await principal.assertFresh();
        expect(principal).toMatchObject({ userId, actorKind: side });
      });
    });

  it("derives a retained owner participant as the seller instead of an owner override", async () => {
    await isolated(async tx => {
      await patchUser(tx, fixture.sellerId, { role: "owner", roles: ["owner"] });
      expect(await resolve(tx)).toMatchObject({ userId: fixture.sellerId, actorKind: "seller", isOwner: true });
    });
  });

  it.each([
    ["disabled", { disabled: true }, "WALLET_ACCOUNT_DISABLED"],
    ["email", { emailVerified: false }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["phone", { phoneVerifiedAt: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["adult", { ageEligibility: undefined }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
  ] as const)("retains the ordinary current-account %s gate", async (_name, patch, code) => {
    await expect(isolated(async tx => { await patchUser(tx, fixture.sellerId, patch); return resolve(tx); })).rejects.toMatchObject({ code });
  });

  it("keeps fixed mobile transport and device checks without web fallback", async () => {
    for (const patch of [{ accessToken: fixture.sellerSessionToken }, { metadata: { ...fixture.mobile.credentials[fixture.sellerId].metadata, deviceId: "wrong-device" } }]) {
      const input = { ...credentials(fixture.sellerId, "mobile"), ...patch } as DevelopmentCancellationMarketplaceCredentials;
      await expect(isolated(tx => resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx,
        requestId: fixture.requestId, operation: "cancel", credentials: input, clock: () => now }))).rejects.toThrow();
    }
  });

  it.each(["actorUserId", "canSell", "sessionToken"] as const)("rejects an extra claimed %s in mobile credentials", async field => {
    const input = { ...credentials(fixture.sellerId, "mobile"), [field]: "caller-claim" };
    await expect(isolated(tx => resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
      operation: "cancel", credentials: input, clock: () => now }))).rejects.toMatchObject({ code: "WALLET_CANCELLATION_AUTH_INPUT_INVALID" });
  });

  it("captures transport and nested device metadata before the first await", async () => {
    await isolated(async tx => {
      const input = credentials(fixture.sellerId, "mobile");
      if (input.kind !== "mobile") throw new Error("Expected mobile fixture");
      const pending = resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
        operation: "cancel", credentials: input, clock: () => now });
      input.accessToken = "changed-after-call"; input.metadata.deviceId = "changed-after-call";
      expect(await pending).toMatchObject({ userId: fixture.sellerId, actorKind: "seller" });
    });
  });

  it("allows exact accepted-to-cancelled identity continuity and authenticates cancelled receipt recovery", async () => {
    await isolated(async tx => {
      const principal = await resolve(tx); await requestStatus(tx, "cancelled"); await principal.assertFresh();
      expect(await resolve(tx, fixture.buyerId, "mobile")).toMatchObject({ userId: fixture.buyerId, actorKind: "buyer" });
    });
  });

  it.each(["seller_id", "listing_id"] as const)("refuses normalized/payload %s disagreement", async column => {
    await expect(isolated(async tx => {
      await tx.query(`UPDATE alpha_exchange.purchase_requests SET ${column}=$2 WHERE id=$1`,
        [fixture.requestId, column === "seller_id" ? fixture.otherSellerId : fixture.marketplace.marketplaceListings.find(row => row.id !== fixture.listingId)!.id]);
      return resolve(tx);
    })).rejects.toMatchObject({ code: "WALLET_AUTH_RECORD_INVALID" });
  });

  it("rechecks immutable party linkage after awaited work", async () => {
    await expect(isolated(async tx => {
      const principal = await resolve(tx);
      await tx.query("UPDATE alpha_exchange.purchase_requests SET buyer_id=$2,payload=jsonb_set(payload,'{buyerId}',to_jsonb($2::text)) WHERE id=$1",
        [fixture.requestId, fixture.otherBuyerId]);
      await principal.assertFresh();
    })).rejects.toMatchObject({ code: "WALLET_AUTHORITY_CHANGED" });
  });

  it("rejects the missing exact request without accepting its trade ID as an alias", async () => {
    await expect(isolated(tx => resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx,
      requestId: fixture.tradeId, credentials: credentials(fixture.sellerId), operation: "cancel", clock: () => now })))
      .rejects.toMatchObject({ code: "WALLET_CANCELLATION_REQUEST_REQUIRED" });
  });

  it.each(["web", "mobile"] as const)("checks %s expiry after the final awaited request read", async kind => {
    const expiry = kind === "web" ? fixture.sessionsExpireAtMs : Date.parse(fixture.mobile.sessions[fixture.sellerId].accessExpiresAt);
    await expect(isolated(owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await owner.query<Row>(sql, values);
        if (sql.includes("authority: retained request identity")) now = expiry;
        return result;
      } };
      return resolve(tx, fixture.sellerId, kind);
    })).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });

  it.each(["bad authority", "uncloneable credentials", "late runtime shutdown"] as const)("poisons only the original transaction after swallowed %s", async fault => {
    let captured: unknown;
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO cancellation_auth_probe VALUES ('earlier-companion-work')");
      try {
        if (fault === "bad authority") await resolve(tx, fixture.otherSellerId);
        else if (fault === "uncloneable credentials") await resolveDevelopmentCancellationMarketplacePrincipal({ mode: MODE, tx,
          requestId: fixture.requestId, operation: "cancel", credentials: { ...credentials(fixture.sellerId), extra: () => undefined } as unknown as DevelopmentCancellationMarketplaceCredentials,
          clock: () => now });
        else { const principal = await resolve(tx); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true"); await principal.assertFresh(); }
      } catch (error) { captured = error; }
      finally { vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", undefined); }
    })).rejects.toThrow();
    vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", undefined);
    expect(captured).toBeDefined();
    expect((await store.transaction(tx => tx.query("SELECT id FROM cancellation_auth_probe"))).rows).toEqual([]);
  });

  it.each(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "SET TRANSACTION READ ONLY", "SET LOCAL alpha_wallet.development_schema='disabled'"])(
    "refuses an uncertified real transaction: %s", async statement => {
      await expect(store.transaction(async tx => { await tx.exec(statement); await resolve(tx); })).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
    });

  it("never poisons a replacement physical transaction", async () => {
    for (const ids of [["41", "42"], ["41", "41", "42"]]) {
      const statements: string[] = []; let index = 0;
      const tx: WalletSql = { exec: async () => { throw new Error("Unexpected write"); }, async query<Row extends Record<string, unknown>>(sql: string) {
        statements.push(sql);
        if (sql.includes("txid_current()")) return { rows: [{ transaction_id: ids[Math.min(index++, ids.length - 1)],
          isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
        throw new Error("Unexpected auth read or abort");
      } };
      await expect(resolve(tx)).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
      expect(statements.some(sql => sql.includes("1 / 0") || sql.includes("alpha_exchange.sessions"))).toBe(false);
    }
  });

  it("does not retain authority after its original transaction lifetime", async () => {
    const principal = await store.transaction(tx => resolve(tx));
    await expect(principal.assertFresh()).rejects.toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE" });
  });
});
