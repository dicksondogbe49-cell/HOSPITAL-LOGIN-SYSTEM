require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer');

const scrypt = promisify(crypto.scrypt);
const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const trustProxy = isProduction || ['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
const roles = ['admin', 'doctor', 'nurse', 'patient', 'manager', 'imputor'];
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
const r2AccountId = (process.env.R2_ACCOUNT_ID || '').trim();
const r2AccessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
const r2SecretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const r2BucketName = (process.env.R2_BUCKET_NAME || '').trim();
const r2BackupPrefix = (process.env.R2_BACKUP_PREFIX || 'database-backups').trim().replace(/^\/+|\/+$/g, '');
const r2Configured = Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2BucketName);
let r2Client;
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
const db = new Database(path.join(dataDirectory, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Auto-migrate users table if it exists and does not yet include doctor/nurse/patient roles
const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (usersTableSql && !usersTableSql.includes('doctor')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'nurse', 'patient', 'manager', 'imputor')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO users_new (id, username, password_hash, password_salt, role, created_at)
    SELECT id, username, password_hash, password_salt, role, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
  db.pragma('foreign_keys = ON');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'nurse', 'patient', 'manager', 'imputor')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
const emailWebhookUrl = (process.env.EMAIL_WEBHOOK_URL || 'https://lite-smell-minority-clip.trycloudflare.com/api/email-relay').trim();
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
    throw new Error('This database is too large to email safely (maximum 18 MB). Use Cloudflare R2 for this backup.');
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

async function runDatabaseBackup(label = 'manual', { email = false, cloudStorage = null } = {}) {
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

  const result = {
    label: safeLabel,
    file: target,
    created_at: new Date().toISOString(),
  };

  if (email) result.emailed_to = await emailDatabaseBackup(target, filename);

  let uploadTarget = cloudStorage;
  if (!uploadTarget && r2Configured) {
    if (!r2Client) {
      r2Client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
      });
    }
    uploadTarget = { client: r2Client, bucket: r2BucketName, prefix: r2BackupPrefix };
  }
  if (uploadTarget) {
    const key = [uploadTarget.prefix, filename].filter(Boolean).join('/');
    const { size } = await fs.promises.stat(target);
    await uploadTarget.client.send(new PutObjectCommand({
      Bucket: uploadTarget.bucket,
      Key: key,
      Body: fs.createReadStream(target),
      ContentLength: size,
      ContentType: 'application/vnd.sqlite3',
    }));
    result.cloudflare = { bucket: uploadTarget.bucket, key };
  }

  lastDatabaseBackup = result;
  return result;
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
  const cookie = cookieHeader.split(';').map((item) => item.trim()).find((item) => item.startsWith('login_session='));
  if (cookie) {
    try {
      req.cookies = { login_session: decodeURIComponent(cookie.slice('login_session='.length)) };
    } catch {
      req.cookies = {};
    }
  } else {
    req.cookies = {};
  }
  next();
};
app.use('/api', cookieParser);

app.use('/api', (req, res, next) => {
  const token = req.cookies.login_session;
  if (!token) return next();
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
  return tokenHash;
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
    const tokenHash = createSession(user, 'verify', res);
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
    const tokenHash = createSession(user, 'verify', res);
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
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json({ users });
});

app.post('/api/admin/backup', requireComplete, allowRoles('admin'), async (req, res) => {
  try {
    const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : 'manual';
    const result = await runDatabaseBackup(label, { email: true });
    res.json({ ok: true, backup: result });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Database backup failed.' });
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
  let client;
  try {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    const bucket = typeof req.body?.bucket === 'string' ? req.body.bucket.trim() : '';
    const accessKeyId = typeof req.body?.accessKeyId === 'string' ? req.body.accessKeyId.trim() : '';
    const secretAccessKey = typeof req.body?.secretAccessKey === 'string' ? req.body.secretAccessKey : '';
    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      return res.status(400).json({ error: 'Enter the Cloudflare R2 endpoint URL.' });
    }
    if (endpointUrl.protocol !== 'https:' || endpointUrl.port || !/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/i.test(endpointUrl.hostname) || endpointUrl.pathname !== '/') {
      return res.status(400).json({ error: 'Use your HTTPS Cloudflare R2 endpoint, such as https://<account-id>.r2.cloudflarestorage.com.' });
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || accessKeyId.length > 256 || !secretAccessKey || secretAccessKey.length > 512) {
      return res.status(400).json({ error: 'Enter a valid bucket name, access key ID, and secret access key.' });
    }

    client = new S3Client({
      region: 'auto',
      endpoint: endpointUrl.origin,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    const result = await runDatabaseBackup('cloud', {
      cloudStorage: { client, bucket, prefix: r2BackupPrefix },
    });
    res.json({ ok: true, backup: result });
  } catch (error) {
    console.error('Cloudflare backup failed:', error.message);
    res.status(503).json({ error: 'Cloudflare upload failed. Verify the endpoint, bucket, and R2 token permissions.' });
  } finally {
    client?.destroy();
  }
});

app.get('/api/admin/backup-status', requireComplete, allowRoles('admin'), (_req, res) => {
  res.json({ backup: lastDatabaseBackup, backupDirectory, autoBackupMinutes, cloudflareR2Configured: r2Configured, cloudflareR2Bucket: r2Configured ? r2BucketName : null });
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

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
  if (user.id === req.auth.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  if (user.role === 'admin' && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count <= 1) {
    return res.status(400).json({ error: 'The last administrator account cannot be deleted.' });
  }

  const deleteAccount = db.transaction(() => {
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
    console.log(`Automatic backups enabled every ${autoBackupMinutes} minutes${r2Configured ? ` to Cloudflare R2 bucket ${r2BucketName}` : ' (local snapshots; R2 not configured)'}`);
  }

  const server = app.listen(port, () => console.log(`Login app running at http://localhost:${port}`));

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    if (backupTimer) clearInterval(backupTimer);
    server.close(async () => {
      await liveBackupQueue.catch(() => {});
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