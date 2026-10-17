import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { createHardNavigationErrorAudit } from "../../e2e/support/hard-navigation-errors";
import { E2E_BASE_URL } from "../../e2e/support/base-url";

const marketUrl = `${E2E_BASE_URL}/api/market/center`;
const refusal = (url = marketUrl) => Object.assign(new Error(`/localhost:3000/api/market/center due to access control checks.`), {
  stack: `Fetch API cannot load ${url} due to access control checks.\n    at poll`,
});

function fakePage() {
  const events = new EventEmitter();
  const frame = {};
  let acceptResponse!: (response: Response) => void;
  const page = Object.assign(events, {
    mainFrame: () => frame,
    url: () => `${E2E_BASE_URL}/en/trade-room/synthetic`,
    waitForResponse: (predicate: (response: Response) => boolean) => new Promise<Response>((resolve) => {
      acceptResponse = (response) => { if (predicate(response)) resolve(response); };
    }),
  }) as unknown as Page;
  const startRequest = () => {
    const request = { method: () => "GET", frame: () => frame } as unknown as Request;
    events.emit("request", request);
    return request;
  };
  const response = (status: number, valid: boolean, request: Request) => ({
    url: () => marketUrl, request: () => request, frame: () => frame,
    ok: () => status === 200, status: () => status,
    json: async () => valid ? { snapshot: { pairs: { btcUsdt: { price: 100000 }, ethUsdt: { price: 3000 }, usdtIls: { price: 3.6 } } } } : {},
  }) as unknown as Response;
  return {
    page, error: (error: Error) => events.emit("pageerror", error),
    commit: () => events.emit("framenavigated", frame),
    startRequest,
    respond: (status = 200, valid = true, request = startRequest()) => acceptResponse(response(status, valid, request)),
  };
}

describe("hard-navigation browser error audit", () => {
  it("records the exact WebKit teardown refusal only after a healthy destination", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    await audit.navigate(fixture.page, async () => {
      fixture.error(refusal());
      expect(audit.report().navigationCancellations).toHaveLength(0);
      fixture.commit(); fixture.respond();
    });
    expect(audit.errors).toEqual([]);
    expect(audit.report().navigationCancellations).toEqual([expect.objectContaining({ marketStatus: 200, destination: fixture.page.url() })]);
  });

  it("does not accept a response from the departing document", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    let settled = false;
    const pending = audit.navigate(fixture.page, async () => {
      fixture.error(refusal());
      const oldRequest = fixture.startRequest();
      fixture.commit(); fixture.respond(200, true, oldRequest);
    }).then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    fixture.respond(); await pending;
    expect(audit.report().navigationCancellations).toHaveLength(1);
  });

  it.each(["chromium", "firefox"])("preserves the same error in %s", async (browser) => {
    const audit = createHardNavigationErrorAudit(browser), fixture = fakePage();
    await audit.navigate(fixture.page, async () => { fixture.error(refusal()); fixture.commit(); fixture.respond(); });
    expect(audit.errors).toHaveLength(1);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it("preserves errors outside navigation and after document commit", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    audit.observe(fixture.page); fixture.error(refusal());
    await audit.navigate(fixture.page, async () => { fixture.commit(); fixture.error(refusal()); fixture.respond(); });
    fixture.error(refusal());
    expect(audit.errors).toHaveLength(3);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it("preserves unrelated errors, other API paths and other origins", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    await audit.navigate(fixture.page, async () => {
      fixture.error(new Error("Unhandled application failure"));
      fixture.error(refusal(`${E2E_BASE_URL}/api/auth/profile`));
      fixture.error(refusal("https://external.invalid/api/market/center"));
      fixture.commit(); fixture.respond();
    });
    expect(audit.errors).toHaveLength(3);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each([[503, true], [200, false]])("rejects an unhealthy destination (%s, valid=%s)", async (status, valid) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    await expect(audit.navigate(fixture.page, async () => {
      fixture.error(refusal()); fixture.commit(); fixture.respond(status as number, valid as boolean);
    })).rejects.toThrow(/Destination market feed/);
    expect(audit.errors).toHaveLength(1);
    expect(audit.report().navigationCancellations).toEqual([]);
  });
});
