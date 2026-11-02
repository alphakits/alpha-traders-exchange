"use client";

import { useSyncExternalStore } from "react";

const TOUCH_ONLY = "(pointer: coarse) and (hover: none)";
const noSubscription = () => () => {};
const notTouchOnly = () => false;

// Android tablets in desktop-site mode can send an ordinary desktop Linux UA.
// Only use input capabilities to resolve that ambiguous case, never to switch a Windows PC.
function mayBeDesktopSiteTablet() {
  return navigator.maxTouchPoints > 0 && /\bX11;\s*Linux\b/i.test(navigator.userAgent);
}

function subscribe(onChange: () => void) {
  if (!mayBeDesktopSiteTablet()) return () => {};
  const media = window.matchMedia(TOUCH_ONLY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function touchOnlyTablet() {
  return mayBeDesktopSiteTablet() && window.matchMedia(TOUCH_ONLY).matches;
}

export function useDesktopListingLayout(compactDevice: boolean, desktopViewport: boolean | null) {
  const desktopSiteTablet = useSyncExternalStore(
    compactDevice ? noSubscription : subscribe,
    compactDevice ? notTouchOnly : touchOnlyTablet,
    notTouchOnly,
  );
  return !compactDevice && !desktopSiteTablet && desktopViewport !== false;
}
