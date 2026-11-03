import { EventEmitter } from "node:events";
import type { Frame, Page, Request, Response } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { createHardNavigationErrorAudit, unblockedAccountDestinationFeed } from "../../e2e/support/hard-navigation-errors";
import { E2E_BASE_URL } from "../../e2e/support/base-url";

const marketUrl = `${E2E_BASE_URL}/api/market/center`;
const refusal = (url = marketUrl) => Object.assign(new Error(`/localhost:3000/api/market/center due to access control checks.`), {
  stack: `Fetch API cannot load ${url} due to access control checks.\n    at poll`,
});

function fakePage(pageUrl = `${E2E_BASE_URL}/en/trade-room/synthetic`) {
  const events = new EventEmitter();
  const frame = {} as Frame;
  const responseWaiters = new Set<{
    predicate: (response: Response) => boolean;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }>();
  const acceptResponse = (response: Response) => {
    for (const waiter of responseWaiters) {
      if (!waiter.predicate(response)) continue;
      responseWaiters.delete(waiter);
      waiter.resolve(response);
    }
  };
  const page = Object.assign(events, {
    mainFrame: () => frame,
    url: () => pageUrl,
    waitForResponse: (predicate: (response: Response) => boolean) => new Promise<Response>((resolve, reject) => {
      responseWaiters.add({ predicate, resolve, reject });
    }),
  }) as unknown as Page;
  const startRequest = (method = "GET", requestFrame = frame) => {
    const request = { method: () => method, frame: () => requestFrame } as unknown as Request;
    events.emit("request", request);
    return request;
  };
  const response = (status: number, valid: boolean, request: Request) => ({
    url: () => marketUrl, request: () => request, frame: () => frame,
    ok: () => status >= 200 && status < 300, status: () => status,
    json: async () => valid ? { snapshot: { pairs: { btcUsdt: { price: 100000 }, ethUsdt: { price: 3000 }, usdtIls: { price: 3.6 } } } } : {},
  }) as unknown as Response;
  return {
    page, error: (error: Error) => events.emit("pageerror", error),
    frame, commit: (committedFrame = frame) => events.emit("framenavigated", committedFrame),
    startRequest,
    pendingResponseCount: () => responseWaiters.size,
    failResponses: (error = new Error("Destination response timed out")) => {
      for (const waiter of responseWaiters) waiter.reject(error);
      responseWaiters.clear();
    },
    respond: (status = 200, valid = true, request = startRequest()) => acceptResponse(response(status, valid, request)),
    respondJson: (body: unknown, options: { url?: string; status?: number; request?: Request; frame?: Frame } = {}) => {
      const status = options.status ?? 200;
      const request = options.request ?? startRequest();
      acceptResponse({
        url: () => options.url ?? demandUrl, request: () => request, frame: () => options.frame ?? frame,
        ok: () => status >= 200 && status < 300, status: () => status, json: async () => body,
      } as unknown as Response);
    },
  };
}

const demandUrl = `${E2E_BASE_URL}/api/alpha-exchange/usdt-requests/demand-synthetic`;
const expectedNativeText = `Fetch API cannot load ${demandUrl} due to access control checks.`;
const validDemandBody = () => ({ actorId: "buyer-synthetic", requests: [{ id: "demand-synthetic", revision: 1, isMine: true,
  offers: [{ id: "offer-new", price: "3.25", state: "open" }] }] });
const demandFeed = {
  url: demandUrl, label: "authenticated Buy Requests feed",
  validateBody: (body: unknown) => {
    const candidate = body as ReturnType<typeof validDemandBody> | null;
    const request = candidate?.requests?.find(request => request.id === "demand-synthetic");
    return candidate?.actorId === "buyer-synthetic" && request?.revision === 1 && request.isMine === true
      && request.offers?.some(offer => offer.id === "offer-new" && offer.price === "3.25" && offer.state === "open") === true;
  },
};

