// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { buildSecurityHeaders } from "@/lib/security-headers";

vi.mock("next-intl/plugin", () => ({ default: () => (config: unknown) => config }));
vi.mock("@/lib/runtime-safety", () => ({ isProductionSecurityRuntime: () => true }));

import config from "../../next.config";

async function responseHeaders(path: string) {
  const result = new Map<string, string>();
  for (const rule of await config.headers!()) {
    if (!getPathMatch(rule.source)(path)) continue;
    for (const header of rule.headers) result.set(header.key, header.value);
  }
  return result;
}

describe("public course document framing", () => {
  it.each([
    "/files/course/pdfs/candles-foundation.pdf",
    "/files/course/pdfs/full-files-examples-workbook.pdf",
    "/files/course/academy-course-notes.html",
  ])("permits only same-origin framing for %s and retains the other protections", async (path) => {
    const actual = await responseHeaders(path);
    expect(actual.get("X-Frame-Options")).toBe("SAMEORIGIN");
    const defaultHeaders = buildSecurityHeaders({ isProduction: true });
    for (const header of defaultHeaders) {
      if (header.key === "X-Frame-Options") continue;
      const expected = header.key === "Content-Security-Policy"
        ? header.value.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
        : header.value;
      expect(actual.get(header.key)).toBe(expected);
    }
  });

  it.each([
    "/en/lessons/candles-foundation",
    "/en/admin/alpha-exchange",
    "/api/alpha-exchange/purchase-requests",
    "/uploads/untrusted.pdf",
    "/files/unrelated.html",
    "/files/course/other.html",
  ])("retains the framing prohibition on %s", async (path) => {
    const actual = await responseHeaders(path);
    expect(actual.get("X-Frame-Options")).toBe("DENY");
    expect(actual.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});
