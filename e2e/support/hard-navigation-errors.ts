import type { Frame, Page, Request, Response } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

const marketUrl = new URL("/api/market/center", E2E_BASE_URL).href;

type Cancellation = { message: string; stack?: string; observedAt: string };
type Navigation = { committed: boolean; candidates: Cancellation[] };

/**
 * WebKit can emit a native fetch refusal before pagehide while a hard
 * navigation tears down the old document, even when the fetch is caught.
 * Keep that diagnostic, and accept it only before the new document commits
 * and after the destination proves it can load a valid public market feed.
 * All other page errors remain failures. See microsoft/playwright#42823.
 */
export function createHardNavigationErrorAudit(browserName: string) {
  const errors: string[] = [];
  const cancellations: Array<Cancellation & { destination: string; marketStatus: number }> = [];
  const active = new Map<Page, Navigation>();
  const observed = new Set<Page>();

  function observe(page: Page) {
    if (observed.has(page)) return;
    observed.add(page);
    page.on("pageerror", (error) => {
      const navigation = active.get(page);
      const expected = `Fetch API cannot load ${marketUrl} due to access control checks.`;
      const exactMarketRefusal = error.message === expected || error.stack?.split("\n")[0] === expected;
      if (browserName === "webkit" && navigation && !navigation.committed && exactMarketRefusal) {
        navigation.candidates.push({ message: error.message, stack: error.stack, observedAt: new Date().toISOString() });
      } else errors.push(error.message);
    });
  }

  async function navigate(page: Page, action: () => Promise<unknown>) {
    if (active.has(page)) throw new Error("Overlapping hard navigation audit");
    observe(page);
    const navigation: Navigation = { committed: false, candidates: [] };
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
    const healthyMarket = page.waitForResponse((response: Response) =>
      destinationRequests.has(response.request()) && response.url() === marketUrl
      && response.request().method() === "GET"
      && response.frame() === page.mainFrame(), { timeout: 20_000 })
      .then(async (response) => {
        if (!response.ok()) throw new Error(`Destination market feed returned HTTP ${response.status()}`);
        const body = await response.json();
        if (!["btcUsdt", "ethUsdt", "usdtIls"].every((key) => {
          const price = body?.snapshot?.pairs?.[key]?.price;
          return Number.isFinite(price) && price > 0;
        })) {
          throw new Error("Destination market feed did not return a valid snapshot");
        }
        return response.status();
      });
    try {
      const [, status] = await Promise.all([Promise.resolve().then(action), healthyMarket]);
      if (!navigation.committed) throw new Error("Hard navigation did not commit a destination document");
      cancellations.push(...navigation.candidates.map((candidate) => ({ ...candidate, destination: page.url(), marketStatus: status })));
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
