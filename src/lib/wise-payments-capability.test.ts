// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWisePaymentsMode } from "@/lib/wise-payments-capability";
const hosted = { NODE_ENV: "production", ALPHA_WISE_PAYMENTS_ENABLED: "1", ALPHA_EXCHANGE_DATA_BACKEND: "postgres",
  DATABASE_URL: "postgresql://synthetic@localhost/synthetic", ALPHA_EXCHANGE_WISE_DATA_SECRET: "synthetic-hosted-wise-key-not-for-real-use" };
afterEach(() => vi.unstubAllGlobals());
describe("server Wise capability", () => {
  it("is default off and accepts only explicit complete hosted configuration", () => {
    expect(getWisePaymentsMode({})).toBe("disabled");
    expect(getWisePaymentsMode(hosted)).toBe("hosted");
    expect(getWisePaymentsMode({ ...hosted, ALPHA_WISE_PAYMENTS_ENABLED: "0" })).toBe("disabled");
  });
  it.each([
    { ALPHA_WISE_PAYMENTS_ENABLED: undefined }, { ALPHA_WISE_PAYMENTS_ENABLED: "true" },
    { NODE_ENV: "development" }, { ALPHA_EXCHANGE_DATA_BACKEND: "json" },
    { DATABASE_URL: "" }, { DATABASE_URL: "https://example.test" }, { DATABASE_URL: "invalid" },
    { SUPABASE_DB_URL: "" }, { SUPABASE_DB_URL: "   " }, { SUPABASE_DB_URL: "https://invalid.example.test" },
    { ALPHA_EXCHANGE_WISE_DATA_SECRET: "" }, { ALPHA_EXCHANGE_WISE_DATA_SECRET: "short" },
    { ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET: "short" },
    { ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1" }, { ALPHA_E2E_TEST_SUPPORT: "1" },
    { ALPHA_E2E_LOOPBACK_ONLY: "1" }, { ALPHA_USDT_OFFLINE_PREVIEW: "1" },
  ])("rejects incomplete/unsafe hosted settings %j", invalid => expect(getWisePaymentsMode({ ...hosted, ...invalid })).toBe("disabled"));
  it("matches repository precedence: a defined Supabase URL wins over DATABASE_URL", () => {
    expect(getWisePaymentsMode({ ...hosted, SUPABASE_DB_URL: "postgresql://synthetic@localhost/preferred", DATABASE_URL: "invalid" })).toBe("hosted");
  });
  it("cannot enable a hosted deployment using copied draft flags", () => {
    expect(getWisePaymentsMode({ NODE_ENV: "production", VERCEL: "1", ALPHA_WISE_DRAFT_ENABLED: "1", ALPHA_EXCHANGE_DATA_BACKEND: "json", ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1" })).toBe("disabled");
  });
  it("keeps the original isolated draft path", () => expect(getWisePaymentsMode({ ALPHA_WISE_DRAFT_ENABLED: "1", ALPHA_EXCHANGE_DATA_BACKEND: "json", ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1" })).toBe("draft"));
  it("cannot be granted by browser state or public flags", () => {
    vi.stubGlobal("window", {});
    expect(getWisePaymentsMode(hosted)).toBe("disabled");
    expect(getWisePaymentsMode({ NEXT_PUBLIC_ALPHA_WISE_PAYMENTS_ENABLED: "1" })).toBe("disabled");
  });
});
