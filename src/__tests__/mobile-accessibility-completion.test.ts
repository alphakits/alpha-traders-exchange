import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mobile accessibility completion", () => {
  it("labels the footer newsletter field and keeps mobile footer targets usable", () => {
    const footer = source("src/components/layout/site-footer.tsx");

    expect(footer).toContain('htmlFor="footer-newsletter-email"');
    expect(footer).toContain('id="footer-newsletter-email"');
    expect(footer).toContain('name="email"');
    expect(footer).toContain('autoComplete="email"');
    expect(footer).toContain('<summary className="flex min-h-11');
    expect(footer).toContain('inline-flex min-h-11 items-center gap-2');
  });

  it("shows a visible keyboard focus boundary around the embedded market chart", () => {
    const chart = source("src/components/market/tradingview-market-charts.tsx");

    expect(chart).toContain('title={title}');
    expect(chart).toContain('focus-visible:ring-2');
    expect(chart).toContain('focus-visible:ring-[#C9A227]');
  });

  it("keeps coarse-pointer checkbox and radio controls at least 24px", () => {
    const css = source("src/app/globals.css");
    const coarsePointerStart = css.indexOf('@media (max-width: 768px) and (pointer: coarse)');
    const reducedMotionStart = css.indexOf('@media (prefers-reduced-motion: reduce)', coarsePointerStart);
    const coarsePointerRules = css.slice(coarsePointerStart, reducedMotionStart);

    expect(coarsePointerStart).toBeGreaterThan(-1);
    expect(reducedMotionStart).toBeGreaterThan(coarsePointerStart);
    expect(coarsePointerRules).toContain('input[type="checkbox"]');
    expect(coarsePointerRules).toContain('input[type="radio"]');
    expect(coarsePointerRules).toContain('min-width: 1.5rem');
    expect(coarsePointerRules).toContain('min-height: 1.5rem');
  });
});
