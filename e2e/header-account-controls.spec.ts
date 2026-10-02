import { expect, test } from "@playwright/test";

// These accounts are provisioned only by the loopback-only global setup.
// No production account, trade, notification, or verification message is used.
const ROLES = ["BUYER", "SELLER", "ADMIN", "OWNER"] as const;
const WIDTHS = [320, 360, 390, 430, 640, 768, 1024, 1280, 1363, 1440, 1920];

test.describe("Responsive authenticated header", () => {
  for (const locale of ["en", "ar"] as const) {
    for (const role of ROLES) {
      test(`keeps ${locale} ${role.toLowerCase()} controls reachable without overflow`, async ({ page, baseURL }) => {
        test.setTimeout(90_000);
        expect(new URL(baseURL!).hostname).toBe("localhost");
        const email = process.env[`E2E_${role}_EMAIL`];
        const password = process.env[`E2E_${role}_PASSWORD`];
        expect(email).toMatch(/@example\.test$/);
        expect(password).toBeTruthy();
        const response = await page.request.post("/api/auth/login", {
          headers: { "x-forwarded-for": "198.51.100.87" },
          data: { email, password, rememberMe: false },
        });
        expect(response.ok()).toBe(true);
        await page.goto(`/${locale}`);
        const header = page.locator("header").first();
        const profileLabel = locale === "ar" ? "الملف الشخصي" : "Profile";
        const logoutLabel = locale === "ar" ? "تسجيل الخروج" : "Sign out";

        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 936 });
          const menu = header.locator("details");
          if (width < 1280) {
            await menu.locator("summary").click();
            await expect(menu).toHaveAttribute("open", "");
            await expect(menu.getByRole("link", { name: profileLabel, exact: true })).toBeVisible();
            await expect(menu.getByRole("button", { name: logoutLabel, exact: true })).toBeVisible();
          } else {
            await expect(header.getByRole("link", { name: profileLabel, exact: true })).toBeVisible();
            await expect(header.getByRole("button", { name: logoutLabel, exact: true })).toBeVisible();
          }

          const geometry = await header.evaluate((element) => {
            const viewport = document.documentElement.clientWidth;
            const controls = [...element.querySelectorAll<HTMLElement>("a, button, summary")]
              .filter((control) => control.getBoundingClientRect().width > 0);
            const clipped = controls.filter((control) => {
              const rect = control.getBoundingClientRect();
              return rect.left < -1 || rect.right > viewport + 1;
            }).map((control) => control.textContent?.trim());
            return { viewport, clipped, bodyWidth: document.body.scrollWidth };
          });
          expect(geometry.clipped, `${locale} ${role} at ${width}px`).toEqual([]);
          expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport);
          if (width < 1280) await menu.locator("summary").press("Escape");
        }
      });
    }
  }
});
