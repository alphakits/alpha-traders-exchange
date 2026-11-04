import { z } from "zod";
import { assetFor, parseUnits, SANDBOX_ASSETS, type AssetId } from "./amounts";
import { parseWalletCommand, walletDigest, WALLET_ENGINE_VERSION } from "./commands";
import { type DurableWallet } from "./durable";
import { balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { Actor, State } from "./types";

/** Supplied by a trusted server session/account resolver, NEVER request JSON. */
export type ResolvedWalletUser = {
  id: string; role: string; roles?: readonly string[]; sellerStatus: string;
  disabled: boolean; emailVerified: boolean; phoneAccessAllowed: boolean; adultConfirmed: boolean;
  sessionExpiresAtMs: number;
};
export type WithdrawalApproval = {
  reference: string; userId: string; termsDigest: string; verifiedAtMs: number; expiresAtMs: number;
};
export class WalletAccessError extends Error {
  readonly status: number;
  constructor(readonly code: string, status = 403) { super(code); this.name = "WalletAccessError"; this.status = status; }
}
/** The financial command committed; only its private response became unavailable. */
export class WalletCommittedResponseError extends WalletAccessError {
  readonly committed = true;
  constructor(readonly requestId: string, readonly revision: number) {
    super("WALLET_COMMITTED_RESPONSE_UNAVAILABLE", 409); this.name = "WalletCommittedResponseError";
  }
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const publicTypes = ["createDepositIntent", "createListing", "closeListing", "reserveTrade", "markBuyerPaid", "authorizeRelease",
  "cancelTrade", "openDispute", "requestWithdrawal", "approveListing", "pause"] as const;
const publicRequest = z.strictObject({ type: z.enum(publicTypes), requestId: id, input: z.unknown() });
const withdrawalInput = z.strictObject({ id, assetId: z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]),
  amount: z.string().min(1).max(100), destination: z.string().min(1).max(250), approvalToken: z.string().min(1).max(2048) });
const approvalSchema = z.strictObject({ reference: id, userId: id, termsDigest: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });

function roles(user: ResolvedWalletUser) { return new Set([user.role, ...(user.roles ?? [])]); }
function requireRole(condition: boolean) { if (!condition) throw new WalletAccessError("WALLET_ROLE_REQUIRED"); }
function assertUser(user: ResolvedWalletUser | null, now: number): asserts user is ResolvedWalletUser {
  if (!user || !id.safeParse(user.id).success || !Number.isSafeInteger(user.sessionExpiresAtMs) || user.sessionExpiresAtMs <= now) throw new WalletAccessError("WALLET_SESSION_REQUIRED", 401);
  if (user.disabled !== false) throw new WalletAccessError("WALLET_ACCOUNT_DISABLED");
  if (user.emailVerified !== true) throw new WalletAccessError("WALLET_EMAIL_VERIFICATION_REQUIRED");
  if (user.phoneAccessAllowed !== true) throw new WalletAccessError("WALLET_PHONE_VERIFICATION_REQUIRED");
  if (user.adultConfirmed !== true) throw new WalletAccessError("WALLET_ADULT_CONFIRMATION_REQUIRED");
}
function safeTime(now: number) { if (!Number.isSafeInteger(now) || now < 0) throw new WalletAccessError("WALLET_CLOCK_INVALID", 503); return now; }
function assertApprovalFresh(proof: WithdrawalApproval, now: number) {
  if (proof.verifiedAtMs > now || now - proof.verifiedAtMs > 300_000 || proof.expiresAtMs <= now || proof.expiresAtMs <= proof.verifiedAtMs) {
    throw new WalletAccessError("WALLET_WITHDRAWAL_APPROVAL_INVALID");
  }
}
export function withdrawalTermsDigest(userId: string, input: { id: string; assetId: AssetId; amount: string; destination: string }) {
  id.parse(userId); id.parse(input.id);
  const asset = assetFor(input.assetId), raw = parseUnits(input.amount, asset.decimals);
  if (raw <= BigInt(0) || !new RegExp(`^sim://${input.assetId}/recipient/[A-Za-z0-9_-]{1,80}$`).test(input.destination)) throw new WalletAccessError("WALLET_WITHDRAWAL_TERMS_INVALID", 400);
  return walletDigest({ userId, withdrawalId: input.id, assetId: input.assetId, amountRaw: raw.toString(), destination: input.destination });
}

