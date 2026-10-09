import { expect, request, test, type Locator, type Page } from "@playwright/test";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { E2E_BASE_URL } from "./support/base-url";

const ROLES = ["BUYER", "SELLER", "ADMIN", "OWNER", "GUEST", "STUDENT", "PENDING"] as const;
type Role = typeof ROLES[number];
const SUPPORT_HEADERS = { "x-alpha-test-support": "enabled" };
const PENDING_ID = "e2e-profile-pending-seller";

// All data and writes stay inside the existing loopback-only E2E server.
test.beforeAll(async () => {
  expect(new URL(E2E_BASE_URL).hostname).toBe("localhost");
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const response = await api.get("/api/testing/alpha-exchange-state", { headers: SUPPORT_HEADERS });
    expect(response.ok()).toBe(true);
    const db = await response.json() as AlphaExchangeDb;
    const buyer = db.users.find(user => user.email === process.env.E2E_BUYER_EMAIL);
    expect(buyer).toBeTruthy();
    db.users = db.users.filter(user => user.id !== PENDING_ID);
    db.users.push({
      ...buyer!, id: PENDING_ID, email: `${PENDING_ID}@example.test`,
      fullName: "E2E Pending Seller", role: "buyer", roles: ["buyer", "pending_seller_approval"],
      sellerStatus: "pending_seller_approval", verifiedPhone: "+972500010009",
      whatsappNumber: "+972500010009", onboardingSelection: "seller_applicant",
    });
    const saved = await api.put("/api/testing/alpha-exchange-state", { headers: SUPPORT_HEADERS, data: db });
    expect(saved.ok()).toBe(true);
    process.env.E2E_PENDING_EMAIL = `${PENDING_ID}@example.test`;
    process.env.E2E_PENDING_PASSWORD = process.env.E2E_BUYER_PASSWORD;
  } finally {
    await api.dispose();
  }
});

async function login(page: Page, role: Role) {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  expect(email).toMatch(/@example\.test$/);
  expect(password).toBeTruthy();
  const response = await page.request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.92" },
    data: { email, password, rememberMe: false },
  });
  expect(response.ok()).toBe(true);
}

async function expectUsableLayout(workspace: Locator) {
  const layout = await workspace.evaluate(element => {
    const viewport = document.documentElement.clientWidth;
    const controls = [...element.querySelectorAll<HTMLElement>("a, button, summary, input, textarea")]
      .filter(control => control.getClientRects().length && getComputedStyle(control).visibility !== "hidden");
    return {
      viewport,
      width: document.documentElement.scrollWidth,
      clipped: controls.flatMap(control => {
        const rect = control.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= viewport + 1 ? [] : [control.getAttribute("aria-label") || control.textContent?.trim()];
      }),
      smallActions: controls.filter(control => control.matches("button, summary, .profile-quick-action") && control.getBoundingClientRect().height < 43).map(control => control.textContent?.trim()),
    };
  });
  expect(layout.clipped).toEqual([]);
  expect(layout.smallActions).toEqual([]);
  expect(layout.width).toBeLessThanOrEqual(layout.viewport + 1);
}

