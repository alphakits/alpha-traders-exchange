import {
  findUserById,
  getListingBroadcastEmailRecipients,
} from "@/lib/alpha-exchange-store";
import {
  sendMarketplaceEmail,
  type MarketplaceEmailEvent,
  type MarketplaceEmailPayload,
} from "@/lib/marketplace-email-delivery";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { logEvent } from "@/lib/structured-logging";
import { normalizePreferredLocale } from "@/lib/preferred-locale";

type EmailRecipient = {
  id: string;
  fullName: string;
  email: string;
  preferredLocale?: "ar" | "en";
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

function tradePath(requestId: string) {
  return `/trade-room/${encodeURIComponent(requestId)}`;
}

function marketplacePath() {
  return "/usdt-exchange";
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
    recipientLocale: normalizePreferredLocale(recipient.preferredLocale),
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
  const actionPath = tradePath(request.id);
  const common = {
    event,
    actionPath,
    actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
    referenceLabel,
  };
  if (event === "new_buy_request") {
    if (request.priceMode === "buyer_offer") {
      return {
        ...common,
        title: { ar: "عرض سعر جديد", en: "New Price Offer" },
        message: {
          ar: `قدّم ${request.buyerName} عرضًا لشراء ${request.usdtAmount} USDT بسعر ₪${request.pricePerUsdt} لكل USDT. وافق على العرض أو ارفضه في غرفة الصفقة.`,
          en: `${request.buyerName} offered ₪${request.pricePerUsdt} per USDT for ${request.usdtAmount} USDT. Accept or decline the offer in the Trade Room.`,
        },
      };
    }
    return {
      ...common,
      title: { ar: "طلب شراء جديد", en: "New Buy Request" },
      message: {
        ar: `طلب ${request.buyerName} شراء ${request.usdtAmount} USDT. راجع الطلب في غرفة الصفقة.`,
        en: `${request.buyerName} requested ${request.usdtAmount} USDT. Review the request in your Trade Room.`,
      },
    };
  }
  if (event === "trade_accepted") {
    if (request.priceMode === "buyer_offer") {
      return {
        ...common,
        title: { ar: "تم قبول عرض السعر", en: "Price Offer Accepted" },
        message: {
          ar: `وافق البائع على سعرك البالغ ₪${request.pricePerUsdt} لكل USDT. تابع الصفقة بالسعر المتفق عليه في غرفة التداول.`,
          en: `The seller accepted your ₪${request.pricePerUsdt} per USDT offer. Continue the trade at the agreed price in the Trade Room.`,
        },
      };
    }
    return {
      ...common,
      title: { ar: "تم قبول الصفقة", en: "Trade Accepted" },
      message: {
        ar: "وافق البائع على طلبك. ارفع إيصال الدفع للمتابعة.",
        en: "The seller accepted your request. Upload your payment receipt to continue.",
      },
    };
  }
  if (event === "trade_rejected") {
    if (request.priceMode === "buyer_offer") {
      return {
        ...common,
        title: { ar: "تم رفض عرض السعر", en: "Price Offer Declined" },
        message: {
          ar: `رفض البائع عرضك البالغ ₪${request.pricePerUsdt} لكل USDT. لا يلزم إجراء أي دفع.`,
          en: `The seller declined your ₪${request.pricePerUsdt} per USDT offer. No payment is required.`,
        },
      };
    }
    return {
      ...common,
      title: { ar: "تم رفض الصفقة", en: "Trade Rejected" },
      message: {
        ar: "رفض البائع طلب الصفقة. لا يلزم إجراء أي دفع.",
        en: "The seller rejected this trade request. No payment is required.",
      },
    };
  }
  if (event === "buyer_payment_sent") {
    return {
      ...common,
      title: { ar: "أبلغ المشتري بإرسال الدفع", en: "Buyer Marked Payment Sent" },
      message: {
        ar: "أرسل المشتري إثبات الدفع. تحقّق من وصول الأموال قبل المتابعة.",
        en: "The buyer submitted payment evidence. Verify the funds before continuing.",
      },
    };
  }
  if (event === "seller_usdt_released") {
    return {
      ...common,
      title: { ar: "أرسل البائع USDT", en: "Seller Released USDT" },
      message: {
        ar: "أكّد البائع إرسال USDT. أكّد الاستلام في غرفة الصفقة.",
        en: "The seller marked USDT as sent. Confirm receipt in the Trade Room.",
      },
    };
  }
  if (event === "trade_completed") {
    return {
      ...common,
      title: { ar: "اكتملت الصفقة", en: "Trade Completed" },
      message: {
        ar: `اكتملت الصفقة ${referenceLabel} وأصبحت متاحة في سجلّك.`,
        en: `Trade ${referenceLabel} is complete and available in your history.`,
      },
    };
  }
  return {
    ...common,
    title: { ar: "أُلغيت الصفقة", en: "Trade Cancelled" },
    message: {
      ar: `أُلغيت الصفقة ${referenceLabel}. افتح غرفة الصفقة للاطّلاع على الحالة النهائية.`,
      en: `Trade ${referenceLabel} was cancelled. Open the Trade Room for the final status.`,
    },
  };
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

  const actionPath = `${tradePath(input.request.id)}#chat`;
  const referenceLabel = input.request.tradeId ?? input.request.id;
  const content = input.event === "trade_room_message"
    ? {
        event: input.event,
        title: { ar: "رسالة جديدة في غرفة الصفقة", en: "New Trade Room message" },
        message: {
          ar: "لديك رسالة جديدة في صفقة نشطة على Alpha Exchange.",
          en: "You have a new message in your active Alpha Exchange trade.",
        },
      }
    : {
        event: input.event,
        title: { ar: "تذكير من غرفة الصفقة", en: "Trade Room reminder" },
        message: input.senderRole === "buyer"
          ? {
              ar: "المشتري ينتظرك في صفقة نشطة.",
              en: "Your Buyer is waiting for you in an active trade.",
            }
          : {
              ar: "البائع ينتظرك في صفقة نشطة.",
              en: "Your Seller is waiting for you in an active trade.",
            },
      };

  return async () => {
    await deliver({
      ...content,
      recipient,
      actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
      actionPath,
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
    title: approved
      ? { ar: "تمت الموافقة على الإعلان", en: "Listing Approved" }
      : { ar: "تم رفض الإعلان", en: "Listing Rejected" },
    message: approved
      ? {
          ar: "تمت الموافقة على إعلانك، وهو متاح الآن في سوق Alpha Exchange.",
          en: "Your listing has been approved and is now live in the Alpha Exchange marketplace.",
        }
      : {
          ar: `تم رفض إعلانك.${input.reason ? ` السبب: ${input.reason}` : ""}`,
          en: `Your listing was rejected.${input.reason ? ` Reason: ${input.reason}` : ""}`,
        },
    actionLabel: approved
      ? { ar: "عرض الإعلان المباشر", en: "View Live Listing" }
      : { ar: "مراجعة الإعلان", en: "Review Listing" },
    actionPath: marketplacePath(),
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
        title: { ar: "نُشر إعلان USDT جديد", en: "New USDT Listing Published" },
        message: {
          ar: `نشر ${seller.fullName} كمية ${input.listing.availableAmount} USDT على شبكة ${input.listing.network} بسعر ${input.listing.price} ${input.listing.currency}/USDT.`,
          en: `${seller.fullName} published ${input.listing.availableAmount} USDT on ${input.listing.network} at ${input.listing.price} ${input.listing.currency}/USDT.`,
        },
        actionLabel: { ar: "تصفّح السوق", en: "Browse Marketplace" },
        actionPath: marketplacePath(),
        referenceLabel: input.listing.id,
      })),
    ]);
  };
}
