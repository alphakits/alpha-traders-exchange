// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mutateDevelopmentInitialAcceptanceInTransaction } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { resolveDevelopmentPaymentMarketplacePrincipal, type DevelopmentPaymentMarketplaceAuthOperation,
  type DevelopmentPaymentMarketplaceCredentials } from "./payment-marketplace-auth";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createInitialMarketplaceFixture } from "./initial-marketplace-fixture";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient auth discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 90_000;
const FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof createInitialMarketplaceFixture>>;
const rollback = Symbol("rollback synthetic mutation");
async function isolated<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try { await store.transaction(async tx => { result = await work(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
  return result as T;
}
function credentials(userId: string, kind: "web" | "mobile" = "web"): DevelopmentPaymentMarketplaceCredentials {
  return kind === "web" ? { kind, ...fixture.webCredentials[userId] } : { kind, ...structuredClone(fixture.mobile.credentials[userId]) };
}
function resolve(tx: WalletSql, userId = fixture.buyerId, kind: "web" | "mobile" = "web",
  operation: DevelopmentPaymentMarketplaceAuthOperation = "claim") {
  return resolveDevelopmentPaymentMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
    credentials: credentials(userId, kind), operation, clock: () => now });
}
async function patchUser(tx: WalletSql, userId: string, patch: Partial<AlphaExchangeUser>) {
  const user = { ...(await tx.query<{ payload: AlphaExchangeUser }>("SELECT payload FROM alpha_exchange.users WHERE id=$1", [userId])).rows[0].payload, ...patch };
  await tx.query("UPDATE alpha_exchange.users SET role=$2,seller_status=$3,email=$4,payload=$5::jsonb WHERE id=$1",
    [userId, user.role, user.sellerStatus, user.email, JSON.stringify(user)]);
}
function requestStatus(tx: WalletSql, status: "accepted" | "payment_sent" | "cancelled") {
  return tx.query("UPDATE alpha_exchange.purchase_requests SET status=$2,payload=jsonb_set(payload,'{status}',to_jsonb($2::text)) WHERE id=$1", [fixture.requestId, status]);
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-payment-auth-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  fixture = await store.transaction(tx => createInitialMarketplaceFixture({ mode: MODE, tx }));
  await store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => ({
    requestId: fixture.requestId, tradeId: fixture.tradeId, actorUserId: fixture.sellerId, acceptedAtMs: fixture.acceptedAtMs,
  })));
  await store.transaction(tx => tx.exec("CREATE TABLE payment_auth_probe (id text PRIMARY KEY)"));
}, TIMEOUT);
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  now = fixture.acceptedAtMs + 1000;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { await store?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);

