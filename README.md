# Secure Login

A small example app with email/password sign-in, Gmail-delivered verification codes, role-based access, and a separate plain HTML/CSS/JavaScript frontend.

## Run it

1. Install Node.js 22.15 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set unique values for `PASSWORD_PEPPER` and `SESSION_SECRET` (each at least 32 characters), and set a strong `BOOTSTRAP_ADMIN_PASSWORD` of at least 12 characters.
5. For Gmail delivery, enable 2-Step Verification on the sending Google account and create a Google App Password. Set `SMTP_APP_PASSWORD` to that app password, not your normal Google password. `SMTP_USER` is the sender address; it defaults to `BOOTSTRAP_ADMIN_USERNAME` when omitted.
6. Set `BACKUP_EMAIL` to the inbox that should receive backups; it defaults to the bootstrap admin email. The existing Gmail SMTP settings are used to send backups.
7. Cloudflare R2 is optional. Create an R2 bucket and an R2 API token with Object Read & Write permission scoped to that bucket. For a one-time upload, an admin can enter the R2 HTTPS endpoint, bucket, access key ID, and secret access key in the **Backup to Cloudflare** form; these credentials are used for that request only and are not saved. For scheduled R2 uploads, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` in `.env`; `R2_BACKUP_PREFIX` defaults to `database-backups`. Keep access keys secret and do not commit `.env`.
8. Press `F5` in VS Code and choose **Login app in Edge** to start the server and open Microsoft Edge. In PowerShell, you can also run `npm.cmd start` and open `http://localhost:3000` yourself.

After each successful application data change, the app queues a local SQLite snapshot and emails an AES-256-GCM encrypted attachment to `BACKUP_EMAIL`. Login and verification activity do not trigger backups. The admin **Backup now** button sends one immediately. The ten most recent live snapshots are kept locally. The encryption key is derived from `SESSION_SECRET`; keep that secret securely backed up because it is required to decrypt the attachment. Gmail attachments are limited to database files of 18 MB or smaller, and Gmail sending quotas may limit how many changes can be backed up in a day. Scheduled backups also run at `AUTO_BACKUP_INTERVAL_MINUTES`, keep a local copy, and upload to R2 when configured; scheduled backups do not email repeatedly. Set the interval to `0` to disable scheduled backups.

To decrypt an emailed backup, save the `.enc` attachment and run `node decrypt_backup.js <encrypted-file> <output.db>` from the project folder with the original `.env` available. Keep `.env` and the decrypted database private.

The bootstrap admin is created on the first run. Account identifiers must be email addresses. Doctor, Nurse, and Patient sign-in codes go to `OTP_SHARED_EMAIL`; when it is empty, they go to the bootstrap admin email. Set it only to a mailbox you control, since access to that inbox can complete sign-in for all three roles. Other roles receive codes at their own account email. Each successful password sign-in sends a six-digit email code that expires after five minutes; the code is single-use and limited to five attempts. The Patient role is sign-in-only and has no patient portal features. The app uses scrypt with an individual random salt and a server-side pepper, HMAC-protected email codes, HttpOnly/SameSite session cookies, rate-limited sign-in, and server-side role checks.

## Frontend and backend files

- `public/index.html`, `public/styles.css`, `public/app.js`: browser interface.
- `server.js`: API, SQLite storage, authentication, 2FA, and authorization.
- `.env.example`: required local configuration template.

This is a learning/demo starter, not a complete production identity platform. Deploy only behind HTTPS, keep the environment secrets out of source control, back them up securely, and add operational controls such as recovery codes, audit logging, and distributed rate limiting across app instances before production use. Email verification depends on the security of the mailbox and is generally weaker than an authenticator app.