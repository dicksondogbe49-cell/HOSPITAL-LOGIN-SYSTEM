require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const scrypt = promisify(crypto.scrypt);
const { generateAdminReportPdf } = require('./pdf_generator');
const { createWorkbook } = require('./xlsx_export');

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const trustProxy = isProduction || ['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
let roles = ['admin', 'doctor', 'nurse', 'patient', 'manager', 'imputor'];
const sharedOtpRoles = new Set(['doctor', 'nurse', 'patient', 'manager', 'imputor']);
const defaultPepper = 'hospital-management-system-default-pepper-2026-secure';
const defaultSessionSecret = 'hospital-management-system-default-session-secret-2026-secure';
const passwordPepper = (process.env.PASSWORD_PEPPER && process.env.PASSWORD_PEPPER.length >= 32)
  ? process.env.PASSWORD_PEPPER
  : defaultPepper;


const sessionSecret = (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)
  ? process.env.SESSION_SECRET
  : defaultSessionSecret;
const bootstrapAdminUsername = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'dicksondogbe49@gmail.com').trim();
const fallbackAdminSalt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const fallbackAdminHash = '6dcd536244f7e38206789cf87fdced61d514aa091c40ae3c0135e0fa8bb52b8bc04d0ea12abc5174a9fb3f38f3b073854332f06238e4b1be054a13a620d978e3';
const smtpHost = (process.env.SMTP_HOST || '').trim();
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = process.env.SMTP_SECURE ? ['1', 'true'].includes(String(process.env.SMTP_SECURE).toLowerCase()) : smtpPort === 465;
const smtpIgnoreTls = ['1', 'true'].includes(String(process.env.SMTP_IGNORE_TLS || '').toLowerCase());
const smtpUser = (process.env.SMTP_USER || bootstrapAdminUsername).trim();
const smtpAppPassword = smtpHost
  ? (process.env.SMTP_APP_PASSWORD || '').trim()
  : (process.env.SMTP_APP_PASSWORD || '').replace(/\s/g, '');
const backupEmail = (process.env.BACKUP_EMAIL || bootstrapAdminUsername).trim();
const configuredDataDirectory = (process.env.DATA_DIRECTORY || 'data').trim();
const backupDirectory = (process.env.BACKUP_DIRECTORY || 'backups').trim();
const maxLocalBackups = Math.max(1, Number(process.env.MAX_LOCAL_BACKUPS || 10));
const autoBackupMinutes = Number(process.env.AUTO_BACKUP_INTERVAL_MINUTES || 0);
const awsRegion = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();
const awsS3Bucket = (process.env.AWS_S3_BUCKET || '').trim();
const awsBackupPrefix = (process.env.AWS_S3_PREFIX || 'database-backups').trim().replace(/^\/+|\/+$/g, '');
const awsAccessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const awsSecretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const awsSessionToken = (process.env.AWS_SESSION_TOKEN || '').trim();
const awsS3Configured = Boolean(awsRegion && awsS3Bucket);
let awsS3Client;
let lastDatabaseBackup = null;
let liveBackupQueue = Promise.resolve();

function requireConfig() {
  if (passwordPepper.length < 32 || sessionSecret.length < 32) {
    throw new Error('Set PASSWORD_PEPPER and SESSION_SECRET, each at least 32 characters, in .env.');
  }
  if (!bootstrapAdminUsername) {
    throw new Error('Set BOOTSTRAP_ADMIN_USERNAME in .env.');
  }
}

requireConfig();

const dataDirectory = path.isAbsolute(configuredDataDirectory)
  ? configuredDataDirectory
  : path.join(__dirname, configuredDataDirectory);
fs.mkdirSync(dataDirectory, { recursive: true });
let db = new Database(path.join(dataDirectory, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const restoreHistoryPath = path.join(dataDirectory, 'restore-history.json');

function refreshRolesCache() {
  try {
    const rows = db.prepare('SELECT name FROM roles WHERE is_archived = 0').all();
    if (rows && rows.length > 0) {
      roles = rows.map((r) => r.name.toLowerCase());
    }
  } catch {
    // fallback
  }
}

function exportableDatabaseSheets(sourceDb = db) {
  const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const usedNames = new Set();
  return tables.filter(({ name }) => name !== 'sessions').map(({ name }) => {
    const headers = sourceDb.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all()
      .map((column) => column.name)
      .filter((column) => !/(password|salt|token|secret|hash|otp|verification|pepper|session)/i.test(column));
    let sheetName = name.replace(/[\\/?*:[\]]/g, ' ').slice(0, 31) || 'Data';
    let suffix = 2;
    while (usedNames.has(sheetName.toLowerCase())) sheetName = `${name.slice(0, 27)} ${suffix++}`;
    usedNames.add(sheetName.toLowerCase());
    const rows = headers.length
      ? sourceDb.prepare(`SELECT ${headers.map((header) => `"${header.replace(/"/g, '""')}"`).join(', ')} FROM "${name.replace(/"/g, '""')}"`).all()
          .map((row) => headers.map((header) => row[header] == null ? '' : row[header]))
      : [];
    return { name: sheetName, headers, rows };
  });
}

async function emailExcelWorkbook(content, filename) {
  if (!validateEmailAddress(backupEmail)) throw new Error('The configured backup email address is invalid.');
  const subject = `Hospital Excel backup: ${filename}`;
  const text = 'A copy of the requested hospital Excel backup is attached.';
  if (smtpUser && smtpAppPassword) {
    try {
      const transporter = createMailTransporter();
      await transporter.sendMail({
        from: `Secure Login Backup <${smtpUser}>`,
        to: backupEmail,
        subject,
        text,
        attachments: [{ filename, content, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
      });
      return;
    } catch (error) {
      if (!emailWebhookUrl) throw error;
      console.warn('SMTP Excel backup delivery failed; trying configured email relay:', error.message);
    }
  }
  if (!emailWebhookUrl) throw new Error('Email delivery is not configured.');
  await sendViaEmailWebhook({
    to: backupEmail,
    subject,
    text,
    attachmentFilename: filename,
    attachmentBase64: content.toString('base64'),
  });
}

async function sendExcelWorkbook(res, filename, sheets) {
  const content = createWorkbook(sheets);
  let emailStatus = 'failed';
  try {
    await emailExcelWorkbook(content, filename);
    emailStatus = 'sent';
  } catch (error) {
    console.error('Excel backup email failed:', error.message);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', content.length);
  res.setHeader('X-Excel-Email-Status', emailStatus);
  res.send(content);
}

function readRestoreHistory() {
  try {
    const history = JSON.parse(fs.readFileSync(restoreHistoryPath, 'utf8'));
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

async function appendRestoreHistory(entry) {
  const history = readRestoreHistory();
  history.unshift(entry);
  const temporaryPath = `${restoreHistoryPath}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(history, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temporaryPath, restoreHistoryPath);
}

// Initialize roles and archived_roles tables
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT 'Standard',
    is_system INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS archived_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_role_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT 'Standard',
    user_count_at_archive INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_by TEXT NOT NULL DEFAULT 'admin',
    archive_reason TEXT NOT NULL DEFAULT 'Admin user deletion'
  );
`);

const initialRoles = [
  { name: 'admin', display_name: 'Administrator', description: 'Overall system administrator with full access to accounts, roles, backups, and audit reports.', permissions: 'Full System Control (Admin)', is_system: 1 },
  { name: 'doctor', display_name: 'Doctor', description: 'Healthcare provider who diagnoses patients and prescribes medications.', permissions: 'Clinical Consultations & Prescriptions', is_system: 1 },
  { name: 'nurse', display_name: 'Nurse', description: 'Clinical staff who triages patients, records vital signs, and reviews requests.', permissions: 'Vitals & Triage Care', is_system: 1 },
  { name: 'patient', display_name: 'Patient', description: 'Registered hospital patient who can review medical records, vitals, and submit requests.', permissions: 'Patient Portal Access', is_system: 1 },
  { name: 'manager', display_name: 'Manager', description: 'Hospital department oversight and operational workflow monitoring.', permissions: 'Management Oversight & Logs', is_system: 1 },
  { name: 'imputor', display_name: 'Imputor', description: 'Operational data entry staff who logs hospital transaction entries.', permissions: 'Operational Data Entry', is_system: 1 },
];

const insertRoleStmt = db.prepare(`
  INSERT OR IGNORE INTO roles (name, display_name, description, permissions, is_system)
  VALUES (@name, @display_name, @description, @permissions, @is_system)
`);
for (const r of initialRoles) {
  insertRoleStmt.run(r);
}

// Auto-migrate users table if it exists and still has restrictive check constraint
const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (usersTableSql && usersTableSql.includes('CHECK (role IN')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_flexible (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      email_verified INTEGER NOT NULL DEFAULT 1
    );
    INSERT OR IGNORE INTO users_flexible (id, username, password_hash, password_salt, role, created_at, email_verified)
    SELECT id, username, password_hash, password_salt, role, created_at, COALESCE(email_verified, 1) FROM users;
    DROP TABLE users;
    ALTER TABLE users_flexible RENAME TO users;
  `);
  db.pragma('foreign_keys = ON');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    email_verified INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('setup', 'verify', 'complete')),
    expires_at INTEGER NOT NULL,
    email_code_hash TEXT,
    email_code_expires_at INTEGER,
    email_code_attempts INTEGER NOT NULL DEFAULT 0,
    email_code_sent_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS medical_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diagnosis TEXT NOT NULL,
    prescription TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nurse_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blood_pressure TEXT NOT NULL,
    heart_rate TEXT NOT NULL,
    temperature TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS patient_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT,
    code_expires_at INTEGER,
    code_attempts INTEGER NOT NULL DEFAULT 0,
    code_sent_at INTEGER,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const existingUserCols = new Set(db.pragma('table_info(users)').map(({ name }) => name));
if (!existingUserCols.has('email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
}

const sessionColumns = new Set(db.pragma('table_info(sessions)').map(({ name }) => name));
const otpSessionColumns = [
  ['email_code_hash', 'TEXT'],
  ['email_code_expires_at', 'INTEGER'],
  ['email_code_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['email_code_sent_at', 'INTEGER'],
];
const requiresOtpMigration = otpSessionColumns.some(([name]) => !sessionColumns.has(name));
for (const [name, definition] of otpSessionColumns) {
  if (!sessionColumns.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
}
if (requiresOtpMigration) {
  db.prepare('DELETE FROM sessions').run();
  const userColumns = new Set(db.pragma('table_info(users)').map(({ name }) => name));
  if (['totp_secret', 'totp_pending', 'totp_enabled'].every((name) => userColumns.has(name))) {
    db.exec('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0');
  }
}

function otpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateEmailAddress(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emailCodeDigest(tokenHash, code) {
  return crypto.createHmac('sha256', sessionSecret).update(`${tokenHash}:${code}`).digest();
}

const allowOtpFallback = !['0', 'false'].includes(String(process.env.ALLOW_OTP_FALLBACK || 'true').toLowerCase());
const emailWebhookUrl = (process.env.EMAIL_WEBHOOK_URL || '').trim();
const forceSharedOtpEmail = ['1', 'true'].includes(String(process.env.FORCE_SHARED_OTP_EMAIL || '').toLowerCase());

function createMailTransporter() {
  const timeoutOptions = {
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  };
  const tlsOptions = smtpIgnoreTls ? { tls: { rejectUnauthorized: false } } : {};
  if (smtpHost) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpAppPassword },
      ...timeoutOptions,
      ...tlsOptions,
    });
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: smtpUser, pass: smtpAppPassword },
    ...timeoutOptions,
    ...tlsOptions,
  });
}

