import { expect, test, type Page } from "@playwright/test";
import { createECDH } from "node:crypto";

// UI-only push evidence: login, profile rendering, service-worker registration,
// and the configuration GET use the local production app. Browser push capability,
// permission and notification persistence/reminder endpoints are mocked. This suite
// never contacts a push provider or proves delivery on an actual device.
type Role = "BUYER" | "SELLER";
type Config = {
  userId: string;
  preferences: { inApp: boolean; email: boolean; browserPush: boolean };
  emailVerified: boolean;
  browserPush: { available: boolean; publicKey: string | null };
};

test.setTimeout(60_000);

async function login(page: Page, role: Role) {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  expect(email).toMatch(/@example\.test$/);
  expect(password).toBeTruthy();
  const response = await page.request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.119" },
    data: { email, password, rememberMe: false },
  });
  expect(response.ok()).toBe(true);
  const configResponse = await page.request.get("/api/alpha-exchange/notification-engagement");
  expect(configResponse.ok()).toBe(true);
  expect(configResponse.headers()["cache-control"]).toContain("no-store");
  const config = await configResponse.json() as Config;
  expect(config.userId).toBeTruthy();
  expect(typeof config.browserPush.available).toBe("boolean");
  expect(config.browserPush.publicKey).toEqual(config.browserPush.available ? expect.any(String) : null);
  if (process.env.E2E_EXPECT_CONFIGURED_PUSH === "1") expect(config.browserPush.available).toBe(true);
  expect(Object.keys(config.browserPush).sort()).toEqual(["available", "publicKey"]);
  expect(JSON.stringify(config)).not.toMatch(/privateKey|WEB_PUSH_VAPID_PRIVATE_KEY|sessionToken|passwordHash/);
  return config;
}

async function mockPushUi(page: Page, config: Config, mode: "prompt" | "blocked" | "unsupported") {
  const registrationRequests: Record<string, unknown>[] = [];
  // Keep this UI suite runnable under the normal CI config, which intentionally
  // has no live provider credentials. The actual GET above remains unmocked.
  const browserPush = { available: true, publicKey: config.browserPush.publicKey
    ?? createECDH("prime256v1").generateKeys().toString("base64url") };
  let enabled = false;
  await page.route("**/api/alpha-exchange/notification-engagement", async route => {
    const method = route.request().method();
    const response = method === "GET"
      ? { ...config, browserPush, preferences: { ...config.preferences, email: true, browserPush: enabled } }
      : route.request().postDataJSON()?.action === "snooze" ? { snoozed: true } : { show: false };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/api/alpha-exchange/browser-push", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    registrationRequests.push(body);
    expect(body.expectedUserId).toBe(config.userId);
    if (body.action === "subscribe") enabled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ registered: true }) });
  });
  await page.addInitScript(({ mode, publicKey }) => {
    const testWindow = window as Window & { __pushUiCalls?: number; __pushUiPermissionCalls?: number };
    testWindow.__pushUiCalls = 0;
    testWindow.__pushUiPermissionCalls = 0;
    if (mode === "unsupported") {
      delete (window as unknown as Record<string, unknown>).PushManager;
      return;
    }
    // Headless Chromium may report denied despite grantPermissions, and the
    // Linux WebKit port has no PushManager. Model those provider-facing APIs
    // explicitly; retain real service-worker registration/activation below.
    let permission: NotificationPermission = mode === "blocked" ? "denied" : "default";
    class UiNotification {
      static get permission() { return permission; }
      static async requestPermission(): Promise<NotificationPermission> {
        testWindow.__pushUiPermissionCalls! += 1;
        if (permission !== "denied") permission = "granted";
        return permission;
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: UiNotification });
    let subscription: PushSubscription | null = null;
    class UiPushManager implements PushManager {
      async getSubscription() { return subscription; }
      async permissionState(): Promise<PermissionState> {
        return permission === "default" ? "prompt" : permission;
      }
      async subscribe(options: PushSubscriptionOptionsInit = {}) {
        testWindow.__pushUiCalls! += 1;
        const requestedKey = options.applicationServerKey;
        const applicationServerKey = requestedKey instanceof ArrayBuffer ? requestedKey
          : ArrayBuffer.isView(requestedKey)
            ? new Uint8Array(requestedKey.buffer, requestedKey.byteOffset, requestedKey.byteLength).slice().buffer
            : null;
        subscription = {
          endpoint: "https://fcm.googleapis.com/fcm/send/local-ui-only",
          expirationTime: null,
          options: { userVisibleOnly: true, applicationServerKey },
          getKey: () => null,
          toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/local-ui-only",
            keys: { p256dh: publicKey!, auth: "AQEBAQEBAQEBAQEBAQEBAQ" } }),
          unsubscribe: async () => { subscription = null; return true; },
        };
        return subscription;
      }
    }
    Object.defineProperty(window, "PushManager", { configurable: true, value: UiPushManager });
    const pushManager = new UiPushManager();
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
      configurable: true, get: () => pushManager,
    });
  }, { mode, publicKey: browserPush.publicKey });
  return registrationRequests;
}

