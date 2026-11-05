import { calculateTradePaymentTotal, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { assetFor, formatUnits } from "./amounts";
import { walletDigest } from "./commands";
import { planDevelopmentInitialAcceptance, type DevelopmentInitialAcceptanceContext, type DevelopmentInitialAcceptanceMarketplace } from "./initial-acceptance";
import { assertSimulationRuntime } from "./runtime";
import { simulatedDestination } from "./sandbox";
import { assertV3Invariants, type V3State } from "./v3-engine";

/**
 * Explicit synthetic canonical evidence for isolated financial tests. This
 * helper creates no real account, session, canonical database row or permission.
 * Its exact wallet checkpoint must be supplied by the caller's verified replay.
 */
export function createV3InitialAcceptanceFixture(options: {
  mode: "simulation-only"; state: V3State; walletRevision: number; walletEventHash: string; atMs: number;
  walletListingId: string; walletTradeId?: string; platformRequestId?: string; platformListingId?: string; platformTradeId?: string;
  buyerId?: string; amount?: string; retainedPrice?: string; paymentMethod?: "Bank Transfer" | "Face-to-Face (Meet in Person)";
}) {
  assertSimulationRuntime(options.mode);
  assertV3Invariants(options.state);
  if (!Number.isSafeInteger(options.atMs) || options.atMs <= 1000 || !Number.isFinite(new Date(options.atMs).getTime())) {
    throw new Error("Synthetic initial acceptance requires an explicit valid clock");
  }
  const state = structuredClone(options.state), walletListing = state.listings.get(options.walletListingId);
  if (!walletListing) throw new Error("Synthetic initial acceptance requires its existing funded listing");
  const asset = assetFor(walletListing.assetId), network = walletListing.assetId === "tron-sim-usdt" ? "TRC20" : "BEP20";
  const method = options.paymentMethod ?? "Bank Transfer", amount = options.amount ?? "200", price = options.retainedPrice ?? "3.20";
  const at = new Date(options.atMs - 1000).toISOString();
  const sellerId = walletListing.sellerId, buyerId = options.buyerId ?? "v3-fixture-buyer";
  const requestId = options.platformRequestId ?? "v3-fixture-request", walletTradeId = options.walletTradeId ?? "v3-fixture-trade";
  const listingId = options.platformListingId ?? `v3-market-${walletDigest(walletListing.id).slice(0, 20)}`;
  const tradeId = options.platformTradeId ?? `v3-platform-${walletDigest(requestId).slice(0, 20)}`;
  const bankId = `v3-bank-${walletDigest(sellerId).slice(0, 20)}`;
  const user = (id: string, seller: boolean): AlphaExchangeUser => ({
    id, fullName: `Synthetic ${id}`, email: `${id}@example.invalid`, passwordHash: "synthetic-wallet-fixture-not-a-login",
    whatsappNumber: "", preferredNetworks: [network], profilePhotoUrl: "", languages: ["en"], bio: "Isolated seller-native fixture",
    onlineStatus: "offline", availabilityStatus: "available", role: seller ? "approved_seller" : "buyer",
    sellerStatus: seller ? "approved_seller" : "buyer", emailVerified: true, verifiedPhone: seller ? "+12025550101" : "+12025550102",
    phoneVerifiedAt: at, ageEligibility: { method: "self_attestation_v1", confirmedAt: at }, disabled: false, createdAt: at, updatedAt: at,
  });
  const seller = user(sellerId, true), buyer = user(buyerId, false);
  const listing: MarketplaceListing = { id: listingId, sellerId, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: formatUnits(walletListing.amountRaw, asset.decimals), availableAmount: formatUnits(walletListing.amountRaw, asset.decimals),
    price: walletListing.price, currency: "ILS", network, paymentMethod: method, paymentMethods: [method],
    minimumTrade: "0.00005", maximumTrade: formatUnits(walletListing.amountRaw, asset.decimals), sellerDescription: "Isolated fixture only",
    responseTime: "fixture", status: "active", approvalStatus: "approved", createdAt: at, updatedAt: at };
  const fiatAmount = calculateTradePaymentTotal(amount, price, true);
  if (!fiatAmount) throw new Error("Synthetic initial acceptance quote is unsupported");
  const request: PurchaseRequest = { id: requestId, tradeId, listingId, sellerId, buyerId, buyerName: "Synthetic buyer", buyerNotes: "Synthetic retained request",
    usdtAmount: amount, fiatAmount, pricePerUsdt: price, listingPriceAtRequest: price, priceMode: "listing_price", currency: "ILS", network,
    paymentMethod: method, buyerReceivingWalletAddress: simulatedDestination(walletListing.assetId, buyerId),
    feePolicyVersion: MARKETPLACE_FEE_POLICY, commissionCalculationVersion: COMMISSION_CALCULATION_VERSION,
    amountAdjustmentCount: 0, buyerSafetyAcknowledged: true, sellerSafetyAcknowledged: method === "Bank Transfer",
    status: "pending", createdAt: at, updatedAt: at, messages: [], timeline: [{ id: `v3-submission-${walletDigest(requestId).slice(0, 20)}`,
      type: "request_submitted", actorUserId: buyerId, actorRole: "buyer", message: "Synthetic buyer submitted the request", createdAt: at }] };
  if (method === "Bank Transfer") {
    const bank = { accountHolderName: "Synthetic seller", bankName: "Synthetic fixture bank", branchNumber: "000", accountNumber: "0000000000", accountLast4: "0000" };
    Object.assign(listing, { bankAccountId: bankId, bankTransferProvider: "israeli_bank" });
    Object.assign(request, { bankTransferProvider: "israeli_bank", sellerBankAccountId: bankId, bankName: bank.bankName, sellerBankAccountSnapshot: bank });
    seller.sellerBankAccounts = [{ id: bankId, sellerId, ...bank, isDefault: true, createdAt: at, updatedAt: at }];
  }
  const marketplace: { [K in keyof DevelopmentInitialAcceptanceMarketplace]: Array<DevelopmentInitialAcceptanceMarketplace[K][number]> } = {
    users: [seller, buyer], marketplaceListings: [listing], purchaseRequests: [request], commissionRecords: [], sellerReviews: [],
    marketplaceEnforcementRecords: [], tradeEvidenceFiles: [], disputes: [],
  };
  const context: DevelopmentInitialAcceptanceContext = { mode: "simulation-only", actorUserId: sellerId, requestId,
    operationId: "v3-fixture-plan", acceptedAtMs: options.atMs, safetyAcknowledged: method === "Face-to-Face (Meet in Person)",
    mapping: { assetId: walletListing.assetId, walletListingId: walletListing.id, walletTradeId }, marketplace,
    wallet: { state, revision: options.walletRevision, eventHash: options.walletEventHash } };
  const plan = planDevelopmentInitialAcceptance(context);
  return { context, marketplace, request, listing, seller, buyer, plan };
}
