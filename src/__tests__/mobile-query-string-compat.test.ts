// @vitest-environment node

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const requireFromExpo = createRequire(resolve(process.cwd(), "node_modules/expo-router/package.json"));
const queryString = requireFromExpo("query-string") as {
  parse: (query: string) => Record<string, unknown>;
  stringify: (query: Record<string, unknown>, options?: { sort: boolean }) => string;
};

describe("Expo Router URL parser compatibility", () => {
  it("preserves the named parse/stringify API consumed by Expo's generated router", () => {
    expect(typeof queryString.parse).toBe("function");
    expect(typeof queryString.stringify).toBe("function");
  });

  it.each([
    ["requestId=Purchase-AbC&action=open-trade", { requestId: "Purchase-AbC", action: "open-trade" }],
    ["redirectTo=%2Fen%2Ftrade-room%2FPurchase-AbC%3Ftab%3Dchat", { redirectTo: "/en/trade-room/Purchase-AbC?tab=chat" }],
    ["text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7+world", { text: "مرحبا world" }],
    ["tag=one&tag=two&empty=&flag", { tag: ["one", "two"], empty: "", flag: null }],
    ["amount=12.50&enabled=false", { amount: "12.50", enabled: "false" }],
  ])("preserves deep-link parameters for %s", (query, expected) => {
    expect(queryString.parse(query)).toEqual(expected);
    expect(queryString.parse(queryString.stringify(expected, { sort: false }))).toEqual(expected);
  });

  it("finishes malformed URL parsing within a bounded process deadline", () => {
    // A separate process also makes a reintroduced synchronous decoder loop
    // fail safely instead of blocking the test runner indefinitely.
    const script = `
      const { createRequire } = require('node:module');
      const parser = createRequire(${JSON.stringify(resolve(process.cwd(), "node_modules/expo-router/package.json"))})('query-string');
      const result = parser.parse('value=' + '%FE%FF%EF%BF%BD'.repeat(2000));
      if (typeof result.value !== 'string') process.exit(2);
    `;
    const result = spawnSync(process.execPath, ["-e", script], { timeout: 3000, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
