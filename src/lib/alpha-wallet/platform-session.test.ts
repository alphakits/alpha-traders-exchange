// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
import type { MobileDeviceSessionRecord, MobileDeviceSessionStore } from "@/lib/mobile-auth-store";

const requestContext = vi.hoisted(() => ({ token: null as string | null, cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: requestContext.cookies, headers: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database access is forbidden"); } }));

import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { createAuthSession, findUserByIdForAuthorization, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { requireMobileApiSession, requireMobileApiUser } from "@/lib/mobile-api-auth";
import { MobileAuthService } from "@/lib/mobile-auth";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";
import { createWalletAccess } from "./access";
import { applyWalletCommand, walletCommandKey, walletDigest, type WalletCommand } from "./commands";
import type { DurableWallet } from "./durable";
import { createAlphaWalletSandbox } from "./sandbox";
import { createDevelopmentMobileWalletResolver, createDevelopmentWebWalletResolver } from "./platform-session";

const NOW = "2026-11-04T12:00:00.000Z", NOW_MS = Date.parse(NOW), DEADLINE_MS = NOW_MS + 12_345;
const TOKEN = "isolated-wallet-cookie", USER_ID = "wallet-platform-seller";
const metadata = { deviceId: "550e8400-e29b-41d4-a716-446655440000", platform: "ios" as const, appVersion: "1.0.0", locale: "en" as const };
const intent = { type: "createDepositIntent", requestId: "platform-intent", input: { id: "platform-intent", assetId: "tron-sim-usdt", purpose: "principal" } };
let repository: AlphaExchangeRepository;
let sessionHash: string;

function account(): AlphaExchangeUser {
  return {
    id: USER_ID, email: "wallet-platform@example.test", fullName: "Wallet Platform Fixture", passwordHash: "private-fixture-password",
    whatsappNumber: "", role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller",
    emailVerified: true, verifiedPhone: "+15551234567", phoneVerifiedAt: NOW,
    ageEligibility: { method: "self_attestation_v1", confirmedAt: NOW },
    onlineStatus: "offline", availabilityStatus: "available", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "",
    createdAt: NOW, updatedAt: NOW,
  };
}
function storedAccount() { return globalThis.__alphaExchangeMemorySnapshot!.users[0]; }
function gateway(resolveUser: ReturnType<typeof createDevelopmentWebWalletResolver>) {
  const core = createAlphaWalletSandbox({ mode: "simulation-only" });
  let revision = 0;
  const execute = vi.fn(async (command: WalletCommand) => ({ revision: ++revision, commandKey: walletCommandKey(command), replayed: false,
    eventHash: walletDigest(command), result: applyWalletCommand(core, command) }));
  const wallet = { execute, snapshot: vi.fn(async () => ({ revision, eventHash: "0".repeat(64), state: core.snapshot() })), recoverPayouts: async () => [] } as unknown as DurableWallet;
  return { core, wallet, execute, access: createWalletAccess({ mode: "simulation-only", wallet, resolveUser }) };
}

async function mobileFixture() {
  let retained: MobileDeviceSessionRecord | null = null;
  const store: MobileDeviceSessionStore = {
    createOrReplace: async session => { retained = structuredClone(session); return structuredClone(session); },
    findByAccessTokenHash: vi.fn(async hash => retained?.accessTokenHash === hash ? structuredClone(retained) : null),
    // Refresh rotation is covered by mobile-auth.test.ts. This fixture exercises
    // real issue/validate/revoke/replace calls and never discovers a runtime pool.
    rotateByRefreshToken: async () => { throw new Error("Refresh rotation is outside this fixture"); },
    revokeByAccessTokenHash: async (hash, reason, now) => {
      if (retained?.accessTokenHash !== hash) return false;
      retained.revokedAt = now; retained.revokeReason = reason; return true;
    },
    revokeAllForUser: async (userId, reason, now) => {
      if (!retained || retained.userId !== userId || retained.revokedAt) return 0;
      retained.revokedAt = now; retained.revokeReason = reason; return 1;
    },
  };
  const service = new MobileAuthService(store);
  const issued = await service.issueSession(USER_ID, metadata);
  retained!.accessExpiresAt = new Date(DEADLINE_MS).toISOString();
  const request = new NextRequest("http://127.0.0.1/api/mobile/v1/wallet", { headers: { Authorization: `Bearer ${issued.tokens.accessToken}` } });
  const loadUser = vi.fn(findUserByIdForAuthorization);
  const options = { mode: "simulation-only" as const, request, requestId: "isolated-request", metadata, authentication: { service, loadUser } };
  return { service, store, issued, request, loadUser, options, session: () => retained!, resolve: createDevelopmentMobileWalletResolver(options) };
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED",
    "ALPHA_USDT_REQUESTS_ENABLED", "ALPHA_AGE_ELIGIBILITY_TEST_REQUIRED", "PHOTO_VERIFICATION_BYPASS_EMAILS", "MOBILE_MIN_IOS_VERSION", "MOBILE_MIN_ANDROID_VERSION"]) vi.stubEnv(key, undefined);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW));
  const seed = {
    users: [account()], authSessions: [], sellerApplications: [], marketplaceListings: [], purchaseRequests: [],
    commissionRecords: [], auditLogs: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [],
    sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [],
    privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    __runtimeVersion: 1,
  } satisfies AlphaExchangeDb & { __runtimeVersion: number };
  globalThis.__alphaExchangeMemorySnapshot = seed as never;
  repository = new AlphaExchangeRepository(null);
  globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
  invalidateAlphaExchangeStoreCache();
  const storedSession = await createAuthSession(USER_ID, TOKEN);
  sessionHash = storedSession.token;
  await repository.upsertAuthSession({ ...storedSession, expiresAt: new Date(DEADLINE_MS).toISOString() });
  requestContext.token = TOKEN;
  requestContext.cookies.mockReset().mockImplementation(async () => ({
    get: (name: string) => name === AUTH_COOKIE_NAME && requestContext.token ? { value: requestContext.token } : undefined,
  }));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  invalidateAlphaExchangeStoreCache();
});

