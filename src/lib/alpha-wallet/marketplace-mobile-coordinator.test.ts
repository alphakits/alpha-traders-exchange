// @vitest-environment node
// Actual canonical SQL and both fixed authentication paths share one isolated
// financial transaction. Native connection races are a separate acceptance drill.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { BUYER, FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { exportMarketplaceWalletBackup, exportMobileMarketplaceWalletBackup, inspectMarketplaceWalletBackup } from "./marketplace-backup";
import { createMarketplaceCoordinationFixture } from "./marketplace-coordination-fixture";
import { initializeMarketplaceCoordination } from "./marketplace-coordination-store";
import { createDevelopmentMarketplaceWalletCoordinator, createDevelopmentMobileMarketplaceWalletCoordinator } from "./marketplace-coordinator";
import { createMarketplaceMobileAuthFixture } from "./marketplace-mobile-fixture";
import { simulatedDestination } from "./sandbox";
import { v2Command } from "./v2-commands";
import { upgradeDurableWalletV2, verifyVersionedHistory } from "./versioned-durable";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));

const MODE = "simulation-only" as const;
const TIMEOUT = 120_000;
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
const FINANCIAL_TABLES = [
  ["purchase_requests", "id"], ["listings", "id"], ["trades", "id"], ["commissions", "id"],
  ["notifications", "id"], ["audit_logs", "id"], ["activity_logs", "id"],
] as const;
let directory: string, store: WalletStore, now: number;
let fixture: Awaited<ReturnType<typeof createMarketplaceCoordinationFixture>>;
let mobileAuth: Awaited<ReturnType<typeof createMarketplaceMobileAuthFixture>>;
let mobile: ReturnType<typeof createDevelopmentMobileMarketplaceWalletCoordinator>;
let web: ReturnType<typeof createDevelopmentMarketplaceWalletCoordinator>;
const clock = () => now;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED", "MOBILE_MIN_IOS_VERSION", "MOBILE_MIN_ANDROID_VERSION"]) {
    vi.stubEnv(key, undefined);
  }
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-mobile-coordinator-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await initializeDurableWallet(store);
  now = FIXTURE_TIME + 1000;
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function setup(options: {
  platform?: "ios" | "android"; locale?: "ar" | "en"; paymentMethod?: "Bank Transfer" | "Face-to-Face";
} = {}) {
  fixture = await store.transaction(tx => createMarketplaceCoordinationFixture({ mode: MODE, tx, paymentMethod: options.paymentMethod }));
  mobileAuth = await store.transaction(tx => createMarketplaceMobileAuthFixture({
    mode: MODE, tx, userIds: [fixture.ownerId, fixture.buyerId, fixture.sellerId], atMs: FIXTURE_TIME,
    platform: options.platform, locale: options.locale,
  }));
  const wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
  await wallet.execute(walletCommand("reserveTrade", BUYER, "mobile-coordinator-reserve", {
    id: fixture.tradeId, listingId: fixture.listingId, amount: "200",
    destination: simulatedDestination(TRON, fixture.buyerId),
  }));
  const beforeUpgrade = await wallet.snapshot();
  await upgradeDurableWalletV2({ mode: MODE, store, acknowledgeVersionUpgrade: true, clock: () => FIXTURE_TIME,
    command: v2Command("continueFromV1", OPERATOR, "mobile-coordinator-upgrade", { checkpoint: {
      revision: beforeUpgrade.revision, eventHash: beforeUpgrade.eventHash,
      stateHash: walletDigest(beforeUpgrade.state), lastCommandAtMs: FIXTURE_TIME,
    } }) });
  await initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true });
  mobile = createDevelopmentMobileMarketplaceWalletCoordinator({ mode: MODE, store, clock });
  web = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store, clock });
}
function credentials(userId: string) {
  const input = mobileAuth.credentials[userId];
  return { accessToken: input.accessToken, metadata: { ...input.metadata } };
}
function inspection(userId = fixture.ownerId) {
  return { ...credentials(userId), requestId: fixture.requestId };
}
function enrollment(userId = fixture.ownerId) {
  return { ...inspection(userId), operationId: "mobile-coordinator-enroll", walletListingId: fixture.listingId,
    walletTradeId: fixture.tradeId, assetId: TRON };
}
function acceptance(userId = fixture.buyerId) {
  return { ...inspection(userId), operationId: "mobile-coordinator-accept", proposalId: fixture.proposalId, expectedBindingRevision: 0 };
}
function webInspection() { return { sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId }; }
function webAcceptance() {
  return { sessionToken: fixture.buyerSessionToken, requestId: fixture.requestId, operationId: "web-after-mobile-accept",
    proposalId: fixture.proposalId, expectedBindingRevision: 0 };
}
async function footprint() {
  return store.transaction(async tx => {
    const canonical: Record<string, unknown[]> = {};
    for (const [table, order] of FINANCIAL_TABLES) {
      canonical[table] = (await tx.query<{ row: unknown }>(`SELECT to_jsonb(r) AS row FROM alpha_exchange.${table} r ORDER BY ${order}`)).rows.map(row => row.row);
    }
    return {
      commands: (await tx.query(COMMANDS)).rows,
      canonical,
      runtime: (await tx.query("SELECT version::text AS version, to_jsonb(r)->>'updated_at' AS updated_at FROM alpha_exchange.runtime_meta r")).rows,
      enrollments: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.enrollments ORDER BY request_id")).rows,
      acceptances: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.acceptances ORDER BY acceptance_key")).rows,
      publications: (await tx.query("SELECT * FROM alpha_wallet_marketplace_simulation.publications ORDER BY id")).rows,
    };
  });
}
async function authRows() {
  return store.transaction(tx => tx.query("SELECT to_jsonb(s) AS session FROM alpha_exchange.mobile_device_sessions s ORDER BY id"));
}
function wrapped(wrap: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined };
}
function noPrivateMetadata(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const { accessToken, metadata } of Object.values(mobileAuth.credentials)) {
    for (const secret of [accessToken, metadata.deviceId, hash(accessToken), hash(`device:${metadata.deviceId}`)]) {
      expect(serialized).not.toContain(secret);
    }
  }
  for (const session of Object.values(mobileAuth.sessions)) {
    expect(serialized).not.toContain(session.refreshTokenHash);
    expect(serialized).not.toContain(session.tokenFamilyId);
  }
  for (const secret of [fixture.ownerSessionToken, fixture.buyerSessionToken, fixture.sellerSessionToken,
    "access_token_hash", "refresh_token_hash", "device_id_hash", "passwordHash", "accountNumber", "sellerBankAccountSnapshot"]) {
    expect(serialized).not.toContain(secret);
  }
}
async function acceptedAndPaused() {
  await mobile.enrollReservedTrade(enrollment());
  const accepted = await mobile.acceptAmountCorrection(acceptance());
  await mobile.pause({ ...inspection(), operationId: "mobile-pause-after-acceptance" });
  return accepted;
}

