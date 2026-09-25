import type { TradeChatParticipantRole } from "@alpha-traders/contracts";
import { publicAccountId } from "@/lib/public-account-identity";
import { normalizePublicAccountId } from "@/lib/format-id";
import type { TradeChatMessage } from "@/types/alpha-exchange";

export type TradeChatContext = {
  request: { buyerId: string; sellerId: string };
  counterpart: { buyerPublicId?: string; sellerPublicId?: string; buyerName?: string; sellerName?: string };
  listing?: { sellerReputation?: { level?: string } } | null;
};

export function tradeChatPublicId(context: TradeChatContext, side: "buyer" | "seller") {
  const explicit = side === "buyer" ? context.counterpart.buyerPublicId : context.counterpart.sellerPublicId;
  const legacy = side === "buyer" ? context.counterpart.buyerName : context.counterpart.sellerName;
  // Old cached snapshots may contain a real name in an owner view. Never use
  // that text (or its initials) as a participant's chat identity.
  for (const value of [explicit, legacy]) {
    const id = normalizePublicAccountId(value);
    if (id) return id;
  }
  return publicAccountId({ id: side === "buyer" ? context.request.buyerId : context.request.sellerId, role: side === "buyer" ? "buyer" : "approved_seller" });
}

export function tradeChatSender(message: Pick<TradeChatMessage, "senderUserId" | "kind"> & Partial<Pick<TradeChatMessage, "senderRole">>, context: TradeChatContext): { role: TradeChatParticipantRole; publicId?: string } | undefined {
  if (message.kind === "system") return undefined;
  if (message.senderRole === "owner") return { role: "owner" };
  const role = message.senderUserId === context.request.buyerId ? "buyer"
    : message.senderUserId === context.request.sellerId ? "seller" : "support";
  return { role, publicId: role === "support" ? undefined : tradeChatPublicId(context, role) };
}
