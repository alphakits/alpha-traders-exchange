import type { Frame, Page, Request, Response } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

const marketUrl = new URL("/api/market/center", E2E_BASE_URL).href;

type Cancellation = { message: string; stack?: string; observedAt: string };
type DestinationFeed = { url: string; label: string; validateBody: (body: unknown) => boolean };
type Navigation = { committed: boolean; candidates: Cancellation[]; feed: DestinationFeed };
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

/**
 * WebKit can emit a native fetch refusal before pagehide while a hard
 * navigation tears down the old document, even when the fetch is caught.
 * Keep that diagnostic, and accept it only before the new document commits
 * and after the destination proves it can load a valid public market feed
 * (or an explicitly supplied same-origin feed contract).
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
      const expected = `Fetch API cannot load ${navigation?.feed.url ?? marketUrl} due to access control checks.`;
      // Custom contracts require the native WebKit stack header captured in
      // the trace. A JavaScript Error with the same message has an Error:
      // prefix and must still fail the suite.
      const nativeStackHeader = error.stack?.split("\n")[0] === expected;
      const exactMarketRefusal = navigation?.feed !== defaultFeed
        ? nativeStackHeader
        : error.message === expected || nativeStackHeader;
      if (browserName === "webkit" && navigation && !navigation.committed && exactMarketRefusal) {
        navigation.candidates.push({ message: error.message, stack: error.stack, observedAt: new Date().toISOString() });
      } else errors.push(error.message);
    });
  }

  async function navigate(page: Page, action: () => Promise<unknown>, feed: DestinationFeed = defaultFeed) {
    if (active.has(page)) throw new Error("Overlapping hard navigation audit");
    if (feed !== defaultFeed && new URL(feed.url).origin !== new URL(page.url()).origin) throw new Error("Navigation audit requires an exact same-origin feed");
    observe(page);
    const navigation: Navigation = { committed: false, candidates: [], feed };
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
    const healthyFeed = page.waitForResponse((response: Response) =>
      destinationRequests.has(response.request()) && response.url() === feed.url
      && response.request().method() === "GET"
      && response.frame() === page.mainFrame(), { timeout: 20_000 })
      .then(async (response) => {
        if (feed === defaultFeed ? !response.ok() : response.status() !== 200) throw new Error(`Destination ${feed.label} returned HTTP ${response.status()}`);
        const body = await response.json();
        if (!feed.validateBody(body)) throw new Error(`Destination ${feed.label} did not return a valid snapshot`);
        return response.status();
      });
    try {
      const [, status] = await Promise.all([Promise.resolve().then(action), healthyFeed]);
      if (!navigation.committed) throw new Error("Hard navigation did not commit a destination document");
      cancellations.push(...navigation.candidates.map((candidate) => ({
        ...candidate, destination: page.url(), feedUrl: feed.url, feedStatus: status,
        ...(feed === defaultFeed ? { marketStatus: status } : {}),
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