function project(state: State, user: ResolvedWalletUser) {
  const listingView = (item: State["listings"] extends Map<string, infer T> ? T : never) => {
    const availableRaw = balance(state, item.assetId, `listing:${item.id}`);
    return { id: item.id, sellerId: item.sellerId, assetId: item.assetId, principalRaw: item.amountRaw.toString(), availableRaw: availableRaw.toString(),
      price: item.price, currency: item.currency, status: item.closed ? "closed" : !item.funded ? "awaiting_funding" : !item.approved ? "awaiting_owner_approval" : availableRaw > BigInt(0) ? "active" : "no_available_inventory" };
  };
  const ownTrades = [...state.trades.values()].filter(t => t.sellerId === user.id || t.buyerId === user.id);
  const tradeIds = new Set(ownTrades.map(t => t.id));
  return {
    simulationOnly: true as const, paused: Boolean(state.haltReason), userId: user.id,
    balances: Object.keys(SANDBOX_ASSETS).map(assetId => ({ assetId, availablePrincipalRaw: balance(state, assetId as AssetId, `available:${user.id}`).toString(), commissionFundsRaw: balance(state, assetId as AssetId, `commission:${user.id}`).toString() })),
    depositIntents: [...state.depositIntents.values()].filter(d => d.sellerId === user.id).map(d => ({ id: d.id, assetId: d.assetId, destination: d.destination, purpose: d.purpose })),
    listings: [...state.listings.values()].filter(l => l.sellerId === user.id).map(listingView),
    marketplace: [...state.listings.values()].filter(l => !l.closed && l.approved && l.funded && balance(state, l.assetId, `listing:${l.id}`) > BigInt(0)).map(listingView),
    trades: ownTrades.map(t => ({ id: t.id, listingId: t.listingId, sellerId: t.sellerId, buyerId: t.buyerId, assetId: t.assetId,
      principalRaw: t.amountRaw.toString(), buyerFeeRaw: t.buyerFeeRaw.toString(), fiatTotalMinor: t.fiatTotalMinor.toString(), currency: t.currency,
      destination: t.destination, status: t.status, disputed: t.disputed, payoutId: t.payoutId ?? null })),
    payouts: [...state.payouts.values()].filter(p => p.sellerId === user.id || (p.tradeId && tradeIds.has(p.tradeId))).map(p => ({
      id: p.id, assetId: p.assetId, kind: p.kind, tradeId: p.tradeId ?? null, principalRaw: p.amountRaw.toString(), destination: p.destination,
      state: p.state, transactionId: p.transactionId ?? null,
    })),
    commissions: [...state.commissions.values()].filter(c => c.sellerId === user.id).map(c => ({ tradeId: c.tradeId, assetId: c.assetId, amountRaw: c.amountRaw.toString(), paid: c.paid })),
  };
}

/**
 * Development HTTP adapter boundary. It does not authenticate a session itself.
 * The injected resolver must derive fresh account/verification data from trusted
 * web/mobile auth. The approval verifier must validate a real step-up proof in a
 * later integration; no client-provided boolean/reference is accepted here.
 */