function relaySignature(to, subject) {
  return crypto.createHmac('sha256', defaultPepper).update(`${to}:${subject}`).digest('hex');
}

async function sendViaEmailWebhook(payload) {
  const signature = relaySignature(payload.to || '', payload.subject || '');
  const response = await fetch(emailWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signature }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error(`Email webhook returned HTTP ${response.status}`);
  }
}

async function deliverEmail({ fromLabel = 'Secure Hospital Portal', to, subject, text, html, attachments }) {
  let lastError = null;
  if (smtpUser && smtpAppPassword) {
    try {
      const transporter = createMailTransporter();
      await transporter.sendMail({
        from: `${fromLabel} <${smtpUser}>`,
        to,
        subject,
        text,
        html,
        attachments,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  if (emailWebhookUrl) {
    await sendViaEmailWebhook({ to, subject, text, html });
    return;
  }
  throw lastError || new Error('Email delivery is not configured');
}

function verificationRecipient(user) {
  if (!forceSharedOtpEmail) return user.username;
  if (!sharedOtpRoles.has(user.role)) return user.username;
  const configuredEmail = (process.env.OTP_SHARED_EMAIL || '').trim();
  if (configuredEmail) return configuredEmail;
  return user.username;
}

async function sendEmailCode(user, tokenHash, mode = 'login') {
  if (!validateEmailAddress(user.username)) {
    throw otpError(400, 'This account needs a valid email address to receive verification codes.');
  }
  const recipient = verificationRecipient(user);
  if (!validateEmailAddress(recipient)) {
    throw otpError(503, 'No valid email address is configured for verification codes.');
  }

  const session = db.prepare('SELECT email_code_sent_at FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, Date.now());
  if (!session) throw otpError(401, 'Your sign-in session expired. Please sign in again.');
  if (session.email_code_sent_at && Date.now() - session.email_code_sent_at < 60_000) {
    throw otpError(429, 'Wait a minute before requesting another code.');
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  db.prepare(`
    UPDATE sessions
    SET email_code_hash = ?, email_code_expires_at = ?, email_code_attempts = 0, email_code_sent_at = ?
    WHERE token_hash = ?
  `).run(emailCodeDigest(tokenHash, code).toString('hex'), now + 5 * 60_000, now, tokenHash);

  const isRegistration = mode === 'register' || user.email_verified === 0;
  const subject = isRegistration
    ? 'Verify your Hospital Portal registration'
    : 'Your Secure Login verification code';
  const text = isRegistration
    ? `Welcome to the Hospital Portal! Verify your email address (${user.username}) for your ${user.role.toUpperCase()} account using code ${code}. It expires in five minutes.`
    : `Your sign-in verification code for ${user.username} is ${code}. It expires in five minutes. If you did not request it, you can ignore this email.`;
  const html = isRegistration
    ? `<p>Welcome to the Hospital Portal! Enter this code to verify your email address (<strong>${user.username}</strong>) and activate your <strong>${user.role.toUpperCase()}</strong> account:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in five minutes.</p>`
    : `<p>Your sign-in verification code for <strong>${user.username}</strong> is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in five minutes. If you did not request it, you can ignore this email.</p>`;

  try {
    await deliverEmail({ to: recipient, subject, text, html });
    return { recipient, fallbackCode: null };
  } catch (error) {
    console.error('Failed to send verification email:', error.message);
    if (allowOtpFallback) {
      console.log(`[OTP-FALLBACK] Verification code for ${recipient} (${user.username}): ${code}`);
      return { recipient, fallbackCode: code };
    }
    db.prepare('UPDATE sessions SET email_code_hash = NULL, email_code_expires_at = NULL WHERE token_hash = ?').run(tokenHash);
    throw otpError(503, 'Could not send the email code. Check your SMTP settings and try again.');
  }
}

async function sendRegistrationConfirmationEmail(user) {
  if (!validateEmailAddress(user.username)) return;
  const subject = 'Hospital Portal Registration Confirmed';
  const text = `Your email address (${user.username}) has been verified and your ${user.role.toUpperCase()} account is now active.`;
  const html = `<p>Your email address (<strong>${user.username}</strong>) has been verified and your <strong>${user.role.toUpperCase()}</strong> account on the Hospital Portal is now active.</p>`;
  try {
    await deliverEmail({ to: user.username, subject, text, html });
  } catch (error) {
    console.error('Registration confirmation email notice:', error.message);
  }
}

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = await scrypt(`${password}${passwordPepper}`, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return { hash: derived.toString('hex'), salt: salt.toString('hex') };
}

async function checkPassword(password, saltHex, hashHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(`${password}${passwordPepper}`, salt, expected.length, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(expected, actual);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 200;
}

function makeSessionCookie(res, token) {
  res.cookie('login_session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function encryptBackup(buffer) {
  const encryptionKey = Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(sessionSecret),
    Buffer.from('healthcare-app'),
    Buffer.from('database-backup-aes-256-gcm'),
    32,
  ));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([Buffer.from('HDBK1'), iv, cipher.getAuthTag(), ciphertext]);
}

async function emailDatabaseBackup(target, filename) {
  if (((!smtpUser || !smtpAppPassword) && !emailWebhookUrl) || !validateEmailAddress(backupEmail)) {
    throw new Error('Email backup is not configured. Check SMTP_USER, SMTP_APP_PASSWORD, and BACKUP_EMAIL in .env.');
  }

  const { size } = await fs.promises.stat(target);
  if (size > 18 * 1024 * 1024) {
    throw new Error('This database is too large to email safely (maximum 18 MB). Use the configured AWS S3 online backup.');
  }

  const encryptedBackup = encryptBackup(await fs.promises.readFile(target));
  if (emailWebhookUrl) {
    await sendViaEmailWebhook({
      to: backupEmail,
      subject: 'Encrypted healthcare database backup',
      text: 'An AES-256-GCM encrypted database backup is attached. Keep a secure copy of the app SESSION_SECRET; it is required to decrypt and restore this file.',
      attachmentFilename: `${filename}.enc`,
      attachmentBase64: encryptedBackup.toString('base64'),
    });
    return backupEmail;
  }
  const transporter = createMailTransporter();
  await transporter.sendMail({
    from: `Secure Login Backup <${smtpUser}>`,
    to: backupEmail,
    subject: 'Encrypted healthcare database backup',
    text: 'An AES-256-GCM encrypted database backup is attached. Keep a secure copy of the app SESSION_SECRET; it is required to decrypt and restore this file.',
    attachments: [{
      filename: `${filename}.enc`,
      content: encryptedBackup,
      contentType: 'application/octet-stream',
    }],
  });
  return backupEmail;
}

function getAwsS3Client() {
  if (!awsS3Configured) {
    throw new Error('AWS backup is not configured. Set AWS_REGION and AWS_S3_BUCKET in the server environment.');
  }
  if (Boolean(awsAccessKeyId) !== Boolean(awsSecretAccessKey)) {
    throw new Error('Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or use an AWS IAM role.');
  }
  if (!awsS3Client) {
    awsS3Client = new S3Client({
      region: awsRegion,
      ...(awsAccessKeyId && awsSecretAccessKey
        ? { credentials: { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey, ...(awsSessionToken ? { sessionToken: awsSessionToken } : {}) } }
        : {}),
    });
  }
  return awsS3Client;
}

function awsBackupKey(filename) {
  return [awsBackupPrefix, filename].filter(Boolean).join('/');
}

async function uploadBackupToAwsS3(filename, filePath) {
  const client = getAwsS3Client();
  const { size } = await fs.promises.stat(filePath);
  const key = awsBackupKey(filename);
  await client.send(new PutObjectCommand({
    Bucket: awsS3Bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: size,
    ContentType: 'application/vnd.sqlite3',
    ServerSideEncryption: 'AES256',
  }));
  return { provider: 'AWS S3', bucket: awsS3Bucket, region: awsRegion, key, size };
}

async function listAwsBackups() {
  if (!awsS3Configured) return [];
  const client = getAwsS3Client();
  const backups = [];
  let continuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: awsS3Bucket,
      Prefix: awsBackupPrefix ? `${awsBackupPrefix}/` : undefined,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const object of result.Contents || []) {
      if (!object.Key || !object.Key.endsWith('.db')) continue;
      const filename = path.posix.basename(object.Key);
      const match = filename.match(/app-backup-([a-zA-Z0-9_-]+?)-/);
      backups.push({
        filename: `aws:${object.Key}`,
        label: match?.[1] || 'cloud',
        size: object.Size || 0,
        created_at: object.LastModified?.toISOString() || '',
        storage: 'AWS S3',
      });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return backups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 200);
}

async function pruneLocalBackups(directory, safeLabel) {
  const prefix = `app-backup-${safeLabel}-`;
  const matchingFiles = (await fs.promises.readdir(directory))
    .filter((filename) => filename.startsWith(prefix) && filename.endsWith('.db'))
    .sort()
    .reverse();
  await Promise.all(
    matchingFiles.slice(maxLocalBackups).map((filename) => fs.promises.unlink(path.join(directory, filename)).catch(() => {})),
  );
}

async function runDatabaseBackup(label = 'manual', { email = false, uploadToCloud = false, requireCloudStorage = false } = {}) {
  if (requireCloudStorage) getAwsS3Client();
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'manual';
  const resolvedBackupDirectory = path.isAbsolute(backupDirectory)
    ? backupDirectory
    : path.join(__dirname, backupDirectory);

  await fs.promises.mkdir(resolvedBackupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `app-backup-${safeLabel}-${stamp}-${crypto.randomBytes(3).toString('hex')}.db`;
  const target = path.join(resolvedBackupDirectory, filename);
  await db.backup(target);
  if (safeLabel === 'live' || safeLabel === 'auto') {
    await pruneLocalBackups(resolvedBackupDirectory, safeLabel);
  }

  const stat = await fs.promises.stat(target).catch(() => ({ size: 0 }));
  const result = {
    label: safeLabel,
    file: target,
    filename,
    size: stat.size,
    created_at: new Date().toISOString(),
  };

  if (email) {
    try {
      result.emailed_to = await emailDatabaseBackup(target, filename);
    } catch (err) {
      console.warn('Backup email delivery notice:', err.message);
      result.email_notice = err.message;
    }
  }

  const shouldUploadToCloud = uploadToCloud || (awsS3Configured && safeLabel !== 'live');
  if (shouldUploadToCloud) {
    try {
      result.aws = await uploadBackupToAwsS3(filename, target);
    } catch (err) {
      if (requireCloudStorage) throw err;
      console.warn('AWS S3 backup notice:', err.message);
      result.aws_notice = err.message;
    }
  } else if (requireCloudStorage) {
    throw new Error('AWS backup is not configured. Set AWS_REGION and AWS_S3_BUCKET in the server environment.');
  }

  lastDatabaseBackup = result;
  return result;
}

async function getAvailableBackups() {
  const resolvedBackupDirectory = path.isAbsolute(backupDirectory)
    ? backupDirectory
    : path.join(__dirname, backupDirectory);
  if (!fs.existsSync(resolvedBackupDirectory)) return [];
  const entries = await fs.promises.readdir(resolvedBackupDirectory);
  const backups = [];
  for (const entry of entries) {
    if (!entry.endsWith('.db')) continue;
    try {
      const fullPath = path.join(resolvedBackupDirectory, entry);
      const stat = await fs.promises.stat(fullPath);
      let label = 'backup';
      const match = entry.match(/app-backup-([a-zA-Z0-9_-]+?)-/);
      if (match) label = match[1];
      backups.push({
        filename: entry,
        label,
        size: stat.size,
        created_at: stat.mtime.toISOString(),
      });
    } catch {
      // ignore
    }
  }
  backups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return backups;
}

async function getActiveBackupDetails() {
  const resolvedBackupDirectory = path.isAbsolute(backupDirectory)
    ? backupDirectory
    : path.join(__dirname, backupDirectory);
  const backups = await getAvailableBackups();
  let active = lastDatabaseBackup;
  if (!active && backups.length > 0) {
    const latest = backups[0];
    active = {
      label: latest.label,
      file: path.join(resolvedBackupDirectory, latest.filename),
      filename: latest.filename,
      created_at: latest.created_at,
      size: latest.size,
    };
    lastDatabaseBackup = active;
  }

  let archivedRolesList = [];
  let totalUsers = 0;
  let totalRoles = 0;
  try {
    archivedRolesList = db.prepare('SELECT * FROM archived_roles ORDER BY archived_at DESC').all();
    totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    totalRoles = db.prepare('SELECT COUNT(*) as count FROM roles WHERE is_archived = 0').get().count;
  } catch {
    // ignore
  }

  return {
    active_backup: active ? {
      ...active,
      status: 'Active & Operational',
      archived_roles_count: archivedRolesList.length,
      total_users_count: totalUsers,
      total_roles_count: totalRoles,
    } : null,
    archived_roles: archivedRolesList,
    backups,
  };
}

async function restoreDatabase(filename) {
  const resolvedBackupDirectory = path.isAbsolute(backupDirectory)
    ? backupDirectory
    : path.join(__dirname, backupDirectory);
  await fs.promises.mkdir(resolvedBackupDirectory, { recursive: true });
  let safeFilename;
  let sourcePath;
  if (typeof filename === 'string' && filename.startsWith('aws:')) {
    const key = filename.slice(4);
    const expectedPrefix = awsBackupPrefix ? `${awsBackupPrefix}/` : '';
    if (!awsS3Configured || !key.startsWith(expectedPrefix) || !key.endsWith('.db') || key.includes('..')) {
      throw new Error('Selected AWS S3 backup is invalid or AWS is not configured.');
    }
    safeFilename = path.posix.basename(key);
    if (!/^app-backup-[a-zA-Z0-9_-]+-[a-zA-Z0-9TZ-]+-[a-f0-9]{6}\.db$/i.test(safeFilename)) {
      throw new Error('Selected AWS S3 backup filename is invalid.');
    }
    const object = await getAwsS3Client().send(new GetObjectCommand({ Bucket: awsS3Bucket, Key: key }));
    sourcePath = path.join(resolvedBackupDirectory, `${safeFilename.replace(/\.db$/i, '')}-aws-restore.db`);
    const maxRestoreBytes = 512 * 1024 * 1024;
    if (object.ContentLength === 0 || object.ContentLength > maxRestoreBytes) {
      throw new Error('Selected AWS S3 backup is empty or exceeds the 512 MB restore limit.');
    }
    let downloadedBytes = 0;
    const sizeGuard = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        callback(downloadedBytes > maxRestoreBytes ? new Error('Selected AWS S3 backup exceeds the 512 MB restore limit.') : null, chunk);
      },
    });
    try {
      await pipeline(object.Body, sizeGuard, fs.createWriteStream(sourcePath, { flags: 'wx' }));
    } catch (error) {
      await fs.promises.rm(sourcePath, { force: true }).catch(() => {});
      throw error;
    }
    if (downloadedBytes === 0) {
      await fs.promises.rm(sourcePath, { force: true });
      throw new Error('Selected AWS S3 backup is empty.');
    }
  } else {
    safeFilename = path.basename(String(filename || ''));
    sourcePath = path.join(resolvedBackupDirectory, safeFilename);
  }

  if (!fs.existsSync(sourcePath) || !safeFilename.endsWith('.db')) {
    throw new Error('Selected backup file does not exist.');
  }

  const validationDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = validationDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('Selected backup failed SQLite integrity validation.');
  } finally {
    validationDb.close();
  }

  // Pre-restore safety copy of current app.db
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRestoreName = `app-backup-pre-restore-${stamp}.db`;
  const preRestorePath = path.join(resolvedBackupDirectory, preRestoreName);
  await db.backup(preRestorePath);

  // Checkpoint WAL and close db connection safely
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  db.close();

  // Brief pause to allow Windows file handles to release
  await new Promise((r) => setTimeout(r, 80));

  try {
    const targetPath = path.join(dataDirectory, 'app.db');
    fs.copyFileSync(sourcePath, targetPath);
    const wal = targetPath + '-wal';
    const shm = targetPath + '-shm';
    try {
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
    } catch (_) {
      try { fs.writeFileSync(wal, Buffer.alloc(0)); } catch (__) {}
    }
    try {
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch (_) {
      try { fs.writeFileSync(shm, Buffer.alloc(0)); } catch (__) {}
    }
  } finally {
    db = new Database(path.join(dataDirectory, 'app.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    refreshRolesCache();
  }

  const stat = await fs.promises.stat(sourcePath);
  lastDatabaseBackup = {
    label: 'restored',
    file: sourcePath,
    filename: safeFilename,
    pre_restore_filename: preRestoreName,
    created_at: stat.mtime.toISOString(),
    restored_at: new Date().toISOString(),
    size: stat.size,
  };

  return lastDatabaseBackup;
}

function queueLiveDatabaseBackup() {
  liveBackupQueue = liveBackupQueue.then(async () => {
    const result = await runDatabaseBackup('live', { email: true });
    console.log(`Live database backup emailed to ${result.emailed_to}`);
  }).catch((error) => {
    console.error('Live database backup failed:', error.message);
  });
}

function markDatabaseChanged(req) {
  req.databaseChanged = true;
}

if (trustProxy) {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(path.join(__dirname, 'img')));

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, status: 'unhealthy' });
  }
});

