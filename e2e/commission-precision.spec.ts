import { test, expect } from "@playwright/test";
import { CANONICAL_TRC20_COMMISSION_WALLET } from "../src/lib/commission-config";

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

// Interface regression fixtures: real loopback login and rendered page, with
// synthetic checkout responses. This does not claim blockchain settlement.
for (const locale of ["en", "ar"] as const) {
  for (const device of ["phone", "desktop"] as const) {
    test(`six-decimal commission instructions on ${device} in ${locale}`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize(device === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      const login = await page.request.post("/api/auth/login", { data: {
        email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD, rememberMe: true,
      } });
      expect(login.ok()).toBeTruthy();
      let due = 0.002;
      let issued = false;
      let carried = false;
      const writes: unknown[] = [];
      await page.route("**/api/alpha-exchange/commissions/checkout", async route => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          expect(body).toEqual({ network: "TRC20", desiredAmount: String(due), hasNotPaidYet: true });
          writes.push(body);
          issued = true;
        }
        if (carried) {
          await route.fulfill({ json: { status: "paid", pendingCount: 0, totalDueUsdt: 0, carriedShortfallUsdt: 2, walletAddress: null, checkout: null } });
          return;
        }
        await route.fulfill({ json: {
          status: issued ? "waiting" : "ready", pendingCount: 1, totalDueUsdt: due,
          walletAddress: issued ? CANONICAL_TRC20_COMMISSION_WALLET : null,
          checkout: issued ? { id: `precision-${due}`, sellerId: "e2e-global-seller", network: "TRC20",
            dueMicros: Math.round(due * 1e6), expectedMicros: Math.round(due * 1e6) } : null,
        } });
      });
      for (const amount of [0.002, 8.304056, 40]) {
        due = amount;
        issued = false;
        await page.goto(`/${locale}/seller/commission-checkout`);
        await expect(page.getByLabel(locale === "en" ? "Amount to receive (USDT)" : "مبلغ الاستلام (USDT)", { exact: true })).toHaveValue(String(amount));
        await expect(page.locator(".commission-surface strong.currency-money")).toHaveText(`${amount} USDT`);
        await page.getByRole("checkbox", { name: locale === "en" ? "I have not sent this payment yet." : "لم أرسل هذه الدفعة بعد.", exact: true }).check();
        await page.getByRole("button", { name: locale === "en" ? "Get payment instructions" : "عرض تعليمات الدفع", exact: true }).click();
        await expect(page.locator("p.currency-money").filter({ hasText: `${amount.toFixed(6)} USDT` })).toBeVisible();
        await expect(page.getByRole("heading", { name: locale === "en" ? "Platform must receive" : "يجب أن تستلم المنصة", exact: true })).toBeVisible();
        await expect(page.getByText(CANONICAL_TRC20_COMMISSION_WALLET, { exact: true })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: locale === "en" ? "Waiting for payment confirmation" : "بانتظار تأكيد الدفع" })).toBeVisible();
        await page.reload();
        await expect(page.locator("p.currency-money").filter({ hasText: `${amount.toFixed(6)} USDT` })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`commission-precision-${amount}-${device}-${locale}.png`), fullPage: true, animations: "disabled" });
        if (amount === 40) {
          const example = page.locator("details").filter({ has: page.locator("summary", { hasText: locale === "en" ? "Fee example" : "مثال على الرسوم" }) });
          await expect(example).not.toHaveAttribute("open", "");
          await example.locator("summary").click();
          await expect(example).toHaveAttribute("open", "");
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          const heading = page.getByRole("heading", { name: locale === "en" ? "Platform must receive" : "يجب أن تستلم المنصة", exact: true });
          await heading.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 110));
          const [surfaceBox, headingBox, exampleBox] = await Promise.all([
            page.locator(".commission-surface").boundingBox(), heading.boundingBox(), example.boundingBox(),
          ]);
          expect(surfaceBox && headingBox && exampleBox).toBeTruthy();
          // This shareable synthetic example excludes addresses, account details
          // and real payment records; capture only the receiving amount and fee.
          await page.screenshot({ path: testInfo.outputPath(`commission-fee-example-${device}-${locale}.png`), animations: "disabled",
            clip: { x: surfaceBox!.x, y: headingBox!.y - 8, width: surfaceBox!.width,
              height: exampleBox!.y + exampleBox!.height - headingBox!.y + 16 } });
        }
      }
      expect(writes).toHaveLength(3);
      carried = true;
      await page.reload();
      await expect(page.getByText(locale === "en" ? /Remaining for your next commission/ : /المتبقي للعمولة التالية/)).toBeVisible();
      await expect(page.getByText("2 USDT", { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`commission-carry-${device}-${locale}.png`), fullPage: true, animations: "disabled" });
    });
  }
}