async function openSetup(page: Page, locale: "en" | "ar") {
  await page.goto(`/${locale}/profile`);
  await page.getByRole("tab", { name: locale === "ar" ? "التنبيهات" : "Alerts", exact: true }).click();
  await page.getByRole("button", { name: locale === "ar" ? "إعداد إشعارات هذا الجهاز" : "Set up device alerts", exact: true }).click();
  const setup = page.locator("#notification-setup");
  await expect(setup).toBeVisible();
  await expect(setup).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  return setup;
}

for (const scenario of [
  { role: "BUYER" as const, locale: "en" as const, width: 1280 },
  { role: "SELLER" as const, locale: "ar" as const, width: 390 },
]) {
  test(`UI only: ${scenario.role.toLowerCase()} manually connects device alerts in ${scenario.locale} at ${scenario.width}px`, async ({ page, baseURL }, testInfo) => {
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const config = await login(page, scenario.role);
    const requests = await mockPushUi(page, config, "prompt");
    const setup = await openSetup(page, scenario.locale);
    expect(await page.evaluate(() => (window as Window & { __pushUiCalls?: number }).__pushUiCalls)).toBe(0);
    expect(await page.evaluate(() => (window as Window & { __pushUiPermissionCalls?: number }).__pushUiPermissionCalls)).toBe(0);
    await setup.getByRole("button", { name: scenario.locale === "ar" ? "تفعيل" : "Enable", exact: true }).click();
    await expect.poll(() => requests.filter(request => request.action === "subscribe").length).toBe(1);
    // The completed reminder closes after its preference refresh. Open settings
    // again to verify the persisted device state instead of racing that close.
    await expect(setup).toBeHidden();
    await page.getByRole("button", { name: scenario.locale === "ar" ? "إعداد إشعارات هذا الجهاز" : "Set up device alerts", exact: true }).click();
    await expect(setup.getByRole("heading")).toHaveText(scenario.locale === "ar" ? "إشعاراتك مفعّلة" : "Your alerts are switched on");
    expect(requests.filter(request => request.action === "subscribe")).toHaveLength(1);
    expect(requests[0]).toMatchObject({ locale: scenario.locale, expectedUserId: config.userId });
    expect(await page.evaluate(() => (window as Window & { __pushUiCalls?: number }).__pushUiCalls)).toBe(1);
    expect(await page.evaluate(() => (window as Window & { __pushUiPermissionCalls?: number }).__pushUiPermissionCalls)).toBe(1);
    const worker = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.active?.scriptURL);
    expect(worker).toContain("/alpha-push-sw.js");
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await setup.screenshot({ path: testInfo.outputPath(`push-setup-${scenario.locale}.png`) });
  });
}

test("UI only: blocked browser notifications show recovery instructions without registering", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const config = await login(page, "BUYER");
  const requests = await mockPushUi(page, config, "blocked");
  const setup = await openSetup(page, "en");
  await setup.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(setup.getByRole("status")).toContainText("Open site settings beside the address bar");
  await expect(setup.getByRole("button", { name: "Check again", exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(await page.evaluate(() => (window as Window & { __pushUiPermissionCalls?: number }).__pushUiPermissionCalls)).toBe(0);
  expect(pageErrors).toEqual([]);
  await setup.screenshot({ path: testInfo.outputPath("push-blocked-recovery.png") });
});

test("UI only: unsupported browser explains device availability and fits a narrow Arabic screen", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 320, height: 900 });
  const config = await login(page, "SELLER");
  const requests = await mockPushUi(page, config, "unsupported");
  const setup = await openSetup(page, "ar");
  await expect(setup).toContainText("غير متاح");
  await expect(setup.getByRole("button", { name: "تفعيل", exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await setup.screenshot({ path: testInfo.outputPath("push-unsupported-ar-mobile.png") });
});

test("actual local configuration endpoint rejects signed-out access", async ({ page }) => {
  const response = await page.request.get("/api/alpha-exchange/notification-engagement");
  expect(response.status()).toBe(401);
  expect(JSON.stringify(await response.json())).not.toMatch(/publicKey|privateKey/);
});