describe("accepted Trade Room account-safety reload", () => {
  const url = `${E2E_BASE_URL}/api/alpha-exchange/user-blocks/offline-seller`;
  const feed = unblockedAccountDestinationFeed(url);

  it("retains the pre-commit native diagnostic only after a fresh same-counterparty read", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const nativeError = refusal(url);
    await audit.navigate(fixture.page, async () => {
      fixture.error(nativeError);
      fixture.commit(); fixture.respondJson({ blocked: false }, { url });
    }, feed);
    expect(audit.errors).toEqual([]);
    expect(audit.report().navigationCancellations).toEqual([expect.objectContaining({
      message: nativeError.message, stack: nativeError.stack, feedUrl: url, feedStatus: 200,
    })]);
  });

  it.each([null, {}, [], { blocked: true }, { blocked: "false" }, { blocked: false, error: "Unavailable" }])(
    "does not excuse the cancellation for an invalid or changed block contract: %j", async body => {
      const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
      const nativeError = refusal(url);
      await expect(audit.navigate(fixture.page, async () => {
        fixture.error(nativeError); fixture.commit(); fixture.respondJson(body, { url });
      }, feed)).rejects.toThrow("did not return a valid snapshot");
      expect(audit.errors).toEqual([nativeError.message]);
      expect(audit.report().navigationCancellations).toEqual([]);
    },
  );

  it("still fails a native-looking refusal after the new Trade Room commits", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const nativeError = refusal(url);
    await audit.navigate(fixture.page, async () => {
      fixture.commit(); fixture.error(nativeError); fixture.respondJson({ blocked: false }, { url });
    }, feed);
    expect(audit.errors).toEqual([nativeError.message]);
    expect(audit.report().navigationCancellations).toEqual([]);
  });
});

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
    expect(fixture.pendingResponseCount()).toBe(1);
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

  it("keeps the default market audit usable for the first navigation from about:blank", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage("about:blank");
    await audit.navigate(fixture.page, async () => {
      fixture.error(refusal()); fixture.commit(); fixture.respond(202);
    });
    expect(audit.errors).toEqual([]);
    expect(audit.report().navigationCancellations[0]).toMatchObject({ marketStatus: 202, feedStatus: 202, feedUrl: marketUrl });
  });

  it("preserves the legacy exact-message matcher only for the implicit market default", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const legacyError = new Error(`Fetch API cannot load ${marketUrl} due to access control checks.`);
    await audit.navigate(fixture.page, async () => {
      fixture.error(legacyError); fixture.commit(); fixture.respond();
    });
    expect(audit.errors).toEqual([]);
    expect(audit.report().navigationCancellations).toEqual([expect.objectContaining({ stack: legacyError.stack, marketStatus: 200 })]);
  });
});

