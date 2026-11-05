// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashMobileDeviceId, hashMobileSecret } from "@/lib/mobile-auth";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createMarketplaceMobileAuthFixture } from "./marketplace-mobile-fixture";
import {
  developmentMarketplaceMobileCredentialsSchema, resolveDevelopmentMarketplaceMobilePrincipal,
  type DevelopmentMarketplaceMobileCredentials,
} from "./marketplace-mobile-auth";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden in mobile authority fixtures"); } }));

const MODE = "simulation-only" as const;
const NOW = 1_800_000_000_000;
const CREATED_AT = NOW - 5000;
const CREATED = new Date(CREATED_AT).toISOString();
const BUYER = "mobile-auth-fixture-buyer";
const TIMEOUT = 90_000;
const HOSTED_FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
let store: WalletStore, directory: string, now: number;
let fixture: Awaited<ReturnType<typeof createMarketplaceMobileAuthFixture>>;
let baselineSession: Record<string, unknown>;
let credentials: DevelopmentMarketplaceMobileCredentials;

function userFixture(): Record<string, unknown> {
  return { id: BUYER, email: "synthetic-mobile-buyer@example.invalid", fullName: "Private synthetic mobile profile",
    passwordHash: "synthetic-mobile-password-hash", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
    emailVerified: true, disabled: false, verifiedPhone: "+15551234567", phoneVerifiedAt: CREATED,
    phoneOtpSalt: "synthetic-mobile-otp-salt", ageEligibility: { method: "self_attestation_v1", confirmedAt: CREATED },
    createdAt: CREATED, updatedAt: CREATED };
}
async function insertUser(tx: WalletSql, user = userFixture()) {
  await tx.query(`INSERT INTO alpha_exchange.users
    (id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload)
    VALUES ($1,$2,$3,$4,'available','offline',$5,$5,0,$6::jsonb)`,
  [user.id, user.email, user.role, user.sellerStatus, CREATED, JSON.stringify(user)]);
}
function environment() {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of HOSTED_FLAGS) vi.stubEnv(flag, undefined);
  for (const flag of ["MOBILE_MIN_IOS_VERSION", "MOBILE_MIN_ANDROID_VERSION", "MOBILE_LATEST_IOS_VERSION", "MOBILE_LATEST_ANDROID_VERSION"]) vi.stubEnv(flag, undefined);
}
beforeAll(async () => {
  environment();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-mobile-auth-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await store.transaction(async tx => {
    await tx.exec(`CREATE SCHEMA alpha_exchange;
      CREATE TABLE alpha_exchange.users (
        id text PRIMARY KEY, email text NOT NULL UNIQUE, role text NOT NULL, seller_status text NOT NULL,
        availability_status text NOT NULL, online_status text NOT NULL, created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
      );
      CREATE TABLE mobile_auth_atomic_probe (id text PRIMARY KEY);`);
    await insertUser(tx);
    fixture = await createMarketplaceMobileAuthFixture({ mode: MODE, tx, userIds: [BUYER], atMs: CREATED_AT });
    baselineSession = (await tx.query<{ value: Record<string, unknown> }>(
      "SELECT to_jsonb(session) AS value FROM alpha_exchange.mobile_device_sessions AS session")).rows[0].value;
  });
}, TIMEOUT);
beforeEach(async () => {
  environment();
  now = NOW;
  credentials = structuredClone(fixture.credentials[BUYER]);
  await store.transaction(async tx => {
    await tx.exec(`DELETE FROM alpha_exchange.mobile_refresh_token_history;
      DELETE FROM alpha_exchange.mobile_device_sessions; DELETE FROM alpha_exchange.users; DELETE FROM mobile_auth_atomic_probe;`);
    await insertUser(tx);
    await tx.query(`INSERT INTO alpha_exchange.mobile_device_sessions
      SELECT * FROM jsonb_populate_record(NULL::alpha_exchange.mobile_device_sessions, $1::jsonb)`, [JSON.stringify(baselineSession)]);
  });
}, TIMEOUT);
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { await store?.close(); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);

