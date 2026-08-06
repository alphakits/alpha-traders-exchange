import {
  findUserById,
  getListingBroadcastEmailRecipients,
} from "@/lib/alpha-exchange-store";
import { getSiteUrl } from "@/lib/site-url";
import {
  sendMarketplaceEmail,
  type MarketplaceEmailEvent,
  type MarketplaceEmailPayload,
} from "@/lib/marketplace-email-delivery";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

type EmailRecipient = {
  id: string;
  fullName: string;
  email: string;
};

function tradeUrl(requestId: string) {
  return `${getSiteUrl()}/en/trade-room/${encodeURIComponent(requestId)}`;
}

function marketplaceUrl() {
  return `${getSiteUrl()}/en/usdt-exchange`;
}

export function tradeEmailEventForStatus(status: PurchaseRequest["status"]) {
  if (status === "accepted") return "trade_accepted" as const;
  if (status === "declined") return "trade_rejected" as const;
  if (status === "payment_sent") return "buyer_payment_sent" as const;
  if (status === "usdt_sent") return "seller_usdt_released" as const;
  if (status === "completed" || status === "review_open" || status === "locked") return "trade_completed" as const;
  if (status === "cancelled") return "trade_cancelled" as const;
  return null;
}

async function deliver(input: Omit<MarketplaceEmailPayload, "recipientName"> & { recipient: EmailRecipient }) {
  const result = await sendMarketplaceEmail({
    ...input,
    to: input.recipient.email,
    recipientName: input.recipient.fullName,
  });
  if (!result.ok) {
    console.warn("[marketplace-email] delivery skipped or failed", {
      event: input.event,
      recipientUserId: input.recipient.id,
      reason: result.reason,
    });
  }
}

function tradeEmailContent(
  event: Exclude<MarketplaceEmailEvent, "listing_approved" | "listing_rejected" | "new_listing_published">,
  request: PurchaseRequest,
) {
  const referenceLabel = request.tradeId ?? request.id;
  const actionUrl = tradeUrl(request.id);
  const common = { event, actionUrl, actionLabel: "Open Trade Room", referenceLabel };
  if (event === "new_buy_request") {
    return { ...common, title: "New Buy Request", message: `${request.buyerName} requested ${request.usdtAmount} USDT. Review the request in your Trade Room.` };
  }
  if (event === "trade_accepted") {
    return { ...common, title: "Trade Accepted", message: "The seller accepted your request. Upload your payment receipt to continue." };
  }
  if (event === "trade_rejected") {
    return { ...common, title: "Trade Rejected", message: "The seller rejected this trade request. No payment is required." };
  }
  if (event === "buyer_payment_sent") {
    return { ...common, title: "Buyer Marked Payment Sent", message: "The buyer submitted payment evidence. Verify the funds before continuing." };
  }
  if (event === "seller_usdt_released") {
    return { ...common, title: "Seller Released USDT", message: "The seller marked USDT as sent. Confirm receipt in the Trade Room." };
  }
  if (event === "trade_completed") {
    return { ...common, title: "Trade Completed", message: `Trade ${referenceLabel} is complete and available in your history.` };
  }
  return { ...common, title: "Trade Cancelled", message: `Trade ${referenceLabel} was cancelled. Open the Trade Room for the final status.` };
}

export async function prepareTradeEventEmails(input: {
  event: Exclude<MarketplaceEmailEvent, "listing_approved" | "listing_rejected" | "new_listing_published">;
  request: PurchaseRequest;
}) {
  // Trade lifecycle messages are transactional safety notices and are sent
  // independently of the optional marketplace-listing email preference.
  const [buyer, seller] = await Promise.all([
    findUserById(input.request.buyerId),
    findUserById(input.request.sellerId),
  ]);
  const recipientIds = input.event === "trade_completed" || input.event === "trade_cancelled"
    ? [input.request.buyerId, input.request.sellerId]
    : input.event === "new_buy_request" || input.event === "buyer_payment_sent"
      ? [input.request.sellerId]
      : [input.request.buyerId];
  const recipients = [buyer, seller].filter(
    (user): user is NonNullable<typeof user> => Boolean(user && recipientIds.includes(user.id)),
  );
  const content = tradeEmailContent(input.event, input.request);
  return () => Promise.all(recipients.map((recipient) => deliver({ ...content, recipient })));
}

export async function prepareListingReviewEmails(input: {
  decision: "approve" | "reject";
  listing: MarketplaceListing;
  reason?: string;
}) {
  const seller = await findUserById(input.listing.sellerId);
  if (!seller) return async () => {};

  const approved = input.decision === "approve";
  const sellerDelivery = {
    event: approved ? "listing_approved" : "listing_rejected",
    recipient: seller,
    title: approved ? "Listing Approved" : "Listing Rejected",
    message: approved
      ? "Your listing has been approved and is now live in the Alpha Exchange marketplace."
      : `Your listing was rejected.${input.reason ? ` Reason: ${input.reason}` : ""}`,
    actionLabel: approved ? "View Live Listing" : "Review Listing",
    actionUrl: marketplaceUrl(),
    referenceLabel: input.listing.id,
  } as const;

  const recipients = approved
    ? await getListingBroadcastEmailRecipients(input.listing.sellerId)
    : [];
  return async () => {
    await Promise.all([
      deliver(sellerDelivery),
      ...recipients.map((recipient) => deliver({
        event: "new_listing_published" as const,
        recipient,
        title: "New USDT Listing Published",
        message: `${seller.fullName} published ${input.listing.availableAmount} USDT on ${input.listing.network} at ${input.listing.price} ${input.listing.currency}/USDT.`,
        actionLabel: "Browse Marketplace",
        actionUrl: marketplaceUrl(),
        referenceLabel: input.listing.id,
      })),
    ]);
  };
}
