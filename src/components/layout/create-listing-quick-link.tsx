"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

type CreateListingQuickLinkProps = {
  className: string;
  label: string;
};

function scrollToCreateListing() {
  const target = document.getElementById("create-listing") ?? document.getElementById("create-listing-form");
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

export function CreateListingQuickLink({ className, label }: CreateListingQuickLinkProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    if (pathname.endsWith("/usdt-exchange")) {
      window.history.replaceState(null, "", `${window.location.pathname}#create-listing`);
      if (scrollToCreateListing()) return;
      const startedAt = Date.now();
      const tryScroll = () => {
        if (scrollToCreateListing()) return;
        if (Date.now() - startedAt > 10000) return;
        window.requestAnimationFrame(tryScroll);
      };
      window.requestAnimationFrame(tryScroll);
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
