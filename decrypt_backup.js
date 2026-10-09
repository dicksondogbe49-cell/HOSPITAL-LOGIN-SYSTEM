require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  console.error('Usage: node decrypt_backup.js <encrypted-file> <output.db>');
  process.exit(1);
}

try {
  const encrypted = fs.readFileSync(inputFile);
  const header = Buffer.from('HDBK1');
  if (encrypted.length < header.length + 28 || !encrypted.subarray(0, header.length).equals(header)) {
    throw new Error('This file is not a supported encrypted database backup.');
  }

  const sessionSecret = process.env.SESSION_SECRET || '';
  if (sessionSecret.length < 32) throw new Error('The original SESSION_SECRET is missing from .env.');

  const encryptionKey = Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(sessionSecret),
    Buffer.from('healthcare-app'),
    Buffer.from('database-backup-aes-256-gcm'),
    32,
  ));
  const ivStart = header.length;
  const tagStart = ivStart + 12;
  const ciphertextStart = tagStart + 16;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, encrypted.subarray(ivStart, tagStart));
  decipher.setAuthTag(encrypted.subarray(tagStart, ciphertextStart));
  const database = Buffer.concat([
    decipher.update(encrypted.subarray(ciphertextStart)),
    decipher.final(),
  ]);

  fs.writeFileSync(path.resolve(outputFile), database, { flag: 'wx' });
  console.log(`Decrypted database written to ${path.resolve(outputFile)}`);
} catch (error) {
  console.error(`Could not decrypt backup: ${error.message}`);
  process.exitCode = 1;
}