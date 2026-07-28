/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http');
const https = require('https');
const base = 'http://127.0.0.1:3001';
const cookieJar = new Map();
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = { ...(options.headers || {}) };
    const cookies = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookies) headers.cookie = cookies;
    const req = lib.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: options.method || 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const setCookies = res.headers['set-cookie'] || [];
        setCookies.forEach((cookie) => {
          const parts = cookie.split(';')[0].split('=');
          const name = parts.shift();
          const value = parts.join('=');
          if (name) cookieJar.set(name, value);
        });
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
(async () => {
  const loginRes = await request(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'marksally11@yahoo.com', password: 'Roflxd123!' }),
  });
  console.log('login status', loginRes.statusCode);
  console.log('login body', loginRes.body.slice(0, 1000));
  const profileRes = await request(base + '/en/profile');
  console.log('profile status', profileRes.statusCode);
  console.log(profileRes.body.slice(0, 25000));
})();
