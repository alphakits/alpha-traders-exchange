import { expect, test } from "@playwright/test";

const ROLES = ["BUYER", "SELLER", "ADMIN", "OWNER", "GUEST", "STUDENT"] as const;
for (const locale of ["en", "ar"] as const) {
  test(`anonymous ${locale} visitors see public footer links and account entry only`, async ({ page, baseURL }) => {
    expect(new URL(baseURL!).hostname).toBe("localhost");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}`);
    const footer = page.locator("footer");
    await expect(footer.locator(`a[href='/${locale}/login']`)).toHaveCount(2);
    await expect(footer.locator(`a[href='/${locale}/register']`)).toHaveCount(2);
    await expect(footer.locator("a[href*='/dashboard'],a[href*='/profile'],a[href*='/settings'],a[href*='/trade-room'],a[href*='/notifications']")).toHaveCount(0);
    const account = footer.locator("summary").filter({ hasText: locale === "ar" ? /^الحساب$/ : /^Account$/ });
    await account.click();
    await expect(footer.getByRole("link", { name: locale === "ar" ? "تسجيل الدخول" : "Login", exact: true })).toBeVisible();
    await page.goto(`/${locale}/dashboard/seller`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?`));
    await page.goto(`/${locale}/learn-trading-free`);
    await expect(page.getByRole("main").locator("a[href*='/login?']")).toHaveCount(2);
  });

  for (const role of ROLES) {
    test(`${locale} ${role.toLowerCase()} gets the correct phone and desktop account links`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      expect(new URL(baseURL!).hostname).toBe("localhost");
      const email = process.env[`E2E_${role}_EMAIL`];
      const password = process.env[`E2E_${role}_PASSWORD`];
      expect(email).toMatch(/@example\.test$/);
      const response = await page.request.post("/api/auth/login", {
        headers: { "x-forwarded-for": "198.51.100.89" },
        data: { email, password, rememberMe: false },
      });
      expect(response.ok()).toBe(true);
      const dashboard = role === "SELLER" ? "/dashboard/seller" : role === "BUYER" ? "/dashboard"
        : role === "GUEST" || role === "STUDENT" ? "/profile" : "/admin/alpha-exchange";
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}`);
        const footer = page.locator("footer");
        await expect(footer.locator(`a[href='/${locale}/login'],a[href='/${locale}/register']`)).toHaveCount(0);
        await expect(footer.locator(`a[href='/${locale}${dashboard}']`)).toHaveCount(2);
        await expect(footer.locator(`a[href='/${locale}/dashboard/seller/compliance-payment']`)).toHaveCount(role === "SELLER" ? 2 : 0);
        await expect(page.getByText(locale === "ar" ? "جديد في Alpha Traders؟" : "New to Alpha Traders?", { exact: true })).toHaveCount(0);
        if (role === "BUYER") await expect(footer.locator("a[href*='mode=sell']")).toHaveCount(0);
      }
      // Already authenticated accounts cannot reopen sign-in/registration UI.
      for (const entry of ["login", "register"]) {
        await page.goto(`/${locale}/${entry}`);
        await expect(page).toHaveURL(new RegExp(`/${locale}${dashboard.replaceAll("/", "\\/")}$`));
        await expect(page.getByRole("heading", { name: /^Login$|^Create Account$|^تسجيل الدخول$|^إنشاء حساب$/ })).toHaveCount(0);
      }
      if (role === "BUYER") {
        await page.goto(`/${locale}/admin/alpha-exchange`);
        await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard$`));
        await page.goto(`/${locale}/dashboard/seller`);
        await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard$`));
      }
      await page.goto(`/${locale}/learn-trading-free`);
      const learning = page.getByRole("main");
      await expect(learning.locator("a[href*='/login']")).toHaveCount(0);
      await expect(learning.locator(`a[href='/${locale}/academy']`)).toHaveCount(2);
      if (role === "STUDENT") {
        await expect(learning.getByRole("link", { name: locale === "ar" ? "تابع الدورة المجانية" : "Continue the Free Course", exact: true })).toHaveCount(2);
      }
      if (role === "GUEST" || role === "STUDENT") {
        for (const route of ["trades", "trade-room", "trade-room/no-trading-access"]) {
          await page.goto(`/${locale}/${route}`);
          await expect(page).toHaveURL(new RegExp(`/${locale}/profile$`));
        }
        await page.goto(`/${locale}/onboarding?mode=manage`);
        const setup = page.getByRole("main");
        await expect(setup.getByRole("heading", { name: locale === "ar" ? "كن مشتريًا" : "Become a Buyer", exact: true })).toBeVisible();
        if (role === "STUDENT") {
          await expect(setup.getByRole("button", { name: locale === "ar" ? "متابعة التعلّم" : "Continue learning", exact: true })).toBeVisible();
          await expect(setup.getByRole("button", { name: locale === "ar" ? "تفعيل دور الطالب" : "Become a Student", exact: true })).toHaveCount(0);
        }
      }
      if (role === "BUYER" || role === "SELLER") {
        await page.goto(`/${locale}/onboarding?mode=manage`);
        const setup = page.getByRole("main");
        await expect(setup.getByRole("button", { name: locale === "ar" ? "فتح مساحة المشتري" : "Open buyer workspace", exact: true })).toBeVisible();
        await expect(setup.getByRole("button", { name: locale === "ar" ? "المتابعة كمشتري" : "Continue as Buyer", exact: true })).toHaveCount(0);
      }
      await page.goto(`/${locale}`);
      await page.locator("header").getByRole("button", { name: locale === "ar" ? "تسجيل الخروج" : "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/en\/?$/);
      await expect(page.locator("footer a[href='/en/login']")).toHaveCount(2);
      await expect(page.locator("footer a[href*='/dashboard'],footer a[href*='/profile']")).toHaveCount(0);
    });
  }
}
