import { expect, test, type Page } from "@playwright/test";

const healthPath = "/en/admin/alpha-exchange?section=system-health";

async function openOwnerHealth(page: Page) {
  const login = await page.request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.93" },
    data: { email: process.env.E2E_OWNER_EMAIL!, password: process.env.E2E_OWNER_PASSWORD!, rememberMe: true },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto(healthPath);
  await expect(page.getByRole("heading", { name: "Website Health", exact: true })).toBeVisible();
  await expect(page.getByText(/^Last checked:/)).toBeVisible();
}

test("owner health returns to the preserved sign-in destination after another tab signs out", async ({ page, context }) => {
  await openOwnerHealth(page);
  const otherTab = await context.newPage();
  try {
    await otherTab.goto("/en");
    await otherTab.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(otherTab.getByRole("button", { name: "Sign out", exact: true })).toBeHidden();
    // The canonical session broadcast can redirect this tab before a manual
    // health refresh; waiting for a now-removed button would reject recovery.
    await expect(page).toHaveURL(/\/en\/login\?redirectTo=/);
    expect(new URL(page.url()).searchParams.get("redirectTo")).toBe(healthPath);
    await expect(page.getByRole("heading", { name: "Website Health", exact: true })).toBeHidden();
    await expect(page.getByText("Website health could not be loaded. Try again.", { exact: true })).toBeHidden();
  } finally {
    await otherTab.close();
  }
});

test("a temporary health outage preserves the owner session and can recover without sign-in", async ({ page }) => {
  await openOwnerHealth(page);
  let unavailable = true;
  await page.route("**/api/admin/system-health", async route => {
    if (unavailable) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary fixture outage" }) });
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Check Now", exact: true }).click();
  await expect(page.getByText("Website health could not be loaded. Try again.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp("/en/admin/alpha-exchange"));
  const authorized = await page.request.get("/api/alpha-exchange/admin-prep");
  expect(authorized.status()).toBe(200);

  unavailable = false;
  await page.getByRole("button", { name: "Check Now", exact: true }).click();
  await expect(page.getByText("Website health could not be loaded. Try again.", { exact: true })).toBeHidden();
  await expect(page.getByText(/^Last checked:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
});
