import { Check, CheckCheck, Clock3, Eye } from "lucide-react";
import { tradeChatRoleLabel, tradeChatStatus, tradeChatStatusLabel } from "@alpha-traders/contracts";
import { tradeChatSender, type TradeChatContext } from "@/lib/trade-chat-presentation";
import type { TradeChatMessage } from "@/types/alpha-exchange";
import { PublicAccountId } from "@/components/ui/public-account-id";

export function TradeChatMessageLabel({ message, context, actorId, locale }: {
  message: TradeChatMessage; context: TradeChatContext; actorId: string; locale: "en" | "ar";
}) {
  const sender = tradeChatSender(message, context);
  if (!sender) return <p className="mb-1 text-xs font-semibold text-[#93C5FD]">{locale === "ar" ? "تحديث الصفقة" : "Trade update"}</p>;
  return <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    {sender.publicId ? <PublicAccountId value={sender.publicId} audience={sender.role === "buyer" ? "buyer" : "seller"} rank={context.listing?.sellerReputation?.level} /> : null}
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${sender.role === "owner" ? "border-red-400/60 bg-red-600/25 text-red-200" : "border-white/15 text-[#D1D5DB]"}`}>{tradeChatRoleLabel(sender.role, locale)}</span>
    {message.senderUserId === actorId ? <span className="text-[#9CA3AF]">{locale === "ar" ? "أنت" : "You"}</span> : null}
  </div>;
}

export function TradeChatMessageStatus({ message, parties, locale }: {
  message: TradeChatMessage; parties: TradeChatContext["request"]; locale: "en" | "ar";
}) {
  const status = tradeChatStatus(message, parties);
  if (!status) return null;
  const Icon = status === "seen" ? Eye : status === "delivered" ? CheckCheck : status === "sending" ? Clock3 : Check;
  return <span className={`inline-flex items-center gap-1 ${status === "seen" ? "text-[#93C5FD]" : ""}`}>
    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
    <span>{tradeChatStatusLabel(status, locale)}</span>
  </span>;
}
