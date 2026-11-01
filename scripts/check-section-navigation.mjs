import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const engine = argument("browser") ?? "chromium";
assert.ok(["chromium", "webkit"].includes(engine), "Choose a supported browser engine.");
const sourcePath = resolve(argument("source") ?? "src/lib/page-section-navigation.ts");
const source = stripTypeScriptTypes(readFileSync(sourcePath, "utf8"), { mode: "strip" })
  .replace(/^export /gm, "");
const browser = await ({ chromium, webkit })[engine].launch();
const results = [];
try {
  for (const direction of ["ltr", "rtl"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      // Use the production section controller with real browser scrolling.
      // No server, account, financial record or network request is involved.
      await page.setContent(`<!doctype html><html dir="${direction}"><head><style>
        html { scroll-behavior: smooth; } body { margin: 0; }
        #space { height: 520px; } #target { height: 240px; padding-top: 60px; }
        button { display: block; margin-inline: 80px; width: 180px; height: 44px; }
        #tail { height: 2000px; }
        </style></head><body><div id="space"></div><section id="target" tabindex="-1">
        <button type="button" id="next">Browse Sellers</button></section><div id="tail"></div></body></html>`);
      await page.addScriptTag({ content: `${source}\nwindow.auditReveal = revealPageSection;
        document.getElementById('next').addEventListener('click', () => document.getElementById('next').textContent = 'Marketplace opened');` });
      await page.evaluate(() => window.auditReveal("target"));
      assert.equal(await page.locator("#target").evaluate((element) => element === document.activeElement), true);
      const before = await page.locator("#next").boundingBox();
      assert.ok(before && before.y >= 0 && before.y + before.height <= 720, "The next control must be visible.");
      const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      await page.mouse.move(point.x, point.y);
      // Model the interval between choosing a target and pressing it. A
      // pointerdown cancellation cannot repair motion that already happened.
      await page.waitForTimeout(160);
      const after = await page.locator("#next").boundingBox();
      await page.mouse.click(point.x, point.y);
      const opened = await page.locator("#next").textContent() === "Marketplace opened";
      const result = { engine, direction, firstClickOpened: opened, movementPixels: Math.abs(after.y - before.y) };
      results.push(result);
      console.log(JSON.stringify(result));
      assert.equal(opened, true, "Section navigation moved the next control away from its first click.");
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ status: "PASS", checks: results.length, engine }));
