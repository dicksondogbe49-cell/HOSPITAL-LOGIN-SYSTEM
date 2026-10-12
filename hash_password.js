require('dotenv').config();
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const password = process.argv[2];
if (!password) {
  console.error('Usage: node hash_password.js <password>');
  process.exit(1);
}

const pepper = process.env.PASSWORD_PEPPER || '';
if (pepper.length < 32) {
  console.error('Set PASSWORD_PEPPER (at least 32 characters) in .env before hashing.');
  process.exit(1);
}

(async () => {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password + pepper, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  console.log(JSON.stringify({
    password_salt: salt.toString('hex'),
    password_hash: derived.toString('hex'),
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
