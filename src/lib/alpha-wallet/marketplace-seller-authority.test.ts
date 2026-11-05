// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { resolveDevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import { resolveDevelopmentMarketplaceMobilePrincipal, type DevelopmentMarketplaceMobileCredentials } from "./marketplace-mobile-auth";
import { createMarketplaceMobileAuthFixture } from "./marketplace-mobile-fixture";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => {
  throw new Error("Ambient database discovery is forbidden in seller authority fixtures");
} }));

const MODE = "simulation-only" as const;
const NOW = 1_800_000_000_000, CREATED_AT = NOW - 5000;
const CREATED = new Date(CREATED_AT).toISOString(), EXPIRES = new Date(NOW + 60_000).toISOString();
const SELLER = "stored-seller-authority-fixture", TOKEN = "public-synthetic-seller-web-credential";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const TIMEOUT = 90_000;
const HOSTED_FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
  "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
let directory: string, store: WalletStore, credentials: DevelopmentMarketplaceMobileCredentials;
let baselineMobileSession: Record<string, unknown>;

function environment() {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of HOSTED_FLAGS) vi.stubEnv(flag, undefined);
  for (const flag of ["MOBILE_MIN_IOS_VERSION", "MOBILE_MIN_ANDROID_VERSION", "MOBILE_LATEST_IOS_VERSION", "MOBILE_LATEST_ANDROID_VERSION"]) {
    vi.stubEnv(flag, undefined);
  }
}
function userFixture(): Record<string, unknown> {
  return { id: SELLER, email: "synthetic-seller-authority@example.invalid", fullName: "Private synthetic seller profile",
    passwordHash: "synthetic-seller-password-hash", role: "approved_seller", roles: ["approved_seller", "buyer"],
    sellerStatus: "approved_seller", emailVerified: true, disabled: false, verifiedPhone: "+15551234567",
    phoneVerifiedAt: CREATED, ageEligibility: { method: "self_attestation_v1", confirmedAt: CREATED },
    availabilityStatus: "available", onlineStatus: "offline", createdAt: CREATED, updatedAt: CREATED };
}
async function insertUser(tx: WalletSql) {
  const user = userFixture();
  await tx.query(`INSERT INTO alpha_exchange.users VALUES ($1,$2,$3,$4,'available','offline',$5,$5,0,$6::jsonb)`,
    [SELLER, user.email, user.role, user.sellerStatus, CREATED, JSON.stringify(user)]);
}
async function patchUser(tx: WalletSql, patch: Record<string, unknown>) {
  const current = (await tx.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM alpha_exchange.users WHERE id=$1", [SELLER])).rows[0].payload;
  const user = { ...current, ...patch };
  await tx.query("UPDATE alpha_exchange.users SET email=$2,role=$3,seller_status=$4,payload=$5::jsonb WHERE id=$1",
    [SELLER, user.email, user.role, user.sellerStatus, JSON.stringify(user)]);
}
function resolve(tx: WalletSql, transport: "web" | "mobile") {
  return transport === "web"
    ? resolveDevelopmentMarketplaceWebPrincipal({ mode: MODE, tx, token: TOKEN, clock: () => NOW })
    : resolveDevelopmentMarketplaceMobilePrincipal({ mode: MODE, tx, ...credentials, clock: () => NOW });
}
async function probes() { return store.transaction(async tx => (await tx.query("SELECT id FROM seller_authority_probe")).rows); }

beforeAll(async () => {
  environment();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-seller-authority-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await store.transaction(async tx => {
    await tx.exec(`CREATE SCHEMA alpha_exchange;
      CREATE TABLE alpha_exchange.users (
        id text PRIMARY KEY, email text NOT NULL UNIQUE, role text NOT NULL, seller_status text NOT NULL,
        availability_status text NOT NULL, online_status text NOT NULL, created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
      );
      CREATE TABLE alpha_exchange.sessions (
        token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
      );
      CREATE TABLE seller_authority_probe (id text PRIMARY KEY);`);
    await insertUser(tx);
    const fixture = await createMarketplaceMobileAuthFixture({ mode: MODE, tx, userIds: [SELLER], atMs: CREATED_AT });
    credentials = fixture.credentials[SELLER];
    baselineMobileSession = (await tx.query<{ value: Record<string, unknown> }>(
      "SELECT to_jsonb(session) AS value FROM alpha_exchange.mobile_device_sessions AS session")).rows[0].value;
  });
}, TIMEOUT);
beforeEach(async () => {
  environment();
  await store.transaction(async tx => {
    await tx.exec(`DELETE FROM alpha_exchange.mobile_refresh_token_history; DELETE FROM alpha_exchange.mobile_device_sessions;
      DELETE FROM alpha_exchange.sessions; DELETE FROM alpha_exchange.users; DELETE FROM seller_authority_probe;`);
    await insertUser(tx);
    const session = { token: TOKEN_HASH, userId: SELLER, createdAt: CREATED, expiresAt: EXPIRES };
    await tx.query("INSERT INTO alpha_exchange.sessions VALUES ($1,$2,$3,$4,0,$5::jsonb)",
      [TOKEN_HASH, SELLER, EXPIRES, CREATED, JSON.stringify(session)]);
    await tx.query(`INSERT INTO alpha_exchange.mobile_device_sessions
      SELECT * FROM jsonb_populate_record(NULL::alpha_exchange.mobile_device_sessions,$1::jsonb)`, [JSON.stringify(baselineMobileSession)]);
  });
}, TIMEOUT);
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { await store?.close(); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);

describe.each(["web", "mobile"] as const)("stored %s seller authority", transport => {
  it.each([
    ["seller-only approved account", "approved_seller", ["approved_seller"], "approved_seller", false, true, false],
    ["approved seller and buyer", "approved_seller", ["approved_seller", "buyer"], "approved_seller", true, true, false],
    ["approved status with buyer label", "buyer", ["buyer"], "approved_seller", true, true, false],
    ["stale seller role after suspension", "approved_seller", ["approved_seller", "buyer"], "suspended", true, false, false],
    ["stale seller role after rejection", "approved_seller", ["approved_seller", "buyer"], "rejected", true, false, false],
    ["pending seller with stale role", "approved_seller", ["approved_seller", "buyer"], "pending_seller_approval", true, false, false],
    ["former seller with buyer status", "approved_seller", ["approved_seller", "buyer"], "buyer", true, false, false],
    ["administrator with buyer status", "admin", ["buyer"], "buyer", true, true, false],
    ["additional administrator role", "buyer", ["buyer", "admin"], "rejected", true, true, false],
    ["owner with suspended seller status", "owner", ["owner"], "suspended", true, true, true],
    ["additional owner role", "buyer", ["buyer", "owner"], "pending_seller_approval", true, true, true],
    ["ordinary buyer", "buyer", ["buyer"], "buyer", true, false, false],
    ["student without approval", "student", ["student"], "buyer", false, false, false],
  ] as const)("derives distinct capabilities for %s", async (_label, role, roles, sellerStatus, canBuy, canSell, isOwner) => {
    const principal = await store.transaction(async tx => {
      await patchUser(tx, { role, roles, sellerStatus });
      const value = await resolve(tx, transport);
      await value.assertFresh();
      return value;
    });
    expect(principal).toMatchObject({ userId: SELLER, canBuy, canSell, isOwner });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.keys(principal).sort()).toEqual(["assertFresh", "canBuy", "canSell", "isOwner", "sessionExpiresAtMs", "userId"]);
    for (const secret of [TOKEN, TOKEN_HASH, credentials.accessToken, credentials.metadata.deviceId,
      "synthetic-seller-authority@example.invalid", "synthetic-seller-password-hash", "+15551234567"]) {
      expect(JSON.stringify(principal)).not.toContain(secret);
    }
  });

  it("preserves canonical approval policy without inventing a new certificate requirement", async () => {
    const principal = await store.transaction(async tx => {
      await patchUser(tx, { roles: undefined, sellerApprovalVerification: undefined, disabled: undefined });
      return resolve(tx, transport);
    });
    expect(principal).toMatchObject({ canSell: true, canBuy: false, isOwner: false });
  });

  it.each(["suspended", "rejected", "pending_seller_approval", "buyer"] as const)(
    "binds seller approval on fresh authorization when status becomes %s", async sellerStatus => {
      let captured: unknown;
      await expect(store.transaction(async tx => {
        const principal = await resolve(tx, transport);
        expect(principal).toMatchObject({ canBuy: true, canSell: true, isOwner: false });
        await tx.query("INSERT INTO seller_authority_probe VALUES ('earlier-financial-work')");
        await patchUser(tx, { sellerStatus });
        try { await principal.assertFresh(); } catch (error) { captured = error; }
      })).rejects.toThrow(/division by zero|aborted/i);
      expect(captured).toMatchObject({ code: "WALLET_AUTHORITY_CHANGED" });
      expect(await probes()).toEqual([]);
      // Both the earlier work and same-transaction approval change rolled back.
      expect(await store.transaction(tx => resolve(tx, transport))).toMatchObject({ canSell: true });
    });

  it("does not keep administrative selling authority when only that additional role is removed", async () => {
    await store.transaction(tx => patchUser(tx, { role: "buyer", roles: ["buyer", "admin"], sellerStatus: "suspended" }));
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx, transport);
      expect(principal).toMatchObject({ canBuy: true, canSell: true, isOwner: false });
      await patchUser(tx, { roles: ["buyer"] });
      await principal.assertFresh();
    })).rejects.toMatchObject({ code: "WALLET_AUTHORITY_CHANGED" });
  });

  it("refuses contradictory normalized seller status before granting capability", async () => {
    await store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET seller_status='suspended' WHERE id=$1", [SELLER]));
    await expect(store.transaction(tx => resolve(tx, transport)))
      .rejects.toMatchObject({ code: "WALLET_AUTH_RECORD_INVALID", status: 503 });
  });

  it("rolls back earlier work after swallowed runtime refusal even if the caller restores the environment", async () => {
    let captured: unknown;
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx, transport);
      await tx.query("INSERT INTO seller_authority_probe VALUES ('before-runtime-refusal')");
      vi.stubEnv("VERCEL_ENV", "production");
      try { await principal.assertFresh(); } catch (error) { captured = error; }
      finally { vi.stubEnv("VERCEL_ENV", undefined); }
    })).rejects.toThrow(/hosted runtime/i);
    expect(captured).toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE", status: 503 });
    expect(await probes()).toEqual([]);
  });

  it("poisons the certified physical transaction after an awaited read fails its runtime recheck", async () => {
    let captured: unknown, observedCleanup = false, observedAbort = false;
    await expect(store.transaction(async owner => {
      await owner.query("INSERT INTO seller_authority_probe VALUES ('before-awaited-runtime-refusal')");
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql === "SELECT txid_current()::text AS transaction_id") {
          // The original failure remains captured even if the runtime becomes
          // permitted again before cleanup reaches the physical database.
          observedCleanup = true;
          vi.stubEnv("VERCEL_ENV", undefined);
        }
        if (sql.includes("1 / 0")) observedAbort = true;
        const result = await owner.query<Row>(sql, params);
        if (sql.includes("FOR SHARE OF session, account")) vi.stubEnv("VERCEL_ENV", "production");
        return result;
      } };
      try { await resolve(tx, transport); } catch (error) { captured = error; }
      finally { vi.stubEnv("VERCEL_ENV", undefined); }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(captured).toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE", status: 503 });
    expect(observedCleanup).toBe(true); expect(observedAbort).toBe(true);
    expect(await probes()).toEqual([]);
  });
});
