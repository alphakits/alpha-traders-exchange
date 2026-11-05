// @vitest-environment node
// Mobile auth is recognized source-only metadata, never part of a recovery unit.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_TIME } from "../../../scripts/alpha-wallet/durable-fixtures";
import {
  marketplaceBackupFixture, MARKETPLACE_BACKUP_RESTORE_TIME,
} from "../../../scripts/alpha-wallet/marketplace-backup-fixtures";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import {
  exportMarketplaceWalletBackup, inspectMarketplaceWalletBackup,
  inspectRestoredMarketplaceWallet, restoreMarketplaceWalletBackup,
} from "./marketplace-backup";
import { resolveDevelopmentMarketplaceMobilePrincipal } from "./marketplace-mobile-auth";
import { createMarketplaceMobileAuthFixture } from "./marketplace-mobile-fixture";
import {
  assertFreshMarketplaceRecoveryTarget, assertMarketplaceRecoveryIdentityQuarantine,
  readMarketplaceRecoveryRows,
} from "./marketplace-recovery-store";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));

const MODE = "simulation-only" as const;
const TIMEOUT = 120_000;
const RESTORE_AT = MARKETPLACE_BACKUP_RESTORE_TIME;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const SPENT_REFRESH_TOKEN = `atr_rt_v1.${createHash("sha384").update("public-previous-mobile-refresh-fixture").digest("base64url")}`;
const SPENT_REFRESH_HASH = digest(SPENT_REFRESH_TOKEN);
const stores: WalletStore[] = [];
let sourceDirectory: string;
let directory: string;
let sourceStore: WalletStore;
let setup: Awaited<ReturnType<typeof marketplaceBackupFixture>>;
let mobile: Awaited<ReturnType<typeof createMarketplaceMobileAuthFixture>>;
let legacySerialized: string;
let serialized: string;
let inspection: ReturnType<typeof inspectMarketplaceWalletBackup>;

function guardedRuntime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
}

const inside = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const exportSource = (store = sourceStore) => exportMarketplaceWalletBackup({
  mode: MODE, store, ...setup.ownerInput, clock: setup.clock,
});
const restore = (store: WalletStore, backup = serialized) => restoreMarketplaceWalletBackup({
  mode: MODE, store, backup, acknowledgeFreshTarget: true,
  expectedChecksum: inspectMarketplaceWalletBackup(backup).checksum, clock: () => RESTORE_AT,
});
const inspectTarget = (store: WalletStore) => inspectRestoredMarketplaceWallet({
  mode: MODE, store, expectedChecksum: inspection.checksum,
});

async function connected(name: string) {
  const store = await createFileWalletStore({ mode: MODE, dataDir: join(directory, name) });
  stores.push(store);
  return store;
}

async function authFootprint(store: WalletStore) {
  return store.transaction(async tx => ({
    sessions: (await tx.query("SELECT to_jsonb(s) AS row FROM alpha_exchange.mobile_device_sessions s ORDER BY id")).rows,
    history: (await tx.query("SELECT to_jsonb(h) AS row FROM alpha_exchange.mobile_refresh_token_history h ORDER BY token_hash")).rows,
  }));
}

