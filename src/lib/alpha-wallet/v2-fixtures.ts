import { calculateTradeTermsQuote, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { assetFor, formatUnits, parseUnits } from "./amounts";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { walletDigest } from "./commands";
import { assertSimulationRuntime } from "./runtime";
import type { State, Trade } from "./types";

/**
 * Explicit synthetic canonical records for reducer/storage tests. This does not
 * read marketplace storage or convert a real wallet trade into an enrollment.
 * Frozen payment instructions are deliberately fake and never provider evidence.
 */
export function createV2TermsFixture(options: {
  mode: "simulation-only"; state: State; walletTradeId: string; platformRequestId?: string;
  platformListingId?: string; proposalId?: string; proposedAmount?: string; submittedAdjustmentCount?: 1 | 2; at?: string;
}) {
  assertSimulationRuntime(options.mode);
  const trade = options.state.trades.get(options.walletTradeId);
  if (!trade) throw new Error("Synthetic fixture requires its existing wallet trade");
  const walletListing = options.state.listings.get(trade.listingId);
  if (!walletListing) throw new Error("Synthetic fixture requires its wallet listing");
  const asset = assetFor(trade.assetId);
  const at = options.at ?? "2026-11-05T00:00:00.000Z";
  const requestId = options.platformRequestId ?? `v2-request-${walletDigest(trade.id).slice(0, 20)}`;
  const listingId = options.platformListingId ?? `v2-listing-${walletDigest(trade.listingId).slice(0, 20)}`;
  const proposalId = options.proposalId ?? "v2-proposal-one";
  const exactPrice = parseUnits(walletListing.price, 2);
  const price = `${exactPrice / BigInt(100)}.${(exactPrice % BigInt(100)).toString().padStart(2, "0")}`;
  const quote = (amount: string) => {
    const result = calculateTradeTermsQuote({ paymentMethod: "Bank Transfer", currency: "ILS", usdtAmount: amount,
      fiatAmount: "0.00", pricePerUsdt: price, feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_amount", amount);
    if (!result) throw new Error("Synthetic fixture quote is unsupported");
    return result;
  };
  const requestFor = (item: Trade, id: string): PurchaseRequest => ({
    id, tradeId: `v2-platform-${walletDigest(item.id).slice(0, 20)}`, listingId, buyerId: item.buyerId, sellerId: item.sellerId,
    buyerName: "Synthetic buyer", buyerNotes: "Isolated versioned wallet fixture", ...quote(formatUnits(item.amountRaw, asset.decimals)),
    listingPriceAtRequest: price, priceMode: "listing_price", currency: "ILS", network: trade.assetId === "tron-sim-usdt" ? "TRC20" : "BEP20",
    buyerReceivingWalletAddress: item.destination, paymentMethod: "Bank Transfer", bankTransferProvider: "israeli_bank",
    bankName: "Synthetic fixture bank", sellerBankAccountId: "v2-fixture-bank",
    sellerBankAccountSnapshot: { accountHolderName: "Synthetic seller", bankName: "Synthetic fixture bank", branchNumber: "000",
      accountNumber: "00001234", accountLast4: "1234" }, feePolicyVersion: MARKETPLACE_FEE_POLICY,
    commissionCalculationVersion: COMMISSION_CALCULATION_VERSION, timeline: [], messages: [], amountAdjustmentCount: 0,
    status: item.status === "completed" ? "completed" : item.status === "cancelled" ? "cancelled" : item.status === "reserved" ? "accepted"
      : item.status === "payment_reported" ? "payment_sent" : item.status === "payment_verified" ? "funds_received" : "usdt_release_pending",
    createdAt: at, updatedAt: at,
  });
  const related = [...options.state.trades.values()].filter(item => item.listingId === walletListing.id);
  const delivered = related.filter(item => item.status === "completed").reduce((sum, item) => sum + item.amountRaw, BigInt(0));
  const listing: MarketplaceListing = {
    id: listingId, sellerId: walletListing.sellerId, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: formatUnits(walletListing.amountRaw, asset.decimals), availableAmount: formatUnits(walletListing.amountRaw - delivered, asset.decimals),
    price, currency: "ILS", network: trade.assetId === "tron-sim-usdt" ? "TRC20" : "BEP20", paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer"],
    bankTransferProvider: "israeli_bank", bankAccountId: "v2-fixture-bank", bankName: "Synthetic fixture bank",
    minimumTrade: "0.00005", maximumTrade: formatUnits(walletListing.amountRaw, asset.decimals), sellerDescription: "Isolated fixture only", responseTime: "fixture",
    status: "matched", approvalStatus: "approved", activeTradeRequestId: requestId, lockedAt: at, createdAt: at, updatedAt: at,
  };
  const request = requestFor(trade, requestId);
  request.amountAdjustmentCount = options.submittedAdjustmentCount ?? 1;
  request.termsProposal = { id: proposalId, kind: "amount_correction", status: "pending", createdAt: at,
    ...quote(options.proposedAmount ?? formatUnits(trade.amountRaw, asset.decimals)) };
  const purchaseRequests = [request, ...related.filter(item => item.id !== trade.id).map(item => requestFor(item, `v2-other-${walletDigest(item.id).slice(0, 20)}`))];
  return {
    request, listing, proposalId,
    marketplace: { purchaseRequests, marketplaceListings: [listing], tradeEvidenceFiles: [], disputes: [] },
    description: describeDevelopmentTradeTerms({ mode: "simulation-only", request, assetId: trade.assetId, walletListingId: trade.listingId }),
  };
}
