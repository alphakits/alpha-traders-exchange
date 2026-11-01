import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Optional explanation only. Required amounts, warnings and actions stay outside. */
export function HelpDetails({ title, children, className }: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return <details className={cn("alpha-help-details group/help rounded-xl border border-white/10 bg-white/[0.02] text-sm", className)}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-medium text-[#D1D5DB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37] [&::-webkit-details-marker]:hidden">
      {title}<ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open/help:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="space-y-3 border-t border-white/10 px-3 py-3 leading-6 text-[#B6BDC8]">{children}</div>
  </details>;
}
