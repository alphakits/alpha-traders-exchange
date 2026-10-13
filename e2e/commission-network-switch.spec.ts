import { test, expect } from "@playwright/test";
import { CANONICAL_BEP20_COMMISSION_WALLET, CANONICAL_TRC20_COMMISSION_WALLET } from "../src/lib/commission-config";

for (const locale of ["en", "ar"] as const) {
  for (const device of ["phone", "desktop"] as const) {
    test(`commission network can change both ways on ${device} in ${locale}`, async ({ page }, testInfo) => {
      await page.setViewportSize(device === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      const login = await page.request.post("/api/auth/login", { data: {
        email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD, rememberMe: true,
      } });
      expect(login.ok()).toBeTruthy();
      let network: "TRC20" | "BEP20" = "TRC20";
      const writes: unknown[] = [];
      await page.route("**/api/alpha-exchange/commissions/checkout", async (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          expect(body.hasNotPaidYet).toBe(true);
          expect(body.currentCheckoutId).toBe(`checkout-${network}`);
          expect(["TRC20", "BEP20"]).toContain(body.network);
          writes.push(body); network = body.network;
        }
        await route.fulfill({ json: { status: "waiting", pendingCount: 1, totalDueUsdt: 40, canChangeNetwork: true,
          walletAddress: network === "TRC20" ? CANONICAL_TRC20_COMMISSION_WALLET : CANONICAL_BEP20_COMMISSION_WALLET,
          checkout: { id: `checkout-${network}`, sellerId: "e2e-global-seller", network,
            dueMicros: 40_000_000, expectedMicros: network === "TRC20" ? 40_000_010 : 40_000_011 },
        } });
      });
      const change = locale === "en" ? "Change network" : "تغيير الشبكة";
      const update = locale === "en" ? "Update payment network" : "تحديث شبكة الدفع";
      const networkLabel = locale === "en" ? "Network" : "الشبكة";
      await page.goto(`/${locale}/seller/commission-checkout`);
      await expect(page.getByText(CANONICAL_TRC20_COMMISSION_WALLET, { exact: true })).toBeVisible();
      for (const target of ["BEP20", "TRC20"] as const) {
        await page.getByRole("button", { name: change, exact: true }).click();
        await expect(page.getByRole("button", { name: update, exact: true })).toBeDisabled();
        await page.getByLabel(networkLabel, { exact: true }).selectOption(target);
        await expect(page.getByText(CANONICAL_TRC20_COMMISSION_WALLET, { exact: true })).toHaveCount(0);
        await expect(page.getByText(CANONICAL_BEP20_COMMISSION_WALLET, { exact: true })).toHaveCount(0);
        await page.getByRole("checkbox", { name: locale === "en" ? "I have not sent this payment yet." : "لم أرسل هذه الدفعة بعد.", exact: true }).check();
        if (target === "BEP20") await page.screenshot({ path: testInfo.outputPath(`commission-network-${device}-${locale}.png`), fullPage: true });
        await page.getByRole("button", { name: update, exact: true }).click();
        await expect(page.getByText(target === "BEP20" ? CANONICAL_BEP20_COMMISSION_WALLET : CANONICAL_TRC20_COMMISSION_WALLET, { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByText(target, { exact: true })).toBeVisible();
      }
      expect(writes).toHaveLength(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
