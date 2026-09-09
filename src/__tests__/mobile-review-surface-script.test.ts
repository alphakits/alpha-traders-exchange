// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  REVIEW_HTML_CHECKS,
  normalizeReviewBaseUrl,
  runReviewSurfaceChecks,
} from "../../scripts/verify-mobile-review-surface.mjs";

const baseUrl = "https://review.example.com";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function reviewFetch(options: { omitSupportForm?: boolean } = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/api/health") {
      return jsonResponse({
        status: "ok",
        checks: { database: "ok" },
        timestamp: "2026-09-08T20:00:00.000Z",
      });
    }
    if (url.pathname === "/api/mobile/v1/app-config") {
      const headers = new Headers(init?.headers);
      const platform = headers.get("X-Platform");
      return jsonResponse({
        apiVersion: "v1",
        platform,
        currentVersion: headers.get("X-App-Version"),
        minimumSupportedVersion: "1.0.0",
        latestVersion: "1.1.0",
        updateRequired: false,
        updateRecommended: false,
        checkedAt: "2026-09-08T20:00:00.000Z",
        requestId: `review-preflight-${platform}`,
      });
    }

    const check = REVIEW_HTML_CHECKS.find((candidate) => candidate.path === url.pathname);
    if (!check) return new Response("Not found", { status: 404 });
    const markers = check.markers.filter((marker) => !(
      options.omitSupportForm
      && url.pathname === "/en/support"
      && marker.includes("aria-label")
    ));
    return new Response(`<html><body>${markers.join("\n")}${"x".repeat(300)}</body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}

describe("mobile App Review surface preflight", () => {
  it("checks health, both native policies, and every bilingual public reviewer route", async () => {
    const fetchImplementation = reviewFetch();
    const results = await runReviewSurfaceChecks({ baseUrl, fetchImplementation });

    expect(results).toHaveLength(REVIEW_HTML_CHECKS.length + 3);
    expect(fetchImplementation).toHaveBeenCalledTimes(REVIEW_HTML_CHECKS.length + 3);
  });

  it("fails closed when the direct support form disappears", async () => {
    await expect(runReviewSurfaceChecks({
      baseUrl,
      fetchImplementation: reviewFetch({ omitSupportForm: true }),
    })).rejects.toThrow("English support is missing its required review marker");
  });

  it("permits HTTP only for local test servers and rejects embedded credentials", () => {
    expect(normalizeReviewBaseUrl("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(() => normalizeReviewBaseUrl("http://review.example.com")).toThrow("must use HTTPS");
    expect(() => normalizeReviewBaseUrl("https://user:secret@review.example.com")).toThrow("must not contain credentials");
  });
});
