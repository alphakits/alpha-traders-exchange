import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/globals.css", () => ({}));

import GlobalError, { resolveGlobalErrorLocale } from "@/app/global-error";
import OfflinePage, { metadata as offlineMetadata } from "@/app/offline/page";

describe("global error localization", () => {
  it("detects Arabic and English from locale-prefixed paths", () => {
    expect(resolveGlobalErrorLocale("/ar/profile", "en")).toBe("ar");
    expect(resolveGlobalErrorLocale("/en/usdt-exchange", "ar")).toBe("en");
  });

  it("falls back to the document language and then the Arabic default", () => {
    expect(resolveGlobalErrorLocale("/", "en-IL")).toBe("en");
    expect(resolveGlobalErrorLocale("/", "ar-IL")).toBe("ar");
    expect(resolveGlobalErrorLocale("/unexpected", "")).toBe("ar");
  });

  it("server-renders a neutral bilingual fatal-error fallback before locale detection", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, {
      error: new Error("test"),
      reset: vi.fn(),
    }));

    expect(html).toContain('<html lang="mul" dir="auto"');
    expect(html).toContain("حدث خطأ غير متوقع");
    expect(html).toContain("Something went wrong");
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('lang="en" dir="ltr"');
  });

  it("server-renders the offline fallback in both languages with explicit directions", () => {
    const html = renderToStaticMarkup(createElement(OfflinePage));

    expect(html).toContain("أنت غير متصل بالإنترنت");
    expect(html).toContain("You’re offline");
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('lang="en" dir="ltr"');
    expect(offlineMetadata.robots).toEqual({ index: false, follow: false });
  });
});