beforeAll(async () => {
  guardedRuntime();
  sourceDirectory = await mkdtemp(join(tmpdir(), "alpha-wallet-mobile-recovery-source-"));
  sourceStore = await createFileWalletStore({ mode: MODE, dataDir: sourceDirectory });
  setup = await marketplaceBackupFixture(sourceStore);
  legacySerialized = await exportSource();
  mobile = await sourceStore.transaction(tx => createMarketplaceMobileAuthFixture({
    mode: MODE, tx, userIds: setup.fixture.accounts.map(account => account.id), atMs: FIXTURE_TIME,
    platform: "android", locale: "ar",
  }));
  await sourceStore.transaction(async tx => {
    // Retain both a prior refresh generation and a revoked device row, alongside
    // the current owner/buyer credentials. None belongs in financial recovery.
    const at = new Date(FIXTURE_TIME + 500).toISOString();
    await tx.query(`INSERT INTO alpha_exchange.mobile_refresh_token_history
      (token_hash,session_id,generation,used_at,expires_at) VALUES ($1,$2,0,$3::timestamptz,$4::timestamptz)`,
    [SPENT_REFRESH_HASH, mobile.sessions[setup.fixture.ownerId].id, at, mobile.sessions[setup.fixture.ownerId].refreshExpiresAt]);
    await tx.query(`UPDATE alpha_exchange.mobile_device_sessions SET refresh_generation=1,updated_at=$2::timestamptz,
      last_seen_at=$2::timestamptz WHERE user_id=$1`, [setup.fixture.ownerId, at]);
    await tx.query(`UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=$2::timestamptz,
      revoke_reason='public-revoked-device-fixture',updated_at=$2::timestamptz WHERE user_id=$1`, [setup.fixture.sellerId, at]);
  });
  serialized = await exportSource();
  inspection = inspectMarketplaceWalletBackup(serialized);
}, TIMEOUT);

beforeEach(async () => {
  guardedRuntime();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-mobile-recovery-test-"));
});

