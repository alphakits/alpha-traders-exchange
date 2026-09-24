"use client";
import type { UserPresenceData } from "@alpha-traders/contracts";
import { useLiveUserPresence } from "@/lib/user-presence-client";
import { cn } from "@/lib/utils";

export function UserPresence({ userId, initial, isAr = false, className, compact = false }: { userId: string; initial?: UserPresenceData; isAr?: boolean; className?: string; compact?: boolean }) {
  const presence = useLiveUserPresence(userId, initial);
  return <span className={cn("inline-flex items-center gap-1.5", presence.online ? "text-emerald-300" : "text-[#9CA3AF]", className)}>
    <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", presence.online ? "bg-emerald-400" : "bg-current")} />
    {compact && !presence.presenceHidden ? (presence.online ? (isAr ? "متصل الآن" : "Online") : (isAr ? "غير متصل" : "Offline")) : (isAr ? presence.labelAr : presence.label)}
  </span>;
}
