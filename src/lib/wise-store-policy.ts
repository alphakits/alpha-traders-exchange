import { isWisePaymentsEnabled } from "@/lib/wise-payments-capability";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import type { WiseUsdAccount } from "@/types/wise";
import { isWiseOwnershipReviewed } from "@/lib/wise-bank-transfer";

export function assertWisePaymentsRuntime() {
  if (!isWisePaymentsEnabled()) throw new Error("Wise USD bank transfers are unavailable.");
}

export function getReviewedWiseAccount(user: AlphaExchangeUser | undefined, accountId: string | undefined): WiseUsdAccount {
  assertWisePaymentsRuntime();
  const account = user?.wiseUsdAccounts?.find(candidate => candidate.id === accountId && candidate.userId === user.id);
  if (!user || user.disabled || user.emailVerified !== true || !account || !isWiseOwnershipReviewed(account)) {
    throw new Error("Select your own Wise USD account with completed manual ownership review.");
  }
  const normalizeName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  if (normalizeName(user.fullName) !== normalizeName(account.accountHolderName)) throw new Error("Your Wise account holder must match your platform identity.");
  return account;
}

export function assertWiseListingShape(listing: Pick<MarketplaceListing, "bankTransferProvider" | "currency" | "paymentMethods" | "wiseAccountId" | "bankAccountId">) {
  if (listing.bankTransferProvider !== undefined && !["israeli_bank", "wise"].includes(listing.bankTransferProvider)) throw new Error("Invalid bank transfer provider.");
  if (listing.bankTransferProvider !== "wise") {
    if (listing.wiseAccountId) throw new Error("Wise accounts require the Wise bank transfer provider.");
    return;
  }
  assertWisePaymentsRuntime();
  if (listing.currency !== "USD" || listing.paymentMethods.length !== 1 || listing.paymentMethods[0] !== "Bank Transfer" || listing.bankAccountId) {
    throw new Error("Wise draft listings require USD and Bank Transfer only, with a Wise USD receiving account.");
  }
  if (!listing.wiseAccountId) throw new Error("Select your reviewed Wise USD receiving account.");
}

export function wiseAccountHasActiveUsage(db: AlphaExchangeDb, userId: string, accountId: string) {
  return db.marketplaceListings.some(listing => listing.sellerId === userId && listing.wiseAccountId === accountId
    && !["cancelled", "closed", "completed"].includes(listing.status))
    || db.purchaseRequests.some(trade => !["cancelled", "declined", "completed", "locked", "review_open", "expired", "closed"].includes(trade.status)
      && ((trade.buyerId === userId && trade.buyerWiseAccountId === accountId)
        || (trade.sellerId === userId && trade.sellerWiseAccountId === accountId)));
}

export function assertWiseTradeSnapshotCurrent(db: AlphaExchangeDb, listing: MarketplaceListing | undefined, request: PurchaseRequest) {
  if (request.bankTransferProvider !== "wise") return;
  assertWisePaymentsRuntime();
  if (!listing || listing.bankTransferProvider !== "wise" || listing.currency !== "USD" || listing.wiseAccountId !== request.sellerWiseAccountId) {
    throw new Error("Wise payment terms changed. Review the listing again.");
  }
  const seller = getReviewedWiseAccount(db.users.find(user => user.id === request.sellerId), request.sellerWiseAccountId);
  const buyer = getReviewedWiseAccount(db.users.find(user => user.id === request.buyerId), request.buyerWiseAccountId);
  for (const [account, snapshot] of [[seller, request.sellerWiseAccountSnapshot], [buyer, request.buyerWiseAccountSnapshot]] as const) {
    if (!snapshot || snapshot.accountNumber !== account.accountNumber || snapshot.routingNumber !== account.routingNumber
      || snapshot.accountHolderName !== account.accountHolderName || snapshot.bankName !== account.bankName
      || snapshot.accountType !== account.accountType || snapshot.bankAddress !== account.bankAddress) {
      throw new Error("Wise account details changed. Review the payment accounts again.");
    }
  }
}
