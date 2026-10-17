import { test, expect } from "@playwright/test";
import { CANONICAL_TRC20_COMMISSION_WALLET } from "../src/lib/commission-config";

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

// Render the actual application with synthetic receiving-provider state. This
// verifies the explanation and controls, not a real-money blockchain transfer.
for (const locale of ["en", "ar"] as const) {
  for (const device of ["phone", "desktop"] as const) {
    test(`commission fee and carried balance on ${device} in ${locale}`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize(device === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      const login = await page.request.post("/api/auth/login", { data: {
        email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD, rememberMe: true,
      } });
      expect(login.ok()).toBeTruthy();
      let stage: "before" | "received" | "next" = "before";
      await page.route("**/api/alpha-exchange/commissions/checkout", async route => {
        expect(route.request().method()).toBe("GET");
        await route.fulfill({ json: stage === "before" ? {
          status: "waiting", pendingCount: 1, totalDueUsdt: 100, carriedShortfallUsdt: 0,
          amountBreakdown: { commissionsUsdt: 100, previousPaymentBalanceUsdt: 0 },
          walletAddress: CANONICAL_TRC20_COMMISSION_WALLET,
          checkout: { id: "carry-example", sellerId: "e2e-global-seller", network: "TRC20", dueMicros: 100_000_000, expectedMicros: 100_000_000 },
        } : {
          status: stage === "received" ? "paid" : "ready", pendingCount: stage === "received" ? 0 : 2,
          totalDueUsdt: stage === "received" ? 0 : 102, carriedShortfallUsdt: stage === "received" ? 2 : 0,
          amountBreakdown: { commissionsUsdt: stage === "received" ? 0 : 100, previousPaymentBalanceUsdt: stage === "received" ? 0 : 2 },
          lastPayment: { dueUsdt: 100, receivedUsdt: 98, carriedUsdt: 2 }, walletAddress: null, checkout: null,
        } });
      });
      await page.goto(`/${locale}/seller/commission-checkout`);
      const surface = page.locator(".commission-surface");
      const receiveHeading = page.getByRole("heading", { name: locale === "en" ? "Platform must receive" : "يجب أن تستلم المنصة", exact: true });
      await expect(receiveHeading).toBeVisible();
      const instructionCard = page.locator("section").filter({ has: receiveHeading }).last();
      const fee = instructionCard.locator("details");
      await fee.locator("summary").click();
      await expect(fee).toContainText(locale === "en" ? "send 101" : "أرسل 101");
      await expect(fee).toContainText(locale === "en" ? "charges the fee separately" : "الرسوم بشكل منفصل");
      await receiveHeading.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 110));
      const [cardBox, headingBox, feeBox] = await Promise.all([instructionCard.boundingBox(), receiveHeading.boundingBox(), fee.boundingBox()]);
      expect(cardBox && headingBox && feeBox).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`commission-before-${device}-${locale}.png`), animations: "disabled",
        clip: { x: cardBox!.x, y: headingBox!.y - 8, width: cardBox!.width, height: feeBox!.y + feeBox!.height - headingBox!.y + 16 } });
      stage = "received";
      await page.getByRole("button", { name: locale === "en" ? "Refresh payment status" : "تحديث حالة الدفع", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: locale === "en" ? "Payment verified" : "تم تأكيد الدفع" })).toBeVisible();
      await expect(page.getByText(locale === "en" ? /Remaining for your next commission/ : /المتبقي للعمولة التالية/)).toBeVisible();
      const previous = surface.locator("details").filter({ hasText: locale === "en" ? "Previous payment breakdown" : "تفاصيل الدفعة السابقة" });
      await previous.locator("summary").click();
      await expect(previous).toContainText("98 USDT");
      await expect(previous).toContainText("100 USDT");
      await expect(surface.getByRole("checkbox")).toHaveCount(0);
      await surface.getByTestId("commission-balance-summary").screenshot({ path: testInfo.outputPath(`commission-received-${device}-${locale}.png`), animations: "disabled" });
      stage = "next";
      await page.getByRole("button", { name: locale === "en" ? "Refresh payment status" : "تحديث حالة الدفع", exact: true }).click();
      await expect(page.getByText(locale === "en" ? "Remaining from previous payments" : "المتبقي من دفعات سابقة", { exact: true })).toBeVisible();
      await expect(surface.locator("strong").filter({ hasText: "102 USDT" })).toBeVisible();
      await expect(page.getByLabel(locale === "en" ? "Amount to receive (USDT)" : "مبلغ الاستلام (USDT)", { exact: true })).toHaveValue("102");
      await expect(page.getByText(locale === "en" ? /Your commission rate has not changed/ : /نسبة عمولتك لم تتغيّر/)).toBeVisible();
      // Collapse the optional previous receipt, keeping the current breakdown visible.
      if (await previous.getAttribute("open") !== null) await previous.locator("summary").click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const network = page.getByLabel(locale === "en" ? "Network" : "الشبكة", { exact: true });
      await expect(network).toHaveCSS("appearance", "none");
      await surface.getByTestId("commission-balance-summary").screenshot({ path: testInfo.outputPath(`commission-next-${device}-${locale}.png`), animations: "disabled" });
      await network.screenshot({ path: testInfo.outputPath(`commission-network-${device}-${locale}.png`), animations: "disabled" });
    });
  }
}
