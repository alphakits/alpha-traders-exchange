import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSafeErrorDigest, getSafeErrorFrames } from "./client-error-report";

describe("private browser crash reports", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T20:00:00Z"));
    window.history.replaceState(null, "", "/en/trade-room/private-trade?withdrawal=482913#private-chat");
  });
  afterEach(() => {
    document.head.querySelectorAll("script").forEach((script) => script.remove());
    window.history.replaceState(null, "", "/");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports only approved diagnostics, excluding messages, raw stacks, trade IDs, query values, and cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const script = document.createElement("script");
    script.src = "/_next/static/chunks/main-abc123.js?dpl=dpl_TestDeployment";
    document.head.appendChild(script);
    const { reportClientError } = await import("./report-client-error");
    const error = Object.assign(new TypeError("482913 ID 012345678 private-chat buyer@example.test"), {
      digest: "1234567890",
      stack: "TypeError: 482913 ID 012345678\n at trade (https://example.test/_next/static/chunks/app/%5Blocale%5D/trade-room/page-abc123.js:1:220)\n at private (/users/buyer@example.test/secret.js:4:9)",
    });
    const reference = reportClientError(error, "global");
    const [url, options] = fetchMock.mock.calls[0];
    const report = JSON.parse(options.body);
    expect(reference).toMatch(/^cr-[a-p]{16}$/);
    expect(url).toBe("/api/diagnostics/client-error");
    expect(options.credentials).toBe("omit");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(report).toEqual({ reference, boundary: "global", kind: "TypeError", page: "trade-room", digest: 1234567890,
      deployment: "dpl_TestDeployment", frames: [{ asset: "page-abc123.js", line: 1, column: 220 }] });
    for (const value of ["482913", "012345678", "private-chat", "private-trade", "buyer@example.test", "https:", "secret.js"]) {
      expect(options.body).not.toContain(value);
    }
  });

  it("deduplicates the same error and limits the browser to three reports per minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { reportClientError } = await import("./report-client-error");
    const error = new Error("test");
    expect(reportClientError(error, "global")).toBe(reportClientError(error, "locale"));
    for (let index = 0; index < 6; index += 1) reportClientError(new Error("test"), "global");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    reportClientError(new Error("after cooldown"), "global");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("bounds a stalled reporting request and does not throw when diagnostics fail", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("offline")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { reportClientError } = await import("./report-client-error");
    expect(() => reportClientError(new Error("test"), "global")).not.toThrow();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    vi.stubGlobal("fetch", () => { throw new Error("fetch unavailable"); });
    expect(() => reportClientError(new Error("test"), "locale")).not.toThrow();
  });

  it("extracts Safari frames but ignores URL-shaped values embedded in the error message", () => {
    expect(getSafeErrorFrames("Error: private /_next/static/chunks/private-message.js:1:1\nrender@https://example.test/_next/static/chunks/123-abcdef.js?dpl=dpl_TestDeployment:2:45\n/private/user.js:1:3"))
      .toEqual([{ asset: "123-abcdef.js", line: 2, column: 45 }]);
    expect(getSafeErrorDigest({ digest: "private-data" })).toBeUndefined();
    expect(getSafeErrorDigest({ digest: "99999999999" })).toBeUndefined();
  });
});
