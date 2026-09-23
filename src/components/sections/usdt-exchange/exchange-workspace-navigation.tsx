"use client";

import { ArrowRight, type LucideIcon } from "lucide-react";
import { currencyText } from "@/components/ui/currency-text";
import { cn } from "@/lib/utils";

export type ExchangeWorkspaceAction = {
  key: string;
  title: string;
  subtitle: string;
  stat: string;
  onClick: () => void;
  icon: LucideIcon;
  tone?: "gold" | "blue" | "green" | "amber";
};

export function ExchangeWorkspaceNavigation({ cards, isAr, integrated = false, compact = false }: {
  cards: ExchangeWorkspaceAction[];
  isAr: boolean;
  integrated?: boolean;
  compact?: boolean;
}) {
  return (
    <div id="workspace-summary" className={cn("min-w-0 scroll-mt-24", !integrated && "mt-5")}>
      <h2 className="text-lg font-semibold text-white md:text-xl">{isAr ? "مساحة العمل" : "Your workspace"}</h2>
      <p className="mt-1 text-sm leading-6 text-[#B6BDC8]">{isAr ? "اختر المهمة التي تريد تنفيذها الآن." : "Choose what you want to do next."}</p>
      <div dir={compact ? "ltr" : undefined} className={cn("mt-3 grid gap-2", compact ? "grid-cols-2" : integrated ? "min-[360px]:grid-cols-2 xl:grid-cols-3" : "min-[360px]:grid-cols-2 xl:grid-cols-4")}>
        {cards.filter((card) => !integrated || card.key !== "create-listing").map((card) => {
          const Icon = card.icon;
          const statIsAction = ["create-listing", "public-profile", "buyer-profile", "account-settings", "marketplace-compliance"].includes(card.key);
          const toneClass = card.tone === "gold"
            ? "border-[#C9A227]/35 bg-[#C9A227]/10"
            : card.tone === "blue"
              ? "border-[#6CAEFF]/35 bg-[#6CAEFF]/10"
              : card.tone === "green"
                ? "border-emerald-500/35 bg-emerald-500/10"
                : "border-amber-500/35 bg-amber-500/10";
          return (
            <button
              key={card.key}
              type="button"
              dir={compact ? (isAr ? "rtl" : "ltr") : undefined}
              onClick={card.onClick}
              aria-label={`${card.title}: ${compact ? `${card.stat}. ` : ""}${card.subtitle}`}
              className={cn("flex min-w-0 w-full flex-col rounded-2xl border p-3 text-start [overflow-wrap:anywhere] transition hover:-translate-y-0.5 hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F4D87A]", compact || integrated ? "min-h-[100px]" : "min-h-[116px]", toneClass)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-5 text-white">{currencyText(card.title)}</p>
                  <p className={cn("mt-1 text-xs leading-5 text-[#C8CDD5]", !integrated && "line-clamp-2")}>{currencyText(card.subtitle)}</p>
                </div>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/20">
                  <Icon className="h-4 w-4 text-[#F4D87A]" />
                </span>
              </div>
              <p className={cn("mt-auto pt-2 font-semibold", statIsAction ? "inline-flex items-center gap-1 text-sm text-[#F4D87A]" : "text-xl tracking-tight text-white")}>
                {currencyText(card.stat)}
                {statIsAction ? <ArrowRight className={cn("h-4 w-4", isAr && "rotate-180")} aria-hidden="true" /> : null}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
