"use client";

import { Menu } from "lucide-react";
import { useEffect, useRef, type FocusEvent, type MouseEvent, type ReactNode } from "react";

type MobileNavigationMenuProps = {
  children: ReactNode;
  label: string;
};

export function MobileNavigationMenu({ children, label }: MobileNavigationMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep the active destination usable on short screens. Scroll only the
  // dropdown; scrollIntoView would also move the page behind the sticky header.
  const revealActiveLink = () => {
    const panel = panelRef.current;
    if (!detailsRef.current?.open || !panel) return;
    const link = panel.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    if (!link) return;
    const bounds = panel.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    if (bounds.height > 0 && item.height > 0 && (item.top < bounds.top || item.bottom > bounds.bottom)) {
      panel.scrollTop += (item.top + item.bottom - bounds.top - bounds.bottom) / 2;
    }
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
        detailsRef.current.querySelector("summary")?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  const closeAfterNavigation = (event: MouseEvent<HTMLDetailsElement>) => {
    if (event.target instanceof Element && event.target.closest("a, button")) {
      detailsRef.current?.removeAttribute("open");
    }
  };
  const closeAfterFocusLeaves = (event: FocusEvent<HTMLDetailsElement>) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
      detailsRef.current?.removeAttribute("open");
    }
  };

  return (
    <details ref={detailsRef} className="group relative xl:hidden" onToggle={revealActiveLink} onClickCapture={closeAfterNavigation} onBlur={closeAfterFocusLeaves}>
      <summary aria-label={label} className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-white/20 text-[#9CA3AF] transition-colors duration-200 hover:border-[#C9A227] hover:text-[#C9A227] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/70">
        <Menu aria-hidden="true" className="h-4 w-4" />
      </summary>
      <div ref={panelRef} className="absolute end-0 top-12 z-50 max-h-[calc(100dvh-12rem-env(safe-area-inset-bottom))] w-[min(18rem,calc(100vw-2rem))] origin-top-right touch-pan-y overflow-y-auto overscroll-contain whitespace-normal rounded-2xl border border-white/15 bg-[#0b0b0b]/95 p-3 shadow-2xl backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
        {children}
      </div>
    </details>
  );
}