export function createWalletAccess(options: {
  mode: "simulation-only"; wallet: DurableWallet; resolveUser: () => Promise<ResolvedWalletUser | null>;
  verifyWithdrawalApproval?: (token: string) => Promise<WithdrawalApproval | null>; clock?: () => number;
}) {
  assertSimulationRuntime(options.mode);
  const clock = options.clock ?? Date.now;
  async function currentUser() {
    assertSimulationRuntime(options.mode);
    const user = await options.resolveUser();
    assertUser(user, safeTime(clock()));
    return structuredClone(user);
  }
  async function assertSameUser(user: ResolvedWalletUser) {
    const fresh = await currentUser();
    if (walletDigest(fresh) !== walletDigest(user)) throw new WalletAccessError("WALLET_AUTHORIZATION_CHANGED");
  }
  return Object.freeze({
    async read() {
      const user = await currentUser(), snapshot = await options.wallet.snapshot();
      await assertSameUser(user);
      return { revision: snapshot.revision, ...project(snapshot.state, user) };
    },
    async execute(input: unknown) {
      const user = await currentUser(), request = publicRequest.parse(input), grants = roles(user);
      const owner = grants.has("owner"), administration = owner || grants.has("admin");
      const buyer = administration || grants.has("buyer");
      // Canonical suspended/rejected status wins over stale seller labels.
      const seller = administration || user.sellerStatus === "approved_seller";
      let actor: Actor;
      let body = request.input;
      let withdrawalApproval: WithdrawalApproval | undefined;
      if (["createDepositIntent", "createListing", "closeListing", "authorizeRelease", "requestWithdrawal"].includes(request.type)) {
        requireRole(seller); actor = { kind: "seller", id: user.id };
      } else if (["reserveTrade", "markBuyerPaid"].includes(request.type)) {
        requireRole(buyer); actor = { kind: "buyer", id: user.id };
      } else if (request.type === "approveListing" || request.type === "pause") {
        requireRole(owner); actor = { kind: "operator", id: user.id };
      } else {
        const tradeId = id.parse(request.input), trade = (await options.wallet.snapshot()).state.trades.get(tradeId);
        if (request.type === "openDispute" && owner) actor = { kind: "operator", id: user.id };
        else if (trade?.sellerId === user.id) { requireRole(seller); actor = { kind: "seller", id: user.id }; }
        else if (trade?.buyerId === user.id) { requireRole(buyer); actor = { kind: "buyer", id: user.id }; }
        else throw new WalletAccessError("WALLET_TRADE_ACCESS_DENIED");
      }
      if (request.type === "markBuyerPaid" || request.type === "authorizeRelease") {
        const trade = (await options.wallet.snapshot()).state.trades.get(id.parse(request.input));
        if (!trade || (request.type === "markBuyerPaid" ? trade.buyerId : trade.sellerId) !== user.id) throw new WalletAccessError("WALLET_TRADE_ACCESS_DENIED");
      }
      if (request.type === "closeListing") {
        const listing = (await options.wallet.snapshot()).state.listings.get(id.parse(request.input));
        if (!listing || listing.sellerId !== user.id) throw new WalletAccessError("WALLET_LISTING_ACCESS_DENIED");
      }
      if (request.type === "requestWithdrawal") {
        const parsed = withdrawalInput.parse(request.input), verifier = options.verifyWithdrawalApproval;
        if (!verifier) throw new WalletAccessError("WALLET_WITHDRAWAL_APPROVAL_REQUIRED");
        const proof = approvalSchema.safeParse(await verifier(parsed.approvalToken)), now = safeTime(clock());
        const digest = withdrawalTermsDigest(user.id, parsed);
        if (!proof.success || proof.data.userId !== user.id || proof.data.termsDigest !== digest) {
          throw new WalletAccessError("WALLET_WITHDRAWAL_APPROVAL_INVALID");
        }
        assertApprovalFresh(proof.data, now);
        withdrawalApproval = proof.data;
        const { approvalToken: _token, ...terms } = parsed;
        body = { ...terms, stepUpReference: `sim-stepup-${proof.data.reference}` };
      }
      const command = parseWalletCommand({ version: 1, engineVersion: WALLET_ENGINE_VERSION, type: request.type,
        actor, requestId: request.requestId, input: body });
      // Re-resolve after asynchronous authorization work to detect account/session
      // revocation during this request. The actual deployment must bind its auth
      // and finance consistency model; this adapter does not invent that guarantee.
      await assertSameUser(user);
      // Account resolution may be slow. Expiry is checked again after that await.
      if (withdrawalApproval) assertApprovalFresh(withdrawalApproval, safeTime(clock()));
      const committed = await options.wallet.execute(command);
      try {
        const snapshot = await options.wallet.snapshot();
        await assertSameUser(user);
        // Never expose the raw domain result: it can contain verifier evidence,
        // authorization metadata, or internal provider references.
        return { requestId: request.requestId, type: request.type, revision: committed.revision, replayed: committed.replayed,
          eventHash: committed.eventHash, view: project(snapshot.state, user) };
      } catch {
        // Do not imply rollback if a private read or renewed authorization fails
        // AFTER commit. Reconciliation/retry must keep the original request ID.
        throw new WalletCommittedResponseError(request.requestId, committed.revision);
      }
    },
  });
}
