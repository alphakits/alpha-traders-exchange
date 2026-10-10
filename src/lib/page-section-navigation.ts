let cancelPendingNavigation: (() => void) | undefined;
export const PAGE_SECTION_NAVIGATION_EVENT = "alpha:page-section";

export function cancelPageSectionNavigation() {
  cancelPendingNavigation?.();
}

export function pageSectionId(hash: string) {
  try {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    return id === "create-listing-form" ? "create-listing" : id;
  } catch {
    return "";
  }
}

export function pageSectionFromEvent(event?: Event) {
  return event?.type === PAGE_SECTION_NAVIGATION_EVENT && event instanceof CustomEvent && typeof event.detail === "string"
    ? event.detail : pageSectionId(window.location.hash);
}

/** Keep one requested section visible while deferred content changes its position. */
export function revealPageSection(sectionId: string) {
  cancelPageSectionNavigation();
  if (typeof window === "undefined" || !sectionId) return () => {};

  const route = `${window.location.pathname}${window.location.search}`;
  const invocationTarget = document.activeElement;
  let trackedTarget: HTMLElement | null = null;
  let lastTop: number | undefined;
  let lastHeight: number | undefined;
  let frame: number | undefined;
  let stopped = false;
  const timers: number[] = [];
  let mutations: MutationObserver | undefined;
  let resize: ResizeObserver | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutations?.disconnect();
    resize?.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    timers.forEach((timer) => window.clearTimeout(timer));
    for (const event of ["pointerdown", "keydown", "wheel", "touchmove"] as const) {
      document.removeEventListener(event, stop, true);
    }
    if (cancelPendingNavigation === stop) cancelPendingNavigation = undefined;
  };
  cancelPendingNavigation = stop;

  const reveal = () => {
    if (stopped) return;
    if (`${window.location.pathname}${window.location.search}` !== route) return stop();
    const target = document.getElementById(sectionId);
    if (!target) return;
    // A target can itself be a disclosure, or sit inside several closed ones.
    for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
    }
    if (target.closest("[hidden], [inert]")) return;
    const active = document.activeElement;
    const canFocus = !active || active === document.body || active === document.documentElement
      || active === invocationTarget || active === trackedTarget || !active.isConnected;
    const top = target.getBoundingClientRect().top + window.scrollY;
    const height = document.documentElement.scrollHeight;
    if (trackedTarget !== target || lastTop === undefined || Math.abs(top - lastTop) > 1 || height !== lastHeight) {
      target.scrollIntoView({
        behavior: trackedTarget === null && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant",
        block: "start",
      });
      lastTop = top;
      lastHeight = height;
    }
    if (canFocus && !target.contains(active)) {
      if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    trackedTarget = target;
  };

  const scheduleReveal = () => {
    if (stopped || frame !== undefined) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      reveal();
    });
  };
  mutations = new MutationObserver(scheduleReveal);
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] });
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(scheduleReveal);
    resize.observe(document.body);
  }
  for (const event of ["pointerdown", "keydown", "wheel", "touchmove"] as const) {
    document.addEventListener(event, stop, { capture: true, passive: true });
  }
  // React can replace the focused section during initial data hydration.
  for (const delay of [100, 250, 500, 1_000, 2_000, 4_000]) {
    timers.push(window.setTimeout(reveal, delay));
  }
  timers.push(window.setTimeout(stop, 10_000));
  // Tabbed sections need to mount their content before they can be focused.
  window.dispatchEvent(new CustomEvent(PAGE_SECTION_NAVIGATION_EVENT, { detail: sectionId }));
  reveal();
  scheduleReveal();
  return stop;
}
