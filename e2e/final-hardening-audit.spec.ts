import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  cleanupBuyerFixture,
  ensureBuyerFixtureListing,
  resolveBuyerFixture,
  type BuyerFixture,
} from "./support/buyer-fixture";
import { E2E_BASE_URL } from "./support/base-url";

const SELLER_EMAIL = (process.env.E2E_SELLER_EMAIL ?? "").toLowerCase();
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD ?? "";
const OWNER_EMAIL = (process.env.E2E_OWNER_EMAIL ?? "").toLowerCase();
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";

const REFRESH_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const MOBILE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const DESKTOP_VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

type DiagnosticCapture = {
  navUrls: string[];
  firstPartyFailures: Array<{ url: string; status: number }>;
  firstPartyApiRequests: string[];
  firstPartyConsoleErrors: string[];
  hydrationWarnings: string[];
  reset: () => void;
};

let buyerFixture: BuyerFixture | undefined;

async function login(request: APIRequestContext, email: string, password: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.post("/api/auth/login", {
        headers: { "x-forwarded-for": "198.51.100.15" },
        data: {
          email,
          password,
          rememberMe: true,
        },
      });
      expect(response.ok(), `login failed for ${email}`).toBeTruthy();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`login failed for ${email}`);
}

function collectDiagnostics(page: Page): DiagnosticCapture {
  const navUrls: string[] = [];
  const firstPartyFailures: Array<{ url: string; status: number }> = [];
  const firstPartyApiRequests: string[] = [];
  const firstPartyConsoleErrors: string[] = [];
  const hydrationWarnings: string[] = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navUrls.push(frame.url());
    }
  });

  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(`${E2E_BASE_URL}/`)) return;
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/")) {
      firstPartyApiRequests.push(parsed.pathname);
    }
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!url.startsWith(`${E2E_BASE_URL}/`)) return;
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/") && response.status() >= 400) {
      firstPartyFailures.push({ url: parsed.pathname, status: response.status() });
    }
  });

  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") {
      firstPartyConsoleErrors.push(text);
      if (/hydration|did not match|server-rendered html|content does not match/i.test(text)) {
        hydrationWarnings.push(text);
      }
      return;
    }
    if (message.type() === "warning" && /hydration|did not match|server-rendered html|content does not match/i.test(text)) {
      hydrationWarnings.push(text);
    }
  });

  return {
    navUrls,
    firstPartyFailures,
    firstPartyApiRequests,
    firstPartyConsoleErrors,
    hydrationWarnings,
    reset: () => {
      navUrls.length = 0;
      firstPartyFailures.length = 0;
      firstPartyApiRequests.length = 0;
      firstPartyConsoleErrors.length = 0;
      hydrationWarnings.length = 0;
    },
  };
}

async function installLayoutShiftTracker(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { __hardeningCls?: number }).__hardeningCls = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        if ((entry as { hadRecentInput?: boolean }).hadRecentInput) continue;
        (window as Window & { __hardeningCls?: number }).__hardeningCls = ((window as Window & { __hardeningCls?: number }).__hardeningCls ?? 0) + ((entry as { value?: number }).value ?? 0);
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  });
}

function countPath(requests: string[], targetPath: string) {
  return requests.filter((path) => path === targetPath).length;
}

async function assertRefreshStability(input: {
  page: Page;
  route: string;
  readyLocator: ReturnType<Page["getByText"]> | ReturnType<Page["locator"]>;
  viewport: { width: number; height: number };
  disallowPathnames?: string[];
  maxCls?: number;
}) {
  const { page, route, readyLocator, viewport, disallowPathnames = [], maxCls = 0.15 } = input;

  await page.setViewportSize(viewport);
  const diagnostics = collectDiagnostics(page);
  await installLayoutShiftTracker(page);

  const initialCanonicalSession = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth/me",
    { timeout: 30_000 },
  );
  await page.goto(route);
  await expect(readyLocator).toBeVisible({ timeout: 30_000 });
  await initialCanonicalSession;
  expect(countPath(diagnostics.firstPartyApiRequests, "/api/auth/me"), `duplicate auth bootstrap on initial ${route}`).toBeLessThanOrEqual(1);
  const stableUrl = page.url();

  diagnostics.reset();
  await page.reload({ waitUntil: "commit" });
  await expect(readyLocator).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  const afterReloadUrl = page.url();
  expect(afterReloadUrl).toBe(stableUrl);

  const disallowedHits = diagnostics.navUrls.filter((url) => {
    const pathname = new URL(url).pathname;
    return disallowPathnames.some((blocked) => pathname.includes(blocked));
  });
  expect(disallowedHits, `unexpected path flash while reloading ${route}`).toEqual([]);

  const changedPathNavigations = diagnostics.navUrls.filter((url) => {
    const path = new URL(url).pathname;
    return path !== new URL(stableUrl).pathname;
  });
  expect(changedPathNavigations, `unexpected redirect while reloading ${route}`).toEqual([]);

  const authMeCalls = countPath(diagnostics.firstPartyApiRequests, "/api/auth/me");
  expect(authMeCalls, `duplicate auth bootstrap calls while reloading ${route}`).toBeLessThanOrEqual(1);

  const firstPartyFailuresExcludingSse = diagnostics.firstPartyFailures.filter((item) => {
    if (item.url.endsWith("/notifications/stream")) return false;
    if (item.status === 403 && (item.url === "/api/alpha-exchange/my-listings" || item.url === "/api/alpha-exchange/discord-sharing")) {
      // Buyer session intentionally receives seller-only endpoint denials.
      return false;
    }
    return true;
  });
  expect(firstPartyFailuresExcludingSse, `first-party API failures while reloading ${route}`).toEqual([]);
  expect(diagnostics.firstPartyConsoleErrors, `console errors while reloading ${route}`).toEqual([]);
  expect(diagnostics.hydrationWarnings, `hydration mismatch warnings while reloading ${route}`).toEqual([]);

  const cls = await page.evaluate(() => (window as Window & { __hardeningCls?: number }).__hardeningCls ?? 0);
  expect(cls, `layout shift too high while reloading ${route}`).toBeLessThan(maxCls);
}

