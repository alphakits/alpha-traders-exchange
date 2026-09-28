// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
import { POST } from "./route";

const url = "https://www.alphatraders.co.il/api/diagnostics/client-error";
const report = { reference: "cr-abcdefghijklmnop", boundary: "global", kind: "TypeError", page: "trade-room", frames: [{ asset: "page-abc123.js", line: 1, column: 220 }] };
let testWindow = Date.now();

function request(body: unknown = report, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", headers: { origin: "https://www.alphatraders.co.il", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("client crash ingestion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testWindow += 61_000;
    vi.setSystemTime(testWindow);
    mocks.logEvent.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("accepts a whitelisted report without authentication or database access and omits all request credentials", async () => {
    const response = await POST(request({ ...report, digest: 1234567890 }, { cookie: "private-session", authorization: "Bearer private-token", "x-forwarded-for": "198.51.100.12" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "client_render_error", metadata: expect.objectContaining({ ...report, digest: 1234567890 }),
    }));
    const logged = JSON.stringify(mocks.logEvent.mock.calls);
    for (const value of ["private-session", "private-token", "198.51.100.12", "authorization", "cookie"]) expect(logged).not.toContain(value);
  });

  it.each<Record<string, string>>([{ origin: "https://attacker.test" }, { origin: "" }, { "sec-fetch-site": "cross-site" }])("rejects an untrusted browser origin: %j", async (headers) => {
    expect((await POST(request(report, headers))).status).toBe(403);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it.each([
    { ...report, message: "private withdrawal code" },
    { ...report, page: "/en/trade-room/private-id" },
    { ...report, frames: [{ asset: "https://example.test/private?code=123456", line: 1, column: 1 }] },
    { ...report, digest: "private-data" },
    "not json",
  ])("rejects unapproved or malformed report content without logging it", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("enforces the byte limit even when content-length is absent or false", async () => {
    expect((await POST(request(" ".repeat(2_049)))).status).toBe(413);
    expect((await POST(request(" ".repeat(2_049), { "content-length": "1" }))).status).toBe(413);
    expect((await POST(request(report, { "content-length": "999999" }))).status).toBe(413);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("limits one address to five reports per minute", async () => {
    for (let count = 0; count < 5; count += 1) expect((await POST(request())).status).toBe(204);
    const rejected = await POST(request());
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
    expect(mocks.logEvent).toHaveBeenCalledTimes(5);
  });

  it("cancels a stalled request body instead of retaining a function indefinitely", async () => {
    const cancel = vi.fn();
    const init = { method: "POST", headers: { origin: "https://www.alphatraders.co.il", "content-type": "application/json" }, body: new ReadableStream({ cancel }), duplex: "half" as const };
    const pending = POST(new NextRequest(url, init));
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe(400);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
