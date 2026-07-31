const http = require('http');
const { chromium } = require('playwright');

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3004,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function parseCookies(headers) {
  const raw = headers['set-cookie'] || [];
  return raw.map((entry) => {
    const [cookiePart] = entry.split(';');
    const [name, ...valueParts] = cookiePart.split('=');
    return { name, value: valueParts.join('=') };
  });
}

(async () => {
  const loginResponse = await postJson('/api/auth/login', { email: 'marksally11@yahoo.com', password: 'Roflxd123!', rememberMe: true });
  if (loginResponse.statusCode !== 200) {
    throw new Error(`Login failed with status ${loginResponse.statusCode}: ${loginResponse.body}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const cookies = parseCookies(loginResponse.headers);
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' })));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3004/en/usdt-exchange', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const bodyText = (await page.textContent('body')) || '';
  const finalUrl = page.url();
  console.log('final-url', finalUrl);
  console.log('contains-dashboard-markers', /overview|listings|trades|settings|bank/i.test(bodyText));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
