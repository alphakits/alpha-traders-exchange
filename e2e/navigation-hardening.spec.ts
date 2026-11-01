import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  cleanupBuyerFixture,
  resolveBuyerFixture,
  type BuyerFixture,
} from "./support/buyer-fixture";

let buyerFixture: BuyerFixture | undefined;
const SELLER_EMAIL = (process.env.E2E_SELLER_EMAIL ?? "").toLowerCase();
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD ?? "";

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.16" },
    data: {
      email,
      password,
      rememberMe: true,
    },
  });
  expect(response.ok(), `login failed for ${email}`).toBeTruthy();
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

test.describe("Navigation hardening", () => {
  for (const locale of ["en", "ar"]) {
    for (const role of ["SELLER", "OWNER"]) {
      for (const input of ["pointer", "keyboard"]) {
        test(`${locale} ${role.toLowerCase()} header create listing reaches the form from My Trades with one ${input} action`, async ({ page, baseURL }, testInfo) => {
          expect(new URL(baseURL!).hostname).toBe("localhost");
          const email = (process.env[`E2E_${role}_EMAIL`] ?? "").toLowerCase();
          const password = process.env[`E2E_${role}_PASSWORD`] ?? "";
          expect(email).toMatch(/@example\.test$/);
          expect(password).toBeTruthy();
          await page.addInitScript(() => {
            const events: Array<Record<string, unknown>> = [];
            (window as Window & { __sectionNavigationEvents?: typeof events }).__sectionNavigationEvents = events;
            const describe = (target: EventTarget | null) => target instanceof HTMLElement
              ? { tag: target.tagName, id: target.id } : null;
            const record = (event: Event) => {
              if (events.length >= 100) return;
              events.push({ type: event.type, time: performance.now(), path: location.pathname, hash: location.hash,
                target: describe(event.target), active: describe(document.activeElement),
                key: event instanceof KeyboardEvent ? event.key : undefined,
                section: event instanceof CustomEvent ? event.detail : undefined,
                formMounted: Boolean(document.getElementById("create-listing")) });
            };
            for (const name of ["focusin", "focusout", "keydown", "keyup", "click", "pointerdown", "wheel", "touchmove"]) {
              document.addEventListener(name, record, true);
            }
            window.addEventListener("alpha:page-section", record);
          });
          try {
            await login(page.request, email, password);
            await page.goto(`/${locale}/trades`);
            await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
            const action = page.getByRole("banner").getByRole("button", { name: /^➕/ });
            if (input === "keyboard") {
              await action.focus();
              await expect(action).toBeFocused();
              await page.keyboard.press("Enter");
            } else {
              await action.click();
            }
            await expect(page).toHaveURL(new RegExp(`/${locale}/usdt-exchange#create-listing$`));
            const form = page.locator("#create-listing");
            await expect(form).toBeFocused();
            await expect(form).toBeInViewport();
            // Inspecting navigation must never submit a listing or change a trade.
            await expect(form.getByRole("textbox").first()).toHaveValue("");
          } finally {
            const diagnostics = await page.evaluate(() => ({
              events: (window as Window & { __sectionNavigationEvents?: Array<Record<string, unknown>> }).__sectionNavigationEvents,
              active: document.activeElement instanceof HTMLElement ? { tag: document.activeElement.tagName, id: document.activeElement.id } : null,
              formTop: document.getElementById("create-listing")?.getBoundingClientRect().top,
            })).catch(() => ({ unavailable: true }));
            await testInfo.attach("section-navigation-events", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
          }
        });
      }
    }
  }

  test("buyer workspace replaces Quick Actions and routes cards to canonical destinations", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/dashboard");

    const main = page.getByRole("main");
    await expect(main.getByText("Your workspace", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Quick Actions", { exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /^Create Listing:/ })).toHaveCount(0);

    const tradeRequests = main.getByRole("button", { name: "My Trade Requests", exact: true });
    const tradeHistory = main.locator("#my-trade-requests-section");
    await expect(tradeRequests).toHaveCount(1);
    await expect(tradeHistory).toBeVisible();
    await expect(main.locator("#workspace-summary")).not.toHaveAttribute("inert");
    await tradeRequests.focus();
    await expect(tradeRequests).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/en\/dashboard$/);
    await expect(tradeHistory).toBeFocused();

    // The hero action remains present when the empty requests panel also
    // offers a Browse Sellers button.
    await main.getByRole("button", { name: "Browse Sellers", exact: true }).first().click();
    await expect(page).toHaveURL(/\/en\/usdt-exchange#buyer-marketplace-listings$/);
  });

  test("buyer direct /trade-room navigation resolves to a stable non-dashboard destination", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/trade-room");

    await expect(page).not.toHaveURL(/\/en\/dashboard$/);
    await expect(page).toHaveURL(
      /\/en\/(trade-room\/[\w-]+|usdt-exchange\?section=trade-history#my-trade-requests-section)$/,
      { timeout: 20_000 },
    );
  });

  test("buyer dashboard refresh keeps the canonical workspace route", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/dashboard");
    await page.reload({ waitUntil: "commit" });

    await expect(page).toHaveURL(/\/en\/dashboard$/);
    await expect(page.getByRole("main").getByText("Your workspace", { exact: true }).first()).toBeVisible();
  });

  test("seller refresh keeps the approved workspace stable", async ({ page }, testInfo) => {
    test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run seller refresh checks.");

    await page.addInitScript(() => {
      const events: Array<Record<string, unknown>> = [];
      (window as Window & { __sellerNavigationEvents?: typeof events }).__sellerNavigationEvents = events;
      const describe = (element: EventTarget | null) => element instanceof HTMLElement
        ? { tag: element.tagName, id: element.id, label: element.getAttribute("aria-label") } : null;
      const record = (event: Event) => {
        if (events.length >= 80) return;
        events.push({
          type: event.type, time: performance.now(), target: describe(event.target), active: describe(document.activeElement),
          key: event instanceof KeyboardEvent ? event.key : undefined,
          section: event instanceof CustomEvent ? event.detail : undefined,
          listingsMounted: Boolean(document.getElementById("my-listings-section")),
        });
      };
      for (const name of ["focusin", "focusout", "keydown", "keyup", "click"]) document.addEventListener(name, record, true);
      window.addEventListener("alpha:page-section", record);
    });

    await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);
    const canonicalSession = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/auth/me" && response.ok());
    await page.goto("/en/dashboard/seller");
    await canonicalSession;
    const main = page.getByRole("main");
    await expect(main.getByText("Approved Seller", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Your workspace", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Quick Actions", { exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Seller Dashboard/i })).toHaveCount(0);

    const purchaseRequests = main.getByRole("button", { name: /^Purchase Requests:/ });
    await expect(purchaseRequests).toHaveCount(1);
    await expect(purchaseRequests).not.toContainText("Loading current trades…");
    await expect(main.locator("#workspace-summary")).not.toHaveAttribute("inert");
    await purchaseRequests.focus();
    await expect(purchaseRequests).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(main.locator("#purchase-requests-section")).toBeFocused();

    const reloadedSession = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/auth/me" && response.ok());
    await page.reload({ waitUntil: "commit" });
    await reloadedSession;

    await expect(page).toHaveURL(/\/en\/dashboard\/seller(?:#purchase-requests-section)?$/);
    await expect(main.getByText("Approved Seller", { exact: true }).first()).toBeVisible();
    const manageListings = main.getByRole("button", { name: /^My Listings:/ });
    await expect(manageListings).toHaveCount(1);
    // Programmatic focus does not wait for inert hydration placeholders to
    // become interactive. Assert readiness and actual focus before Enter.
    await expect(main.locator("#workspace-summary")).not.toHaveAttribute("inert");
    await manageListings.focus();
    await expect(manageListings).toBeFocused();
    await page.keyboard.press("Enter");
    try {
      await expect(main.locator("#my-listings-section")).toBeFocused({ timeout: 10_000 });
    } catch (error) {
      await testInfo.attach("seller-navigation-events", {
        contentType: "application/json",
        body: JSON.stringify(await page.evaluate(() => ({
          events: (window as Window & { __sellerNavigationEvents?: unknown[] }).__sellerNavigationEvents,
          activeId: document.activeElement?.id,
          activeTag: document.activeElement?.tagName,
        })), null, 2),
      });
      throw error;
    }
  });

  test("guest protected trade-room route redirects to login with redirectTo", async ({ page }) => {
    await page.request.post("/api/auth/logout").catch(() => {});
    await page.goto("/en/trade-room");

    await expect(page).toHaveURL(/\/en\/login\?redirectTo=%2Fen%2Ftrade-room/);
  });

  test("mobile menu can navigate to Alpha Exchange without refresh loops", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.request.post("/api/auth/logout").catch(() => {});
    for (const { locale, label } of [{ locale: "en", label: "Open menu" }, { locale: "ar", label: "فتح القائمة" }]) {
      await page.goto(`/${locale}`);
      const menu = page.locator("header summary");
      await expect(menu).toHaveAttribute("aria-label", label);
      // A separate hidden text node can be reported outside the tappable
      // summary bounds by a WebView accessibility tree.
      await expect(menu.locator(".sr-only")).toHaveCount(0);
      const bounds = await menu.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await menu.click();
      await page.locator(`details[open] a[href$='/${locale}/usdt-exchange']`).first().click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/(usdt-exchange|login\\?redirectTo=%2F${locale}%2Fusdt-exchange)$`));
    }
  });

  test("locale switch updates document language and direction without a reload", async ({ page }) => {
    await page.request.post("/api/auth/logout").catch(() => {});
    await page.goto("/en");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");
    await page.evaluate(() => {
      (window as Window & { __localeSwitchSentinel?: string }).__localeSwitchSentinel = "same-document";
    });

    await page.getByRole("button", { name: "Switch to Arabic" }).click();

    await expect(page).toHaveURL(/\/ar$/);
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect
      .poll(() => page.evaluate(() => (window as Window & { __localeSwitchSentinel?: string }).__localeSwitchSentinel))
      .toBe("same-document");

    await page.getByRole("button", { name: "التبديل إلى الإنجليزية" }).click();

    await expect(page).toHaveURL(/\/en$/);
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");
  });
});
