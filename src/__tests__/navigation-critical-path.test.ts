// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("authenticated navigation critical path", () => {
  it("keeps session resolution direct and sequences locale loading before auth", () => {
    const auth = source("src/lib/auth.ts");
    const layout = source("src/app/[locale]/layout.tsx");

    expect(auth).toContain("export async function getCurrentSessionUser()");
    expect(auth).not.toContain("cache(resolveCurrentSessionUser)");
    expect(layout).toContain("const messages = await getMessages();");
    expect(layout).toContain("const sessionUser = await getCurrentSessionUser();");
    expect(layout.indexOf("const messages = await getMessages();"))
      .toBeLessThan(layout.indexOf("const sessionUser = await getCurrentSessionUser();"));
  });

  it("keeps authenticated user lookup on the stable two-table snapshot path", () => {
    const store = source("src/lib/alpha-exchange-store.ts");
    const start = store.indexOf("async function readDbForAuthUser");
    const end = store.indexOf("async function readDbForPurchaseRequestActor", start);
    const authReadFunction = store.slice(start, end);

    expect(authReadFunction).toContain("return readDbForSelectedTables(AUTH_USER_READ_TABLES)");
    expect(authReadFunction).not.toContain("loadAuthUserSnapshot");
  });

  it("loads one scoped trade snapshot for the global authenticated header", () => {
    const header = source("src/components/layout/site-header.tsx");
    const store = source("src/lib/alpha-exchange-store.ts");
    const start = store.indexOf("async function resolveTradeHeaderStateForUser");
    const end = store.indexOf("export const getTradeHeaderStateForUser", start);
    const tradeHeaderFunction = store.slice(start, end);

    expect(header).toContain("getTradeHeaderStateForUser(sessionUser.id, sessionUser.role)");
    expect(header).toContain("async function getNonBlockingTradeHeaderState");
    expect(header).toContain("return { activeTrade: null, tradeReminder: null }");
    expect(header).not.toContain("getFirstActiveTradeForUser(sessionUser.id");
    expect(header).not.toContain("getTradeReminderForUser(sessionUser.id");
    expect(tradeHeaderFunction).toContain("readDbForTradeCandidate(userId, role, ACTIVE_TRADE_STATUSES, true)");
    expect(tradeHeaderFunction).not.toContain("readDb()");
    expect(store).toContain("export const getTradeHeaderStateForUser = cache(resolveTradeHeaderStateForUser)");
  });

  it("does not trigger a second full snapshot for the admin SMS panel", () => {
    const store = source("src/lib/alpha-exchange-store.ts");
    const start = store.indexOf("export async function getSmsDeliveriesForAdmin");
    const end = store.indexOf("export async function openTradeDispute", start);
    const smsFunction = store.slice(start, end);

    expect(smsFunction).toContain("readDbForSelectedTables(SMS_DELIVERY_READ_TABLES");
    expect(smsFunction).not.toContain("readDb()");
  });
});
