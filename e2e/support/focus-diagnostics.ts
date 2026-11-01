import { test as base, type Page } from "@playwright/test";

const MAX_EVENTS = 512;
const TARGET_TESTS = new Set([
  "action transition matrix: destination query/hash + focused section + CTA across required states",
  "bank-transfer listing requires selected seller bank account and preserves privacy in public listings",
]);

// Keep the event history missing from D95/D110 without recording entered text.
// Each navigation creates a fresh document; the bounded buffer spans the test.
export async function installFocusDiagnostics(page: Page) {
  const events: unknown[] = [];
  let droppedEvents = 0;
  await page.exposeBinding("__alphaFocusDiagnostic", (_source, event: unknown) => {
    if (events.length === MAX_EVENTS) { events.shift(); droppedEvents += 1; }
    events.push(event);
  });
  await page.addInitScript(() => {
    type DiagnosticWindow = Window & { __alphaFocusDiagnostic: (event: unknown) => Promise<void> };
    const label = (node: EventTarget | null) => node instanceof Element
      ? `${node.tagName.toLowerCase()}#${node.id}`.slice(0,100)
      : node === window ? "window" : node === document ? "document" : "none";
    const state = () => ({
      active: label(document.activeElement),
      documentFocused: document.hasFocus(),
      visibility: document.visibilityState,
      path: /^https?:$/.test(location.protocol) ? location.pathname.slice(0,256) : "[non-http]",
      amounts: ["create-available", "create-price", "create-min-trade"].map(id => {
        const input = document.getElementById(id);
        return input instanceof HTMLInputElement
          ? { id, length: input.value.length, empty: input.value === "", disabled: input.disabled }
          : { id, absent: true };
      }),
      actionPresent: Boolean(document.getElementById("action-required")),
      contactDialogOpen: Boolean(document.getElementById("buyer-private-phone")?.closest("dialog[open]")),
    });
    const record = (type: string, detail: unknown = null) => {
      void (window as unknown as DiagnosticWindow).__alphaFocusDiagnostic({
        type, time: performance.now(), timeOrigin: performance.timeOrigin, ...state(), detail,
      }).catch(() => {});
    };
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      record("focus-call", { target: label(this), connected: this.isConnected });
      originalFocus.apply(this, args);
      record("focus-return", { target: label(this) });
    };
    for (const type of ["focus", "blur", "focusin", "focusout", "pointerdown", "keydown", "beforeinput", "input", "change", "visibilitychange", "DOMContentLoaded", "pageshow", "pagehide"]) {
      window.addEventListener(type, event => {
        record(type, { target: label(event.target), trusted: event.isTrusted });
        if (type === "input" || type === "change") queueMicrotask(() => record(`${type}-settled`));
      }, true);
    }
    let previous = "";
    const observe = () => {
      const current = JSON.stringify(state());
      if (current !== previous) { previous = current; record("state-change"); }
    };
    new MutationObserver(observe).observe(document, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "open"],
    });
    window.setInterval(observe, 100);
  });
  return () => ({ version: 1, maxEvents: MAX_EVENTS, droppedEvents, events: [...events] });
}

type FocusDiagnosticsFixtures = {
  // Lifecycle tests can create their own session pages without using `page`.
  captureFocusDiagnostics: (page: Page) => Promise<void>;
};

export const test = base.extend<FocusDiagnosticsFixtures>({
  captureFocusDiagnostics: async ({}, runTest, testInfo) => {
    const snapshots = new Map<Page, Awaited<ReturnType<typeof installFocusDiagnostics>>>();
    await runTest(async (page) => {
      if (!TARGET_TESTS.has(testInfo.title) || snapshots.has(page)) return;
      snapshots.set(page, await installFocusDiagnostics(page));
    });
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const [index, snapshot] of [...snapshots.values()].entries()) {
        await testInfo.attach(index === 0 ? "focus-diagnostics" : `focus-diagnostics-${index + 1}`, {
          body: Buffer.from(JSON.stringify(snapshot())), contentType: "application/json",
        });
      }
    }
  },
  page: async ({ page, captureFocusDiagnostics }, runTest) => {
    await captureFocusDiagnostics(page);
    await runTest(page);
  },
});