describe("explicit authenticated destination feed audit", () => {
  it("retains the raw native diagnostic only after the new document proves the exact authenticated state", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const nativeError = refusal(demandUrl);
    await audit.navigate(fixture.page, async () => {
      fixture.error(nativeError);
      expect(audit.report().navigationCancellations).toEqual([]);
      fixture.commit(); fixture.respondJson(validDemandBody());
    }, demandFeed);
    expect(audit.errors).toEqual([]);
    expect(audit.report().navigationCancellations).toEqual([{
      message: nativeError.message, stack: nativeError.stack, observedAt: expect.any(String),
      destination: fixture.page.url(), feedUrl: demandUrl, feedStatus: 200,
    }]);
  });

  it.each([
    ["wrong actor", (): unknown => ({ ...validDemandBody(), actorId: "another-buyer" })],
    ["wrong revision", (): unknown => ({ ...validDemandBody(), requests: [{ ...validDemandBody().requests[0], revision: 2 }] })],
    ["different request", (): unknown => ({ ...validDemandBody(), requests: [{ ...validDemandBody().requests[0], id: "another-demand" }] })],
    ["non-owner projection", (): unknown => ({ ...validDemandBody(), requests: [{ ...validDemandBody().requests[0], isMine: false }] })],
    ["missing new response", (): unknown => ({ ...validDemandBody(), requests: [{ ...validDemandBody().requests[0], offers: [] }] })],
    ["wrong response price", (): unknown => ({ ...validDemandBody(), requests: [{ ...validDemandBody().requests[0], offers: [{ id: "offer-new", price: "3.30", state: "open" }] }] })],
    ["wrong response state", (): unknown => ({ ...validDemandBody(), requests: [{ ...validDemandBody().requests[0], offers: [{ id: "offer-new", price: "3.25", state: "withdrawn" }] }] })],
    ["missing body", (): unknown => null],
    ["empty body", (): unknown => ({})],
  ] as const)("does not excuse a native error when the destination returns %s", async (_label, body) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const nativeError = refusal(demandUrl);
    await expect(audit.navigate(fixture.page, async () => {
      fixture.error(nativeError); fixture.commit(); fixture.respondJson(body());
    }, demandFeed)).rejects.toThrow("Destination authenticated Buy Requests feed did not return a valid snapshot");
    expect(audit.errors).toEqual([nativeError.message]);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each([201, 202, 204, 401, 403, 503])("requires HTTP 200 for the custom feed even if the body is valid (HTTP %s)", async status => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    await expect(audit.navigate(fixture.page, async () => {
      fixture.error(refusal(demandUrl)); fixture.commit(); fixture.respondJson(validDemandBody(), { status });
    }, demandFeed)).rejects.toThrow(`returned HTTP ${status}`);
    expect(audit.errors).toHaveLength(1); expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each([
    ["another same-origin endpoint", `${E2E_BASE_URL}/api/alpha-exchange/usdt-requests/other-demand`],
    ["another origin", "https://external.invalid/api/alpha-exchange/usdt-requests/demand-synthetic"],
    ["extra query parameters", `${demandUrl}?other=1`],
  ])("preserves a refusal for %s", async (_label, url) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const otherError = refusal(url);
    await audit.navigate(fixture.page, async () => {
      fixture.error(otherError); fixture.commit(); fixture.respondJson(validDemandBody());
    }, demandFeed);
    expect(audit.errors).toEqual([otherError.message]); expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each(["https://external.invalid/feed", "http://localhost:65534/feed"])("rejects a cross-origin custom contract before navigation: %s", async url => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    let actionCalled = false;
    await expect(audit.navigate(fixture.page, async () => { actionCalled = true; }, { ...demandFeed, url })).rejects.toThrow("exact same-origin feed");
    expect(actionCalled).toBe(false); expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each([
    ["a real JavaScript Error", () => new Error(expectedNativeText)],
    ["a rejected-promise TypeError", () => new TypeError(expectedNativeText)],
    ["a message without the native stack header", () => Object.assign(new Error(expectedNativeText), { stack: undefined })],
    ["an unrelated application error", () => new Error("Cannot read properties of undefined")],
  ] as const)("never reclassifies %s even with matching URL and a healthy feed", async (_label, makeError) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const error = makeError();
    await audit.navigate(fixture.page, async () => {
      fixture.error(error); fixture.commit(); fixture.respondJson(validDemandBody());
    }, demandFeed);
    expect(audit.errors).toEqual([error.message]); expect(audit.report().navigationCancellations).toEqual([]);
  });

  it("preserves native errors outside the navigation window and after commit", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    audit.observe(fixture.page); fixture.error(refusal(demandUrl));
    await audit.navigate(fixture.page, async () => {
      fixture.commit(); fixture.error(refusal(demandUrl)); fixture.respondJson(validDemandBody());
    }, demandFeed);
    fixture.error(refusal(demandUrl));
    expect(audit.errors).toHaveLength(3); expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each(["departing document", "child frame", "POST", "other endpoint", "other origin"])("does not let a %s response validate a cancellation", async kind => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    let settled = false;
    const pending = audit.navigate(fixture.page, async () => {
      fixture.error(refusal(demandUrl));
      const oldRequest = fixture.startRequest();
      fixture.commit();
      const childFrame = {} as Frame;
      const request = kind === "departing document" ? oldRequest
        : fixture.startRequest(kind === "POST" ? "POST" : "GET", kind === "child frame" ? childFrame : fixture.frame);
      fixture.respondJson(validDemandBody(), {
        request, frame: kind === "child frame" ? childFrame : fixture.frame,
        url: kind === "other endpoint" ? `${demandUrl}-other` : kind === "other origin" ? "https://external.invalid/feed" : demandUrl,
      });
    }, demandFeed).then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.pendingResponseCount()).toBe(1);
    expect(settled).toBe(false); expect(audit.report().navigationCancellations).toEqual([]);
    fixture.respondJson(validDemandBody()); await pending;
    expect(audit.errors).toEqual([]); expect(audit.report().navigationCancellations).toHaveLength(1);
  });

  it.each(["chromium", "firefox"])("never reclassifies a native-looking custom-feed error in %s", async browser => {
    const audit = createHardNavigationErrorAudit(browser), fixture = fakePage();
    await audit.navigate(fixture.page, async () => {
      fixture.error(refusal(demandUrl)); fixture.commit(); fixture.respondJson(validDemandBody());
    }, demandFeed);
    expect(audit.errors).toHaveLength(1); expect(audit.report().navigationCancellations).toEqual([]);
  });
});

describe("multiple explicit destination feed audit", () => {
  const accountUrl = `${E2E_BASE_URL}/api/alpha-exchange/user-blocks/seller-synthetic`;
  const accountFeed = unblockedAccountDestinationFeed(accountUrl);
  const feeds = [demandFeed, accountFeed];

  it("requires every fresh feed and retains each native diagnostic's exact feed identity", async () => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const demandError = refusal(demandUrl), accountError = refusal(accountUrl);
    let settled = false;
    const pending = audit.navigate(fixture.page, async () => {
      fixture.error(demandError); fixture.error(accountError);
      fixture.commit(); fixture.respondJson({ blocked: false }, { url: accountUrl });
    }, feeds).then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.pendingResponseCount()).toBe(1);
    expect(settled).toBe(false);
    expect(audit.report().navigationCancellations).toEqual([]);
    fixture.respondJson(validDemandBody()); await pending;
    expect(audit.errors).toEqual([]);
    expect(audit.report().navigationCancellations).toEqual([
      expect.objectContaining({ stack: demandError.stack, feedUrl: demandUrl, feedStatus: 200 }),
      expect.objectContaining({ stack: accountError.stack, feedUrl: accountUrl, feedStatus: 200 }),
    ]);
  });

  it.each([
    ["the cancelled feed is healthy but its companion is missing", demandUrl],
    ["only another feed is healthy", accountUrl],
  ])("retains the error if %s", async (_label, errorUrl) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const nativeError = refusal(errorUrl);
    let settled = false;
    const pending = audit.navigate(fixture.page, async () => {
      fixture.error(nativeError); fixture.commit(); fixture.respondJson(validDemandBody());
    }, feeds).finally(() => { settled = true; });
    const rejected = expect(pending).rejects.toThrow("Destination response timed out");
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.pendingResponseCount()).toBe(1);
    expect(settled).toBe(false);
    expect(audit.report().navigationCancellations).toEqual([]);
    fixture.failResponses(); await rejected;
    expect(audit.errors).toEqual([nativeError.message]);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each([
    { label: "wrong actor", demandBody: { ...validDemandBody(), actorId: "another-buyer" }, accountBody: { blocked: false }, status: 200 },
    { label: "invalid companion body", demandBody: validDemandBody(), accountBody: { blocked: true }, status: 200 },
    { label: "missing companion body", demandBody: validDemandBody(), accountBody: null, status: 200 },
    { label: "non-200 success", demandBody: validDemandBody(), accountBody: { blocked: false }, status: 202 },
    { label: "failed companion response", demandBody: validDemandBody(), accountBody: { blocked: false }, status: 503 },
  ])("retains all candidates when any contract fails: $label", async ({ demandBody, accountBody, status }) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const nativeErrors = [refusal(demandUrl), refusal(accountUrl)];
    await expect(audit.navigate(fixture.page, async () => {
      nativeErrors.forEach(fixture.error); fixture.commit();
      fixture.respondJson(demandBody);
      fixture.respondJson(accountBody, { url: accountUrl, status });
    }, feeds)).rejects.toThrow(/Destination /);
    expect(audit.errors).toEqual(nativeErrors.map(error => error.message));
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each(["departing document", "child request frame", "child response frame", "POST", "other endpoint", "other origin"])(
    "does not use a %s response to complete the companion proof", async kind => {
      const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
      const nativeError = refusal(accountUrl);
      let settled = false;
      const pending = audit.navigate(fixture.page, async () => {
        fixture.error(nativeError);
        const oldRequest = fixture.startRequest();
        fixture.commit(); fixture.respondJson(validDemandBody());
        const childFrame = {} as Frame;
        const request = kind === "departing document" ? oldRequest
          : fixture.startRequest(kind === "POST" ? "POST" : "GET", kind === "child request frame" ? childFrame : fixture.frame);
        fixture.respondJson({ blocked: false }, {
          request, frame: kind === "child response frame" ? childFrame : fixture.frame,
          url: kind === "other endpoint" ? `${accountUrl}-other` : kind === "other origin" ? "https://external.invalid/feed" : accountUrl,
        });
      }, feeds).then(() => { settled = true; });
      await Promise.resolve(); await Promise.resolve();
      expect(fixture.pendingResponseCount()).toBe(1);
      expect(settled).toBe(false);
      expect(audit.report().navigationCancellations).toEqual([]);
      fixture.respondJson({ blocked: false }, { url: accountUrl }); await pending;
      expect(audit.errors).toEqual([]);
      expect(audit.report().navigationCancellations).toEqual([expect.objectContaining({ feedUrl: accountUrl })]);
    },
  );

  it.each([
    { label: "an empty list", contracts: [], message: "at least one destination feed" },
    { label: "a duplicate object", contracts: [demandFeed, demandFeed], message: "distinct destination feed URLs" },
    { label: "duplicate URLs in different objects", contracts: [demandFeed, { ...demandFeed, label: "another contract" }], message: "distinct destination feed URLs" },
    { label: "a cross-origin companion", contracts: [demandFeed, { ...accountFeed, url: "https://external.invalid/feed" }], message: "exact same-origin feed" },
  ])("rejects $label before calling the action", async ({ contracts, message }) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    let actionCalled = false;
    await expect(audit.navigate(fixture.page, async () => { actionCalled = true; }, contracts)).rejects.toThrow(message);
    expect(actionCalled).toBe(false);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each([
    { label: "a JavaScript Error", makeError: () => new Error(expectedNativeText), afterCommit: false },
    { label: "a JavaScript TypeError", makeError: () => new TypeError(expectedNativeText), afterCommit: false },
    { label: "a missing native stack", makeError: () => Object.assign(new Error(expectedNativeText), { stack: undefined }), afterCommit: false },
    { label: "an unrelated endpoint", makeError: () => refusal(`${E2E_BASE_URL}/api/auth/profile`), afterCommit: false },
    { label: "another origin", makeError: () => refusal("https://external.invalid/feed"), afterCommit: false },
    { label: "a post-commit native refusal", makeError: () => refusal(accountUrl), afterCommit: true },
  ])("keeps $label as an error even when all feeds recover", async ({ makeError, afterCommit }) => {
    const audit = createHardNavigationErrorAudit("webkit"), fixture = fakePage();
    const error = makeError();
    await audit.navigate(fixture.page, async () => {
      if (!afterCommit) fixture.error(error);
      fixture.commit();
      if (afterCommit) fixture.error(error);
      fixture.respondJson(validDemandBody()); fixture.respondJson({ blocked: false }, { url: accountUrl });
    }, feeds);
    expect(audit.errors).toEqual([error.message]);
    expect(audit.report().navigationCancellations).toEqual([]);
  });

  it.each(["chromium", "firefox"])("keeps explicit native-looking errors in %s", async browser => {
    const audit = createHardNavigationErrorAudit(browser), fixture = fakePage();
    const error = refusal(accountUrl);
    await audit.navigate(fixture.page, async () => {
      fixture.error(error); fixture.commit();
      fixture.respondJson(validDemandBody()); fixture.respondJson({ blocked: false }, { url: accountUrl });
    }, feeds);
    expect(audit.errors).toEqual([error.message]);
    expect(audit.report().navigationCancellations).toEqual([]);
  });
});
