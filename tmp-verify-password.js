/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto');
const fs = require('fs');
const db = JSON.parse(fs.readFileSync('data/alpha-exchange-db.json', 'utf8'));
const user = db.users.find((item) => item.email === 'markwick99@yahoo.com');
const [salt, key] = user.passwordHash.split(':');
const derived = crypto.scryptSync('Roflxd123!', salt, 64);
console.log('match', Buffer.from(key, 'hex').equals(derived));
