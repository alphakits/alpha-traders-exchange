import type { MobileSupportedNetwork, MobileTradeStatus } from "./mobile-v1";
import { getWalletAddressValidationError } from "./wallet-address";

export function isTradeChatOpen(trade: { status: MobileTradeStatus; closedAt?: string; usdtDemandId?: string; usdtDemandOfferId?: string }) {
  if (trade.closedAt) return false;
  // A public Buy Request only acquires these bindings when the buyer accepts a seller response
  // and the transaction creates its room. The later seller settlement step stays independent.
  if (trade.status === "pending") return Boolean(trade.usdtDemandId && trade.usdtDemandOfferId);
  return ["accepted", "payment_sent", "funds_received", "usdt_release_pending",
    "usdt_sent", "completed", "review_open", "locked"].includes(trade.status);
}

/** Only a whole, network-validated address may bypass the ATM's generic digit filter. */
export function isTradeWalletMessage(message: string, network: MobileSupportedNetwork) {
  const text = message.trim();
  if (!["TRC20", "BEP20", "ERC20", "SOL"].includes(network)) return false;
  if (text.toUpperCase() === network) return true;
  const prefix = network + ":";
  const address = text.slice(0, prefix.length).toUpperCase() === prefix ? text.slice(prefix.length).trim() : text;
  return /^[A-Za-z0-9]{32,44}$/.test(address) && getWalletAddressValidationError(network, address) === null;
}

/** A network-prefixed draft is an explicit address share. */
export function tradeWalletShareError(message: string, network: MobileSupportedNetwork, locale = "en") {
  if (!/^(?:TRC20|BEP20|ERC20|SOL):/i.test(message.trim()) || isTradeWalletMessage(message, network)) return null;
  return locale === "ar" ? `أدخل عنوان محفظة صحيحًا لشبكة ${network}.` : `Enter a valid ${network} wallet address.`;
}

export type TradeChatStatus = "sending" | "sent" | "delivered" | "seen" | "deleted";
export type TradeChatParticipantRole = "buyer" | "seller" | "support" | "owner";

/** Presentation only; never rewrite drafts or insert direction-control characters. */
export function tradeChatTextDirection(value: string, fallback: "ltr" | "rtl" = "ltr"): "ltr" | "rtl" {
  const firstLetter = value.match(/\p{Letter}/u)?.[0];
  if (firstLetter) return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(firstLetter) ? "rtl" : "ltr";
  // Amount-only messages stay readable left to right in either interface language.
  return /\p{Number}/u.test(value) ? "ltr" : fallback;
}

export function tradeChatStatus(message: {
  id: string;
  kind: "user" | "system";
  senderUserId: string;
  readByUserIds?: readonly string[];
  deliveredAt?: string;
  deletedAt?: string;
}, parties: { buyerId: string; sellerId: string }): TradeChatStatus | undefined {
  if (message.kind === "system") return undefined;
  if (message.deletedAt) return "deleted";
  if (message.id.startsWith("optimistic-")) return "sending";
  const recipient = message.senderUserId === parties.buyerId ? parties.sellerId
    : message.senderUserId === parties.sellerId ? parties.buyerId : undefined;
  // A historical seenAt or an owner's inspection is not a participant receipt.
  if (recipient && message.readByUserIds?.includes(recipient)) return "seen";
  return message.deliveredAt ? "delivered" : "sent";
}

export function tradeChatStatusLabel(status: TradeChatStatus, locale: "en" | "ar") {
  const labels = {
    sending: { en: "Sending…", ar: "جارٍ الإرسال…" },
    sent: { en: "Sent", ar: "تم الإرسال" },
    delivered: { en: "Delivered", ar: "تم التسليم" },
    seen: { en: "Seen", ar: "تمت القراءة" },
    deleted: { en: "Message deleted", ar: "تم حذف الرسالة" },
  };
  return labels[status][locale];
}

export function tradeChatRoleLabel(role: TradeChatParticipantRole, locale: "en" | "ar") {
  return { owner: { en: "Owner", ar: "المالك" }, buyer: { en: "Buyer", ar: "المشتري" }, seller: { en: "Seller", ar: "البائع" }, support: { en: "Support", ar: "الدعم" } }[role][locale];
}
/** Resource bounds remain in force even for verified owner-authored messages. */
export const TRADE_CHAT_MESSAGE_MAX_LENGTH = 1200;
export const OWNER_TRADE_CHAT_MESSAGE_MAX_LENGTH = 10_000;