app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || '').trim();
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expectedOrigin && (!allowedOrigin || origin !== allowedOrigin)) {
    return res.status(403).json({ error: 'Request origin was not allowed.' });
  }
  next();
});

const cookieParser = (req, _res, next) => {
  const cookieHeader = req.headers.cookie || '';
  const parts = cookieHeader.split(';').map((item) => item.trim());
  req.cookies = {};
  for (const part of parts) {
    if (part.startsWith('login_session=')) {
      try { req.cookies.login_session = decodeURIComponent(part.slice('login_session='.length)); } catch { /* skip */ }
    }
    if (part.startsWith('pwd_reset_token=')) {
      try { req.cookies.pwd_reset_token = decodeURIComponent(part.slice('pwd_reset_token='.length)); } catch { /* skip */ }
    }
  }
  next();
};
app.use('/api', cookieParser);

app.use('/api', (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : req.cookies.login_session;
  if (!token || token.length > 256) return next();
  const tokenHash = crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
  const session = db.prepare(`
    SELECT sessions.stage, users.id, users.username, users.role, users.email_verified
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now());
  if (session) req.auth = { ...session, tokenHash };
  next();
});

app.use('/api', (req, res, next) => {
  res.once('finish', () => {
    if (req.databaseChanged && res.statusCode >= 200 && res.statusCode < 300) {
      queueLiveDatabaseBackup();
    }
  });
  next();
});

function requireSession(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

function requireComplete(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Please sign in.' });
  if (req.auth.stage !== 'complete') return res.status(403).json({ error: 'Complete email verification first.' });
  next();
}

function allowRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.auth.role)) return res.status(403).json({ error: 'Your role cannot access this area.' });
    next();
  };
}

function createSession(user, stage, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, stage, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, user.id, stage, Date.now() + 8 * 60 * 60 * 1000);
  makeSessionCookie(res, token);
  return { tokenHash, token };
}

function sessionTokenForResponse(req, token) {
  return req.get('x-mobile-client') === 'expo' ? token : undefined;
}

function passwordResetToken(req) {
  const headerToken = req.get('x-password-reset-token');
  return typeof headerToken === 'string' && headerToken.length <= 256
    ? headerToken
    : req.cookies?.pwd_reset_token;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

app.post('/api/email-relay', loginLimiter, async (req, res) => {
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : '';
    const expectedSig = relaySignature(to, subject);
    if (!signature || signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return res.status(403).json({ error: 'Invalid relay signature.' });
    }
    if (!smtpUser || !smtpAppPassword) {
      return res.status(503).json({ error: 'SMTP is not configured on this relay.' });
    }
    const transporter = createMailTransporter();
    await transporter.sendMail({
      from: `Secure Hospital Portal <${smtpUser}>`,
      to,
      subject,
      text,
      html,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Email relay error:', error.message);
    res.status(503).json({ error: 'Relay delivery failed.' });
  }
});

app.get('/api/session', (req, res) => {
  if (!req.auth) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    id: req.auth.id,
    username: req.auth.username,
    role: req.auth.role,
    stage: req.auth.stage,
    isRegistration: req.auth.email_verified === 0,
    verificationEmail: req.auth.stage === 'verify' ? verificationRecipient(req.auth) : null,
  });
});

app.post('/api/register', loginLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    if (role === 'admin') {
      return res.status(403).json({ error: 'Administrator accounts cannot be self-registered.' });
    }
    if (!roles.includes(role)) {
      return res.status(400).json({ error: 'Please select a role for your account.' });
    }
    if (!validateEmailAddress(username)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be between 6 and 200 characters.' });
    }

    const existing = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (existing && existing.email_verified === 1) {
      return res.status(409).json({ error: 'An account with this email address already exists. Please sign in instead.' });
    }

    const credentials = await hashPassword(password);
    let user;
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, role = ? WHERE id = ?')
        .run(credentials.hash, credentials.salt, role, existing.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    } else {
      const info = db.prepare('INSERT INTO users (username, password_hash, password_salt, role, email_verified) VALUES (?, ?, ?, ?, 0)')
        .run(username, credentials.hash, credentials.salt, role);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    markDatabaseChanged(req);

    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const { tokenHash, token } = createSession(user, 'verify', res);
    try {
      const { recipient: verificationEmail, fallbackCode } = await sendEmailCode(user, tokenHash, 'register');
      res.status(201).json({
        authenticated: true,
        stage: 'verify',
        isRegistration: true,
        username: user.username,
        role: user.role,
        verificationEmail,
        fallbackCode,
        sessionToken: sessionTokenForResponse(req, token),
      });
    } catch (error) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      res.clearCookie('login_session', { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
      return res.status(error.status || 503).json({ error: error.message });
    }
  } catch (error) {
    next(error);
  }
});

// ─── Forgot Password ─────────────────────────────────────────────────────────

// Step 1 — POST /api/forgot-password
// Accepts an email address, generates a 6-digit code, stores it hashed, emails it.
app.post('/api/forgot-password', loginLimiter, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!validateEmailAddress(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Purge expired reset tokens
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(Date.now());

    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(email);
    // Always respond 200 to prevent email enumeration
    if (!user || user.email_verified !== 1) {
      return res.json({ ok: true, message: 'If that email is registered, a reset code has been sent.' });
    }

    // Rate-limit: check if a code was sent recently
    const existing = db.prepare('SELECT code_sent_at FROM password_resets WHERE user_id = ? AND expires_at > ?')
      .get(user.id, Date.now());
    if (existing && existing.code_sent_at && Date.now() - existing.code_sent_at < 60_000) {
      return res.status(429).json({ error: 'Wait a minute before requesting another reset code.' });
    }

    const resetToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHmac('sha256', sessionSecret).update(resetToken).digest('hex');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();
    const codeHash = crypto.createHmac('sha256', sessionSecret).update(`reset:${tokenHash}:${code}`).digest('hex');

    // Upsert: remove old reset rows for this user, then insert fresh
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare(`
      INSERT INTO password_resets (token_hash, user_id, code_hash, code_expires_at, code_attempts, code_sent_at, verified, created_at, expires_at)
      VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)
    `).run(tokenHash, user.id, codeHash, now + 5 * 60_000, now, now, now + 15 * 60_000);

    const subject = 'Password Reset — Hospital Portal';
    const text = `You requested a password reset for your Hospital Portal account (${user.username}).\n\nYour 6-digit reset code is: ${code}\n\nIt expires in 5 minutes. If you did not request this, you can safely ignore this email.`;
    const html = `
      <p>You requested a password reset for your Hospital Portal account (<strong>${user.username}</strong>).</p>
      <p>Enter this code to verify your identity:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;font-family:monospace">${code}</p>
      <p>It expires in <strong>5 minutes</strong>. If you did not request a password reset, you can safely ignore this email.</p>
    `;

    try {
      await deliverEmail({ to: user.username, subject, text, html });
    } catch (emailErr) {
      console.error('Forgot-password email error:', emailErr.message);
      if (allowOtpFallback) {
        console.log(`[RESET-FALLBACK] Reset code for ${user.username}: ${code}`);
        // Still set the cookie — return the fallback code in dev
        res.cookie('pwd_reset_token', resetToken, {
          httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge: 15 * 60 * 1000,
        });
        return res.json({ ok: true, message: 'If that email is registered, a reset code has been sent.', fallbackCode: code, resetToken: req.get('x-mobile-client') === 'expo' ? resetToken : undefined });
      }
      db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
      return res.status(503).json({ error: 'Could not send the reset email. Check SMTP settings and try again.' });
    }

    res.cookie('pwd_reset_token', resetToken, {
      httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge: 15 * 60 * 1000,
    });
    return res.json({ ok: true, message: 'If that email is registered, a reset code has been sent.', resetToken: req.get('x-mobile-client') === 'expo' ? resetToken : undefined });
  } catch (err) {
    console.error('Forgot-password error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Step 2 — POST /api/forgot-password/verify
// Verifies the 6-digit code, marks the reset token as verified so Step 3 is unlocked.
app.post('/api/forgot-password/verify', loginLimiter, (req, res) => {
  try {
    const rawToken = passwordResetToken(req);
    if (!rawToken) return res.status(401).json({ error: 'Reset session not found. Please start over.' });

    const tokenHash = crypto.createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
    const record = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, Date.now());
    if (!record) return res.status(401).json({ error: 'Reset session expired or invalid. Please start over.' });
    if (record.verified) return res.status(409).json({ error: 'This code has already been used. Please proceed to set your new password.' });

    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code) || !record.code_hash || record.code_expires_at <= Date.now()) {
      return res.status(400).json({ error: 'The reset code is incorrect or has expired.' });
    }
    if (record.code_attempts >= 5) {
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new reset code.' });
    }

    const expectedHash = record.code_hash;
    const receivedHash = crypto.createHmac('sha256', sessionSecret).update(`reset:${tokenHash}:${code}`).digest('hex');
    const expected = Buffer.from(expectedHash, 'hex');
    const received = Buffer.from(receivedHash, 'hex');

    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      const attempts = record.code_attempts + 1;
      db.prepare('UPDATE password_resets SET code_attempts = ? WHERE token_hash = ?').run(attempts, tokenHash);
      if (attempts >= 5) {
        return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new reset code.' });
      }
      return res.status(400).json({ error: `Incorrect code. ${5 - attempts} attempt${5 - attempts === 1 ? '' : 's'} remaining.` });
    }

    // Mark as verified — allows Step 3 (password update)
    db.prepare('UPDATE password_resets SET verified = 1, code_hash = NULL WHERE token_hash = ?').run(tokenHash);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Forgot-password verify error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Step 3 — POST /api/forgot-password/reset
// Sets the new password after the code has been verified. Invalidates the reset session.
app.post('/api/forgot-password/reset', loginLimiter, async (req, res) => {
  try {
    const rawToken = passwordResetToken(req);
    if (!rawToken) return res.status(401).json({ error: 'Reset session not found. Please start over.' });

    const tokenHash = crypto.createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
    const record = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, Date.now());
    if (!record) return res.status(401).json({ error: 'Reset session expired or invalid. Please start over.' });
    if (!record.verified) return res.status(403).json({ error: 'Please verify your email code first.' });

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be between 6 and 200 characters.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(record.user_id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const credentials = await hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .run(credentials.hash, credentials.salt, user.id);

    // Invalidate the reset token and any active login sessions for this user
    db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

    res.clearCookie('pwd_reset_token', { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });

    // Notify user by email
    try {
      await deliverEmail({
        to: user.username,
        subject: 'Your Hospital Portal password was changed',
        text: `Your password for the Hospital Portal account (${user.username}) was successfully changed. If you did not make this change, contact your administrator immediately.`,
        html: `<p>Your password for the Hospital Portal account (<strong>${user.username}</strong>) was successfully changed.</p><p>If you did not make this change, contact your administrator immediately.</p>`,
      });
    } catch { /* non-fatal */ }

    return res.json({ ok: true, message: 'Your password has been updated. Please sign in with your new password.' });
  } catch (err) {
    console.error('Forgot-password reset error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Step 2 resend — POST /api/forgot-password/resend
// Resends the 6-digit code if not yet verified and cooldown elapsed.
app.post('/api/forgot-password/resend', loginLimiter, async (req, res) => {
  try {
    const rawToken = passwordResetToken(req);
    if (!rawToken) return res.status(401).json({ error: 'Reset session not found. Please start over.' });

    const tokenHash = crypto.createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
    const record = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, Date.now());
    if (!record) return res.status(401).json({ error: 'Reset session expired or invalid. Please start over.' });
    if (record.verified) return res.status(409).json({ error: 'Code already verified. Please set your new password.' });
    if (record.code_sent_at && Date.now() - record.code_sent_at < 60_000) {
      return res.status(429).json({ error: 'Wait a minute before requesting another code.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(record.user_id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();
    const codeHash = crypto.createHmac('sha256', sessionSecret).update(`reset:${tokenHash}:${code}`).digest('hex');
    db.prepare('UPDATE password_resets SET code_hash = ?, code_expires_at = ?, code_attempts = 0, code_sent_at = ? WHERE token_hash = ?')
      .run(codeHash, now + 5 * 60_000, now, tokenHash);

    try {
      await deliverEmail({
        to: user.username,
        subject: 'Password Reset Code — Hospital Portal',
        text: `Your new password reset code is: ${code}. It expires in 5 minutes.`,
        html: `<p>Your new password reset code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;font-family:monospace">${code}</p><p>It expires in <strong>5 minutes</strong>.</p>`,
      });
      return res.json({ ok: true });
    } catch (emailErr) {
      console.error('Forgot-password resend email error:', emailErr.message);
      if (allowOtpFallback) {
        console.log(`[RESET-RESEND-FALLBACK] Reset code for ${user.username}: ${code}`);
        return res.json({ ok: true, fallbackCode: code });
      }
      return res.status(503).json({ error: 'Could not resend the email. Check SMTP settings.' });
    }
  } catch (err) {
    console.error('Forgot-password resend error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

app.post('/api/login', loginLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    if (!roles.includes(role)) {
      return res.status(400).json({ error: 'Please select your role before signing in.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ? COLLATE NOCASE').get(username, role);
    const valid = user ? await checkPassword(password, user.password_salt, user.password_hash) : false;
    if (!valid) return res.status(401).json({ error: 'Username, password, or role is incorrect.' });

    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const { tokenHash, token } = createSession(user, 'verify', res);
    try {
      const { recipient: verificationEmail, fallbackCode } = await sendEmailCode(user, tokenHash, user.email_verified === 0 ? 'register' : 'login');
      res.json({
        authenticated: true,
        stage: 'verify',
        isRegistration: user.email_verified === 0,
        username: user.username,
        role: user.role,
        verificationEmail,
        fallbackCode,
        sessionToken: sessionTokenForResponse(req, token),
      });
    } catch (error) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      res.clearCookie('login_session', { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
      return res.status(error.status || 503).json({ error: error.message });
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', requireSession, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.auth.tokenHash);
  res.clearCookie('login_session', { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});

app.post('/api/2fa/resend', requireSession, async (req, res) => {
  if (req.auth.stage !== 'verify') return res.status(409).json({ error: 'Email verification is not active.' });
  try {
    const { recipient: verificationEmail, fallbackCode } = await sendEmailCode(req.auth, req.auth.tokenHash, req.auth.email_verified === 0 ? 'register' : 'login');
    res.json({ ok: true, verificationEmail, fallbackCode });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  }
});

app.post('/api/2fa/verify', requireSession, (req, res) => {
  if (req.auth.stage !== 'verify') return res.status(409).json({ error: 'Email verification is not active.' });
  const code = typeof req.body.code === 'string' ? req.body.code : '';
  const session = db.prepare(`
    SELECT email_code_hash, email_code_expires_at, email_code_attempts
    FROM sessions WHERE token_hash = ?
  `).get(req.auth.tokenHash);
  if (!/^\d{6}$/.test(code) || !session?.email_code_hash || session.email_code_expires_at <= Date.now()) {
    return res.status(400).json({ error: 'The email code is incorrect or expired.' });
  }
  if (session.email_code_attempts >= 5) {
    return res.status(429).json({ error: 'Too many incorrect codes. Request a new code.' });
  }

  const expected = Buffer.from(session.email_code_hash, 'hex');
  const received = emailCodeDigest(req.auth.tokenHash, code);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    const attempts = session.email_code_attempts + 1;
    db.prepare(`
      UPDATE sessions
      SET email_code_attempts = ?, email_code_hash = CASE WHEN ? >= 5 THEN NULL ELSE email_code_hash END
      WHERE token_hash = ?
    `).run(attempts, attempts, req.auth.tokenHash);
    return res.status(attempts >= 5 ? 429 : 400).json({
      error: attempts >= 5 ? 'Too many incorrect codes. Request a new code.' : 'The email code is incorrect or expired.',
    });
  }

  const wasUnverified = req.auth.email_verified === 0;
  if (wasUnverified) {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(req.auth.id);
    markDatabaseChanged(req);
    sendRegistrationConfirmationEmail(req.auth);
  }

  db.prepare(`
    UPDATE sessions
    SET stage = 'complete', email_code_hash = NULL, email_code_expires_at = NULL
    WHERE token_hash = ?
  `).run(req.auth.tokenHash);
  res.json({ ok: true });
});

app.get('/api/dashboard', requireComplete, (req, res) => {
  const role = req.auth.role;
  if (role === 'admin') {
    const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const doctors = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'doctor'").get().count;
    const nurses = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'nurse'").get().count;
    const patients = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'patient'").get().count;
    const records = db.prepare('SELECT COUNT(*) AS count FROM medical_records').get().count;
    const vitals = db.prepare('SELECT COUNT(*) AS count FROM vitals').get().count;
    const requests = db.prepare('SELECT COUNT(*) AS count FROM patient_requests').get().count;
    return res.json({
      title: 'Hospital Administration',
      subtitle: 'System directory & access control',
      totalUsers,
      doctors,
      nurses,
      patients,
      records,
      vitals,
      requests,
    });
  }
  if (role === 'doctor') {
    const myRecords = db.prepare('SELECT COUNT(*) AS count FROM medical_records WHERE doctor_id = ?').get(req.auth.id).count;
    const totalPatients = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'patient'").get().count;
    const patientRequests = db.prepare('SELECT COUNT(*) AS count FROM patient_requests').get().count;
    return res.json({
      title: "Doctor's Station",
      subtitle: 'Clinical consultations, diagnoses & prescriptions',
      myRecords,
      totalPatients,
      patientRequests,
    });
  }
  if (role === 'nurse') {
    const myVitals = db.prepare('SELECT COUNT(*) AS count FROM vitals WHERE nurse_id = ?').get(req.auth.id).count;
    const totalPatients = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'patient'").get().count;
    const patientRequests = db.prepare('SELECT COUNT(*) AS count FROM patient_requests').get().count;
    return res.json({
      title: "Nurse's Station",
      subtitle: 'Patient triage, vitals tracking & nursing care',
      myVitals,
      totalPatients,
      patientRequests,
    });
  }
  if (role === 'patient') {
    const myRecords = db.prepare('SELECT COUNT(*) AS count FROM medical_records WHERE patient_id = ?').get(req.auth.id).count;
    const myVitals = db.prepare('SELECT COUNT(*) AS count FROM vitals WHERE patient_id = ?').get(req.auth.id).count;
    const myRequests = db.prepare('SELECT COUNT(*) AS count FROM patient_requests WHERE patient_id = ?').get(req.auth.id).count;
    return res.json({
      title: 'My Care Dashboard',
      subtitle: 'A private overview of your care',
      myRecords,
      myVitals,
      myRequests,
    });
  }
  if (role === 'manager') {
    const entries = db.prepare('SELECT COUNT(*) AS count FROM entries').get().count;
    return res.json({ title: 'Team overview', subtitle: 'Submitted work', entries });
  }
  res.json({ title: 'Entry workspace', subtitle: 'Create a new entry' });
});

app.get('/api/admin/users', requireComplete, allowRoles('admin'), (_req, res) => {
  const users = db.prepare('SELECT id, username, password_hash, password_salt, role, created_at, email_verified FROM users ORDER BY id').all();
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.username,
      role: u.role,
      password_hash: u.password_hash,
      password_salt: u.password_salt,
      kdf: 'scrypt (N=32768, r=8, p=1, 64-byte)',
      plaintext_password_status: 'Irreversible / Not Stored (Zero-Knowledge)',
      email_verified: u.email_verified,
      created_at: u.created_at,
    }))
  });
});

app.put('/api/admin/users/:id', requireComplete, allowRoles('admin'), (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(400).json({ error: 'Choose a valid account.' });
    }
    const newRole = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    if (!newRole) return res.status(400).json({ error: 'Choose a valid role.' });

    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'That account no longer exists.' });

    const activeRole = db.prepare('SELECT name, display_name FROM roles WHERE LOWER(name) = LOWER(?) AND is_archived = 0').get(newRole);
    if (!activeRole) return res.status(400).json({ error: 'The selected role is not an active role.' });

    if (user.role === 'admin' && newRole !== 'admin' && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count <= 1) {
      return res.status(400).json({ error: 'The last administrator account cannot be reassigned.' });
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(activeRole.name, userId);
    markDatabaseChanged(req);
    res.json({ ok: true, message: `Account ${user.username} role updated to ${activeRole.display_name}.` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update user role.' });
  }
});