for (const locale of ["en", "ar"] as const) {
  for (const role of ROLES) {
    test(`${locale} ${role.toLowerCase()} profile keeps actions and sections usable on phone, tablet and desktop`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      expect(new URL(baseURL!).hostname).toBe("localhost");
      await login(page, role);
      await page.goto(`/${locale}/profile`);
      const workspace = page.locator(".profile-workspace");
      await expect(workspace.getByRole("heading", { level: 1 })).toHaveText(locale === "ar" ? "ملفي الشخصي" : "My profile");
      const actions = workspace.getByRole("navigation");
      const target = role === "OWNER" || role === "ADMIN" ? "/admin/alpha-exchange"
        : role === "SELLER" ? "/dashboard/seller"
          : role === "GUEST" || role === "STUDENT" ? "/academy" : "/dashboard";
      await expect(actions.locator("a").first()).toHaveAttribute("href", `/${locale}${target}`);
      await expect(actions.locator("a[href$='/journal']")).toHaveCount(0);
      await expect(actions).toContainText(locale === "ar" ? "قريبًا" : "Coming soon");
      await expect(actions.locator("a[href$='/trades']")).toHaveCount(role === "GUEST" || role === "STUDENT" ? 0 : 1);
      if (role !== "OWNER" && role !== "ADMIN") await expect(actions.locator("a[href*='/admin/']")).toHaveCount(0);
      if (role === "PENDING") await expect(workspace.getByRole("link", { name: locale === "ar" ? "حالة طلب البائع" : "Seller application status" })).toBeVisible();

      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 936 });
        await workspace.getByRole("tab").first().click();
        await expect(workspace.locator("#profile-panel-edit")).toBeHidden();
        await expect(workspace.locator("details[open]")).toHaveCount(0);
        const actionOffset = await actions.evaluate(element => element.getBoundingClientRect().top - element.closest(".profile-workspace")!.getBoundingClientRect().top);
        expect(actionOffset, `${role} ${locale} actions at ${width}px`).toBeLessThan(430);
        await expectUsableLayout(workspace);
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: testInfo.outputPath(`profile-${locale}-${role.toLowerCase()}-${width}.png`), animations: "disabled" });
        }
        await workspace.getByRole("tab").nth(1).click();
        await expect(workspace.locator("#profile-full-name")).toBeVisible();
        await expectUsableLayout(workspace);
        await workspace.getByRole("tab").nth(2).click();
        await expect(workspace.locator("#notification-preferences").getByRole("checkbox").first()).toBeVisible();
        await expectUsableLayout(workspace);
      }
      // Check that the prominent account link actually reaches its authorized destination.
      await actions.locator("a").first().click();
      await expect(page).toHaveURL(new RegExp(`/${locale}${target}$`));
    });
  }
}

test("profile edits survive section changes and live refresh, save, and persist after reload", async ({ page, baseURL }, testInfo) => {
  expect(new URL(baseURL!).hostname).toBe("localhost");
  await login(page, "BUYER");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/profile#contact-details");
  const workspace = page.locator(".profile-workspace");
  const edit = workspace.getByRole("tab", { name: "Edit profile", exact: true });
  await expect(edit).toHaveAttribute("aria-selected", "true");
  await expect(workspace.locator("#contact-details")).toBeInViewport();
  const bio = workspace.getByLabel("Professional bio");
  const previousBio = await bio.inputValue();
  const draft = "My profile review — saved from the phone layout.";
  await bio.fill(draft);
  await workspace.getByRole("tab", { name: "Overview", exact: true }).click();
  const refreshed = page.waitForResponse(response => response.url().endsWith("/api/auth/profile") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("alpha-profile-updated")));
  await refreshed;
  await edit.click();
  await expect(bio).toHaveValue(draft);
  const saved = page.waitForResponse(response => response.url().endsWith("/api/auth/profile") && response.request().method() === "PATCH");
  await workspace.getByRole("button", { name: "Save changes", exact: true }).first().click();
  expect((await saved).ok()).toBe(true);
  await expect(workspace.getByRole("status")).toContainText("Trading identity saved.");
  await page.reload();
  await expect(edit).toHaveAttribute("aria-selected", "true");
  await expect(bio).toHaveValue(draft);
  await expectUsableLayout(workspace);
  await page.screenshot({ path: testInfo.outputPath("profile-edit-phone.png"), animations: "disabled" });
  await page.request.patch("/api/auth/profile", { data: { bio: previousBio } });
});

test("Arabic profile tabs support RTL keyboard navigation and notification deep links", async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe("localhost");
  await login(page, "STUDENT");
  await page.goto("/ar/profile#notification-preferences");
  const tabs = page.locator(".profile-workspace").getByRole("tab");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(2).press("Home");
  await expect(tabs.first()).toBeFocused();
  await tabs.first().press("ArrowLeft");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(1).press("End");
  await expect(tabs.nth(2)).toBeFocused();
  await page.locator(".profile-workspace").getByRole("button", { name: "تعديل الملف", exact: true }).click();
  await expect(page.locator("#profile-panel-edit")).toBeFocused();
  await expect(page.locator("#profile-panel-edit")).toBeInViewport();
});
