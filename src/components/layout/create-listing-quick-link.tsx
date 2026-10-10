"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { revealPageSection } from "@/lib/page-section-navigation";

type CreateListingQuickLinkProps = {
  className: string;
  label: string;
};

export function CreateListingQuickLink({ className, label }: CreateListingQuickLinkProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    if (pathname.endsWith("/usdt-exchange") || pathname.endsWith("/dashboard/seller")) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#create-listing`);
      revealPageSection("create-listing");
      return;
    }
    router.push("/usdt-exchange#create-listing");
  }, [pathname, router]);

  return (
    <button type="button" onClick={handleClick} className={`${className} cursor-pointer`}>
      ➕ {label}
    </button>
  );
}
