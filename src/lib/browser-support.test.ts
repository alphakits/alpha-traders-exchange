// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { BROWSER_SUPPORT_GUARD } from "./browser-support";

function check(css: unknown, lang = "en", hasFindLast = true) {
  const replace = vi.fn();
  runInNewContext(BROWSER_SUPPORT_GUARD, {
    window: { CSS: css, location: { replace } },
    document: { documentElement: { lang } },
    Array: { prototype: { findLast: hasFindLast ? () => {} : undefined } },
  });
  return replace;
}

const modernCss = { supports: (): boolean => true, registerProperty: () => {} };

describe("browser recovery before hydration", () => {
  it("keeps supported engines on the requested page", () => {
    expect(check(modernCss)).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { supports: (): boolean => true }, { ...modernCss, supports: (): boolean => false }, { ...modernCss, supports: (): boolean => { throw new Error("Unavailable"); } }])("recovers without framework or authentication APIs when CSS is unavailable: %j", css => {
    expect(check(css)).toHaveBeenCalledExactlyOnceWith("/browser-update.html#en");
  });
  it("recovers when the JavaScript engine cannot support the application", () => {
    expect(check(modernCss, "en", false)).toHaveBeenCalledExactlyOnceWith("/browser-update.html#en");
  });
  it("preserves Arabic without including a private pathname or query in recovery", () => {
    expect(check(undefined, "ar")).toHaveBeenCalledExactlyOnceWith("/browser-update.html#ar");
  });
});
