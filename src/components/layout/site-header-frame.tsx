"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { isAlphaExchangePath } from "@/lib/exchange-navigation";

export function SiteHeaderFrame({ children }: { children: ReactNode }) {
  const exchange = isAlphaExchangePath(usePathname());
  return <div dir={exchange ? "ltr" : undefined} className="section-container relative flex h-16 items-center justify-between gap-1.5 sm:gap-3">{children}</div>;
}

export function HeaderBrandText({ children, signedIn, label }: { children: ReactNode; signedIn: boolean; label: string }) {
  const exchange = isAlphaExchangePath(usePathname());
  return <span className={`${exchange && signedIn ? "hidden min-[430px]:flex" : "flex"} shrink-0 flex-col`} aria-label={label}>{children}</span>;
}