test.beforeAll(async () => {
  buyerFixture = await resolveBuyerFixture(
    (process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(),
    process.env.E2E_BUYER_PASSWORD ?? "",
  );
});

test.afterAll(async () => {
  await cleanupBuyerFixture(buyerFixture);
});

test.describe("Final hardening audit", () => {
  test.describe.configure({ mode: "serial" });

  for (const viewport of REFRESH_VIEWPORTS) {
    test(`seller refresh stability @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run seller refresh hardening checks.");
      await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);

      await assertRefreshStability({
        page,
        route: "/en/dashboard/seller",
        readyLocator: page.getByText(/seller status/i).first(),
        viewport,
        disallowPathnames: ["/login"],
      });
    });
  }

  for (const viewport of REFRESH_VIEWPORTS) {
    test(`buyer refresh stability @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.skip(!buyerFixture, "Buyer fixture not available");
      await login(page.request, buyerFixture!.email, buyerFixture!.password);

      await assertRefreshStability({
        page,
        route: "/en/usdt-exchange#my-trade-requests-section",
        readyLocator: page.getByRole("main").locator("#my-trade-requests-section"),
        viewport,
        disallowPathnames: ["/login", "/dashboard"],
        maxCls: 1.5,
      });
    });
  }

  test("performance: first useful marketplace interaction timings + bootstrap duplication check", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!buyerFixture, "Buyer fixture not available");
    await login(page.request, buyerFixture!.email, buyerFixture!.password);

    const timings: Array<{ viewport: string; msToInteractive: number; authMeCalls: number }> = [];

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      const diagnostics = collectDiagnostics(page);
      await page.goto("/en/usdt-exchange", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /Buy USDT from/i }).first()).toBeVisible({ timeout: 30_000 });

      diagnostics.reset();
      const startedAt = Date.now();
      await page.goto("/en/usdt-exchange", { waitUntil: "domcontentloaded" });
      const buyButton = page.getByRole("button", { name: /Buy USDT from/i }).first();
      await expect(buyButton).toBeVisible({ timeout: 30_000 });
      await expect(buyButton).toBeEnabled({ timeout: 30_000 });
      const msToInteractive = Date.now() - startedAt;
      const authMeCalls = countPath(diagnostics.firstPartyApiRequests, "/api/auth/me");

      expect(authMeCalls, `duplicate auth bootstrap on marketplace load @ ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
      expect(msToInteractive, `marketplace took too long to become interactive @ ${viewport.width}x${viewport.height}`).toBeLessThan(25000);

      timings.push({ viewport: `${viewport.width}x${viewport.height}`, msToInteractive, authMeCalls });
    }

    console.log("[hardening/perf] marketplace interactive timings", timings);
  });

  test("important navigation and CTA audit", async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(!buyerFixture, "Buyer fixture not available");
    await login(page.request, buyerFixture!.email, buyerFixture!.password);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/en/usdt-exchange");
    await expect(page.getByRole("button", { name: /My Trade Requests/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /My Trade Requests/i }).first().click();
    await expect(page).toHaveURL(/\/en\/usdt-exchange(#my-trade-requests-section)?$/);
    await expect(page.locator("#my-trade-requests-section")).toBeVisible();

    await page.getByRole("button", { name: /Buy USDT from/i }).first().click();
    await expect(page.getByRole("heading", { name: /^Buy USDT$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Start Trade/i })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/en/profile");
    await expect(page).not.toHaveURL(/\/en\/login/);
    await page.goto("/en/settings");
    await expect(page).not.toHaveURL(/\/en\/login/);
    await page.goto("/en/notifications");
    await expect(page).not.toHaveURL(/\/en\/login/);

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/settings/);
    await page.goForward();
    await expect(page).toHaveURL(/\/en\/notifications/);

    await page.goto("/ar/usdt-exchange#my-trade-requests-section");
    await expect(page).toHaveURL(/\/ar\/usdt-exchange(#my-trade-requests-section)?$/);
    await expect(page.locator("#my-trade-requests-section")).toBeVisible();
  });

  test("seller navigation audit: dashboard, listings, profile/settings/notifications", async ({ page }) => {
    test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run seller navigation checks.");
    await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);

    await page.goto("/en/dashboard/seller");
    await expect(page.getByText(/seller status/i).first()).toBeVisible();
    await page.getByRole("button", { name: /^Manage Listings$/ }).first().click();
    await expect(page.locator("#my-listings-section")).toBeVisible();

    await page.goto("/en/profile");
    await expect(page).not.toHaveURL(/\/en\/login/);
    await page.goto("/en/settings");
    await expect(page).not.toHaveURL(/\/en\/login/);
    await page.goto("/en/notifications");
    await expect(page).not.toHaveURL(/\/en\/login/);
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }] as const) {
    test(`seller listing position and navigation paths @ ${viewport.width}px`, async ({ page }) => {
      test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run listing position checks.");
      await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);
      await page.setViewportSize(viewport);
      await page.goto("/en/usdt-exchange");
      const main = page.getByRole("main");
      await expect(main.locator("#market-overview")).toBeVisible({ timeout: 30_000 });
      await expect(main.locator("#my-listings-section")).toBeVisible({ timeout: 30_000 });
      await expect(main.locator("#create-listing")).toBeVisible({ timeout: 30_000 });

      const sectionOrder = await page.evaluate(() => {
        const main = document.querySelector("main");
        const market = main?.querySelector("#market-overview");
        const listings = main?.querySelector("#my-listings-section");
        const create = main?.querySelector("#create-listing");
        return {
          marketTop: market?.getBoundingClientRect().top ?? -1,
          listingsTop: listings?.getBoundingClientRect().top ?? -1,
          createTop: create?.getBoundingClientRect().top ?? -1,
        };
      });
      expect(sectionOrder.listingsTop).toBeGreaterThan(sectionOrder.marketTop);
      expect(sectionOrder.createTop).toBeGreaterThan(sectionOrder.listingsTop);

      await page.getByRole("button", { name: /^Manage Listings$/ }).first().click();
      await expect(main.locator("#my-listings-section")).toBeInViewport();
      await page.getByRole("button", { name: /^Create Listing$/ }).first().click();
      await expect(main.locator("#create-listing")).toBeInViewport();
    });
  }

  test("route protection matrix for guest, buyer, seller, owner", async ({ page }) => {
    test.setTimeout(120_000);
    await page.request.post("/api/auth/logout").catch(() => {});
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/login\?redirectTo=%2Fen%2Fdashboard/);

    await page.goto("/en/trade-room");
    await expect(page).toHaveURL(/\/en\/login\?redirectTo=%2Fen%2Ftrade-room/);

    test.skip(!buyerFixture, "Buyer fixture not available");
    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/admin/alpha-exchange", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/en\/(usdt-exchange|login)(\?|$)/, { timeout: 20_000 });

    if (SELLER_EMAIL && SELLER_PASSWORD) {
      await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);
      await page.goto("/en/admin/alpha-exchange", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/en\/(usdt-exchange|login)(\?|$)/, { timeout: 20_000 });
    }

    if (OWNER_EMAIL && OWNER_PASSWORD) {
      await login(page.request, OWNER_EMAIL, OWNER_PASSWORD);
      await page.goto("/en/admin/alpha-exchange", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/en\/admin\/alpha-exchange$/);
    }
  });

  for (const viewport of MOBILE_VIEWPORTS) {
    test(`mobile viewport integrity @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.request.post("/api/auth/logout").catch(() => {});
      await page.goto("/en");
      await page.locator("summary").first().click();
      await page.locator("details[open] a[href$='/en/usdt-exchange']").first().click();
      await expect(page).toHaveURL(/\/en\/(usdt-exchange|login\?redirectTo=%2Fen%2Fusdt-exchange)$/);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on mobile ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    });
  }

  for (const viewport of DESKTOP_VIEWPORTS) {
    test(`desktop viewport integrity @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.skip(!buyerFixture, "Buyer fixture not available");
      await login(page.request, buyerFixture!.email, buyerFixture!.password);
      await ensureBuyerFixtureListing(buyerFixture!);
      await page.setViewportSize(viewport);
      await page.goto("/en/usdt-exchange");
      await expect(page.getByRole("button", { name: /Buy USDT from/i }).first()).toBeVisible({
        timeout: 20_000,
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on desktop ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    });
  }
});
