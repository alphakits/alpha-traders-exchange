import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb } from "../src/types/alpha-exchange";

const prefix = "e2e-owner-csv-";
const supportHeaders = { "x-alpha-test-support": "enabled" };
async function readFixture(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: supportHeaders });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function writeFixture(api: APIRequestContext, db: AlphaExchangeDb) {
  const response = await api.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db });
  expect(response.ok()).toBe(true);
}
function removeFixtures(db: AlphaExchangeDb) {
  db.purchaseRequests = db.purchaseRequests.filter(row => !row.id.startsWith(prefix));
  db.commissionRecords = db.commissionRecords.filter(row => !row.id.startsWith(prefix));
}

test.beforeEach(async ({ request, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe("localhost");
  const db = await readFixture(request);
  removeFixtures(db);
  const buyer = db.users.find(user => user.id === "e2e-global-admin")!;
  expect(buyer).toBeTruthy();
  for (let i = 1; i <= 12; i++) {
    const createdAt = `2026-09-${String(i).padStart(2, "0")}T00:00:00.000Z`;
    db.purchaseRequests.push({
      id: `${prefix}${i === 11 ? "excluded" : "kept"}-${i}`, tradeId: `${prefix}trade-${i}`, displayNumber: 44000 + i,
      listingId: "e2e-global-seller-listing", sellerId: "e2e-global-seller", buyerId: buyer.id, buyerName: buyer.fullName,
      usdtAmount: String(i), fiatAmount: String(i * 3.2), currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
      status: i === 12 ? "pending" : "completed", timeline: [], createdAt, updatedAt: createdAt,
    });
    if (i <= 11) db.commissionRecords.push({
      id: `${prefix}commission-${i}`, displayNumber: 45000 + i, source: "admin_manual", sellerId: "e2e-global-seller",
      issueReason: `CSV ${i === 11 ? "excluded" : "kept"} ${String(i).padStart(2, "0")}`,
      rate: 0, grossAmount: 0, commissionAmount: i, paymentStatus: "pending", dueAt: "2030-01-01T00:00:00.000Z",
      createdAt, updatedAt: createdAt,
    });
  }
  await writeFixture(request, db);
});
test.afterEach(async ({ request }) => {
  const db = await readFixture(request);
  removeFixtures(db);
  await writeFixture(request, db);
});

for (const locale of ["en", "ar"] as const) {
  test(`${locale} owner CSV downloads include all matching pages in the selected order`, async ({ page }) => {
    const t = (en: string, ar: string) => locale === "ar" ? ar : en;
    expect(process.env.E2E_OWNER_EMAIL).toMatch(/@example\.test$/);
    const login = await page.request.post("/api/auth/login", {
      headers: { "x-forwarded-for": "198.51.100.96" },
      data: { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD, rememberMe: false },
    });
    expect(login.ok()).toBe(true);
    for (const section of ["purchase-requests", "commissions"]) {
      await page.goto(`/${locale}/admin/alpha-exchange?section=${section}`);
      const isTrades = section === "purchase-requests";
      await page.getByPlaceholder(isTrades
        ? t("Search buyer, seller, listing...", "ابحث بالمشتري أو البائع أو العرض...")
        : t("Search commission, trade, seller, reason...", "ابحث بالعمولة أو الصفقة أو البائع أو السبب...")).fill(isTrades ? `${prefix}kept` : "CSV kept");
      if (isTrades) await page.getByRole("combobox", { name: t("Filter trades by status", "تصفية الصفقات حسب الحالة") }).selectOption("completed");
      await page.getByRole("combobox").filter({ has: page.getByRole("option", { name: t("Sort: Oldest", "الترتيب: الأقدم"), exact: true }) }).selectOption("oldest");
      await page.getByRole("button", { name: t("Next", "التالي"), exact: true }).click();
      await expect(page.getByRole("button", { name: t("Next", "التالي"), exact: true })).toBeDisabled();
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: isTrades ? t("Export Trades", "تصدير الصفقات") : t("Export CSV", "تصدير CSV"), exact: true }).click();
      const download = await downloading;
      expect(await download.failure()).toBeNull();
      const csv = await readFile((await download.path())!, "utf8");
      const lines = csv.split("\n");
      expect(lines).toHaveLength(11);
      for (let i = 1; i <= 10; i++) expect(lines[i]).toContain(isTrades ? `TR-${String(44000 + i).padStart(6, "0")}` : `CSV kept ${String(i).padStart(2, "0")}`);
      expect(csv).not.toContain("CSV excluded");
      expect(csv).not.toContain("TR-044011");
      expect(csv).not.toContain("TR-044012");
    }
  });
}