describe("development mobile canonical wallet coordination", () => {
  it.each([
    ["ios", "en", "Bank Transfer"], ["android", "ar", "Face-to-Face"],
  ] as const)("commits %s/%s owner enrollment and buyer correction with the unchanged %s financial semantics", async (platform, locale, paymentMethod) => {
    await setup({ platform, locale, paymentMethod });
    const before = await footprint();
    const enrolled = await mobile.enrollReservedTrade(enrollment());
    expect(enrolled).toMatchObject({ replayed: false, bindingRevision: 0, terms: { principalRaw: "200000000" } });
    const afterEnrollment = await footprint();
    const browserEnrollment = await web.enrollReservedTrade({ ...webInspection(), walletListingId: fixture.listingId,
      walletTradeId: fixture.tradeId, assetId: TRON, operationId: "web-retry-of-mobile-enrollment" });
    expect(browserEnrollment).toEqual({ ...enrolled, replayed: true });
    expect(await footprint()).toEqual(afterEnrollment);

    const accepted = await mobile.acceptAmountCorrection(acceptance());
    expect(accepted).toMatchObject({ replayed: false, bindingRevision: 1, principalDeltaRaw: "100000000",
      terms: { principalRaw: "300000000", buyerFeeRaw: "3000000", sellerFeeRaw: "3000000", fiatAmount: "969.60" } });
    const committed = await footprint();
    const state = verifyVersionedHistory(committed.commands).state;
    expect(expectedCustody(state, TRON)).toBe(BigInt("500000000"));
    expect(balance(state, TRON, `trade:${fixture.tradeId}`)).toBe(BigInt("300000000"));
    expect(balance(state, TRON, `listing:${fixture.listingId}`)).toBe(BigInt("200000000"));
    expect(committed.commands).toHaveLength(before.commands.length + 2);
    expect(committed.enrollments).toHaveLength(1);
    expect(committed.acceptances).toHaveLength(1);
    expect(committed.publications).toHaveLength(1);
    expect(committed.canonical.notifications).toHaveLength(1);
    expect(committed.canonical.audit_logs).toHaveLength(1);
    const request = (await store.transaction(tx => tx.query<{ payload: PurchaseRequest }>(
      "SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.requestId]))).rows[0].payload;
    expect(request).toMatchObject({ status: "accepted", usdtAmount: "300", fiatAmount: "969.60",
      termsProposal: { id: fixture.proposalId, status: "accepted" } });
    expect(request.messages).toHaveLength(1);
    expect(await mobile.inspect(inspection())).toEqual(await web.inspect(webInspection()));
    noPrivateMetadata(enrolled); noPrivateMetadata(accepted); noPrivateMetadata(committed.publications);

    const pause = await mobile.pause({ ...inspection(), operationId: "shared-owner-pause" });
    expect(await web.pause({ ...webInspection(), operationId: "shared-owner-pause" })).toEqual({ ...pause, replayed: true });
    const paused = await footprint();
    expect(await web.acceptAmountCorrection(webAcceptance())).toEqual({ ...accepted, replayed: true });
    expect(await mobile.acceptAmountCorrection({ ...acceptance(), operationId: "second-mobile-transport-id" }))
      .toEqual({ ...accepted, replayed: true });
    expect(await footprint()).toEqual(paused);
    expect((await mobile.inspect(inspection())).wallet.halted).toBe(true);
  }, TIMEOUT);

  it("recovers a web-created acceptance through a freshly authenticated mobile device after owner pause", async () => {
    await setup();
    await web.enrollReservedTrade({ ...webInspection(), operationId: "web-enrollment", walletListingId: fixture.listingId,
      walletTradeId: fixture.tradeId, assetId: TRON });
    const accepted = await web.acceptAmountCorrection(webAcceptance());
    await web.pause({ ...webInspection(), operationId: "web-source-pause" });
    const before = await footprint();
    expect(await mobile.acceptAmountCorrection(acceptance())).toEqual({ ...accepted, replayed: true });
    expect(await footprint()).toEqual(before);
    noPrivateMetadata(await mobile.inspect(inspection()));
  }, TIMEOUT);

  it.each(["buyer", "seller"] as const)("refuses %s credentials for every owner control without changing financial state", async role => {
    await setup();
    const actorId = role === "buyer" ? fixture.buyerId : fixture.sellerId;
    const before = await footprint();
    await expect(mobile.enrollReservedTrade(enrollment(actorId))).rejects.toMatchObject({ code: "ACTOR" });
    await expect(mobile.inspect(inspection(actorId))).rejects.toMatchObject({ code: "ACTOR" });
    await expect(mobile.pause({ ...inspection(actorId), operationId: "unauthorized-owner-pause" })).rejects.toMatchObject({ code: "ACTOR" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["owner", "seller"] as const)("refuses %s credentials for the canonical buyer's financial consent", async role => {
    await setup();
    await mobile.enrollReservedTrade(enrollment());
    const before = await footprint();
    await expect(mobile.acceptAmountCorrection(acceptance(role === "owner" ? fixture.ownerId : fixture.sellerId)))
      .rejects.toMatchObject({ code: "ACTOR" });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("keeps browser, mobile access and refresh credential families separate with no authentication fallback", async () => {
    await setup();
    await mobile.enrollReservedTrade(enrollment());
    const before = await footprint();
    for (const accessToken of [fixture.buyerSessionToken, mobileAuth.sessions[fixture.buyerId].accessTokenHash,
      `atr_rt_v1.${"r".repeat(64)}`]) {
      await expect(mobile.acceptAmountCorrection({ ...acceptance(), accessToken })).rejects.toThrow();
    }
    await expect(web.acceptAmountCorrection({ ...webAcceptance(), sessionToken: credentials(fixture.buyerId).accessToken })).rejects.toThrow();
    await expect(mobile.acceptAmountCorrection({ ...acceptance(), metadata: { ...credentials(fixture.buyerId).metadata,
      deviceId: "different-synthetic-device-id" } })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects client-supplied authority, mixed credentials and financial fields before opening a transaction", async () => {
    await setup();
    let transactions = 0;
    const observed: WalletStore = { transaction: work => { transactions++; return store.transaction(work); }, close: async () => undefined };
    const boundary = createDevelopmentMobileMarketplaceWalletCoordinator({ mode: MODE, store: observed, clock });
    for (const extra of [{ actorUserId: fixture.ownerId }, { sessionToken: fixture.ownerSessionToken },
      { amount: "500" }, { metadata: { ...credentials(fixture.buyerId).metadata, role: "owner" } }]) {
      await expect(boundary.acceptAmountCorrection({ ...acceptance(), ...extra } as Parameters<typeof boundary.acceptAmountCorrection>[0]))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(transactions).toBe(0);
  }, TIMEOUT);

  it.each(["revoked", "expired", "disabled", "rotated"] as const)(
    "denies %s mobile credentials even when the historical acceptance is already committed and paused", async scenario => {
      await setup();
      const accepted = await acceptedAndPaused();
      const before = await footprint();
      const replacementToken = `atr_at_v1.${createHash("sha256").update("public-replacement-mobile-access").digest("base64url")}`;
      if (scenario === "expired") now = mobileAuth.expiresAtMs;
      else await store.transaction(async tx => {
        if (scenario === "revoked") await tx.query(`UPDATE alpha_exchange.mobile_device_sessions
          SET revoked_at=$2::timestamptz,revoke_reason='user_logout',updated_at=$2::timestamptz WHERE user_id=$1`,
        [fixture.buyerId, new Date(now).toISOString()]);
        if (scenario === "disabled") await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [fixture.buyerId]);
        if (scenario === "rotated") await tx.query(`UPDATE alpha_exchange.mobile_device_sessions
          SET access_token_hash=$2,refresh_token_hash=$3,refresh_generation=refresh_generation+1,updated_at=$4::timestamptz WHERE user_id=$1`,
        [fixture.buyerId, hash(replacementToken), hash("public-replacement-refresh"), new Date(now).toISOString()]);
      });
      await expect(mobile.acceptAmountCorrection({ ...acceptance(), operationId: "denied-historical-mobile-retry" })).rejects.toThrow();
      expect(await footprint()).toEqual(before);
      if (scenario === "rotated") {
        expect(await mobile.acceptAmountCorrection({ ...acceptance(), accessToken: replacementToken, operationId: "new-mobile-credential-recovery" }))
          .toEqual({ ...accepted, replayed: true });
        expect(await footprint()).toEqual(before);
      }
    }, TIMEOUT,
  );

  it("honors the current minimum mobile version on receipt recovery and never accepts a supplied role instead", async () => {
    await setup();
    await acceptedAndPaused();
    const before = await footprint();
    vi.stubEnv("MOBILE_MIN_IOS_VERSION", "999.0.0");
    await expect(mobile.acceptAmountCorrection(acceptance())).rejects.toThrow();
    await expect(mobile.inspect(inspection())).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    // The web path has its own authentication contract; a mobile version policy
    // does not revoke an otherwise valid stored browser session.
    expect(await web.acceptAmountCorrection(webAcceptance())).toMatchObject({ replayed: true, bindingRevision: 1 });
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["expiry", "logout", "account disable"] as const)(
    "rechecks %s after actual canonical persistence and rolls back the whole mobile acceptance", async change => {
      await setup();
      await mobile.enrollReservedTrade(enrollment());
      const before = await footprint(), beforeAuth = await authRows();
      let reachedPersistence = false;
      const fault = wrapped(tx => ({ exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          const result = await tx.query<Row>(sql, values);
          if (!reachedPersistence && /^update alpha_exchange\.runtime_meta set version/i.test(sql)) {
            reachedPersistence = true;
            if (change === "expiry") now = mobileAuth.expiresAtMs;
            if (change === "logout") await tx.query(`UPDATE alpha_exchange.mobile_device_sessions
              SET revoked_at=$2::timestamptz,revoke_reason='user_logout',updated_at=$2::timestamptz WHERE user_id=$1`,
            [fixture.buyerId, new Date(now).toISOString()]);
            if (change === "account disable") await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [fixture.buyerId]);
          }
          return result;
        },
      }));
      const boundary = createDevelopmentMobileMarketplaceWalletCoordinator({ mode: MODE, store: fault, clock });
      await expect(boundary.acceptAmountCorrection(acceptance())).rejects.toThrow();
      expect(reachedPersistence).toBe(true);
      expect(await footprint()).toEqual(before);
      expect(await authRows()).toEqual(beforeAuth);
      now = FIXTURE_TIME + 1000;
      expect(await mobile.acceptAmountCorrection(acceptance())).toMatchObject({ replayed: false, bindingRevision: 1 });
    }, TIMEOUT,
  );

  it("rolls back a real SQL error after the canonical request write and keeps the same mobile operation retryable", async () => {
    await setup();
    await mobile.enrollReservedTrade(enrollment());
    const before = await footprint();
    let failed = false;
    const broken = wrapped(tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        if (!failed && /^update alpha_exchange\.purchase_requests set payload/i.test(sql)) {
          failed = true;
          await tx.query("SELECT 1 / 0");
        }
        return result;
      },
    }));
    await expect(createDevelopmentMobileMarketplaceWalletCoordinator({ mode: MODE, store: broken, clock })
      .acceptAmountCorrection(acceptance())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(failed).toBe(true);
    expect(await footprint()).toEqual(before);
    expect(await mobile.acceptAmountCorrection(acceptance())).toMatchObject({ replayed: false, bindingRevision: 1 });
  }, TIMEOUT);

  it("recovers one real committed acceptance after a lost mobile reply without exposing credentials or repeating effects", async () => {
    await setup();
    await mobile.enrollReservedTrade(enrollment());
    let committed = false;
    const lostReply: WalletStore = { close: async () => undefined,
      async transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
        await store.transaction(work);
        committed = true;
        throw new CommitOutcomeUnknownError(new Error(`Synthetic acknowledgement loss ${credentials(fixture.buyerId).accessToken} ${credentials(fixture.buyerId).metadata.deviceId}`));
      },
    };
    let error: unknown;
    try {
      await createDevelopmentMobileMarketplaceWalletCoordinator({ mode: MODE, store: lostReply, clock })
        .acceptAmountCorrection(acceptance());
    } catch (failure) { error = failure; }
    expect(committed).toBe(true);
    expect(error).toBeInstanceOf(CommitOutcomeUnknownError);
    expect(error).toMatchObject({ code: "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" });
    noPrivateMetadata({ error: String(error), cause: String((error as Error).cause) });
    const before = await footprint();
    expect(before.acceptances).toHaveLength(1);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    const reopenedWeb = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store, clock });
    const recovered = await reopenedWeb.acceptAmountCorrection(webAcceptance());
    expect(recovered).toMatchObject({ replayed: true, bindingRevision: 1, principalDeltaRaw: "100000000" });
    expect(await footprint()).toEqual(before);
    noPrivateMetadata(recovered);
  }, TIMEOUT);

  it("exports the same private financial recovery unit through mobile owner authority while excluding every session family", async () => {
    await setup();
    await acceptedAndPaused();
    const before = await footprint();
    const serialized = await exportMobileMarketplaceWalletBackup({ mode: MODE, store, ...inspection(), clock });
    const browserSerialized = await exportMarketplaceWalletBackup({ mode: MODE, store, ...webInspection(), clock });
    expect(serialized).toBe(browserSerialized);
    expect(await footprint()).toEqual(before);
    const inspected = inspectMarketplaceWalletBackup(serialized);
    expect(inspected).toMatchObject({ halted: true, credentialsIncluded: false, commandCount: before.commands.length });
    noPrivateMetadata(inspected);
    const parsed = JSON.parse(serialized) as { canonical: Record<string, unknown> };
    for (const name of ["sessions", "mobile_device_sessions", "mobile_refresh_token_history"]) expect(parsed.canonical[name]).toBeUndefined();
    for (const { accessToken, metadata } of Object.values(mobileAuth.credentials)) {
      for (const secret of [accessToken, hash(accessToken), metadata.deviceId, hash(`device:${metadata.deviceId}`)]) {
        expect(serialized).not.toContain(secret);
      }
    }
    for (const session of Object.values(mobileAuth.sessions)) {
      expect(serialized).not.toContain(session.refreshTokenHash);
      expect(serialized).not.toContain(session.tokenFamilyId);
    }
    // The bundle remains private financial data: only inspection metadata is
    // safe to display. Auth exclusion does not turn bank instructions public.
    expect(serialized).toContain("sellerBankAccountSnapshot");
  }, TIMEOUT);

  it("requires a paused source and actual mobile owner authority before export", async () => {
    await setup();
    await mobile.enrollReservedTrade(enrollment());
    const before = await footprint();
    await expect(exportMobileMarketplaceWalletBackup({ mode: MODE, store, ...inspection(), clock })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    await mobile.pause({ ...inspection(), operationId: "pause-for-mobile-export" });
    const paused = await footprint();
    for (const userId of [fixture.buyerId, fixture.sellerId]) {
      await expect(exportMobileMarketplaceWalletBackup({ mode: MODE, store, ...inspection(userId), clock })).rejects.toThrow();
    }
    expect(await footprint()).toEqual(paused);
    expect(inspectMarketplaceWalletBackup(await exportMobileMarketplaceWalletBackup({ mode: MODE, store, ...inspection(), clock })).halted).toBe(true);
  }, TIMEOUT);

  it("rechecks mobile owner expiry after awaited backup capture and does not return financial bytes", async () => {
    await setup();
    await acceptedAndPaused();
    const before = await footprint();
    let historyReads = 0, expiredDuringCapture = false;
    const expires = wrapped(tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values);
        if (/FROM alpha_wallet_simulation\.commands\b/i.test(sql) && /ORDER BY revision\b/i.test(sql)) {
          historyReads++;
          if (historyReads === 2) { now = mobileAuth.expiresAtMs; expiredDuringCapture = true; }
        }
        return result;
      },
    }));
    await expect(exportMobileMarketplaceWalletBackup({ mode: MODE, store: expires, ...inspection(), clock }))
      .rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect(expiredDuringCapture).toBe(true);
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
});
