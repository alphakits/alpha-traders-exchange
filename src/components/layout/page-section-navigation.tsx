"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cancelPageSectionNavigation, consumePageSectionNavigationRequest, pageSectionId, preparePageSectionNavigation, revealPageSection } from "@/lib/page-section-navigation";

/** Native hash scrolling runs before streamed and dynamically imported panels mount. */
export function PageSectionNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    let frame: number | undefined;
    const interactionEvents = ["pointerdown", "keydown", "wheel", "touchmove", "focusin"] as const;
    const cancelInitialRestore = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      for (const event of interactionEvents) document.removeEventListener(event, cancelInitialRestore, true);
    };
    const revealHash = () => {
      cancelInitialRestore();
      const id = pageSectionId(window.location.hash);
      if (id) revealPageSection(id);
      else cancelPageSectionNavigation();
    };
    // An empty initial hash has nothing to restore. Cancelling here can erase
    // a workspace action while its dynamically loaded target is mounting.
    // Actual hash/history changes still cancel an obsolete pending section.
    frame = window.requestAnimationFrame(() => {
      cancelInitialRestore();
      const requestedSection = consumePageSectionNavigationRequest();
      if (requestedSection) {
        revealPageSection(requestedSection);
        return;
      }
      // Hydration can finish after the user has already focused a tab or field.
      // Initial URL restoration must yield; explicit links/history still work.
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      if (pageSectionId(window.location.hash)) revealHash();
    });
    for (const event of interactionEvents) document.addEventListener(event, cancelInitialRestore, { capture: true, passive: true });
    window.addEventListener("hashchange", revealHash);
    window.addEventListener("popstate", revealHash);
    return () => {
      cancelInitialRestore();
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
      if (url.origin !== window.location.origin || !url.hash) return;
      if (url.pathname !== window.location.pathname || url.search !== window.location.search) {
        preparePageSectionNavigation(url.href);
        return;
      }
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
