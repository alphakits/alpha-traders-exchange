import { test, expect } from "@playwright/test";
import { CANONICAL_TRC20_COMMISSION_WALLET } from "../src/lib/commission-config";

test.use({ contextOptions: { reducedMotion: "reduce" } });

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
      for (const amount of [0.002, 8.304056]) {
        due = amount;
        issued = false;
        await page.goto(`/${locale}/seller/commission-checkout`);
        await expect(page.getByLabel(locale === "en" ? "Payment amount (USDT)" : "مبلغ الدفع (USDT)", { exact: true })).toHaveValue(String(amount));
        await expect(page.getByText(`${amount} USDT`, { exact: true })).toBeVisible();
        await page.getByRole("checkbox", { name: locale === "en" ? "I have not sent this payment yet." : "لم أرسل هذه الدفعة بعد.", exact: true }).check();
        await page.getByRole("button", { name: locale === "en" ? "Get payment instructions" : "عرض تعليمات الدفع", exact: true }).click();
        await expect(page.getByText(`${amount.toFixed(6)} USDT`, { exact: true }).last()).toBeVisible();
        await expect(page.getByText(CANONICAL_TRC20_COMMISSION_WALLET, { exact: true })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: locale === "en" ? "Waiting for payment confirmation" : "بانتظار تأكيد الدفع" })).toBeVisible();
        await page.reload();
        await expect(page.getByText(`${amount.toFixed(6)} USDT`, { exact: true }).last()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`commission-precision-${amount}-${device}-${locale}.png`), fullPage: true, animations: "disabled" });
      }
      expect(writes).toHaveLength(2);
      carried = true;
      await page.reload();
      await expect(page.getByText(locale === "en" ? /Unpaid balance carried to your next commission/ : /رصيد غير مدفوع يُرحّل إلى العمولة التالية/)).toBeVisible();
      await expect(page.getByText("2 USDT", { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`commission-carry-${device}-${locale}.png`), fullPage: true, animations: "disabled" });
    });
  }
}
