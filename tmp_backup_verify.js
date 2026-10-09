require('dotenv').config({ path: 'C:/Users/user/Desktop/LOGIN INFO/.env' });
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const token = process.argv[2];
const sessionSecret = process.env.SESSION_SECRET;
const dbPath = 'C:/Users/user/Desktop/LOGIN INFO/data/app.db';
const db = new Database(dbPath);

const tokenHash = crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
const row = db.prepare('SELECT email_code_hash FROM sessions WHERE token_hash = ?').get(tokenHash);
if (!row) {
  console.log('NO_CODE');
  process.exit(1);
}

const expected = Buffer.from(row.email_code_hash, 'hex');
for (let i = 0; i < 1000000; i++) {
  const code = String(i).padStart(6, '0');
  const actual = crypto.createHmac('sha256', sessionSecret).update(tokenHash + ':' + code).digest();
  if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
    console.log(code);
    process.exit(0);
  }
}

console.log('NOT_FOUND');
process.exit(1);
