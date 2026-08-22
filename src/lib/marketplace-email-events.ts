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
import { logEvent } from "@/lib/structured-logging";

type EmailRecipient = {
  id: string;
  fullName: string;
  email: string;
};

type LifecycleTradeEmailEvent = Extract<
  MarketplaceEmailEvent,
  | "new_buy_request"
  | "trade_accepted"
  | "trade_rejected"
  | "buyer_payment_sent"
  | "seller_usdt_released"
  | "trade_completed"
  | "trade_cancelled"
>;

type TradeRoomConversationEmailEvent = Extract<
  MarketplaceEmailEvent,
  "trade_room_message" | "trade_room_poke"
>;

// First chat email is delivered immediately. Additional messages for the same
// recipient in the same Trade Room are suppressed by the PostgreSQL-backed
// shared limiter for this short server-owned burst window.
export const TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS = 2 * 60_000;

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

async function deliver(input: Omit<MarketplaceEmailPayload, "recipientName"> & { recipient: EmailRecipient; idempotencyKey?: string }) {
  const { recipient, idempotencyKey, ...payload } = input;
  const result = await sendMarketplaceEmail({
    ...payload,
    to: recipient.email,
    recipientName: recipient.fullName,
    idempotencyKey,
  });
  if (!result.ok) {
    logEvent("error", {
      event: "marketplace_email_delivery",
      targetUserId: recipient.id,
      outcome: "failed",
      reason: payload.event,
      metadata: {
        deliveryReason: result.reason,
        providerStatus: "providerStatus" in result ? result.providerStatus : undefined,
      },
    });
  }
}

function tradeEmailContent(
  event: LifecycleTradeEmailEvent,
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
  event: LifecycleTradeEmailEvent;
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

export async function prepareTradeRoomConversationEmail(input: {
  event: TradeRoomConversationEmailEvent;
  request: Pick<PurchaseRequest, "id" | "tradeId">;
  recipientUserId: string;
  senderUserId: string;
  senderRole: "buyer" | "seller";
  idempotencyKey: string;
}) {
  // All recipient identity and routing are resolved server-side. The caller
  // cannot supply an email address, message preview, or external destination.
  if (!input.recipientUserId || input.recipientUserId === input.senderUserId) {
    return async () => {};
  }
  const recipient = await findUserById(input.recipientUserId);
  if (!recipient) return async () => {};

  const actionUrl = `${tradeUrl(input.request.id)}#chat`;
  const referenceLabel = input.request.tradeId ?? input.request.id;
  const content = input.event === "trade_room_message"
    ? {
        event: input.event,
        title: "New Trade Room message",
        message: "You have a new message in your active Alpha Exchange trade.",
      }
    : {
        event: input.event,
        title: "Trade Room reminder",
        message: input.senderRole === "buyer"
          ? "Your Buyer is waiting for you in an active trade."
          : "Your Seller is waiting for you in an active trade.",
      };

  return async () => {
    await deliver({
      ...content,
      recipient,
      actionLabel: "Open Trade Room",
      actionUrl,
      referenceLabel,
      idempotencyKey: input.idempotencyKey,
    });
  };
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
