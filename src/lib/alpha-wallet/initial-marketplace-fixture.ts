import { createHash } from "node:crypto";
import { calculateTradeTermsQuote, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { AlphaExchangeUser, AuthSession, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { assetFor, type AssetId } from "./amounts";
import type { WalletSql } from "./durable-store";
import { createInitialAcceptanceFixture } from "./initial-acceptance-fixture";
import { createMarketplaceMobileAuthFixture } from "./marketplace-mobile-fixture";
import { assertSimulationRuntime } from "./runtime";
import { simulatedDestination } from "./sandbox";

/**
 * Explicit disposable canonical rows and public synthetic web/mobile credentials.
 * This does not sign anybody up, issue a real session, initialize a wallet or
 * activate a cohort. The caller owns every write in one development transaction.
 * The older canonical-mechanics and correction fixtures retain their contracts.
 */
export async function createInitialMarketplaceFixture(options: {
  mode: "simulation-only";
  tx: WalletSql;
  paymentMethod?: "Bank Transfer" | "Face-to-Face";
  tradeProjection?: "absent" | "pending";
  platform?: "ios" | "android";
  assetId?: AssetId;
}) {
  assertSimulationRuntime(options.mode);
  const { tx } = options;
  const assetId = options.assetId ?? "tron-sim-usdt";
  assetFor(assetId);
  const network = assetId === "tron-sim-usdt" ? "TRC20" as const : "BEP20" as const;
  const base = await createInitialAcceptanceFixture(options);
  const paymentMethod = options.paymentMethod ?? "Bank Transfer";
  const ownerId = "initial-fixture-owner";
  const owner: AlphaExchangeUser = {
    id: ownerId, fullName: "Synthetic initial owner", email: `${ownerId}@example.invalid`,
    passwordHash: "synthetic-fixture-not-a-login", whatsappNumber: "", preferredNetworks: ["TRC20"],
    profilePhotoUrl: "", languages: ["en"], bio: "Isolated initial marketplace fixture",
    onlineStatus: "offline", availabilityStatus: "available", role: "owner", sellerStatus: "buyer",
    emailVerified: true, emailVerifiedAt: base.at, verifiedPhone: "+12025550109", phoneVerifiedAt: base.at,
    ageEligibility: { method: "self_attestation_v1", confirmedAt: base.at }, disabled: false,
    createdAt: base.at, updatedAt: base.at,
  };
  await tx.query(`INSERT INTO alpha_exchange.users
    (id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)`,
  [owner.id, owner.email, owner.role, owner.sellerStatus, owner.availabilityStatus, owner.onlineStatus,
    owner.createdAt, owner.updatedAt, base.users.length, JSON.stringify(owner)]);
  await tx.exec(`CREATE TABLE alpha_exchange.sessions (
    token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
  )`);

  const ownerSessionToken = "1a".repeat(32), buyerSessionToken = "2b".repeat(32), sellerSessionToken = "3c".repeat(32);
  const otherSellerSessionToken = "4d".repeat(32), otherBuyerSessionToken = "5e".repeat(32);
  const sessionsExpireAtMs = base.atMs + 60 * 60 * 1000;
  const webCredentials = {
    [ownerId]: { sessionToken: ownerSessionToken }, [base.buyerId]: { sessionToken: buyerSessionToken },
    [base.sellerId]: { sessionToken: sellerSessionToken }, [base.otherSellerId]: { sessionToken: otherSellerSessionToken },
    [base.otherBuyerId]: { sessionToken: otherBuyerSessionToken },
  };
  const webSessions: Record<string, AuthSession> = {};
  for (const [index, [userId, { sessionToken }]] of Object.entries(webCredentials).entries()) {
    const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const session: AuthSession = { token: tokenHash, userId, createdAt: base.at,
      expiresAt: new Date(sessionsExpireAtMs).toISOString(), deviceLabel: "Public synthetic initial marketplace fixture" };
    await tx.query(`INSERT INTO alpha_exchange.sessions
      (token_hash,user_id,expires_at,created_at,sort_index,payload) VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6::jsonb)`,
    [tokenHash, userId, session.expiresAt, session.createdAt, index, JSON.stringify(session)]);
    webSessions[userId] = session;
  }

  // The public listing and funded wallet listing remain 3.20 ILS. The retained
  // buyer request is 3.10 ILS; acceptance must preserve this original quote.
  const quote = calculateTradeTermsQuote({ paymentMethod, currency: "ILS", usdtAmount: "200", fiatAmount: "0.00",
    pricePerUsdt: "3.10", feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_amount", "200");
  if (!quote) throw new Error("Synthetic initial marketplace quote is unsupported");
  const initialRequest: PurchaseRequest = { ...structuredClone(base.initialRequest), ...quote, listingPriceAtRequest: "3.10",
    network, buyerReceivingWalletAddress: simulatedDestination(assetId, base.buyerId) };
  const initialListing: MarketplaceListing = { ...structuredClone(base.initialListing), network };
  await tx.query("UPDATE alpha_exchange.listings SET payload=$2::jsonb WHERE id=$1", [base.listingId, JSON.stringify(initialListing)]);
  const purchaseRequests = base.marketplace.purchaseRequests.map(request => request.id === base.requestId ? initialRequest
    : request.listingId === base.listingId ? { ...structuredClone(request), network,
      buyerReceivingWalletAddress: simulatedDestination(assetId, request.buyerId) } : request);
  for (const request of purchaseRequests.filter(request => request.listingId === base.listingId)) {
    await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=$2::jsonb WHERE id=$1", [request.id, JSON.stringify(request)]);
  }

  const accounts = [...base.users, owner];
  const mobile = await createMarketplaceMobileAuthFixture({ mode: options.mode, tx, userIds: accounts.map(user => user.id),
    atMs: base.atMs, platform: options.platform ?? "ios", locale: options.platform === "android" ? "ar" : "en" });
  assertSimulationRuntime(options.mode);
  return {
    ...base, initialRequest, initialListing, ownerId, ownerSessionToken, buyerSessionToken, sellerSessionToken, otherSellerSessionToken,
    otherBuyerSessionToken, sessionsExpireAtMs, accounts, webCredentials, webSessions, mobile,
    walletListingId: "initial-wallet-listing", walletTradeId: "initial-wallet-trade", assetId,
    marketplace: { ...base.marketplace, users: accounts,
      marketplaceListings: base.marketplace.marketplaceListings.map(listing => listing.id === base.listingId ? initialListing : listing),
      purchaseRequests },
  };
}