describe("fixed current payment-profile authority", () => {
  it.each([["web", "claim"], ["mobile", "claim"], ["web", "dispute"], ["mobile", "dispute"]] as const)(
    "derives only the retained buyer for %s %s without exposing credentials or policy records", async (kind, operation) => {
      const principal = await isolated(async tx => { const value = await resolve(tx, fixture.buyerId, kind, operation); await value.assertFresh(); return value; });
      expect(principal).toMatchObject({ userId: fixture.buyerId, actorKind: "buyer", isOwner: false });
      expect(Object.isFrozen(principal)).toBe(true);
      expect(Object.keys(principal).sort()).toEqual(["actorKind", "assertFresh", "isOwner", "sessionExpiresAtMs", "userId"]);
      for (const secret of [fixture.buyerSessionToken, "passwordHash", "account_payload", "deviceId", "canBuy", "canSell"]) expect(JSON.stringify(principal)).not.toContain(secret);
    });
  it.each(["upgrade", "inspect", "pause", "export"] as const)("requires current owner authority for %s", async operation => {
    expect(await isolated(tx => resolve(tx, fixture.ownerId, "web", operation))).toMatchObject({ actorKind: "operator", isOwner: true });
    await expect(isolated(tx => resolve(tx, fixture.buyerId, "web", operation))).rejects.toMatchObject({ code: "WALLET_PAYMENT_OWNER_REQUIRED" });
  });
  it.each(["sellerId", "ownerId", "otherBuyerId", "otherSellerId"] as const)("refuses %s as buyer even with a privileged label", async name => {
    await expect(isolated(tx => resolve(tx, fixture[name]))).rejects.toMatchObject({ code: "WALLET_PAYMENT_BUYER_REQUIRED" });
  });
  it.each(["web", "mobile"] as const)("permits the actual %s buyer to report a retained claim after new-trade role loss", async kind => {
    await isolated(async tx => {
      await patchUser(tx, fixture.buyerId, { role: "guest", roles: [] });
      expect(await resolve(tx, fixture.buyerId, kind)).toMatchObject({ actorKind: "buyer" });
    });
  });
  it("identifies the actual buyer with supplementary owner membership without an override", async () => {
    await isolated(async tx => {
      await patchUser(tx, fixture.buyerId, { role: "buyer", roles: ["buyer", "owner"] });
      expect(await resolve(tx)).toMatchObject({ actorKind: "buyer", isOwner: true });
    });
  });
  it.each([
    ["disabled", { disabled: true }, "WALLET_ACCOUNT_DISABLED"], ["email", { emailVerified: false }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["phone", { phoneVerifiedAt: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"], ["adult", { ageEligibility: undefined }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
  ] as const)("retains the current %s account gate", async (_name, patch, code) => {
    await expect(isolated(async tx => { await patchUser(tx, fixture.buyerId, patch); return resolve(tx); })).rejects.toMatchObject({ code });
  });
  it("does not substitute web credentials for a mobile session or wrong device", async () => {
    for (const patch of [{ accessToken: fixture.buyerSessionToken }, { metadata: { ...fixture.mobile.credentials[fixture.buyerId].metadata, deviceId: "wrong-device" } }]) {
      const input = { ...credentials(fixture.buyerId, "mobile"), ...patch } as DevelopmentPaymentMarketplaceCredentials;
      await expect(isolated(tx => resolveDevelopmentPaymentMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
        operation: "claim", credentials: input, clock: () => now }))).rejects.toThrow();
    }
  });
  it("captures credentials and nested device metadata before the first await", async () => {
    await isolated(async tx => {
      const input = credentials(fixture.buyerId, "mobile"); if (input.kind !== "mobile") throw new Error("Expected mobile fixture");
      const pending = resolveDevelopmentPaymentMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
        operation: "claim", credentials: input, clock: () => now });
      input.accessToken = "mutated"; input.metadata.deviceId = "mutated";
      expect(await pending).toMatchObject({ actorKind: "buyer", userId: fixture.buyerId });
    });
  });
  it("allows exact accepted-to-claimed identity continuity and cancelled archival owner reads", async () => {
    await isolated(async tx => {
      const principal = await resolve(tx); await requestStatus(tx, "payment_sent"); await principal.assertFresh();
      expect(await resolve(tx, fixture.buyerId, "mobile", "dispute")).toMatchObject({ actorKind: "buyer" });
      await requestStatus(tx, "cancelled"); expect(await resolve(tx, fixture.ownerId, "web", "inspect")).toMatchObject({ actorKind: "operator" });
    });
  });
  it.each(["seller_id", "listing_id"] as const)("refuses normalized/payload %s mismatch", async column => {
    await expect(isolated(async tx => {
      await tx.query(`UPDATE alpha_exchange.purchase_requests SET ${column}=$2 WHERE id=$1`, [fixture.requestId, "wrong-identity"]);
      return resolve(tx);
    })).rejects.toMatchObject({ code: "WALLET_AUTH_RECORD_INVALID" });
  });
  it("rechecks party identity after awaited work", async () => {
    await expect(isolated(async tx => {
      const principal = await resolve(tx);
      await tx.query("UPDATE alpha_exchange.purchase_requests SET buyer_id=$2,payload=jsonb_set(payload,'{buyerId}',to_jsonb($2::text)) WHERE id=$1", [fixture.requestId, fixture.otherBuyerId]);
      await principal.assertFresh();
    })).rejects.toMatchObject({ code: "WALLET_AUTHORITY_CHANGED" });
  });
  it.each(["web", "mobile"] as const)("rechecks %s expiry after the final awaited identity read", async kind => {
    const expiry = kind === "web" ? fixture.sessionsExpireAtMs : Date.parse(fixture.mobile.sessions[fixture.buyerId].accessExpiresAt);
    await expect(isolated(owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await owner.query<Row>(sql, values); if (sql.includes("authority: retained request identity")) now = expiry; return result;
      } };
      return resolve(tx, fixture.buyerId, kind);
    })).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });
  it.each(["bad authority", "uncloneable credentials", "late runtime shutdown"] as const)("poisons the original transaction after a swallowed %s", async fault => {
    let captured: unknown;
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO payment_auth_probe VALUES ('companion')");
      try {
        if (fault === "bad authority") await resolve(tx, fixture.sellerId);
        else if (fault === "uncloneable credentials") await resolveDevelopmentPaymentMarketplacePrincipal({ mode: MODE, tx, requestId: fixture.requestId,
          operation: "claim", credentials: { ...credentials(fixture.buyerId), extra: () => undefined } as unknown as DevelopmentPaymentMarketplaceCredentials, clock: () => now });
        else { const principal = await resolve(tx); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true"); await principal.assertFresh(); }
      } catch (error) { captured = error; }
      finally { vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", undefined); }
    })).rejects.toThrow();
    expect(captured).toBeDefined(); expect((await store.transaction(tx => tx.query("SELECT id FROM payment_auth_probe"))).rows).toEqual([]);
  });
  it.each(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "SET TRANSACTION READ ONLY", "SET LOCAL alpha_wallet.development_schema='disabled'"])(
    "refuses an uncertified physical transaction: %s", async statement => {
      await expect(store.transaction(async tx => { await tx.exec(statement); await resolve(tx); })).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
    });
  it("never adopts or poisons a replacement transaction during nested certification", async () => {
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
  it("does not retain authority beyond its original transaction lifetime", async () => {
    const principal = await store.transaction(tx => resolve(tx));
    await expect(principal.assertFresh()).rejects.toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE" });
  });
});