afterEach(async () => {
  try {
    const outcomes = await Promise.allSettled(stores.splice(0).map(store => store.close()));
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

afterAll(async () => {
  try { if (sourceStore) await sourceStore.close(); }
  finally {
    try { if (sourceDirectory) await rm(sourceDirectory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

describe("combined recovery excludes native mobile authentication", () => {
  it("exports exactly the existing financial bytes without reading or copying device credentials and refresh history", async () => {
    const before = await authFootprint(sourceStore);
    let authenticationReads = 0;
    const observed: WalletStore = {
      transaction: work => sourceStore.transaction(tx => work({
        exec: sql => tx.exec(sql),
        query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          if (/\b(?:FROM|JOIN)\s+alpha_exchange\.mobile_(?:device_sessions|refresh_token_history)\b/i.test(sql.replaceAll('"', ""))) {
            authenticationReads++;
          }
          return tx.query<Row>(sql, params);
        },
      })),
      close: async () => undefined,
    };
    expect(await exportSource(observed)).toBe(legacySerialized);
    expect(serialized).toBe(legacySerialized);
    expect(authenticationReads).toBe(0);
    expect(await authFootprint(sourceStore)).toEqual(before);
    expect(before.sessions).toHaveLength(3);
    expect(before.history).toHaveLength(1);
    expect(inspection).toMatchObject({ formatVersion: 1, schemaVersion: "canonical-cohort-v1", credentialsIncluded: false });
    const markers = [SPENT_REFRESH_TOKEN, SPENT_REFRESH_HASH, "public-revoked-device-fixture",
      ...Object.values(mobile.credentials).flatMap(credential => [credential.accessToken, credential.metadata.deviceId]),
      ...Object.values(mobile.sessions).flatMap(session => [session.id, session.deviceIdHash, session.accessTokenHash,
        session.refreshTokenHash, session.tokenFamilyId])];
    for (const marker of markers) expect(serialized).not.toContain(marker);
    for (const field of ["mobile_device_sessions", "mobile_refresh_token_history", "device_id_hash", "access_token_hash",
      "refresh_token_hash", "token_family_id", "refresh_generation"]) expect(serialized).not.toContain(`"${field}"`);
  }, TIMEOUT);

  it("restores the unchanged web-only format without mobile tables or usable source credentials", async () => {
    for (const userId of [setup.fixture.ownerId, setup.fixture.buyerId]) {
      const credential = mobile.credentials[userId];
      const principal = await sourceStore.transaction(tx => resolveDevelopmentMarketplaceMobilePrincipal({
        mode: MODE, tx, ...credential, clock: setup.clock,
      }));
      expect(principal.userId).toBe(userId);
    }
    const target = await connected("restored-legacy-compatible");
    const restored = await restore(target, legacySerialized);
    expect(restored.quarantined).toBe(true);
    const current = await target.transaction(async tx => ({
      mobileRelations: (await tx.query(`SELECT to_regclass('alpha_exchange.mobile_device_sessions') AS sessions,
        to_regclass('alpha_exchange.mobile_refresh_token_history') AS history`)).rows,
      webSessions: (await tx.query("SELECT token_hash FROM alpha_exchange.sessions")).rows,
      users: (await tx.query<{ payload: Record<string, unknown> }>("SELECT payload FROM alpha_exchange.users ORDER BY id")).rows,
      financial: await readMarketplaceRecoveryRows(tx),
    }));
    expect(current.mobileRelations).toEqual([{ sessions: null, history: null }]);
    expect(current.webSessions).toEqual([]);
    for (const user of current.users) {
      expect(user.payload.disabled).toBe(true);
      expect(user.payload.emailVerified).toBe(false);
      expect(user.payload.passwordHash).toBeUndefined();
    }
    expect(current.financial).toEqual(await sourceStore.transaction(tx => readMarketplaceRecoveryRows(tx)));
    for (const userId of [setup.fixture.ownerId, setup.fixture.buyerId]) {
      await expect(target.transaction(tx => resolveDevelopmentMarketplaceMobilePrincipal({
        mode: MODE, tx, ...mobile.credentials[userId], clock: () => RESTORE_AT,
      }))).rejects.toThrow();
    }
    await expect(inspectTarget(target)).resolves.toMatchObject({ quarantined: true, source: inspection.checkpoint,
      restored: { revision: inspection.checkpoint.revision + 1 } });
  }, TIMEOUT);

  it.each([
    ["only device sessions", "DROP TABLE alpha_exchange.mobile_refresh_token_history", /both exact mobile authentication tables/],
    ["only refresh history", "DROP TABLE alpha_exchange.mobile_device_sessions CASCADE", /both exact mobile authentication tables/],
    ["an extra secret column", "ALTER TABLE alpha_exchange.mobile_device_sessions ADD COLUMN provider_secret text", /application columns/],
    ["a missing history column", "ALTER TABLE alpha_exchange.mobile_refresh_token_history DROP COLUMN used_at", /application columns/],
    ["the wrong integer width", "ALTER TABLE alpha_exchange.mobile_device_sessions ALTER COLUMN refresh_generation TYPE bigint", /column types or nullability/],
    ["nullable history session identity", "ALTER TABLE alpha_exchange.mobile_refresh_token_history ALTER COLUMN session_id DROP NOT NULL", /column types or nullability/],
    ["a view replacing the history table", `DROP TABLE alpha_exchange.mobile_refresh_token_history;
      CREATE VIEW alpha_exchange.mobile_refresh_token_history AS SELECT NULL::text AS token_hash,NULL::text AS session_id,
        NULL::integer AS generation,NULL::timestamptz AS used_at,NULL::timestamptz AS expires_at WHERE false`, /application tables/],
    ["an additional mobile-looking table", "CREATE TABLE alpha_exchange.mobile_other_credentials (token_hash text)", /application tables/],
  ] as const)("refuses a source with %s and leaves the complete financial/authentication snapshot unchanged", async (_name, sql, message) => {
    const before = await authFootprint(sourceStore);
    await expect(sourceStore.transaction(async tx => {
      await tx.exec(sql);
      return exportSource(inside(tx));
    })).rejects.toThrow(message);
    expect(await authFootprint(sourceStore)).toEqual(before);
    expect(await exportSource()).toBe(serialized);
  }, TIMEOUT);

  it("refuses quarantine inspection even when a restored target has only an empty mobile table pair", async () => {
    const target = await connected("empty-mobile-added-after-restore");
    await restore(target);
    await target.transaction(async tx => {
      await createMarketplaceMobileAuthFixture({ mode: MODE, tx, userIds: [setup.fixture.ownerId], atMs: RESTORE_AT });
      await tx.exec("DELETE FROM alpha_exchange.mobile_device_sessions");
    });
    expect(await authFootprint(target)).toEqual({ sessions: [], history: [] });
    await expect(target.transaction(tx => assertMarketplaceRecoveryIdentityQuarantine(tx)))
      .rejects.toThrow(/mobile authentication relations must remain absent/);
    await expect(target.transaction(tx => readMarketplaceRecoveryRows(tx)))
      .rejects.toThrow(/mobile authentication relations must remain absent/);
    await expect(inspectTarget(target)).rejects.toThrow(/mobile authentication relations must remain absent/);
  }, TIMEOUT);

  it("does not turn recreated device credentials into authority for a disabled recovery identity", async () => {
    const target = await connected("mobile-credential-recreation-refused");
    await restore(target);
    const recreated = await target.transaction(tx => createMarketplaceMobileAuthFixture({
      mode: MODE, tx, userIds: [setup.fixture.ownerId], atMs: RESTORE_AT, platform: "android", locale: "ar",
    }));
    const credential = recreated.credentials[setup.fixture.ownerId];
    await expect(target.transaction(tx => resolveDevelopmentMarketplaceMobilePrincipal({
      mode: MODE, tx, ...credential, clock: () => RESTORE_AT + 1,
    }))).rejects.toMatchObject({ code: "WALLET_ACCOUNT_DISABLED" });
    const freshToken = `atr_at_v1.${createHash("sha256").update("public-new-token-for-disabled-recovered-account").digest("base64url")}`;
    await target.transaction(tx => tx.query("UPDATE alpha_exchange.mobile_device_sessions SET access_token_hash=$1 WHERE user_id=$2",
      [digest(freshToken), setup.fixture.ownerId]));
    await expect(target.transaction(tx => resolveDevelopmentMarketplaceMobilePrincipal({
      mode: MODE, tx, accessToken: freshToken, metadata: credential.metadata, clock: () => RESTORE_AT + 1,
    }))).rejects.toMatchObject({ code: "WALLET_ACCOUNT_DISABLED" });
    const account = await target.transaction(tx => tx.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM alpha_exchange.users WHERE id=$1", [setup.fixture.ownerId]));
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0].payload).toMatchObject({ disabled: true, emailVerified: false, recoveryIdentityOnly: true });
    await expect(inspectTarget(target)).rejects.toThrow(/mobile authentication relations must remain absent/);
  }, TIMEOUT);

  it.each([false, true])("rolls the whole restore back if a late participant adds mobile auth tables before COMMIT (credentials=%s)", async credentials => {
    const target = await connected(`late-mobile-${credentials}`);
    let recoveryReturned = false, mobileInstalled = false;
    const late: WalletStore = {
      transaction: work => target.transaction(async tx => {
        const result = await work(tx);
        recoveryReturned = true;
        // Every application-level verification has already returned. Only the
        // real outer COMMIT's deferred receipt constraint can reject this state.
        await createMarketplaceMobileAuthFixture({ mode: MODE, tx, userIds: [setup.fixture.ownerId], atMs: RESTORE_AT });
        if (!credentials) await tx.exec("DELETE FROM alpha_exchange.mobile_device_sessions");
        mobileInstalled = true;
        return result;
      }),
      close: async () => undefined,
    };
    await expect(restore(late)).rejects.toThrow();
    expect(recoveryReturned).toBe(true);
    expect(mobileInstalled).toBe(true);
    await target.transaction(tx => assertFreshMarketplaceRecoveryTarget(tx));
    expect((await restore(target)).quarantined).toBe(true);
    await expect(inspectTarget(target)).resolves.toMatchObject({ quarantined: true });
  }, TIMEOUT);
});
