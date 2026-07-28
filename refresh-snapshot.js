/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const { getAlphaExchangeRepository } = require('./src/lib/alpha-exchange-repository');
(async () => {
  const db = JSON.parse(fs.readFileSync('data/alpha-exchange-db.json', 'utf8'));
  const repo = await getAlphaExchangeRepository();
  await repo.saveSnapshot(db, { skipReadyCheck: true });
  console.log('snapshot refreshed');
})();
