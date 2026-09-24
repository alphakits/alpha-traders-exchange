import type { TradeChatParticipantRole } from "@alpha-traders/contracts";
import { publicAccountId } from "@/lib/public-account-identity";
import type { TradeChatMessage } from "@/types/alpha-exchange";

export type TradeChatContext = {
  request: { buyerId: string; sellerId: string };
  counterpart: { buyerPublicId?: string; sellerPublicId?: string; buyerName?: string; sellerName?: string };
};

export function tradeChatPublicId(context: TradeChatContext, side: "buyer" | "seller") {
  const explicit = side === "buyer" ? context.counterpart.buyerPublicId : context.counterpart.sellerPublicId;
  const legacy = side === "buyer" ? context.counterpart.buyerName : context.counterpart.sellerName;
  // Old cached snapshots may contain a real name in an owner view. Never use
  // that text (or its initials) as a participant's chat identity.
  for (const value of [explicit, legacy]) if (value && /^#[SB]-\d{6,7}$/.test(value)) return value;
  return publicAccountId({ id: side === "buyer" ? context.request.buyerId : context.request.sellerId, role: side === "buyer" ? "buyer" : "approved_seller" });
}

export function tradeChatSender(message: Pick<TradeChatMessage, "senderUserId" | "kind">, context: TradeChatContext): { role: TradeChatParticipantRole; publicId?: string } | undefined {
  if (message.kind === "system") return undefined;
  const role = message.senderUserId === context.request.buyerId ? "buyer"
    : message.senderUserId === context.request.sellerId ? "seller" : "support";
  return { role, publicId: role === "support" ? undefined : tradeChatPublicId(context, role) };
}
