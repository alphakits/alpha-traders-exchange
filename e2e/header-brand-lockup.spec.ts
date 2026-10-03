import { expect, test } from "@playwright/test";

const VIEWPORT_WIDTHS = [320, 360, 390, 430, 640, 768, 1024, 1280, 1363, 1440, 1920];

test.describe("Header brand lockup", () => {
  for (const locale of ["en", "ar"] as const) {
    for (const width of VIEWPORT_WIDTHS) {
      test(`keeps the full ${locale} lockup visible at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.request.post("/api/auth/logout").catch(() => {});
        await page.goto(`/${locale}`);

        const lockup = page.locator("header span[aria-label]").first();
        await expect(lockup).toBeVisible();
        await expect(lockup).toContainText("Alpha Traders");
        await expect(lockup).toContainText(locale === "ar" ? "الأكاديمية والسوق" : "Academy & Exchange");

        const layout = await page.locator("header > .section-container").first().evaluate((row) => {
          const brandLink = row.querySelector(":scope > a");
          const controls = row.lastElementChild;
          if (!(brandLink instanceof HTMLElement) || !(controls instanceof HTMLElement)) return null;

          const brandRect = brandLink.getBoundingClientRect();
          const controlsRect = controls.getBoundingClientRect();
          const horizontalOverlap = Math.max(
            0,
            Math.min(brandRect.right, controlsRect.right) - Math.max(brandRect.left, controlsRect.left),
          );
          const verticalOverlap = Math.max(
            0,
            Math.min(brandRect.bottom, controlsRect.bottom) - Math.max(brandRect.top, controlsRect.top),
          );
          const textStyles = Array.from(brandLink.querySelectorAll("span[aria-label] > span")).map((element) => {
            const style = getComputedStyle(element);
            return { overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
          });

          return {
            overlapArea: horizontalOverlap * verticalOverlap,
            documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            viewportWidth: document.documentElement.clientWidth,
            textStyles,
          };
        });

        expect(layout).not.toBeNull();
        expect(layout!.overlapArea).toBe(0);
        expect(layout!.documentWidth).toBeLessThanOrEqual(layout!.viewportWidth);
        expect(layout!.textStyles).toEqual([
          { overflow: "visible", textOverflow: "clip", whiteSpace: "nowrap" },
          { overflow: "visible", textOverflow: "clip", whiteSpace: "nowrap" },
        ]);
      });
    }
  }
});
