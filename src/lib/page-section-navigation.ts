let cancelPendingNavigation: (() => void) | undefined;
let pendingRouteRequest: {
  target: URL;
  sourceRoute: string;
  initiator: Element | null;
  cancel: () => void;
} | undefined;
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

/** Carry an explicit section request across a client-side route transition. */
export function preparePageSectionNavigation(destination: string) {
  pendingRouteRequest?.cancel();
  if (typeof window === "undefined") return;
  const target = new URL(destination, window.location.href);
  const current = new URL(window.location.href);
  if (target.origin !== current.origin || !pageSectionId(target.hash)) return;
  // The localized router accepts unprefixed paths. Bind the request to the
  // current locale now, so it cannot activate on a later locale transition.
  const locale = current.pathname.match(/^\/(en|ar)(?:\/|$)/)?.[1];
  if (locale && !/^\/(en|ar)(?:\/|$)/.test(target.pathname)) {
    target.pathname = `/${locale}${target.pathname}`;
  }
  const sourceRoute = `${current.pathname}${current.search}`;
  if (`${target.pathname}${target.search}` === sourceRoute) return;
  const initiator = document.activeElement;
  const interactionEvents = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
  const historyEvents = ["popstate", "hashchange"] as const;
  const cancel = () => {
    window.clearTimeout(timer);
    for (const event of interactionEvents) document.removeEventListener(event, cancel, true);
    document.removeEventListener("focusin", onFocus, true);
    for (const event of historyEvents) window.removeEventListener(event, cancel);
    if (pendingRouteRequest?.cancel === cancel) pendingRouteRequest = undefined;
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target !== initiator && event.target !== document.body && event.target !== document.documentElement) cancel();
  };
  const timer = window.setTimeout(cancel, 10_000);
  pendingRouteRequest = { target, sourceRoute, initiator, cancel };
  for (const event of interactionEvents) document.addEventListener(event, cancel, { capture: true, passive: true });
  document.addEventListener("focusin", onFocus, { capture: true, passive: true });
  for (const event of historyEvents) window.addEventListener(event, cancel);
}

/** Consume only the requested route, while its initiating control still owns focus. */
export function consumePageSectionNavigationRequest() {
  const request = pendingRouteRequest;
  if (!request || typeof window === "undefined") return "";
  const route = `${window.location.pathname}${window.location.search}`;
  if (`${request.target.pathname}${request.target.search}` !== route
    || pageSectionId(request.target.hash) !== pageSectionId(window.location.hash)) {
    if (route !== request.sourceRoute) request.cancel();
    return "";
  }
  request.cancel();
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement
    && active !== request.initiator && active.isConnected) return "";
  return pageSectionId(request.target.hash);
}

/** Next's imperative same-page navigation does not emit a native hashchange. */
export function navigateToPageSection(router: { push: (href: string) => void }, destination: string) {
  if (typeof window === "undefined") { router.push(destination); return; }
  const target = new URL(destination, window.location.href);
  const current = new URL(window.location.href);
  preparePageSectionNavigation(destination);
  try {
    router.push(destination);
  } catch (error) {
    pendingRouteRequest?.cancel();
    throw error;
  }
  const locale = (path: string) => path.match(/^\/(en|ar)(?:\/|$)/)?.[1];
  const path = (value: string) => value.replace(/^\/(en|ar)(?=\/|$)/, "") || "/";
  if (target.origin !== current.origin || path(target.pathname) !== path(current.pathname)
    || target.search !== current.search || (locale(target.pathname) && locale(target.pathname) !== locale(current.pathname))) return;
  const id = pageSectionId(target.hash);
  if (id) revealPageSection(id);
}

/** Keep one requested section visible while deferred content changes its position. */
export function revealPageSection(sectionId: string) {
  cancelPageSectionNavigation();
  if (typeof window === "undefined" || !sectionId) return () => {};

  const route = `${window.location.pathname}${window.location.search}`;
  const invocationTarget = document.activeElement;
  let trackedTarget: HTMLElement | null = null;
  let announcedTarget: HTMLElement | null = null;
  let lastTop: number | undefined;
  let lastHeight: number | undefined;
  let frame: number | undefined;
  let stopped = false;
  const timers: number[] = [];
  let resize: ResizeObserver | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutations?.disconnect();
    resize?.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    timers.forEach((timer) => window.clearTimeout(timer));
    for (const event of ["pointerdown", "keydown", "wheel", "touchmove"] as const) {
      document.removeEventListener(event, interrupt, true);
    }
    if (cancelPendingNavigation === stop) cancelPendingNavigation = undefined;
  };
  cancelPendingNavigation = stop;

  const interrupt = () => {
    if (stopped) return;
    stop();
  };

  const reveal = () => {
    if (stopped) return;
    if (`${window.location.pathname}${window.location.search}` !== route) return stop();
    const target = document.getElementById(sectionId);
    if (!target) return;
    // A deferred page may mount after the initial request was announced. Give
    // its controller ownership before the generic restorer moves or focuses it.
    if (announcedTarget !== target) {
      announcedTarget = target;
      if (!window.dispatchEvent(new CustomEvent(PAGE_SECTION_NAVIGATION_EVENT, { detail: sectionId, cancelable: true }))) return stop();
    }
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
      // Focus and viewport position must settle together. A smooth scroll can
      // move the next control after its pointer coordinates have been chosen,
      // before pointerdown can cancel the animation (CI1138).
      target.scrollIntoView({
        behavior: "instant",
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
  const mutations = new MutationObserver(scheduleReveal);
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] });
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(scheduleReveal);
    resize.observe(document.body);
  }
  for (const event of ["pointerdown", "keydown", "wheel", "touchmove"] as const) {
    document.addEventListener(event, interrupt, { capture: true, passive: true });
  }
  // React can replace the focused section during initial data hydration.
  for (const delay of [100, 250, 500, 1_000, 2_000, 4_000]) {
    timers.push(window.setTimeout(reveal, delay));
  }
  timers.push(window.setTimeout(stop, 10_000));
  // Tabbed sections need to mount their content before they can be focused.
  if (!window.dispatchEvent(new CustomEvent(PAGE_SECTION_NAVIGATION_EVENT, { detail: sectionId, cancelable: true }))) {
    stop();
    return stop;
  }
  reveal();
  scheduleReveal();
  return stop;
}