describe("development wallet resolves actual web authentication evidence", () => {
  it("uses the server cookie and real retained expiry, projects minimal evidence, and supplies the actor to the real gateway", async () => {
    const read = vi.spyOn(repository, "loadAuthenticatedSessionSnapshot");
    const resolve = createDevelopmentWebWalletResolver({ mode: "simulation-only" });
    const resolved = await resolve();
    expect(resolved).toEqual({ id: USER_ID, role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller",
      disabled: false, emailVerified: true, phoneAccessAllowed: true, adultConfirmed: true, sessionExpiresAtMs: DEADLINE_MS });
    expect(read).toHaveBeenCalledWith(sessionHash, { requireFresh: true });
    expect(requestContext.cookies).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(resolved)).not.toMatch(/private-fixture|example\.test|15551234567|isolated-wallet-cookie/);
    (resolved!.roles as string[]).push("owner");
    expect((await resolve())!.roles).not.toContain("owner");
    const f = gateway(resolve);
    const accepted = await f.access.execute(intent);
    expect(f.execute.mock.calls[0][0].actor).toEqual({ kind: "seller", id: USER_ID });
    expect(accepted.view.depositIntents).toHaveLength(1);
    expect(accepted.view.userId).toBe(USER_ID);
  });

  it("does not read account storage without the authentication cookie", async () => {
    requestContext.token = null;
    const read = vi.spyOn(repository, "loadAuthenticatedSessionSnapshot");
    expect(await createDevelopmentWebWalletResolver({ mode: "simulation-only" })()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [{ disabled: true }, "WALLET_ACCOUNT_DISABLED"],
    [{ sellerStatus: "suspended" }, "WALLET_ROLE_REQUIRED"],
    [{ emailVerified: false }, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    [{ verifiedPhone: undefined, phoneVerifiedAt: undefined }, "WALLET_PHONE_VERIFICATION_REQUIRED"],
    [{ ageEligibility: undefined }, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
  ] as const)("enforces canonical account evidence %j without executing", async (change, code) => {
    Object.assign(storedAccount(), change);
    // Neither runtime gate skipping nor the development photo bypass is evidence.
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", account().email);
    const f = gateway(createDevelopmentWebWalletResolver({ mode: "simulation-only" }));
    await expect(f.access.execute(intent)).rejects.toThrow(code);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("uses the existing exact-account phone exemption rather than an email-only or role claim", async () => {
    const exemptId = "user-6f3a0120-5d36-423f-8dee-9a875e8e064e";
    Object.assign(storedAccount(), { id: exemptId, email: "claudiahttps11@gmail.com", verifiedPhone: undefined, phoneVerifiedAt: undefined });
    const issued = await createAuthSession(exemptId, "exact-exempt-cookie");
    requestContext.token = "exact-exempt-cookie";
    const resolve = createDevelopmentWebWalletResolver({ mode: "simulation-only" });
    expect(await resolve()).toMatchObject({ id: exemptId, phoneAccessAllowed: true, sessionExpiresAtMs: Date.parse(issued.expiresAt) });
    storedAccount().id = "recreated-account";
    await createAuthSession("recreated-account", "recreated-cookie"); requestContext.token = "recreated-cookie";
    expect(await resolve()).toMatchObject({ id: "recreated-account", phoneAccessAllowed: false });
  });

  it.each(["revocation", "expiry"] as const)("withholds private data after %s during the wallet read", async change => {
    const read = vi.spyOn(repository, "loadAuthenticatedSessionSnapshot");
    const f = gateway(createDevelopmentWebWalletResolver({ mode: "simulation-only" }));
    vi.spyOn(f.wallet, "snapshot").mockImplementationOnce(async () => {
      if (change === "revocation") await repository.deleteAuthSession(sessionHash);
      else vi.setSystemTime(new Date(DEADLINE_MS));
      return { revision: 0, eventHash: "0".repeat(64), state: f.core.snapshot() };
    });
    await expect(f.access.read()).rejects.toThrow("WALLET_SESSION_REQUIRED");
    expect(read).toHaveBeenCalledTimes(2);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("propagates a failed final authorization read without executing or reusing the first account", async () => {
    const actualRead = repository.loadAuthenticatedSessionSnapshot.bind(repository);
    vi.spyOn(repository, "loadAuthenticatedSessionSnapshot").mockImplementationOnce(actualRead).mockRejectedValueOnce(new Error("isolated auth read unavailable"));
    const f = gateway(createDevelopmentWebWalletResolver({ mode: "simulation-only" }));
    await expect(f.access.execute(intent)).rejects.toThrow("isolated auth read unavailable");
    expect(f.execute).not.toHaveBeenCalled();
  });
});

describe("development wallet resolves real mobile token lifecycle metadata", () => {
  it("retains the stored access deadline and keeps the old mobile API result shape exact", async () => {
    const f = await mobileFixture();
    const context = await requireMobileApiSession(f.request, "context", metadata, f.service, f.loadUser);
    expect(context).toMatchObject({ session: { id: f.issued.session.id, userId: USER_ID, accessExpiresAt: new Date(DEADLINE_MS).toISOString() } });
    const legacy = await requireMobileApiUser(f.request, "legacy", metadata, f.service);
    expect(Object.keys(legacy).sort()).toEqual(["accessToken", "unauthorized", "user"]);
    expect(await f.resolve()).toMatchObject({ id: USER_ID, phoneAccessAllowed: true, adultConfirmed: true, sessionExpiresAtMs: DEADLINE_MS });
    expect(f.session().refreshExpiresAt).not.toBe(new Date(DEADLINE_MS).toISOString());
  });

  it.each(["device", "revoked", "expiry"] as const)("rejects %s before loading the account", async change => {
    const f = await mobileFixture();
    if (change === "device") f.session().deviceIdHash = "another-device-hash";
    if (change === "revoked") await f.service.revokeDevice(f.issued.tokens.accessToken);
    if (change === "expiry") vi.setSystemTime(new Date(DEADLINE_MS));
    expect(await f.resolve()).toBeNull();
    expect(f.loadUser).not.toHaveBeenCalled();
  });

  it("fails closed on malformed retained access expiry instead of substituting refresh expiry", async () => {
    const f = await mobileFixture(); f.session().accessExpiresAt = "not-a-date";
    expect(await f.resolve()).toBeNull();
  });

  it("preserves the existing disabled-account revocation and enforces canonical seller suspension", async () => {
    const disabled = await mobileFixture(); storedAccount().disabled = true;
    expect(await disabled.resolve()).toBeNull();
    expect(await disabled.service.validateAccessToken(disabled.issued.tokens.accessToken, metadata.deviceId)).toEqual({ status: "revoked" });
    storedAccount().disabled = false; storedAccount().sellerStatus = "suspended";
    const suspended = await mobileFixture(), f = gateway(suspended.resolve);
    await expect(f.access.execute(intent)).rejects.toThrow("WALLET_ROLE_REQUIRED");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("rejects an account loader that resolves a different subject", async () => {
    const f = await mobileFixture(); f.loadUser.mockResolvedValue({ ...account(), id: "unrelated-account" });
    expect(await f.resolve()).toBeNull();
  });

  it.each(["revoke", "replace", "expire"] as const)("revalidates the access session when it can %s during account loading", async change => {
    const f = await mobileFixture();
    f.loadUser.mockImplementationOnce(async userId => {
      const user = await findUserByIdForAuthorization(userId);
      if (change === "revoke") await f.service.revokeDevice(f.issued.tokens.accessToken);
      if (change === "replace") await f.service.issueSession(USER_ID, metadata);
      if (change === "expire") vi.setSystemTime(new Date(DEADLINE_MS));
      return user;
    });
    expect(await f.resolve()).toBeNull();
    expect(f.store.findByAccessTokenHash).toHaveBeenCalledTimes(2);
  });

  it("propagates unavailable account/session reads without revoking valid credentials", async () => {
    const f = await mobileFixture(); f.loadUser.mockRejectedValueOnce(new Error("isolated account unavailable"));
    await expect(f.resolve()).rejects.toThrow("isolated account unavailable");
    expect(f.session().revokedAt).toBeNull();
    expect(await f.service.validateAccessToken(f.issued.tokens.accessToken, metadata.deviceId)).toMatchObject({ status: "valid" });
    vi.mocked(f.store.findByAccessTokenHash).mockRejectedValueOnce(new Error("isolated session unavailable"));
    await expect(f.resolve()).rejects.toThrow("isolated session unavailable");
    expect(f.session().revokedAt).toBeNull();
  });
});

describe("platform identity integration remains development-only", () => {
  it("checks runtime opt-in before auth and again after an asynchronous auth read", async () => {
    const web = createDevelopmentWebWalletResolver({ mode: "simulation-only" }), mobile = await mobileFixture();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createDevelopmentWebWalletResolver({ mode: "simulation-only" })).toThrow(/local/);
    await expect(web()).rejects.toThrow(/local/);
    await expect(mobile.resolve()).rejects.toThrow(/local/);
    expect(requestContext.cookies).not.toHaveBeenCalled();
    expect(mobile.loadUser).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test");
    requestContext.cookies.mockImplementationOnce(async () => {
      vi.stubEnv("VERCEL", "1");
      return { get: () => ({ value: TOKEN }) };
    });
    await expect(web()).rejects.toThrow(/hosted/);
  });
});
