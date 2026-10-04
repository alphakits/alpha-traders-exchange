import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  for (const control of ["header", "session"] as const) {
    test(`${locale} ${control} sign-out owns navigation while its confirmed response is delayed`, async ({ page }) => {
      const login = await page.request.post("/api/auth/login", {
        headers: { "x-forwarded-for": "198.51.100.239" },
        data: { email: process.env.E2E_SELLER_EMAIL!, password: process.env.E2E_SELLER_PASSWORD!, rememberMe: true },
      });
      expect(login.ok(), `${login.status()}: ${await login.text()}`).toBeTruthy();
      const source = control === "header" ? `/${locale}/usdt-exchange` : `/${locale}/settings?tab=security`;
      await page.goto(source);
      const button = control === "header"
        ? page.locator("header").getByRole("button", { name: locale === "ar" ? "تسجيل الخروج" : "Sign out", exact: true })
        : page.getByRole("button", { name: locale === "ar" ? "تسجيل الخروج من هذه الجلسة" : "Sign out this session", exact: true });
      await expect(button).toBeVisible();
      let ready!: () => void;
      let release!: () => void;
      const revoked = new Promise<void>(resolve => { ready = resolve; });
      const confirmation = new Promise<void>(resolve => { release = resolve; });
      const endpoint = control === "header" ? "**/api/auth/logout" : "**/api/alpha-exchange/account-sessions";
      await page.route(endpoint, async route => {
        if (control === "session" && route.request().method() !== "DELETE") return route.continue();
        const response = await route.fetch();
        expect(response.ok(), `${response.status()}: ${await response.text()}`).toBeTruthy();
        ready();
        await confirmation;
        await route.fulfill({ response });
      });
      try {
        await button.click();
        await revoked;
        expect(await (await page.request.get("/api/auth/me")).json()).toEqual({ user: null });
        // Exercise the real revocation/response gap with a concurrent refresh.
        // The short held response makes the ordering deterministic in Chromium.
        await page.evaluate(async () => {
          window.dispatchEvent(new Event("alpha-auth-changed"));
          await new Promise(resolve => setTimeout(resolve, 250));
        });
        await expect(page).toHaveURL(new RegExp(source.replace("?", "\\?") + "$"));
        release();
        await expect(page).toHaveURL(control === "header" ? /\/en$/ : /\/en\/login$/);
        expect(await (await page.request.get("/api/auth/me")).json()).toEqual({ user: null });
      } finally {
        release();
      }
    });
  }
}
