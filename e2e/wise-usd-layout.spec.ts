import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { OFFLINE_ACCOUNTS, OFFLINE_PASSWORD, seedOfflineFixture } from "../scripts/usdt-request-offline-fixture.mjs";

// This uses the same isolated, network-blocked server as the Wise lifecycle test.
// Maximum-length accepted names must not push the account controls off a phone.
for (const locale of ["en", "ar"] as const) {
  test(`Wise account form remains usable on a narrow ${locale} phone`, async ({ page, context, baseURL }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await context.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort("blockedbyclient"));
    await seedOfflineFixture(baseURL!);
    const login = await page.request.post("/api/auth/login", {
      data: { email: OFFLINE_ACCOUNTS.buyer.email, password: OFFLINE_PASSWORD, rememberMe: false },
      headers: { "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 4)}` },
    });
    expect(login.ok()).toBe(true);
    const account = await page.request.post("/api/alpha-exchange/wise-accounts", { data: {
      provider: "wise", currency: "USD", countryCode: "US", accountHolderType: "personal", accountType: "checking",
      accountHolderName: "Synthetic".repeat(15) + "Names", bankName: "Synthetic Test Bank",
      routingNumber: "021000021", accountNumber: "00001001001",
    } });
    expect(account.status()).toBe(201);
    await page.goto(`/${locale}/settings?tab=profile#wise-accounts`);
    const panel = page.getByRole("region", { name: locale === "ar" ? "حسابات Wise الشخصية · USD" : "Personal Wise accounts · USD", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("****1001");
    await expect(panel).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect.poll(() => panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const input = panel.getByLabel(locale === "ar" ? "رقم الحساب" : "Account number", { exact: true });
    await expect(input).toHaveAttribute("dir", "ltr");
    await input.fill("00003003003");
    await expect(input).toHaveValue("00003003003");
    const edit = panel.getByRole("button", { name: locale === "ar" ? "تعديل" : "Edit", exact: true });
    const editBox = await edit.boundingBox();
    expect(editBox?.height).toBeGreaterThanOrEqual(44);
    if (locale === "ar") {
      await panel.getByLabel("الاسم القانوني لصاحب الحساب", { exact: true }).fill("Demo Buyer");
      await panel.getByLabel("اسم البنك كما يظهر في Wise", { exact: true }).fill("Synthetic Test Bank");
      const routing = panel.getByLabel("رقم توجيه ACH (9 أرقام)", { exact: true });
      await routing.fill("123456789");
      await panel.getByRole("button", { name: "حفظ للمراجعة", exact: true }).click();
      await expect(routing).toHaveAttribute("aria-invalid", "true");
      await expect(panel.getByText("أدخل رقم توجيه ACH صالحًا من 9 أرقام، دون مسافات أو علامات ترقيم.", { exact: true })).toBeVisible();
    }
    await panel.screenshot({ path: info.outputPath(`wise-account-${locale}-phone.png`) });
  });
}
