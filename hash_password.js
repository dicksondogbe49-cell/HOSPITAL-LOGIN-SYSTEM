const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

(async () => {
  const password = 'D!I!C!K!S!O!N&';
  const pepper = '12345678901234567890123456789012';
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password + pepper, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  console.log(JSON.stringify({
    password,
    password_salt: salt.toString('hex'),
    password_hash: derived.toString('hex'),
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
