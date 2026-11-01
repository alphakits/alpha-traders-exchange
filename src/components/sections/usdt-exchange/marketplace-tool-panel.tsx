"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { currencyText } from "@/components/ui/currency-text";
import { cn } from "@/lib/utils";

export function MarketplaceToolPanel({ title, isAr, icon, children, id, tabIndex, defaultOpen = false, className, bodyClassName = "px-4 pb-4 pt-3 sm:px-5" }: {
  title: string;
  isAr: boolean;
  icon?: ReactNode;
  children: ReactNode;
  id?: string;
  tabIndex?: number;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const panel = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (defaultOpen && panel.current) panel.current.open = true;
  }, [defaultOpen]);

  useEffect(() => {
    if (!id) return;
    const revealDestination = () => {
      if (window.location.hash === `#${id}` && panel.current) panel.current.open = true;
    };
    revealDestination();
    window.addEventListener("hashchange", revealDestination);
    return () => window.removeEventListener("hashchange", revealDestination);
  }, [id]);

  return (
    <section aria-label={title} className={cn("mt-2 min-w-0 rounded-2xl border border-white/10 bg-[#0B0B0B]/90", className)}>
      <details ref={panel} id={id} tabIndex={tabIndex} className="group/tool scroll-mt-24">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37] sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold sm:text-base">
            {icon}
            <span>{currencyText(title)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#D4AF37]">
            <span className="group-open/tool:hidden">{isAr ? "المزيد" : "More"}</span>
            <span className="hidden group-open/tool:inline">{isAr ? "أقل" : "Less"}</span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open/tool:rotate-180 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className={cn("border-t border-white/10", bodyClassName)}>{children}</div>
      </details>
    </section>
  );
}
