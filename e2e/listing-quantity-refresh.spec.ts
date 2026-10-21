import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb } from "../src/types/alpha-exchange";
import { E2E_BASE_URL } from "./support/base-url";

const headers = { "x-alpha-test-support": "enabled" };
async function state(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function login(api: APIRequestContext, role: "BUYER" | "SELLER") {
  const email = process.env[`E2E_${role}_EMAIL`];
  expect(email).toMatch(/@example\.test$/);
  const response = await api.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.108" },
    data: { email, password: process.env[`E2E_${role}_PASSWORD`], rememberMe: false } });
  expect(response.ok(), await response.text()).toBe(true);
}

for (const locale of ["en", "ar"] as const) {
  test(`${locale} seller replenishment updates the open buyer dialog and enforces custom limits`, async ({ browser, request }) => {
    test.setTimeout(90_000);
    const db = await state(request);
    const id = `e2e-replenishment-${locale}`;
    const source = db.marketplaceListings.find(item => item.id === "e2e-global-seller-listing")!;
    db.marketplaceListings.push({ ...source, id, displayNumber: 9981, originalAmount: "500", availableAmount: "500",
      minimumTrade: "200", maximumTrade: "500", currency: "USD", price: "1", paymentMethod: "Face-to-Face (Meet in Person)",
      paymentMethods: ["Face-to-Face (Meet in Person)"], bankAccountId: undefined, bankName: undefined });
    expect((await request.put("/api/testing/alpha-exchange-state", { headers, data: db })).ok()).toBe(true);
    const buyer = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 390, height: 844 } });
    const seller = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 390, height: 844 } });
    try {
      await login(buyer.request, "BUYER");
      await login(seller.request, "SELLER");
      const buyerPage = await buyer.newPage(), sellerPage = await seller.newPage();
      await buyerPage.goto(`/${locale}/usdt-exchange?listing=${id}`);
      const dialog = buyerPage.getByRole("dialog", { name: locale === "ar" ? "شراء USDT" : "Buy USDT", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("#buyer-amount-help")).toContainText("500 USDT");
      await dialog.locator("#buyer-usdt-amount").fill("700");
      await expect(dialog.locator("#buyer-usdt-amount")).toHaveAttribute("aria-invalid", "true");
      await sellerPage.goto(`/${locale}/dashboard/seller#seller-listing-${id}`);
      const card = sellerPage.locator(`[id="seller-listing-${id}"]`);
      await card.getByRole("button", { name: locale === "ar" ? "تعديل" : "Edit", exact: true }).click();
      await card.getByPlaceholder(locale === "ar" ? "الكمية المتاحة" : "Available Amount").fill("2000");
      await expect(card.getByPlaceholder(locale === "ar" ? "الحد الأقصى للصفقة" : "Maximum Trade")).toHaveValue("2000");
      await card.getByLabel(locale === "ar" ? "سبب تغيير العرض" : "Reason for listing change").selectOption("Changed available balance");
      await card.getByPlaceholder(locale === "ar" ? "اشرح هذا التغيير باختصار" : "Briefly explain this change").fill("Synthetic inventory replenishment");
      const saved = sellerPage.waitForResponse(response => response.url().endsWith(`/api/alpha-exchange/listings/${id}`) && response.request().method() === "PATCH");
      await card.getByRole("button", { name: locale === "ar" ? "حفظ" : "Save", exact: true }).click();
      const result = await saved;
      expect(result.ok(), await result.text()).toBe(true);
      expect(await result.json()).toMatchObject({ listing: { availableAmount: "2000", maximumTrade: "2000", minimumTrade: "200" } });
      // Keep the dialog mounted and preserve the buyer's entered amount while refreshed terms arrive.
      await buyerPage.bringToFront();
      await buyerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(dialog.locator("#buyer-amount-help")).toContainText("2,000 USDT", { timeout: 20_000 });
      await expect(dialog.locator("#buyer-usdt-amount")).toHaveValue("700");
      await expect(dialog.locator("#buyer-usdt-amount")).not.toHaveAttribute("aria-invalid", "true");
      await sellerPage.bringToFront();
      await card.getByRole("button", { name: locale === "ar" ? "تعديل" : "Edit", exact: true }).click();
      const capInput = card.getByPlaceholder(locale === "ar" ? "الحد الأقصى للصفقة" : "Maximum Trade");
      const amountInput = card.getByPlaceholder(locale === "ar" ? "الكمية المتاحة" : "Available Amount");
      await capInput.fill("600");
      await amountInput.fill("");
      await amountInput.pressSequentially("6000");
      await expect(capInput).toHaveValue("600");
      await card.getByLabel(locale === "ar" ? "سبب تغيير العرض" : "Reason for listing change").selectOption("Changed available balance");
      await card.getByPlaceholder(locale === "ar" ? "اشرح هذا التغيير باختصار" : "Briefly explain this change").fill("Synthetic explicit per-trade cap");
      const capSaved = sellerPage.waitForResponse(response => response.url().endsWith(`/api/alpha-exchange/listings/${id}`) && response.request().method() === "PATCH");
      await card.getByRole("button", { name: locale === "ar" ? "حفظ" : "Save", exact: true }).click();
      const capped = await capSaved;
      expect(capped.ok(), await capped.text()).toBe(true);
      expect(await capped.json()).toMatchObject({ listing: { availableAmount: "6000", maximumTrade: "600" } });
      await buyerPage.bringToFront();
      await buyerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(dialog.locator("#buyer-amount-help")).toContainText("600 USDT");
      await expect(dialog.locator("#buyer-usdt-amount")).toHaveAttribute("aria-invalid", "true");
      await expect(dialog.locator("#buyer-usdt-amount")).toHaveValue("700");
    } finally {
      await buyer.close(); await seller.close();
      const latest = await state(request);
      latest.marketplaceListings = latest.marketplaceListings.filter(item => item.id !== id);
      expect((await request.put("/api/testing/alpha-exchange-state", { headers, data: latest })).ok()).toBe(true);
    }
  });
}
