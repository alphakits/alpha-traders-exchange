import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it("bounds local memory without evicting live limits and recovers after expiration", async () => {
  vi.resetModules();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const { checkRateLimit } = await import("./rate-limit");
  const input = { headers: new Headers({ "x-forwarded-for": "8.8.8.8" }), key: "capacity", maxRequests: 1, windowMs: 60_000 };
  for (let index = 0; index < 20_000; index++) expect(checkRateLimit({ ...input, identifier: String(index) }).allowed).toBe(true);
  expect(checkRateLimit({ ...input, identifier: "new" })).toMatchObject({ allowed: false, reason: "limiter_unavailable" });
  expect(checkRateLimit({ ...input, identifier: "0" })).toMatchObject({ allowed: false, reason: "limit_reached" });
  clock.mockReturnValue(1_800_000_060_000);
  expect(checkRateLimit({ ...input, identifier: "new" }).allowed).toBe(true);
});
