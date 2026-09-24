"use client";
import type { UserPresenceData } from "@alpha-traders/contracts";
import { useLiveUserPresence } from "@/lib/user-presence-client";
import { cn } from "@/lib/utils";

export function UserPresence({ userId, initial, isAr = false, className, compact = false }: { userId: string; initial?: UserPresenceData; isAr?: boolean; className?: string; compact?: boolean }) {
  const presence = useLiveUserPresence(userId, initial);
  return <span className={cn("inline-flex items-center gap-1.5", presence.online ? "text-emerald-300" : "text-[#9CA3AF]", className)}>
    <span aria-hidden="true" className={cn("seller-presence-dot", presence.online ? "seller-presence-dot--online" : "seller-presence-dot--idle")} />
    {compact ? (isAr ? presence.compactLabelAr : presence.compactLabel) : (isAr ? presence.labelAr : presence.label)}
  </span>;
}
