# Secure Login & Hospital Workflow Portal

A full-stack healthcare role-based access control (RBAC) web application with email/password sign-in, two-factor email verification codes (2FA OTP), clinical workflows, and automated encrypted database backups.

## Features

- **Two-Step Authentication**: Salted and peppered `scrypt` password hashing (`N=32768`) paired with single-use 6-digit email verification codes (`HMAC-SHA256`, 5-minute expiry, 5-attempt limit, 60-second resend cooldown).
- **Six Role-Based Workspaces**:
  - **Administrator (`admin`)**: Hospital metrics snapshot, account creation/deletion across all roles, system backup controls (offline encrypted download, instant email backup, one-time or scheduled Cloudflare R2 upload), and patient request monitoring.
  - **Doctor (`doctor`)**: Clinical consultation logging (diagnosis, prescription, clinical notes), consultation history, and patient consultation/support request review.
  - **Nurse (`nurse`)**: Patient triage and vitals logging (blood pressure, heart rate, temperature, nursing notes), vitals history, and patient request review.
  - **Patient (`patient`)**: Personal care portal displaying medical records, recorded vitals history, and a form to submit consultation or support requests to the care team.
  - **Manager (`manager`) & Imputor (`imputor`)**: General operational entry submission (`imputor`) and team review (`manager`).
- **Automated & Encrypted Backups**:
  - **Live Snapshots & Encrypted Email**: Queues a consistent SQLite online backup (`db.backup()`) and emails an `AES-256-GCM` encrypted `.db.enc` attachment after every data modification.
  - **Scheduled Backups**: Runs every `AUTO_BACKUP_INTERVAL_MINUTES`, prunes local snapshots (`live` and `auto`) to `MAX_LOCAL_BACKUPS` (default `10`), and uploads to Cloudflare R2 when configured.
  - **Offline Encrypted Download**: Downloads an `AES-256-GCM` encrypted `.db.enc` snapshot directly to the administrator's device.

## Local Setup

1. Install **Node.js 22.15** or newer.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Configure `.env`:
   - Set unique values for `PASSWORD_PEPPER` and `SESSION_SECRET` (each at least 32 characters).
   - Set `BOOTSTRAP_ADMIN_USERNAME` (a valid email address) and `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters). The bootstrap administrator account is provisioned automatically on first startup.
   - For **Gmail SMTP**, enable 2-Step Verification on your Google account, generate a Google App Password, and set `SMTP_USER` and `SMTP_APP_PASSWORD`. For **any other SMTP provider** (Outlook, Resend, Brevo, SendGrid, Mailgun, Zoho), also set `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE`.
   - Set `BACKUP_EMAIL` to the inbox that should receive encrypted backups (defaults to `BOOTSTRAP_ADMIN_USERNAME`).
   - Set `OTP_SHARED_EMAIL` to the inbox that should receive verification codes for `doctor`, `nurse`, and `patient` accounts (defaults to `BOOTSTRAP_ADMIN_USERNAME` when empty). `admin`, `manager`, and `imputor` accounts receive codes at their own account email address.
5. Start the server:
   ```bash
   npm start
   ```
   Open `http://localhost:3000`. Health status is available at `GET /api/health`.

## Decrypting a Backup

Keep your original `SESSION_SECRET` backed up securely; it is required to decrypt `.db.enc` files downloaded from the dashboard or received by email:

```bash
node decrypt_backup.js <encrypted-file.db.enc> <restored.db>
```

## Deploying to Your Own GitHub & Hosting Platform

This repository is pre-configured for deployment under any GitHub account and hosting provider:

### 1. Push to a New GitHub Repository
```bash
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/<your-github-username>/<your-repo-name>.git
git branch -M main
git push -u origin main
```

### 2. Hosting Options
- **Render (`render.yaml` included)**:
  1. In Render, click **New + → Blueprint** and connect your GitHub repository.
  2. Render will automatically provision the web service, a persistent disk mounted at `/var/data` (`DATA_DIRECTORY=/var/data/db`, `BACKUP_DIRECTORY=/var/data/backups`), and generate `PASSWORD_PEPPER` and `SESSION_SECRET`.
  3. Fill in `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `SMTP_USER`, and `SMTP_APP_PASSWORD` when prompted.
- **Railway (`railway.json` included)**:
  1. Create a new project from your GitHub repo in Railway.
  2. Attach a **Volume** mounted at `/app/data`, set `DATA_DIRECTORY=/app/data/db` and `BACKUP_DIRECTORY=/app/data/backups`, and add the variables from `.env.example`.
- **Docker / Fly.io / Koyeb / VPS (`Dockerfile` included)**:
  ```bash
  docker build -t secure-hospital-portal .
  docker run -d -p 3000:3000 --env-file .env -v hospital_data:/app/data -v hospital_backups:/app/backups secure-hospital-portal
  ```

## Project Files

- `server.js`: Express 5 API, SQLite WAL storage, authentication, 2FA OTP, role authorization, and backup engine.
- `public/index.html`, `public/styles.css`, `public/app.js`: Single-page browser interface.
- `decrypt_backup.js`: Offline backup decryption CLI utility (`HKDF-SHA256` + `AES-256-GCM`).
- `hash_password.js`: CLI utility (`node hash_password.js <password>`) to generate `scrypt` password hashes.
- `Dockerfile`, `render.yaml`, `railway.json`, `.env.example`: Deployment configurations.