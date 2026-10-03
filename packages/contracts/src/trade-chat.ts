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
