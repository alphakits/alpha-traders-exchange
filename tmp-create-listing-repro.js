const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER_CONSOLE', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE_ERROR', err.message));
  page.on('requestfailed', req => console.log('REQUEST_FAILED', req.method(), req.url(), req.failure()?.errorText));
  page.on('response', async response => {
    if (response.url().includes('/api/alpha-exchange/listings') || response.url().includes('/api/alpha-exchange/my-listings')) {
      console.log('RESPONSE', response.status(), response.url());
      try {
        console.log('BODY', await response.text());
      } catch (e) {
        console.log('BODY_ERROR', e.message);
      }
    }
  });

  try {
    console.log('go to login');
    await page.goto('http://127.0.0.1:3001/en/login', { waitUntil: 'networkidle', timeout: 60000 });
    await page.fill('input[placeholder="Email"]', 'marksally11@yahoo.com');
    await page.fill('input[placeholder="Password"]', 'Roflxd123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard\/seller|\/dashboard|\/en$/, { timeout: 60000 });
    console.log('after login', page.url());

    console.log('go to seller dashboard');
    await page.goto('http://127.0.0.1:3001/en/dashboard/seller', { waitUntil: 'networkidle', timeout: 60000 });
    console.log('seller page', page.url());

    const form = page.locator('form').filter({ has: page.getByRole('button', { name: /Create Live Listing/i }) }).first();
    console.log('form present', await form.count());

    await form.locator('input').nth(0).fill('1000');
    await form.locator('input').nth(1).fill('3.70');
    await form.locator('input').nth(2).fill('ILS');
    await form.locator('input').nth(4).fill('Bank transfer');
    await form.locator('input').nth(5).fill('100');
    await form.locator('input').nth(6).fill('1000');
    await form.locator('input').nth(8).fill('5 min');
    await form.locator('textarea').nth(0).fill('');
    await form.locator('textarea').nth(1).fill('');

    await page.getByRole('button', { name: /Create Live Listing/i }).click();
    await page.waitForTimeout(5000);
    console.log('final body snippet');
    console.log((await page.textContent('body')).slice(0, 8000));
  } catch (err) {
    console.error('RUNNER_ERROR', err && err.stack ? err.stack : err);
  } finally {
    await browser.close();
  }
})();
