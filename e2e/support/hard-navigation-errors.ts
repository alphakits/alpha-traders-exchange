import type { Frame, Page, Request, Response } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

const marketUrl = new URL("/api/market/center", E2E_BASE_URL).href;

type Cancellation = { message: string; stack?: string; observedAt: string };
export type DestinationFeed = { url: string; label: string; validateBody: (body: unknown) => boolean };
type Navigation = { committed: boolean; candidates: Array<Cancellation & { feed: DestinationFeed }>; feeds: DestinationFeed[] };

export function unblockedAccountDestinationFeed(url: string): DestinationFeed {
  return {
    url,
    label: "same counterparty account-safety status",
    validateBody: body => typeof body === "object" && body !== null && !Array.isArray(body)
      && Object.keys(body).length === 1 && (body as { blocked?: unknown }).blocked === false,
  };
}

const defaultFeed: DestinationFeed = {
  url: marketUrl,
  label: "market feed",
  validateBody: (body) => {
    const snapshot = body as { snapshot?: { pairs?: Record<string, { price?: number }> } } | null;
    return ["btcUsdt", "ethUsdt", "usdtIls"].every((key) => {
      const price = snapshot?.snapshot?.pairs?.[key]?.price;
      return typeof price === "number" && Number.isFinite(price) && price > 0;
    });
  },
};

export function marketDestinationFeed(baseURL: string): DestinationFeed {
  return { ...defaultFeed, url: new URL("/api/market/center", baseURL).href };
}

/**
 * WebKit can emit a native fetch refusal before pagehide while a hard
 * navigation tears down the old document, even when the fetch is caught.
 * Keep that diagnostic, and accept it only before the new document commits
 * and after the destination proves it can load a valid public market feed
 * (or every explicitly supplied same-origin feed contract).
 * All other page errors remain failures. See microsoft/playwright#42823 and
 * #43120; individual candidates still require the observed navigation proof.
 */
export function createHardNavigationErrorAudit(browserName: string) {
  const errors: string[] = [];
  const cancellations: Array<Cancellation & { destination: string; feedUrl: string; feedStatus: number; marketStatus?: number }> = [];
  const active = new Map<Page, Navigation>();
  const observed = new Set<Page>();

  function observe(page: Page) {
    if (observed.has(page)) return;
    observed.add(page);
    page.on("pageerror", (error) => {
      const navigation = active.get(page);
      // Explicit contracts require the exact native WebKit stack header;
      // JavaScript errors with the same message must still fail. Preserve
      // the legacy implicit market-feed matcher for existing callers.
      const header = error.stack?.split("\n")[0];
      const feed = navigation?.feeds.find(candidate => {
        const expected = `Fetch API cannot load ${candidate.url} due to access control checks.`;
        return header === expected || (candidate === defaultFeed && error.message === expected);
      });
      if (browserName === "webkit" && navigation && !navigation.committed && feed) {
        navigation.candidates.push({ message: error.message, stack: error.stack, observedAt: new Date().toISOString(), feed });
      } else errors.push(error.message);
    });
  }

  async function navigate(page: Page, action: () => Promise<unknown>, feed: DestinationFeed | DestinationFeed[] = defaultFeed) {
    if (active.has(page)) throw new Error("Overlapping hard navigation audit");
    const feeds = Array.isArray(feed) ? [...feed] : [feed];
    if (!feeds.length) throw new Error("Navigation audit requires at least one destination feed");
    const urls = new Set<string>();
    for (const candidate of feeds) {
      const url = new URL(candidate.url);
      if (candidate !== defaultFeed && url.origin !== new URL(page.url()).origin) throw new Error("Navigation audit requires an exact same-origin feed");
      if (urls.has(url.href)) throw new Error("Navigation audit requires distinct destination feed URLs");
      urls.add(url.href);
    }
    observe(page);
    const navigation: Navigation = { committed: false, candidates: [], feeds };
    const destinationRequests = new Set<Request>();
    active.set(page, navigation);
    const committed = (frame: Frame) => {
      if (frame === page.mainFrame()) navigation.committed = true;
    };
    const requested = (request: Request) => {
      if (navigation.committed && request.frame() === page.mainFrame()) destinationRequests.add(request);
    };
    page.on("framenavigated", committed);
    page.on("request", requested);
    // Start observation before navigation so a fast destination response is
    // captured. Only responses from the newly committed main frame qualify.
    const healthyFeeds = Promise.all(feeds.map(destinationFeed => page.waitForResponse((response: Response) =>
      destinationRequests.has(response.request()) && response.url() === destinationFeed.url
      && response.request().method() === "GET"
      && response.frame() === page.mainFrame(), { timeout: 20_000 })
      .then(async (response) => {
        if (destinationFeed === defaultFeed ? !response.ok() : response.status() !== 200) throw new Error(`Destination ${destinationFeed.label} returned HTTP ${response.status()}`);
        const body = await response.json();
        if (!destinationFeed.validateBody(body)) throw new Error(`Destination ${destinationFeed.label} did not return a valid snapshot`);
        return [destinationFeed, response.status()] as const;
      }))).then(entries => new Map(entries));
    try {
      const [, statuses] = await Promise.all([Promise.resolve().then(action), healthyFeeds]);
      if (!navigation.committed) throw new Error("Hard navigation did not commit a destination document");
      cancellations.push(...navigation.candidates.map(({ feed: candidateFeed, ...candidate }) => ({
        ...candidate, destination: page.url(), feedUrl: candidateFeed.url, feedStatus: statuses.get(candidateFeed)!,
        ...(candidateFeed === defaultFeed ? { marketStatus: statuses.get(candidateFeed)! } : {}),
      })));
    } catch (error) {
      // A failed destination cannot validate even an otherwise matching error.
      errors.push(...navigation.candidates.map((candidate) => candidate.message));
      throw error;
    } finally {
      page.off("framenavigated", committed);
      page.off("request", requested);
      active.delete(page);
    }
  }

  return { errors, observe, navigate, report: () => ({ errors: [...errors], navigationCancellations: [...cancellations] }) };
}
