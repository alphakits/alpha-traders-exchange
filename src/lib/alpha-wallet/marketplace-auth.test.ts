// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/alpha-exchange-store";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { resolveDevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden in auth fixtures"); } }));

const MODE = "simulation-only" as const;
const NOW = 1_800_000_000_000;
const CREATED = new Date(NOW - 5000).toISOString();
const EXPIRES = new Date(NOW + 60_000).toISOString();
const TOKEN = "isolated-development-web-session-credential";
const BUYER = "auth-fixture-buyer";
const TIMEOUT = 90_000;
const HOSTED_FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
let store: WalletStore;
let directory: string;
let now: number;

function userFixture(): Record<string, unknown> {
  return { id: BUYER, email: "synthetic-buyer@example.invalid", fullName: "Private synthetic profile name",
    passwordHash: "synthetic-private-password-hash", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
    emailVerified: true, disabled: false, verifiedPhone: "+15551234567", phoneVerifiedAt: CREATED,
    phoneOtpSalt: "synthetic-private-otp-salt", ageEligibility: { method: "self_attestation_v1", confirmedAt: CREATED },
    createdAt: CREATED, updatedAt: CREATED };
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of HOSTED_FLAGS) vi.stubEnv(flag, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-auth-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await store.transaction(tx => tx.exec(`
    CREATE SCHEMA alpha_exchange;
    CREATE TABLE alpha_exchange.users (
      id text PRIMARY KEY, email text NOT NULL UNIQUE, role text NOT NULL, seller_status text NOT NULL,
      availability_status text NOT NULL, online_status text NOT NULL, created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.sessions (
      token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE auth_atomic_probe (id text PRIMARY KEY);
  `));
}, TIMEOUT);

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const flag of HOSTED_FLAGS) vi.stubEnv(flag, undefined);
  now = NOW;
  await store.transaction(async tx => {
    await tx.exec("DELETE FROM alpha_exchange.sessions; DELETE FROM alpha_exchange.users; DELETE FROM auth_atomic_probe;");
    const user = userFixture();
    await tx.query(`INSERT INTO alpha_exchange.users
      (id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload)
      VALUES ($1,$2,$3,$4,'available','offline',$5,$5,0,$6::jsonb)`,
    [user.id, user.email, user.role, user.sellerStatus, CREATED, JSON.stringify(user)]);
    const session = { token: hashToken(TOKEN), userId: BUYER, createdAt: CREATED, expiresAt: EXPIRES, deviceLabel: "Private synthetic device" };
    await tx.query("INSERT INTO alpha_exchange.sessions VALUES ($1,$2,$3,$4,0,$5::jsonb)",
      [session.token, session.userId, session.expiresAt, session.createdAt, JSON.stringify(session)]);
  });
}, TIMEOUT);

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { await store?.close(); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, TIMEOUT);

function resolve(tx: WalletSql, token = TOKEN) {
  return resolveDevelopmentMarketplaceWebPrincipal({ mode: MODE, tx, token, clock: () => now });
}

async function patchUser(patch: Record<string, unknown>) {
  await store.transaction(async tx => {
    const current = (await tx.query<{ payload: Record<string, unknown> }>("SELECT payload FROM alpha_exchange.users WHERE id=$1", [BUYER])).rows[0].payload;
    const user = { ...current, ...patch };
    await tx.query("UPDATE alpha_exchange.users SET email=$2,role=$3,seller_status=$4,payload=$5::jsonb WHERE id=$1",
      [BUYER, user.email, user.role, user.sellerStatus, JSON.stringify(user)]);
  });
}

function alter(statement: string, parameters?: unknown[]) {
  return store.transaction(tx => tx.query(statement, parameters));
}

