// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWalletAccess, withdrawalTermsDigest, type ResolvedWalletUser, type WithdrawalApproval } from "./access";
import { applyWalletCommand, walletCommandKey, walletDigest, type WalletCommand } from "./commands";
import { type DurableWallet } from "./durable";
import { createAlphaWalletSandbox, simulatedDestination } from "./sandbox";
import { BUYER, SELLER, VERIFIER, FIXTURE_TIME, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { balance } from "./ledger";

// These tests exercise authorization and privacy against the real domain engine.
// Storage atomicity/restarts are covered separately by the durable repository suite.
function fixture() {
  let now = FIXTURE_TIME;
  const core = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => FIXTURE_TIME });
  let revision = 0;
  const execute = vi.fn(async (command: WalletCommand) => ({ revision: ++revision, commandKey: walletCommandKey(command), replayed: false,
    eventHash: walletDigest(command), result: applyWalletCommand(core, command) }));
  const wallet = { execute, snapshot: async () => ({ revision, eventHash: "0".repeat(64), state: core.snapshot() }), recoverPayouts: async () => [] } as unknown as DurableWallet;
  let user: ResolvedWalletUser | null = {
    id: SELLER.id, role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller", disabled: false,
    emailVerified: true, phoneAccessAllowed: true, adultConfirmed: true, sessionExpiresAtMs: FIXTURE_TIME + 60_000,
  };
  const resolveUser = vi.fn(async () => user ? structuredClone(user) : null);
  let approval: WithdrawalApproval | null = null;
  const verifyWithdrawalApproval = vi.fn(async () => approval ? structuredClone(approval) : null);
  const gateway = createWalletAccess({ mode: "simulation-only", wallet, resolveUser, verifyWithdrawalApproval, clock: () => now });
  return { core, wallet, execute, gateway, resolveUser, verifyWithdrawalApproval, model: durableFixture(wallet),
    user: () => user!, setUser: (next: ResolvedWalletUser | null) => { user = next; }, setTime: (at: number) => { now = at; }, setApproval: (next: WithdrawalApproval | null) => { approval = next; } };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());
const createIntent = { type: "createDepositIntent", requestId: "intent-request", input: { id: "intent", assetId: TRON, purpose: "principal" } };

