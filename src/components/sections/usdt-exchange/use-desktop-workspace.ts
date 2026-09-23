"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_WORKSPACE_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_WORKSPACE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_WORKSPACE_QUERY).matches;
}

const getServerSnapshot = () => false;

/** Keep the established phone/tablet experience until a desktop viewport is known. */
export function useDesktopWorkspace() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