function resolve(tx: WalletSql, supplied = credentials) {
  return resolveDevelopmentMarketplaceMobilePrincipal({ mode: MODE, tx, ...supplied, clock: () => now });
}
function alter(sql: string, params?: unknown[]) { return store.transaction(tx => tx.query(sql, params)); }
async function patchUser(patch: Record<string, unknown>) {
  await store.transaction(async tx => {
    const current = (await tx.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM alpha_exchange.users WHERE id=$1", [BUYER])).rows[0].payload;
    const user = { ...current, ...patch };
    await tx.query("UPDATE alpha_exchange.users SET email=$2,role=$3,seller_status=$4,payload=$5::jsonb WHERE id=$1",
      [BUYER, user.email, user.role, user.sellerStatus, JSON.stringify(user)]);
  });
}
function afterAuthRead(owner: WalletSql, after: () => void): WalletSql {
  return { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    const result = await owner.query<Row>(sql, params);
    if (sql.includes("FOR SHARE OF session, account")) after();
    return result;
  } };
}

describe("transaction-owned mobile marketplace authority", () => {
  it("locks the actual device session and account using only hashed credentials and returns minimal frozen authority", async () => {
    const statements: string[] = [], parameters: unknown[] = [];
    const principal = await store.transaction(async owner => {
      const tx: WalletSql = { exec: sql => { statements.push(sql); return owner.exec(sql); },
        query: (sql, params) => { statements.push(sql); parameters.push(...(params ?? [])); return owner.query(sql, params); } };
      const value = await resolve(tx);
      await value.assertFresh();
      return value;
    });
    expect(principal).toMatchObject({ userId: BUYER, canBuy: true, isOwner: false, sessionExpiresAtMs: fixture.expiresAtMs });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.keys(principal).sort()).toEqual(["assertFresh", "canBuy", "canSell", "isOwner", "sessionExpiresAtMs", "userId"]);
    expect(statements.filter(sql => sql.includes("FOR SHARE OF session, account"))).toHaveLength(2);
    expect(statements.some(sql => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))).toBe(false);
    expect(parameters).toEqual([hashMobileSecret(credentials.accessToken), hashMobileSecret(credentials.accessToken)]);
    const serialized = JSON.stringify(principal), session = fixture.sessions[BUYER];
    for (const value of [credentials.accessToken, credentials.metadata.deviceId, session.id, session.accessTokenHash,
      session.deviceIdHash, session.refreshTokenHash, session.tokenFamilyId, "synthetic-mobile-buyer@example.invalid",
      "synthetic-mobile-password-hash", "synthetic-mobile-otp-salt", "+15551234567", "Private synthetic mobile profile"]) {
      expect(serialized).not.toContain(value);
    }
    expect((await alter("SELECT to_jsonb(session) AS value FROM alpha_exchange.mobile_device_sessions AS session")).rows[0].value).toEqual(baselineSession);
  });

  it.each([
    ["buyer", ["buyer"], true, false], ["approved_seller", ["approved_seller", "buyer"], true, false],
    ["approved_seller", ["approved_seller"], false, false], ["admin", ["admin"], true, false],
    ["owner", ["owner", "buyer"], true, true], ["student", ["student"], false, false],
  ])("derives %s authority from canonical roles rather than mobile metadata", async (role, roles, canBuy, isOwner) => {
    await patchUser({ role, roles });
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ canBuy, isOwner });
  });

  it.each([
    ["disabled account", { disabled: true }, "WALLET_ACCOUNT_DISABLED"],
    ["malformed disabled flag", { disabled: "false" }, "WALLET_ACCOUNT_DISABLED"],
    ["null disabled flag", { disabled: null }, "WALLET_ACCOUNT_DISABLED"],
    ["unverified email", { emailVerified: false }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["malformed email flag", { emailVerified: "true" }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["missing phone", { verifiedPhone: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["missing OTP evidence", { phoneVerifiedAt: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["invalid OTP date", { phoneVerifiedAt: "invalid" }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["missing adult confirmation", { ageEligibility: undefined }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
    ["different adult method", { ageEligibility: { method: "client_boolean", confirmedAt: CREATED } }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
    ["malformed roles", { roles: "owner" }, "WALLET_AUTH_RECORD_INVALID"],
    ["unknown role", { roles: ["super_owner"] }, "WALLET_AUTH_RECORD_INVALID"],
  ])("rejects %s using the locked canonical account", async (_name, patch, code) => {
    await patchUser(patch as Record<string, unknown>);
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code });
  });

  it("preserves the legacy enabled-account rule without fabricating verification evidence", async () => {
    await patchUser({ disabled: undefined, roles: undefined });
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ userId: BUYER, canBuy: true });
  });

  it("honors only the exact approved account phone exemption and never a role or environment bypass", async () => {
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "alphatradersai@gmail.com");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    await patchUser({ email: "alphatradersai@gmail.com", role: "owner", roles: ["owner"], verifiedPhone: undefined, phoneVerifiedAt: undefined });
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_PHONE_VERIFICATION_REQUIRED" });
    const exemptId = "user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a";
    await store.transaction(async tx => {
      await tx.exec("DELETE FROM alpha_exchange.mobile_device_sessions; DELETE FROM alpha_exchange.users;");
      await insertUser(tx, { ...userFixture(), id: exemptId, email: "alphatradersai@gmail.com", verifiedPhone: undefined, phoneVerifiedAt: undefined });
      await tx.query(`INSERT INTO alpha_exchange.mobile_device_sessions
        SELECT * FROM jsonb_populate_record(NULL::alpha_exchange.mobile_device_sessions, $1::jsonb)`,
      [JSON.stringify({ ...baselineSession, user_id: exemptId })]);
    });
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ userId: exemptId, canBuy: true });
  });

  it.each([
    ["account identity", "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{id}','\"another-user\"')"],
    ["account email", "UPDATE alpha_exchange.users SET email='different@example.invalid'"],
    ["primary role", "UPDATE alpha_exchange.users SET role='owner'"],
    ["seller status", "UPDATE alpha_exchange.users SET seller_status='suspended'"],
    ["non-object account", "UPDATE alpha_exchange.users SET payload='[]'"],
    ["invalid stored refresh hash", "UPDATE alpha_exchange.mobile_device_sessions SET refresh_token_hash='not-a-hash'"],
    ["invalid stored device hash", "UPDATE alpha_exchange.mobile_device_sessions SET device_id_hash='not-a-hash'"],
    ["invalid family identity", "UPDATE alpha_exchange.mobile_device_sessions SET token_family_id=''"],
    ["invalid stored app version", "UPDATE alpha_exchange.mobile_device_sessions SET app_version='invalid version with spaces'"],
    ["sub-millisecond access deadline", "UPDATE alpha_exchange.mobile_device_sessions SET access_expires_at=access_expires_at + interval '1 microsecond'"],
    ["sub-millisecond refresh deadline", "UPDATE alpha_exchange.mobile_device_sessions SET refresh_expires_at=refresh_expires_at + interval '1 microsecond'"],
    ["infinite access deadline", "UPDATE alpha_exchange.mobile_device_sessions SET access_expires_at='infinity'::timestamptz"],
    ["reversed lifetime", "UPDATE alpha_exchange.mobile_device_sessions SET access_expires_at=created_at"],
    ["inconsistent revocation", "UPDATE alpha_exchange.mobile_device_sessions SET revoke_reason='logout'"],
  ])("fails closed on retained %s corruption", async (_name, sql) => {
    await alter(sql);
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_AUTH_RECORD_INVALID", status: 503 });
  });

  it("accepts a still-valid access token after its refresh lifetime expires, including a final refresh extending access", async () => {
    await alter("UPDATE alpha_exchange.mobile_device_sessions SET refresh_expires_at=$1::timestamptz,refresh_generation=1", [new Date(NOW - 1).toISOString()]);
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ sessionExpiresAtMs: fixture.expiresAtMs });
  });

  it("allows an upgraded app and changed UI language without requiring stored version or locale equality", async () => {
    const upgraded = { ...credentials, metadata: { ...credentials.metadata, appVersion: "999.0.0", locale: "ar" as const } };
    expect(await store.transaction(tx => resolve(tx, upgraded))).toMatchObject({ userId: BUYER });
  });

  it.each(["", "stored-hash", "atr_rt_v1." + "r".repeat(64), "atr_at_v1." + "a".repeat(152),
    "atr_at_v1." + "a".repeat(42) + "\n", "atr_at_v1." + "a".repeat(42) + "\0", "atr_at_v1." + "z".repeat(43)])(
    "rejects malformed, refresh, hashed and unrelated bearer credentials (%#)", async token => {
      const accessToken = token === "stored-hash" ? fixture.sessions[BUYER].accessTokenHash : token;
      await expect(store.transaction(tx => resolve(tx, { ...credentials, accessToken }))).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED", status: 401 });
    });

  it("does not accept a refresh token even if its hash is incorrectly placed in the access column", async () => {
    const accessToken = `atr_rt_v1.${"r".repeat(64)}`;
    await alter("UPDATE alpha_exchange.mobile_device_sessions SET access_token_hash=$1", [hashMobileSecret(accessToken)]);
    await expect(store.transaction(tx => resolve(tx, { ...credentials, accessToken }))).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });

  it.each(["another-mobile-device-id", "hashed-device", "short", " device-with-a-leading-space", "device-with-control-\n"])(
    "requires the original raw installation identifier (%s)", async device => {
      const deviceId = device === "hashed-device" ? hashMobileDeviceId(credentials.metadata.deviceId) : device;
      await expect(store.transaction(tx => resolve(tx, { ...credentials, metadata: { ...credentials.metadata, deviceId } })))
        .rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED", status: 401 });
    });

  it("binds the presented platform to the stored session", async () => {
    await expect(store.transaction(tx => resolve(tx, { ...credentials, metadata: { ...credentials.metadata, platform: "android" } })))
      .rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });

  it("exports a closed credentials schema that rejects caller authority, refresh credentials and unexpected metadata", () => {
    const invalid = [
      { ...credentials, userId: BUYER }, { ...credentials, roles: ["owner"] }, { ...credentials, sessionToken: "web-cookie" },
      { ...credentials, refreshToken: "ignored-secret" }, { ...credentials, metadata: { ...credentials.metadata, isOwner: true } },
      { ...credentials, metadata: { ...credentials.metadata, platform: "web" } },
      { ...credentials, metadata: { ...credentials.metadata, locale: "ro" } },
      { ...credentials, metadata: { ...credentials.metadata, appVersion: "1.0.0 " } },
    ];
    for (const value of invalid) expect(developmentMarketplaceMobileCredentialsSchema.safeParse(value).success).toBe(false);
    expect(developmentMarketplaceMobileCredentialsSchema.safeParse(credentials).success).toBe(true);
  });

  it.each(["1.0.0", "not-semver"])("enforces current minimum client policy before authoritative SQL reads (%s)", async appVersion => {
    vi.stubEnv("MOBILE_MIN_IOS_VERSION", "2.0.0");
    const statements: string[] = [];
    await expect(store.transaction(owner => resolve({ exec: sql => owner.exec(sql), query: (sql, params) => {
      statements.push(sql); return owner.query(sql, params);
    } }, { ...credentials, metadata: { ...credentials.metadata, appVersion } })))
      .rejects.toMatchObject({ code: "WALLET_APP_UPDATE_REQUIRED", status: 426 });
    expect(statements.some(sql => sql.includes("FROM alpha_exchange.mobile_device_sessions"))).toBe(false);
  });

  it("uses the matching platform version policy and rechecks it after the awaited session read", async () => {
    vi.stubEnv("MOBILE_MIN_ANDROID_VERSION", "999.0.0");
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ userId: BUYER });
    await expect(store.transaction(owner => resolve(afterAuthRead(owner, () => vi.stubEnv("MOBILE_MIN_IOS_VERSION", "999.0.0")))))
      .rejects.toMatchObject({ code: "WALLET_APP_UPDATE_REQUIRED", status: 426 });
  });

  it("captures metadata before asynchronous work so caller mutation cannot change an in-flight principal", async () => {
    const supplied = structuredClone(credentials);
    let mutated = false;
    const principal = await store.transaction(async owner => {
      const tx: WalletSql = { exec: sql => owner.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await owner.query<Row>(sql, params);
        if (!mutated) { mutated = true; supplied.metadata.deviceId = "different-mobile-device"; supplied.metadata.platform = "android"; supplied.metadata.appVersion = "0.0.0"; }
        return result;
      } };
      const value = await resolve(tx, supplied);
      await value.assertFresh();
      return value;
    });
    expect(principal).toMatchObject({ userId: BUYER, sessionExpiresAtMs: fixture.expiresAtMs });
  });

  it.each(["exact expiry", "past expiry", "future creation"])("refuses %s at the trusted clock", async boundary => {
    now = boundary === "future creation" ? CREATED_AT - 1 : fixture.expiresAtMs + (boundary === "past expiry" ? 1 : 0);
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });

  it("checks expiry after the final awaited read", async () => {
    await expect(store.transaction(owner => resolve(afterAuthRead(owner, () => { now = fixture.expiresAtMs; }))))
      .rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });

  it.each([
    ["logout", "UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=updated_at,revoke_reason='logout'", "WALLET_SESSION_REQUIRED"],
    ["session deletion", "DELETE FROM alpha_exchange.mobile_device_sessions", "WALLET_SESSION_REQUIRED"],
    ["rotated access hash", "UPDATE alpha_exchange.mobile_device_sessions SET access_token_hash=repeat('a',64),refresh_generation=refresh_generation+1", "WALLET_SESSION_REQUIRED"],
    ["replacement family on the same row", "UPDATE alpha_exchange.mobile_device_sessions SET token_family_id='replacement-family'", "WALLET_AUTHORITY_CHANGED"],
    ["changed generation", "UPDATE alpha_exchange.mobile_device_sessions SET refresh_generation=refresh_generation+1", "WALLET_AUTHORITY_CHANGED"],
    ["changed row identity", "UPDATE alpha_exchange.mobile_device_sessions SET id='replacement-session-id'", "WALLET_AUTHORITY_CHANGED"],
    ["changed device binding", "UPDATE alpha_exchange.mobile_device_sessions SET device_id_hash=repeat('b',64)", "WALLET_SESSION_REQUIRED"],
    ["changed access deadline", "UPDATE alpha_exchange.mobile_device_sessions SET access_expires_at=access_expires_at + interval '1 millisecond'", "WALLET_AUTHORITY_CHANGED"],
    ["changed refresh hash", "UPDATE alpha_exchange.mobile_device_sessions SET refresh_token_hash=repeat('c',64)", "WALLET_AUTHORITY_CHANGED"],
    ["changed refresh deadline", "UPDATE alpha_exchange.mobile_device_sessions SET refresh_expires_at=refresh_expires_at - interval '1 millisecond'", "WALLET_AUTHORITY_CHANGED"],
    ["account disable", "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true')", "WALLET_ACCOUNT_DISABLED"],
    ["phone evidence removal", "UPDATE alpha_exchange.users SET payload=payload - 'phoneVerifiedAt'", "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["role revocation", "UPDATE alpha_exchange.users SET role='student',payload=jsonb_set(jsonb_set(payload,'{role}','\"student\"'),'{roles}','[\"student\"]')", "WALLET_AUTHORITY_CHANGED"],
  ])("rechecks %s even when the same transaction owns the changed row", async (_name, sql, code) => {
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx);
      await tx.query(sql);
      await principal.assertFresh();
    })).rejects.toMatchObject({ code });
  });

  it.each(["expiry", "version policy", "account disable"])("rolls back earlier work when a late %s error is swallowed", async failure => {
    let captured: unknown;
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx);
      await tx.query("INSERT INTO mobile_auth_atomic_probe VALUES ('synthetic-financial-work')");
      if (failure === "expiry") now = fixture.expiresAtMs;
      else if (failure === "version policy") vi.stubEnv("MOBILE_MIN_IOS_VERSION", "999.0.0");
      else await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true')");
      try { await principal.assertFresh(); } catch (error) { captured = error; }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(captured).toMatchObject({ code: failure === "expiry" ? "WALLET_SESSION_REQUIRED"
      : failure === "version policy" ? "WALLET_APP_UPDATE_REQUIRED" : "WALLET_ACCOUNT_DISABLED" });
    expect((await alter("SELECT id FROM mobile_auth_atomic_probe")).rows).toEqual([]);
  });

  it("rolls back earlier work if invalid initial credentials are swallowed after transaction certification", async () => {
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO mobile_auth_atomic_probe VALUES ('earlier-work')");
      try { await resolve(tx, { ...credentials, accessToken: "invalid" }); } catch { /* Test the outer owner's bad behavior. */ }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect((await alter("SELECT id FROM mobile_auth_atomic_probe")).rows).toEqual([]);
  });

  it("rejects invalid and backwards clocks", async () => {
    for (const at of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      now = at;
      await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_CLOCK_INVALID" });
    }
    now = NOW;
    await expect(store.transaction(async tx => { const principal = await resolve(tx); now -= 1; await principal.assertFresh(); }))
      .rejects.toMatchObject({ code: "WALLET_CLOCK_INVALID" });
  });

  it.each(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "SET TRANSACTION READ ONLY", "SET LOCAL alpha_wallet.development_schema='disabled'"])(
    "refuses the wrong transaction contract: %s", async sql => {
      await expect(store.transaction(async tx => { await tx.exec(sql); await resolve(tx); }))
        .rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED", status: 503 });
    });

  it("refuses actual autocommit before reading accounts or poisoning an unrelated transaction", async () => {
    const db = new PGlite(), statements: string[] = [];
    try {
      await db.exec("SET default_transaction_isolation='serializable'; SET alpha_wallet.development_schema='simulation-only';");
      const tx: WalletSql = { exec: async sql => { await db.exec(sql); }, query: (sql, values) => { statements.push(sql); return db.query(sql, values); } };
      await expect(resolve(tx)).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
      expect(statements.some(sql => sql.includes("FROM alpha_exchange.mobile_device_sessions") || sql.includes("1 / 0"))).toBe(false);
    } finally { await db.close(); }
  }, TIMEOUT);

  it("does not let a retained principal authorize outside its original transaction", async () => {
    const principal = await store.transaction(tx => resolve(tx));
    await expect(principal.assertFresh()).rejects.toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE" });
  });

  it("never poisons a replaced or uncertified transaction", async () => {
    for (const ids of [["41", "42"], ["41", "41", "42"]]) {
      const statements: string[] = [];
      let index = 0;
      const tx: WalletSql = { exec: async () => { throw new Error("Unexpected write"); },
        async query<Row extends Record<string, unknown>>(sql: string) {
          statements.push(sql);
          if (sql.includes("txid_current()")) return { rows: [{ transaction_id: ids[Math.min(index++, ids.length - 1)],
            isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
          throw new Error("Unexpected authority read or abort");
        } };
      await expect(resolve(tx)).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
      expect(statements.some(sql => sql.includes("FROM alpha_exchange.mobile_device_sessions") || sql.includes("1 / 0"))).toBe(false);
    }
  });

  it("sanitizes private driver failures and preserves serialization/deadlock retry codes for the transaction owner", async () => {
    for (const failure of [new Error(`Driver included ${credentials.accessToken} and synthetic-mobile-buyer@example.invalid`),
      Object.assign(new Error("synthetic serialization conflict"), { code: "40001" }),
      Object.assign(new Error("synthetic deadlock"), { code: "40P01" })]) {
      let injected = false;
      const operation = store.transaction(owner => resolve({ exec: sql => owner.exec(sql), query: (sql, params) => {
        if (sql.includes("FOR SHARE OF session, account") && !injected) { injected = true; throw failure; }
        return owner.query(sql, params);
      } }));
      if ("code" in failure) await expect(operation).rejects.toBe(failure);
      else {
        let result: unknown;
        try { await operation; } catch (error) { result = error; }
        expect(result).toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE", status: 503 });
        expect(String(result)).not.toContain(credentials.accessToken);
        expect(result).not.toHaveProperty("cause");
      }
    }
  });

  it("refuses production runtime before touching the transaction", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const tx: WalletSql = { exec: vi.fn(), query: vi.fn() };
    await expect(resolve(tx)).rejects.toThrow(/local|production/i);
    expect(tx.query).not.toHaveBeenCalled();
  });
});
