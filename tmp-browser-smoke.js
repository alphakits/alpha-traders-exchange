const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3004/en/login');
  await page.fill('input[placeholder="Email"]', 'marksally11@yahoo.com');
  await page.fill('input[placeholder="Password"]', 'Roflxd123!');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/usdt-exchange|\/en\/dashboard|\/en\/onboarding/, { timeout: 20000 });
  console.log('final-url', page.url());
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
