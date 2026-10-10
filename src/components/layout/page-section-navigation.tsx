"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cancelPageSectionNavigation, pageSectionId, revealPageSection } from "@/lib/page-section-navigation";

/** Native hash scrolling runs before streamed and dynamically imported panels mount. */
export function PageSectionNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    const revealHash = () => {
      const id = pageSectionId(window.location.hash);
      if (id) revealPageSection(id);
      else cancelPageSectionNavigation();
    };
    // Next commits its URL and its rendered page in the same navigation turn.
    const frame = window.requestAnimationFrame(revealHash);
    window.addEventListener("hashchange", revealHash);
    window.addEventListener("popstate", revealHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", revealHash);
      window.removeEventListener("popstate", revealHash);
      cancelPageSectionNavigation();
    };
  }, [pathname, search]);

  useEffect(() => {
    const revealSamePageLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname
        || url.search !== window.location.search || !url.hash) return;
      // Next Link uses pushState for same-page links, which emits no hashchange.
      // Its normal navigation still owns the URL, history, and access checks.
      const id = pageSectionId(url.hash);
      if (id) revealPageSection(id);
    };
    document.addEventListener("click", revealSamePageLink);
    return () => document.removeEventListener("click", revealSamePageLink);
  }, []);

  return null;
}