describe("server-resolved wallet access", () => {
  it.each([
    ["disabled", true, "WALLET_ACCOUNT_DISABLED"], ["emailVerified", false, "WALLET_EMAIL_VERIFICATION_REQUIRED"],
    ["phoneAccessAllowed", false, "WALLET_PHONE_VERIFICATION_REQUIRED"], ["adultConfirmed", false, "WALLET_ADULT_CONFIRMATION_REQUIRED"],
    ["sessionExpiresAtMs", FIXTURE_TIME, "WALLET_SESSION_REQUIRED"],
  ])("denies %s without executing a financial command", async (field, value, code) => {
    const f = fixture(); f.setUser({ ...f.user(), [field]: value });
    await expect(f.gateway.execute(createIntent)).rejects.toThrow(String(code));
    await expect(f.gateway.read()).rejects.toThrow(String(code));
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("denies absent sessions and propagates unavailable account reads without falling back", async () => {
    const f = fixture(); f.setUser(null);
    await expect(f.gateway.execute(createIntent)).rejects.toThrow("WALLET_SESSION_REQUIRED");
    f.resolveUser.mockRejectedValueOnce(new Error("account temporarily unavailable"));
    await expect(f.gateway.read()).rejects.toThrow("account temporarily unavailable");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("derives the actor from the server and rejects body role, identity, service commands and synthetic step-up bypasses", async () => {
    const f = fixture();
    await expect(f.gateway.execute({ ...createIntent, actor: { kind: "operator", id: "attacker" } })).rejects.toThrow();
    await expect(f.gateway.execute({ ...createIntent, userId: "another-user" })).rejects.toThrow();
    for (const type of ["observeDeposit", "verifyPayment", "queueRelease", "beginDispatch", "recordSubmission", "confirmPayout", "reconcileAsset", "setNativeFeeReadiness"]) {
      await expect(f.gateway.execute({ type, requestId: "forged", input: null })).rejects.toThrow();
    }
    await expect(f.gateway.execute({ type: "requestWithdrawal", requestId: "forged-stepup", input: { id: "withdrawal", assetId: TRON, amount: "1", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-forged" } })).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
    const accepted = await f.gateway.execute(createIntent);
    expect(accepted.view.depositIntents[0].destination).toContain("intent");
    expect(f.execute.mock.calls[0][0].actor).toEqual(SELLER);
  });
  it("ignores stale seller roles when canonical seller approval is suspended", async () => {
    const f = fixture(); f.setUser({ ...f.user(), sellerStatus: "suspended" });
    await expect(f.gateway.execute(createIntent)).rejects.toThrow("WALLET_ROLE_REQUIRED");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("requires an actual buyer role instead of a default sellerStatus marker", async () => {
    const f = fixture(); f.setUser({ ...f.user(), role: "guest", roles: ["guest"], sellerStatus: "buyer" });
    await expect(f.gateway.execute({ type: "reserveTrade", requestId: "buy", input: { id: "trade", listingId: "listing", amount: "10", destination: simulatedDestination(TRON, BUYER.id) } })).rejects.toThrow("WALLET_ROLE_REQUIRED");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("limits financial operator actions to owner and never turns owner into a payout verifier", async () => {
    const f = fixture(); f.setUser({ ...f.user(), role: "admin", roles: ["admin"] });
    await expect(f.gateway.execute({ type: "pause", requestId: "pause", input: null })).rejects.toThrow("WALLET_ROLE_REQUIRED");
    f.setUser({ ...f.user(), role: "owner", roles: ["owner"] });
    await f.gateway.execute({ type: "pause", requestId: "pause", input: null });
    expect(f.core.snapshot().haltReason).not.toBeNull();
    await expect(f.gateway.execute({ type: "verifyPayment", requestId: "bypass", input: {} })).rejects.toThrow();
  });
  it("re-resolves permissions before execution and detects account revocation during a request", async () => {
    const f = fixture();
    f.resolveUser.mockResolvedValueOnce(f.user()).mockResolvedValueOnce({ ...f.user(), disabled: true });
    await expect(f.gateway.execute(createIntent)).rejects.toThrow("WALLET_ACCOUNT_DISABLED");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("withholds a private read if authorization is revoked while storage is loading", async () => {
    const f = fixture();
    const original = f.wallet.snapshot.bind(f.wallet);
    vi.spyOn(f.wallet, "snapshot").mockImplementationOnce(async () => {
      f.setUser({ ...f.user(), disabled: true }); return original();
    });
    await expect(f.gateway.read()).rejects.toThrow("WALLET_ACCOUNT_DISABLED");
  });
  it("reports a committed request without exposing private state when authorization changes after commit", async () => {
    const f = fixture();
    const original = f.wallet.snapshot.bind(f.wallet);
    vi.spyOn(f.wallet, "snapshot").mockImplementationOnce(async () => {
      f.setUser({ ...f.user(), disabled: true }); return original();
    });
    await expect(f.gateway.execute(createIntent)).rejects.toMatchObject({ code: "WALLET_COMMITTED_RESPONSE_UNAVAILABLE", committed: true, requestId: createIntent.requestId, revision: 1 });
    expect(f.core.snapshot().depositIntents.size).toBe(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects guessed trade IDs and keeps buyer payment claims separate from verification", async () => {
    const f = fixture(); const listing = await f.model.fundedListing();
    const trade = (await f.model.command("reserveTrade", BUYER, { id: "trade", listingId: listing, amount: "200", destination: simulatedDestination(TRON, BUYER.id) })).result;
    f.setUser({ ...f.user(), id: "unrelated-buyer", role: "buyer", roles: ["buyer"], sellerStatus: "buyer" });
    await expect(f.gateway.execute({ type: "openDispute", requestId: "guess", input: trade.id })).rejects.toThrow("WALLET_TRADE_ACCESS_DENIED");
    f.setUser({ ...f.user(), id: BUYER.id });
    await f.gateway.execute({ type: "markBuyerPaid", requestId: "paid", input: trade.id });
    expect(f.core.getTrade(trade.id).status).toBe("payment_reported");
    await expect(f.gateway.execute({ type: "authorizeRelease", requestId: "release", input: trade.id })).rejects.toThrow("WALLET_ROLE_REQUIRED");
  });
});

describe("private wallet projections and withdrawal approval", () => {
  it("reveals only the user's balances/trades/deposit destinations and never raw evidence or provider references", async () => {
    const f = fixture(), payout = await f.model.queuedTrade();
    const own = await f.gateway.read();
    expect(own.payouts).toHaveLength(1); expect(own.trades).toHaveLength(1); expect(own.depositIntents).toHaveLength(1);
    const serial = JSON.stringify(own);
    for (const hidden of ["providerReference", "evidenceReference", "idempotency", "journal", "sim-evidence-", "authorization", "sim-payout-"]) expect(serial).not.toContain(hidden);
    f.setUser({ ...f.user(), id: "another-seller" });
    const other = await f.gateway.read();
    expect(other.trades).toEqual([]); expect(other.payouts).toEqual([]); expect(other.depositIntents).toEqual([]);
    expect(other.balances.every(b => b.availablePrincipalRaw === "0" && b.commissionFundsRaw === "0")).toBe(true);
    expect(JSON.stringify(other)).not.toContain(payout.destination);
    expect(other.marketplace).toHaveLength(1);
  });
  it("does not leak verification metadata through a successful mutation response", async () => {
    const f = fixture(), listing = await f.model.fundedListing();
    const trade = (await f.model.command("reserveTrade", BUYER, { id: "private", listingId: listing, amount: "100", destination: simulatedDestination(TRON, BUYER.id) })).result;
    await f.model.command("markBuyerPaid", BUYER, trade.id);
    await f.model.command("verifyPayment", VERIFIER, { tradeId: trade.id, evidence: { reference: "sim-evidence-bank-private", currency: "ILS", kind: "simulated-bank-credit", amountMinor: trade.fiatTotalMinor.toString() } });
    const response = await f.gateway.execute({ type: "authorizeRelease", requestId: "authorize", input: trade.id });
    expect(response.view.trades[0].status).toBe("release_authorized");
    expect(JSON.stringify(response)).not.toContain("sim-evidence-bank-private");
    expect(response).not.toHaveProperty("result");
  });
  it("requires a current exact-terms server-verified withdrawal approval and prevents its reuse for another payout", async () => {
    const f = fixture(); await f.model.deposit("100"); await f.model.ready();
    const terms = { id: "withdrawal-a", assetId: TRON, amount: "25", destination: simulatedDestination(TRON, SELLER.id) };
    const request = { type: "requestWithdrawal", requestId: "withdraw", input: { ...terms, approvalToken: "opaque-fixture-proof" } };
    await expect(f.gateway.execute(request)).rejects.toThrow("WALLET_WITHDRAWAL_APPROVAL_INVALID");
    const proof = { reference: "approved-proof", userId: SELLER.id, termsDigest: withdrawalTermsDigest(SELLER.id, terms), verifiedAtMs: FIXTURE_TIME - 10_000, expiresAtMs: FIXTURE_TIME + 30_000 };
    for (const change of [{ userId: "other-user" }, { expiresAtMs: FIXTURE_TIME }, { verifiedAtMs: FIXTURE_TIME + 1 }, { verifiedAtMs: FIXTURE_TIME - 300_001 }, { termsDigest: "0".repeat(64) }]) {
      f.setApproval({ ...proof, ...change });
      await expect(f.gateway.execute(request)).rejects.toThrow("WALLET_WITHDRAWAL_APPROVAL_INVALID");
    }
    f.setApproval(proof);
    for (const change of [{ id: "withdrawal-b" }, { amount: "26" }, { destination: simulatedDestination(TRON, "other-recipient") }]) {
      await expect(f.gateway.execute({ ...request, input: { ...request.input, ...change } })).rejects.toThrow("WALLET_WITHDRAWAL_APPROVAL_INVALID");
    }
    const accepted = await f.gateway.execute(request);
    expect(accepted.view.payouts[0].principalRaw).toBe("25000000");
    expect(balance(f.core.snapshot(), TRON, `available:${SELLER.id}`)).toBe(BigInt(75_000_000));
    await f.gateway.execute(request);
    expect(f.core.snapshot().payouts.size).toBe(1);
    expect(JSON.stringify(accepted)).not.toContain("opaque-fixture-proof");
    expect(withdrawalTermsDigest(SELLER.id, { ...terms, amount: "25.00" })).toBe(proof.termsDigest);
  });
  it("rejects a withdrawal approval that expires during the final account lookup", async () => {
    const f = fixture(); await f.model.deposit("100"); await f.model.ready();
    const terms = { id: "slow-withdrawal", assetId: TRON, amount: "25", destination: simulatedDestination(TRON, SELLER.id) };
    f.setApproval({ reference: "slow-proof", userId: SELLER.id, termsDigest: withdrawalTermsDigest(SELLER.id, terms), verifiedAtMs: FIXTURE_TIME, expiresAtMs: FIXTURE_TIME + 100 });
    f.resolveUser.mockResolvedValueOnce(f.user()).mockImplementationOnce(async () => { f.setTime(FIXTURE_TIME + 101); return structuredClone(f.user()); });
    f.execute.mockClear();
    await expect(f.gateway.execute({ type: "requestWithdrawal", requestId: "slow", input: { ...terms, approvalToken: "opaque-proof" } })).rejects.toThrow("WALLET_WITHDRAWAL_APPROVAL_INVALID");
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.core.snapshot().payouts.size).toBe(0);
  });
  it("keeps production and hosted runtimes disabled", async () => {
    const f = fixture(); vi.stubEnv("NODE_ENV", "production");
    await expect(f.gateway.read()).rejects.toThrow(); await expect(f.gateway.execute(createIntent)).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  });
});