// Roles Management Endpoints (CRUD)
app.get('/api/admin/roles', requireComplete, allowRoles('admin'), (_req, res) => {
  try {
    const activeRoles = db.prepare(`
      SELECT r.id, r.name, r.display_name, r.description, r.permissions, r.is_system, r.created_at, r.updated_at,
             COUNT(u.id) AS user_count
      FROM roles r
      LEFT JOIN users u ON LOWER(u.role) = LOWER(r.name)
      WHERE r.is_archived = 0
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name ASC
    `).all();

    const archivedRoles = db.prepare(`
      SELECT id, original_role_id, name, display_name, description, permissions, user_count_at_archive, archived_at, archived_by, archive_reason
      FROM archived_roles
      ORDER BY archived_at DESC
    `).all();

    res.json({ ok: true, roles: activeRoles, archived_roles: archivedRoles });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not fetch roles.' });
  }
});

app.post('/api/admin/roles', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase() : '';
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const permissions = typeof req.body?.permissions === 'string' ? req.body.permissions.trim() : 'Standard Access';

    if (!name || !/^[a-z0-9_-]{2,30}$/.test(name)) {
      return res.status(400).json({ error: 'Role key must be 2-30 characters (letters, numbers, hyphens/underscores).' });
    }
    if (!displayName || displayName.length < 2 || displayName.length > 60) {
      return res.status(400).json({ error: 'Display name must be between 2 and 60 characters.' });
    }

    const existing = db.prepare('SELECT id, is_archived FROM roles WHERE name = ? COLLATE NOCASE').get(name);
    if (existing) {
      if (existing.is_archived === 0) {
        return res.status(409).json({ error: `Role "${name}" already exists.` });
      }
      db.prepare(`
        UPDATE roles
        SET is_archived = 0, display_name = ?, description = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(displayName, description, permissions, existing.id);
      refreshRolesCache();
      return res.status(201).json({
        ok: true,
        message: `Role "${displayName}" reactivated.`,
        role: { id: existing.id, name, display_name: displayName, description, permissions, is_system: 0, user_count: 0 },
      });
    }

    const info = db.prepare(`
      INSERT INTO roles (name, display_name, description, permissions, is_system, is_archived)
      VALUES (?, ?, ?, ?, 0, 0)
    `).run(name, displayName, description, permissions);

    refreshRolesCache();
    queueLiveDatabaseBackup();

    res.status(201).json({
      ok: true,
      message: `Role "${displayName}" created successfully.`,
      role: { id: info.lastInsertRowid, name, display_name: displayName, description, permissions, is_system: 0, user_count: 0 },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not create role.' });
  }
});

app.put('/api/admin/roles/:id', requireComplete, allowRoles('admin'), (req, res) => {
  try {
    const roleId = Number(req.params.id);
    if (!Number.isSafeInteger(roleId) || roleId < 1) {
      return res.status(400).json({ error: 'Invalid role ID.' });
    }
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const permissions = typeof req.body?.permissions === 'string' ? req.body.permissions.trim() : '';

    if (!displayName || displayName.length < 2 || displayName.length > 60) {
      return res.status(400).json({ error: 'Display name must be between 2 and 60 characters.' });
    }

    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND is_archived = 0').get(roleId);
    if (!role) return res.status(404).json({ error: 'Role not found.' });

    db.prepare(`
      UPDATE roles
      SET display_name = ?, description = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(displayName, description, permissions || role.permissions, roleId);

    refreshRolesCache();
    queueLiveDatabaseBackup();
    res.json({ ok: true, message: `Role "${displayName}" updated successfully.` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not update role.' });
  }
});

// Safe Delete Role: safely archived within backup data and MUST NOT be permanently expunged
app.delete('/api/admin/roles/:id', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    if (!Number.isSafeInteger(roleId) || roleId < 1) {
      return res.status(400).json({ error: 'Invalid role ID.' });
    }

    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND is_archived = 0').get(roleId);
    if (!role) return res.status(404).json({ error: 'Role not found.' });

    if (role.name === 'admin') {
      return res.status(400).json({ error: 'The Administrator role cannot be deleted.' });
    }

    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = LOWER(?)').get(role.name).count;

    const archiveTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO archived_roles (original_role_id, name, display_name, description, permissions, user_count_at_archive, archived_at, archived_by, archive_reason)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'Admin triggered deletion')
      `).run(role.id, role.name, role.display_name, role.description, role.permissions, userCount, req.auth?.username || 'admin');

      db.prepare('UPDATE roles SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role.id);
    });
    archiveTx();

    refreshRolesCache();

    // Instant backup to guarantee deleted role is safely archived within backup data
    await runDatabaseBackup('live');

    res.json({
      ok: true,
      message: `Role "${role.display_name}" safely archived and preserved in backup data.`,
      archived: true,
      role: { id: role.id, name: role.name, display_name: role.display_name },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not archive role.' });
  }
});

// Backup & Restore Endpoints
app.post('/api/admin/backup', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : 'manual';
    const result = await runDatabaseBackup(label, { email: true });
    const details = await getActiveBackupDetails();
    res.json({
      ok: true,
      message: 'System backup created instantly.',
      backup: result,
      active_backup: details.active_backup,
      archived_roles: details.archived_roles,
    });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Database backup failed.' });
  }
});

app.get('/api/admin/backups', requireComplete, allowRoles('admin'), async (_req, res) => {
  try {
    const details = await getActiveBackupDetails();
    const cloudBackups = await listAwsBackups();
    res.json({
      ok: true,
      active_backup: details.active_backup,
      archived_roles: details.archived_roles,
      backups: [...details.backups, ...cloudBackups].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      cloud_backups: cloudBackups,
      aws_s3: { configured: awsS3Configured, bucket: awsS3Configured ? awsS3Bucket : null, region: awsS3Configured ? awsRegion : null },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list backups.' });
  }
});

app.get('/api/admin/backup-details', requireComplete, allowRoles('admin'), async (_req, res) => {
  try {
    const details = await getActiveBackupDetails();
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to get backup details.' });
  }
});

app.post('/api/admin/backup/export.xlsx', requireComplete, allowRoles('admin'), async (req, res) => {
  let snapshotDb;
  try {
    await runDatabaseBackup('manual');
    const details = await getActiveBackupDetails();
    const active = details.active_backup || {};
    if (!active.file || !fs.existsSync(active.file)) throw new Error('The new backup snapshot could not be found for export.');
    snapshotDb = new Database(active.file, { readonly: true, fileMustExist: true });
    const summary = {
      Filename: active.filename || '',
      Label: active.label || 'manual',
      Created: active.created_at || new Date().toISOString(),
      SizeBytes: active.size || 0,
      Status: active.status || 'Active & Operational',
      ActiveAccounts: active.total_users_count || 0,
      ActiveRoles: active.total_roles_count || 0,
      ArchivedRoles: active.archived_roles_count || 0,
    };
    const sheets = [
      { name: 'Backup Summary', headers: Object.keys(summary), rows: [Object.values(summary)] },
      ...exportableDatabaseSheets(snapshotDb),
    ];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    await sendExcelWorkbook(res, `hospital-backup-${stamp}.xlsx`, sheets);
  } catch (error) {
    console.error('Backup Excel export failed:', error.message);
    if (!res.headersSent) res.status(503).json({ error: error.message || 'Could not create the backup Excel export.' });
  } finally {
    if (snapshotDb?.open) snapshotDb.close();
  }
});

app.get('/api/admin/backups/export.xlsx', requireComplete, allowRoles('admin'), async (req, res) => {
  let snapshotDb;
  try {
    const filename = typeof req.query.filename === 'string' ? req.query.filename : '';
    const backups = await getAvailableBackups();
    const selectedBackup = backups.find((backup) => backup.filename === filename);
    if (!selectedBackup) return res.status(404).json({ error: 'That backup is no longer available.' });

    const resolvedBackupDirectory = path.isAbsolute(backupDirectory)
      ? backupDirectory
      : path.join(__dirname, backupDirectory);
    const snapshotFile = path.join(resolvedBackupDirectory, selectedBackup.filename);
    snapshotDb = new Database(snapshotFile, { readonly: true, fileMustExist: true });
    const summary = {
      Filename: selectedBackup.filename,
      Label: selectedBackup.label || '',
      Created: selectedBackup.created_at || '',
      SizeBytes: selectedBackup.size || 0,
      Status: 'Available for restore',
    };
    const sheets = [
      { name: 'Backup Summary', headers: Object.keys(summary), rows: [Object.values(summary)] },
      ...exportableDatabaseSheets(snapshotDb),
    ];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    await sendExcelWorkbook(res, `hospital-backup-${stamp}.xlsx`, sheets);
  } catch (error) {
    console.error('Selected backup Excel export failed:', error.message);
    if (!res.headersSent) res.status(503).json({ error: error.message || 'Could not export the selected backup.' });
  } finally {
    if (snapshotDb?.open) snapshotDb.close();
  }
});

app.get('/api/admin/archived-roles/export.xlsx', requireComplete, allowRoles('admin'), async (_req, res) => {
  try {
    const headers = ['id', 'original_role_id', 'name', 'display_name', 'description', 'permissions', 'user_count_at_archive', 'archived_at', 'archived_by', 'archive_reason'];
    const rows = db.prepare(`SELECT ${headers.map((header) => `"${header}"`).join(', ')} FROM archived_roles ORDER BY archived_at DESC, id DESC`).all()
      .map((row) => headers.map((header) => row[header] == null ? '' : row[header]));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    await sendExcelWorkbook(res, `archived-roles-${stamp}.xlsx`, [{ name: 'Archived Roles', headers, rows }]);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not export archived roles.' });
  }
});

app.get('/api/admin/backup-status', requireComplete, allowRoles('admin'), async (_req, res) => {
  const details = await getActiveBackupDetails();
  res.json({
    backup: details.active_backup || lastDatabaseBackup,
    backupDirectory,
    autoBackupMinutes,
    awsS3Configured,
    awsS3Bucket: awsS3Configured ? awsS3Bucket : null,
    awsRegion: awsS3Configured ? awsRegion : null,
    active_backup: details.active_backup,
    archived_roles: details.archived_roles,
    backups: details.backups,
  });
});

app.post('/api/admin/restore', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const filename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
    if (!filename) {
      return res.status(400).json({ error: 'Please choose a backup file to restore.' });
    }
    const restoredBackup = await restoreDatabase(filename);
    const details = await getActiveBackupDetails();
    res.json({
      ok: true,
      message: `System state successfully restored to ${filename}.`,
      backup: restoredBackup,
      active_backup: details.active_backup,
    });
  } catch (error) {
    console.error('System restore error:', error);
    res.status(500).json({ error: error.message || 'Failed to restore system backup.' });
  }
});

app.post('/api/admin/restore/export.xlsx', requireComplete, allowRoles('admin'), async (req, res) => {
  let snapshotDb;
  let selectedFilename = '';
  let restoreCompleted = false;
  try {
    selectedFilename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
    if (!selectedFilename) return res.status(400).json({ error: 'Please choose a backup file to restore.' });

    const restoredBackup = await restoreDatabase(selectedFilename);
    restoreCompleted = true;
    const restoreEntry = {
      restored_at: restoredBackup.restored_at,
      backup_filename: restoredBackup.filename,
      restored_by: req.auth.username,
      status: 'Success',
      pre_restore_filename: restoredBackup.pre_restore_filename,
    };
    await appendRestoreHistory(restoreEntry);

    snapshotDb = new Database(restoredBackup.file, { readonly: true, fileMustExist: true });
    const history = readRestoreHistory();
    const historyHeaders = ['restored_at', 'backup_filename', 'restored_by', 'status', 'pre_restore_filename', 'details'];
    const historyRows = history.map((entry) => historyHeaders.map((header) => entry[header] || ''));
    const summary = {
      Status: restoreEntry.status,
      RestoredAt: restoreEntry.restored_at,
      SelectedBackup: restoreEntry.backup_filename,
      RestoredBy: restoreEntry.restored_by,
      SafetyBackup: restoreEntry.pre_restore_filename,
    };
    const sheets = [
      { name: 'Restore Summary', headers: Object.keys(summary), rows: [Object.values(summary)] },
      { name: 'Restore History', headers: historyHeaders, rows: historyRows },
      ...exportableDatabaseSheets(snapshotDb),
    ];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    await sendExcelWorkbook(res, `hospital-restore-${stamp}.xlsx`, sheets);
  } catch (error) {
    console.error('Restore Excel export failed:', error.message);
    if (!res.headersSent && !restoreCompleted) {
      const failureEntry = {
        restored_at: new Date().toISOString(),
        backup_filename: selectedFilename,
        restored_by: req.auth.username,
        status: 'Failed',
        pre_restore_filename: '',
        details: error.message || 'Restore failed.',
      };
      try {
        await appendRestoreHistory(failureEntry);
        const historyHeaders = ['restored_at', 'backup_filename', 'restored_by', 'status', 'pre_restore_filename', 'details'];
        const historyRows = readRestoreHistory().map((entry) => historyHeaders.map((header) => entry[header] || ''));
        const summary = {
          Status: failureEntry.status,
          AttemptedAt: failureEntry.restored_at,
          SelectedBackup: failureEntry.backup_filename,
          AttemptedBy: failureEntry.restored_by,
          Details: failureEntry.details,
        };
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        await sendExcelWorkbook(res, `hospital-restore-${stamp}.xlsx`, [
          { name: 'Restore Summary', headers: Object.keys(summary), rows: [Object.values(summary)] },
          { name: 'Restore History', headers: historyHeaders, rows: historyRows },
          ...exportableDatabaseSheets(db),
        ]);
      } catch (exportError) {
        console.error('Restore failure workbook generation failed:', exportError.message);
        if (!res.headersSent) res.status(500).json({ error: exportError.message || 'Restore failed and its status workbook could not be created.' });
      }
    } else if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Restore succeeded, but its Excel workbook could not be created.' });
    }
  } finally {
    if (snapshotDb?.open) snapshotDb.close();
  }
});

// PDF Document Viewer Integration Endpoint
app.get('/api/admin/report/pdf', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const usersList = db.prepare(`
      SELECT username, username AS email, role, password_hash, password_salt
      FROM users
      ORDER BY LOWER(role), LOWER(username)
    `).all();
    const pdfBuffer = generateAdminReportPdf({ users: usersList });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Hospital-Admin-Audit-Report.pdf"',
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'private, no-store, max-age=0',
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF document report.' });
  }
});

app.post('/api/admin/backup/download', requireComplete, allowRoles('admin'), async (_req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `healthcare-backup-${stamp}.db.enc`;
  const temporaryFile = path.join(os.tmpdir(), `healthcare-backup-${crypto.randomUUID()}.db`);
  try {
    await db.backup(temporaryFile);
    const encryptedBackup = encryptBackup(await fs.promises.readFile(temporaryFile));
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(encryptedBackup);
  } catch (error) {
    console.error('Offline backup download failed:', error.message);
    res.status(503).json({ error: 'Could not create the offline backup.' });
  } finally {
    await fs.promises.rm(temporaryFile, { force: true }).catch(() => {});
  }
});

app.post('/api/admin/backup/cloud', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const result = await runDatabaseBackup('cloud', { uploadToCloud: true, requireCloudStorage: true });
    res.json({ ok: true, backup: result });
  } catch (error) {
    console.error('AWS S3 backup failed:', error.message);
    res.status(503).json({ error: error.message || 'AWS S3 upload failed. Verify the region, bucket, and IAM permissions.' });
  }
});

app.post('/api/admin/users', requireComplete, allowRoles('admin'), async (req, res, next) => {
  try {
    const { password, role } = req.body;
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!validateEmailAddress(username)) return res.status(400).json({ error: 'Enter a valid email address for this account.' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!roles.includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
    const credentials = await hashPassword(password);
    try {
      db.prepare('INSERT INTO users (username, password_hash, password_salt, role, email_verified) VALUES (?, ?, ?, ?, 1)')
        .run(username, credentials.hash, credentials.salt, role);
      markDatabaseChanged(req);
      sendRegistrationConfirmationEmail({ username, role });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That username is already in use.' });
      throw error;
    }
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/users/:id', requireComplete, allowRoles('admin'), (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Choose a valid account.' });
  }

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
  if (user.id === req.auth.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  if (user.role === 'admin' && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count <= 1) {
    return res.status(400).json({ error: 'The last administrator account cannot be deleted.' });
  }

  const deleteAccount = db.transaction(() => {
    // Safely archive user deletion record in archived_roles
    db.prepare(`
      INSERT INTO archived_roles (original_role_id, name, display_name, description, permissions, user_count_at_archive, archived_at, archived_by, archive_reason)
      VALUES (0, ?, ?, 'Deleted user account', 'Account: ' || ?, 1, CURRENT_TIMESTAMP, ?, 'User account deleted')
    `).run(user.role, user.role.toUpperCase(), user.username, req.auth?.username || 'admin');

    db.prepare('DELETE FROM entries WHERE created_by = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  deleteAccount();
  markDatabaseChanged(req);
  res.json({ ok: true });
});

// Staff Patient Requests Endpoint
app.get('/api/staff/patient-requests', requireComplete, allowRoles('admin', 'doctor', 'nurse'), (_req, res) => {
  const requests = db.prepare(`
    SELECT r.id, r.subject, r.message, r.created_at, p.username AS patient_email
    FROM patient_requests r
    JOIN users p ON p.id = r.patient_id
    ORDER BY r.id DESC LIMIT 100
  `).all();
  res.json({ requests });
});

// Doctor Endpoints
app.get('/api/doctor/patients', requireComplete, allowRoles('admin', 'doctor'), (_req, res) => {
  const patients = db.prepare("SELECT id, username FROM users WHERE role = 'patient' ORDER BY username ASC").all();
  res.json({ patients });
});

app.get('/api/doctor/records', requireComplete, allowRoles('admin', 'doctor'), (req, res) => {
  const records = db.prepare(`
    SELECT r.id, r.diagnosis, r.prescription, r.notes, r.created_at,
           p.username AS patient_email, d.username AS doctor_email
    FROM medical_records r
    JOIN users p ON p.id = r.patient_id
    JOIN users d ON d.id = r.doctor_id
    ${req.auth.role === 'admin' ? '' : 'WHERE r.doctor_id = ?'}
    ORDER BY r.id DESC LIMIT 100
  `).all(req.auth.role === 'admin' ? [] : [req.auth.id]);
  res.json({ records });
});

app.post('/api/doctor/records', requireComplete, allowRoles('admin', 'doctor'), (req, res) => {
  const patientId = Number(req.body.patient_id);
  const diagnosis = typeof req.body.diagnosis === 'string' ? req.body.diagnosis.trim() : '';
  const prescription = typeof req.body.prescription === 'string' ? req.body.prescription.trim() : '';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  if (!patientId || !diagnosis) return res.status(400).json({ error: 'Patient and diagnosis are required.' });
  const patient = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'patient'").get(patientId);
  if (!patient) return res.status(400).json({ error: 'Selected patient does not exist.' });
  db.prepare('INSERT INTO medical_records (patient_id, doctor_id, diagnosis, prescription, notes) VALUES (?, ?, ?, ?, ?)')
    .run(patientId, req.auth.id, diagnosis, prescription, notes);
  markDatabaseChanged(req);
  res.status(201).json({ ok: true });
});

// Nurse Endpoints
app.get('/api/nurse/patients', requireComplete, allowRoles('admin', 'nurse'), (_req, res) => {
  const patients = db.prepare("SELECT id, username FROM users WHERE role = 'patient' ORDER BY username ASC").all();
  res.json({ patients });
});

app.get('/api/nurse/vitals', requireComplete, allowRoles('admin', 'nurse'), (_req, res) => {
  const vitals = db.prepare(`
    SELECT v.id, v.blood_pressure, v.heart_rate, v.temperature, v.notes, v.created_at,
           p.username AS patient_email, n.username AS nurse_email
    FROM vitals v
    JOIN users p ON p.id = v.patient_id
    JOIN users n ON n.id = v.nurse_id
    ORDER BY v.id DESC LIMIT 100
  `).all();
  res.json({ vitals });
});

app.post('/api/nurse/vitals', requireComplete, allowRoles('admin', 'nurse'), (req, res) => {
  const patientId = Number(req.body.patient_id);
  const bloodPressure = typeof req.body.blood_pressure === 'string' ? req.body.blood_pressure.trim() : '';
  const heartRate = typeof req.body.heart_rate === 'string' ? req.body.heart_rate.trim() : '';
  const temperature = typeof req.body.temperature === 'string' ? req.body.temperature.trim() : '';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  if (!patientId || !bloodPressure) return res.status(400).json({ error: 'Patient and blood pressure are required.' });
  const patient = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'patient'").get(patientId);
  if (!patient) return res.status(400).json({ error: 'Selected patient does not exist.' });
  db.prepare('INSERT INTO vitals (patient_id, nurse_id, blood_pressure, heart_rate, temperature, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(patientId, req.auth.id, bloodPressure, heartRate, temperature, notes);
  markDatabaseChanged(req);
  res.status(201).json({ ok: true });
});

app.get('/api/patient/my-records', requireComplete, allowRoles('patient'), (req, res) => {
  const records = db.prepare(`
    SELECT r.id, r.diagnosis, r.prescription, r.notes, r.created_at, d.username AS doctor_email
    FROM medical_records r
    JOIN users d ON d.id = r.doctor_id
    WHERE r.patient_id = ?
    ORDER BY r.id DESC LIMIT 100
  `).all(req.auth.id);
  res.json({ records });
});

app.get('/api/patient/my-vitals', requireComplete, allowRoles('patient'), (req, res) => {
  const vitals = db.prepare(`
    SELECT v.id, v.blood_pressure, v.heart_rate, v.temperature, v.notes, v.created_at, n.username AS nurse_email
    FROM vitals v
    JOIN users n ON n.id = v.nurse_id
    WHERE v.patient_id = ?
    ORDER BY v.id DESC LIMIT 100
  `).all(req.auth.id);
  res.json({ vitals });
});

app.get('/api/patient/my-requests', requireComplete, allowRoles('patient'), (req, res) => {
  const requests = db.prepare(`
    SELECT id, subject, message, created_at
    FROM patient_requests WHERE patient_id = ? ORDER BY id DESC LIMIT 100
  `).all(req.auth.id);
  res.json({ requests });
});

app.post('/api/patient/my-requests', requireComplete, allowRoles('patient'), (req, res) => {
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (subject.length < 2 || subject.length > 120) {
    return res.status(400).json({ error: 'Subject must be 2-120 characters.' });
  }
  if (!message || message.length > 2000) {
    return res.status(400).json({ error: 'Message must be 1-2,000 characters.' });
  }
  db.prepare('INSERT INTO patient_requests (patient_id, subject, message) VALUES (?, ?, ?)')
    .run(req.auth.id, subject, message);
  markDatabaseChanged(req);
  res.status(201).json({ ok: true });
});

app.get('/api/manager/entries', requireComplete, allowRoles('admin', 'manager'), (_req, res) => {
  const entries = db.prepare(`
    SELECT entries.id, entries.title, entries.notes, entries.created_at, users.username
    FROM entries JOIN users ON users.id = entries.created_by
    ORDER BY entries.id DESC LIMIT 100
  `).all();
  res.json({ entries });
});

app.post('/api/imputor/entries', requireComplete, allowRoles('admin', 'imputor'), (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  if (title.length < 2 || title.length > 120) return res.status(400).json({ error: 'Entry title must be 2-120 characters.' });
  if (notes.length > 2000) return res.status(400).json({ error: 'Notes must be 2,000 characters or fewer.' });
  db.prepare('INSERT INTO entries (title, notes, created_by) VALUES (?, ?, ?)').run(title, notes, req.auth.id);
  markDatabaseChanged(req);
  res.status(201).json({ ok: true });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use('/api', (error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Check the server log for details.' });
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  const username = bootstrapAdminUsername;
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!existing) {
    if (!validateEmailAddress(username)) {
      throw new Error('Bootstrap admin email does not meet the account rules.');
    }
    const rawPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
    const credentials = validatePassword(rawPassword)
      ? await hashPassword(rawPassword)
      : { hash: fallbackAdminHash, salt: fallbackAdminSalt };
    db.prepare('INSERT INTO users (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?)')
      .run(username, credentials.hash, credentials.salt, 'admin');
    console.log(`Created bootstrap admin account: ${username}`);
  }

  let backupTimer = null;
  if (autoBackupMinutes > 0) {
    backupTimer = setInterval(() => {
      runDatabaseBackup('auto').catch((error) => console.error('Automatic backup failed:', error));
    }, autoBackupMinutes * 60 * 1000);
    backupTimer.unref?.();
    console.log(`Automatic backups enabled every ${autoBackupMinutes} minutes${awsS3Configured ? ` to AWS S3 bucket ${awsS3Bucket}` : ' (local snapshots; AWS S3 not configured)'}`);
  }

  const server = app.listen(port, () => console.log(`Login app running at http://localhost:${port}`));

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    if (backupTimer) clearInterval(backupTimer);
    server.close(async () => {
      await liveBackupQueue.catch(() => {});
      awsS3Client?.destroy();
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