describe("transaction-bound development marketplace web authentication", () => {
  it("uses the actual stored web-token hash and locked canonical rows, returning only minimal immutable authority", async () => {
    const statements: string[] = [], parameters: unknown[] = [];
    const principal = await store.transaction(async owner => {
      const tx: WalletSql = {
        exec: statement => { statements.push(statement); return owner.exec(statement); },
        query: (statement, values) => { statements.push(statement); parameters.push(...(values ?? [])); return owner.query(statement, values); },
      };
      const current = await resolve(tx);
      await current.assertFresh();
      return current;
    });
    expect(principal).toMatchObject({ userId: BUYER, canBuy: true, isOwner: false, sessionExpiresAtMs: NOW + 60_000 });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.keys(principal).sort()).toEqual(["assertFresh", "canBuy", "canSell", "isOwner", "sessionExpiresAtMs", "userId"]);
    expect(statements.filter(sql => sql.includes("FOR SHARE OF session, account"))).toHaveLength(2);
    expect(statements.some(sql => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))).toBe(false);
    expect(parameters).toEqual([hashToken(TOKEN), hashToken(TOKEN)]);
    const serialized = JSON.stringify(principal);
    for (const privateValue of [TOKEN, hashToken(TOKEN), "synthetic-buyer@example.invalid", "+15551234567", "Private synthetic",
      "synthetic-private-password-hash", "synthetic-private-otp-salt"]) expect(serialized).not.toContain(privateValue);
  });

  it.each([
    ["buyer", ["buyer"], true, false],
    ["approved_seller", ["approved_seller", "buyer"], true, false],
    ["approved_seller", ["approved_seller"], false, false],
    ["admin", ["admin"], true, false],
    ["owner", ["owner", "buyer"], true, true],
    ["student", ["student"], false, false],
  ])("derives buyer and owner authority from canonical %s roles", async (role, roles, canBuy, isOwner) => {
    await patchUser({ role, roles });
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ canBuy, isOwner });
  });

  it("retains the explicit legacy enabled-account rule without inventing verification flags", async () => {
    await patchUser({ disabled: undefined, roles: undefined });
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ userId: BUYER, canBuy: true });
  });

  it.each([
    ["disabled", { disabled: true }, "WALLET_ACCOUNT_DISABLED"],
    ["malformed disabled flag", { disabled: "false" }, "WALLET_ACCOUNT_DISABLED"],
    ["null disabled flag", { disabled: null }, "WALLET_ACCOUNT_DISABLED"],
    ["unverified email", { emailVerified: false }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["missing email verification", { emailVerified: undefined }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["malformed email flag", { emailVerified: "true" }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["missing phone", { verifiedPhone: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["missing OTP proof", { phoneVerifiedAt: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["invalid OTP time", { phoneVerifiedAt: "invalid" }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["malformed OTP time", { phoneVerifiedAt: NOW }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["missing adult confirmation", { ageEligibility: undefined }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
    ["different adult method", { ageEligibility: { method: "client_boolean", confirmedAt: CREATED } }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
    ["malformed adult date", { ageEligibility: { method: "self_attestation_v1", confirmedAt: "invalid" } }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
  ])("rejects %s using the locked account", async (_name, patch, code) => {
    await patchUser(patch as Record<string, unknown>);
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code });
  });

  it("does not permit a role or photo-verification environment bypass to replace phone evidence", async () => {
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "synthetic-buyer@example.invalid");
    await patchUser({ role: "owner", roles: ["owner"], verifiedPhone: undefined, phoneVerifiedAt: undefined });
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_PHONE_VERIFICATION_REQUIRED" });
  });

  it("uses the exact existing-account phone exemption, while the same email on a recreated account is denied", async () => {
    const exemptId = "user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a";
    await patchUser({ email: "alphatradersai@gmail.com", verifiedPhone: undefined, phoneVerifiedAt: undefined });
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_PHONE_VERIFICATION_REQUIRED" });
    await store.transaction(async tx => {
      const user = { ...userFixture(), id: exemptId, email: "alphatradersai@gmail.com", verifiedPhone: undefined, phoneVerifiedAt: undefined };
      await tx.exec("DELETE FROM alpha_exchange.sessions; DELETE FROM alpha_exchange.users;");
      await tx.query(`INSERT INTO alpha_exchange.users VALUES ($1,$2,'buyer','buyer','available','offline',$3,$3,0,$4::jsonb)`,
        [exemptId, user.email, CREATED, JSON.stringify(user)]);
      const session = { token: hashToken(TOKEN), userId: exemptId, createdAt: CREATED, expiresAt: EXPIRES };
      await tx.query("INSERT INTO alpha_exchange.sessions VALUES ($1,$2,$3,$4,0,$5::jsonb)",
        [session.token, session.userId, EXPIRES, CREATED, JSON.stringify(session)]);
    });
    expect(await store.transaction(tx => resolve(tx))).toMatchObject({ userId: exemptId, canBuy: true });
  });

  it("requires the raw credential and rejects missing, malformed, incorrect and stored-hash credentials", async () => {
    for (const token of ["", " ", "raw\ncredential", "x".repeat(2049), "different-opaque-credential", hashToken(TOKEN)]) {
      await expect(store.transaction(tx => resolve(tx, token))).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED", status: 401 });
    }
    await alter("DELETE FROM alpha_exchange.sessions");
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED", status: 401 });
  });

  it.each([NOW + 60_000, NOW + 60_001, NOW - 5001])("rejects expiry or future session creation at clock %s", async value => {
    now = value;
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED", status: 401 });
  });

  it.each([
    ["session identity", "UPDATE alpha_exchange.sessions SET payload=jsonb_set(payload,'{userId}','\"another-user\"')"],
    ["session token", "UPDATE alpha_exchange.sessions SET payload=jsonb_set(payload,'{token}','\"different-hash\"')"],
    ["session expiry scalar", "UPDATE alpha_exchange.sessions SET expires_at=expires_at + interval '1 millisecond'"],
    ["session creation scalar", "UPDATE alpha_exchange.sessions SET created_at=created_at - interval '1 millisecond'"],
    ["sub-millisecond expiry", "UPDATE alpha_exchange.sessions SET expires_at=expires_at + interval '1 microsecond'"],
    ["invalid session expiry", "UPDATE alpha_exchange.sessions SET payload=jsonb_set(payload,'{expiresAt}','\"not-a-date\"')"],
    ["noncanonical session timestamp", "UPDATE alpha_exchange.sessions SET payload=jsonb_set(payload,'{expiresAt}',to_jsonb(replace(payload->>'expiresAt','.000Z','Z')))"],
    ["session array", "UPDATE alpha_exchange.sessions SET payload='[]'"],
    ["account identity", "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{id}','\"another-user\"')"],
    ["account email", "UPDATE alpha_exchange.users SET email='different@example.invalid'"],
    ["account primary role", "UPDATE alpha_exchange.users SET role='owner'"],
    ["account seller status", "UPDATE alpha_exchange.users SET seller_status='suspended'"],
    ["account array", "UPDATE alpha_exchange.users SET payload='[]'"],
    ["malformed roles", "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{roles}','\"owner\"')"],
    ["unknown role", "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{roles}','[\"super_owner\"]')"],
  ])("fails closed on retained %s inconsistency", async (_name, statement) => {
    await alter(statement);
    await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_AUTH_RECORD_INVALID", status: 503 });
  });

  it("checks expiry after the final awaited read", async () => {
    await expect(store.transaction(owner => {
      const tx: WalletSql = {
        exec: sql => owner.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          const result = await owner.query<Row>(sql, values);
          if (sql.includes("FOR SHARE OF session, account")) now = NOW + 60_000;
          return result;
        },
      };
      return resolve(tx);
    })).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
  });

  it("rolls back earlier writes when the owner swallows a late expiry rejection", async () => {
    let captured: unknown;
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx);
      await tx.query("INSERT INTO auth_atomic_probe VALUES ('synthetic-financial-work')");
      now = NOW + 60_000;
      try { await principal.assertFresh(); } catch (error) { captured = error; }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(captured).toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect((await alter("SELECT id FROM auth_atomic_probe")).rows).toEqual([]);
  });

  it.each([
    ["session deletion", "DELETE FROM alpha_exchange.sessions", "WALLET_SESSION_REQUIRED"],
    ["account disable", "UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true')", "WALLET_ACCOUNT_DISABLED"],
    ["phone removal", "UPDATE alpha_exchange.users SET payload=payload - 'phoneVerifiedAt'", "WALLET_PHONE_VERIFICATION_REQUIRED"],
    ["role revocation", "UPDATE alpha_exchange.users SET role='student',payload=jsonb_set(jsonb_set(payload,'{role}','\"student\"'),'{roles}','[\"student\"]')", "WALLET_AUTHORITY_CHANGED"],
  ])("rechecks %s even if the same owner changed its locked rows", async (_name, statement, code) => {
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx);
      await tx.query(statement);
      await principal.assertFresh();
    })).rejects.toMatchObject({ code });
  });

  it("rejects invalid or backwards trusted clock values", async () => {
    for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      now = value;
      await expect(store.transaction(tx => resolve(tx))).rejects.toMatchObject({ code: "WALLET_CLOCK_INVALID" });
    }
    now = NOW;
    await expect(store.transaction(async tx => {
      const principal = await resolve(tx);
      now -= 1;
      await principal.assertFresh();
    })).rejects.toMatchObject({ code: "WALLET_CLOCK_INVALID" });
  });

  it.each([
    "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
    "SET TRANSACTION READ ONLY",
    "SET LOCAL alpha_wallet.development_schema = 'disabled'",
  ])("rejects a real transaction with the wrong contract: %s", async statement => {
    await expect(store.transaction(async tx => { await tx.exec(statement); await resolve(tx); }))
      .rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
  });

  it("rejects actual autocommit before reading accounts, even with serializable defaults and a session-level guard", async () => {
    const db = new PGlite();
    const queries: string[] = [];
    try {
      await db.exec("SET default_transaction_isolation = 'serializable'; SET alpha_wallet.development_schema = 'simulation-only';");
      const tx: WalletSql = {
        exec: async sql => { await db.exec(sql); },
        query: (sql, values) => { queries.push(sql); return db.query(sql, values); },
      };
      await expect(resolve(tx)).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
      expect(queries.some(sql => sql.includes("alpha_exchange.sessions") || sql.includes("1 / 0"))).toBe(false);
    } finally { await db.close(); }
  }, TIMEOUT);

  it("does not let a retained principal authorize outside its original transaction", async () => {
    const principal = await store.transaction(tx => resolve(tx));
    await expect(principal.assertFresh()).rejects.toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE" });
  });

  it("never poisons a changed or uncertified transaction", async () => {
    for (const ids of [["41", "42"], ["41", "41", "42"]]) {
      const queries: string[] = [];
      let index = 0;
      const tx: WalletSql = {
        exec: async () => { throw new Error("Unexpected write"); },
        async query<Row extends Record<string, unknown>>(sql: string) {
          queries.push(sql);
          if (sql.includes("txid_current()")) return { rows: [{ transaction_id: ids[Math.min(index++, ids.length - 1)],
            isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
          throw new Error("Unexpected auth read or abort");
        },
      };
      await expect(resolve(tx)).rejects.toMatchObject({ code: "WALLET_AUTH_CONTEXT_REQUIRED" });
      expect(queries.some(sql => sql.includes("alpha_exchange.sessions") || sql.includes("1 / 0"))).toBe(false);
    }
  });

  it("hides private driver errors while preserving serialization retries for the owner", async () => {
    for (const failure of [new Error(`Driver accidentally included ${TOKEN} and synthetic-buyer@example.invalid`),
      Object.assign(new Error("synthetic serialization failure"), { code: "40001" })]) {
      let injected = false;
      const operation = store.transaction(owner => {
        const tx: WalletSql = {
          exec: sql => owner.exec(sql),
          query: (sql, values) => {
            if (sql.includes("FOR SHARE OF session, account") && !injected) { injected = true; throw failure; }
            return owner.query(sql, values);
          },
        };
        return resolve(tx);
      });
      if ("code" in failure) {
        // The file store is serial; native PostgreSQL's owner supplies retry.
        await expect(operation).rejects.toBe(failure);
        expect(await store.transaction(tx => resolve(tx))).toMatchObject({ userId: BUYER });
      }
      else {
        let result: unknown;
        try { await operation; } catch (error) { result = error; }
        expect(result).toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE", status: 503 });
        expect(String(result)).not.toContain(TOKEN);
        expect(result).not.toHaveProperty("cause");
      }
    }
  });

  it("refuses non-simulation and hosted execution before accessing a database", async () => {
    const tx: WalletSql = { exec: vi.fn(), query: vi.fn() };
    await expect(resolveDevelopmentMarketplaceWebPrincipal({ mode: "live" as typeof MODE, tx, token: TOKEN, clock: () => now }))
      .rejects.toThrow(/simulation-only/);
    vi.stubEnv("VERCEL", "1");
    await expect(resolve(tx)).rejects.toThrow(/hosted/);
    expect(tx.query).not.toHaveBeenCalled();
  });
});
