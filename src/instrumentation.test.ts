import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { onRequestError } from "./instrumentation";

describe("request error instrumentation", () => {
  it("records a stable redacted error event without headers or request values", () => {
    onRequestError(
      new TypeError("private buyer data"),
      { path: "/api/private?token=secret", method: "post" },
      { routePath: "/api/private", routeType: "route", routerKind: "App Router" },
    );

    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "unhandled_request_error",
      outcome: "failed",
      metadata: expect.objectContaining({
        errorName: "TypeError",
        method: "POST",
        routePath: "/api/private",
      }),
    }));
    const serialized = JSON.stringify(mocks.logEvent.mock.calls[0]);
    expect(serialized).not.toContain("private buyer data");
    expect(serialized).not.toContain("token=secret");
  });
});
