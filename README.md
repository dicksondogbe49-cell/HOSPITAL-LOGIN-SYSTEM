# Secure Login & Hospital Workflow Portal

A full-stack healthcare role-based access control (RBAC) web application with email/password sign-in, two-factor email verification codes (2FA OTP), clinical workflows, and automated encrypted database backups.

## Features

- **Two-Step Authentication**: Salted and peppered `scrypt` password hashing (`N=32768`) paired with single-use 6-digit email verification codes (`HMAC-SHA256`, 5-minute expiry, 5-attempt limit, 60-second resend cooldown).
- **Six Role-Based Workspaces**:
  - **Administrator (`admin`)**: Hospital metrics snapshot, account creation/deletion across all roles, system backup controls (offline encrypted download, instant email backup, AWS S3 online backups and restore), and patient request monitoring.
  - **Doctor (`doctor`)**: Clinical consultation logging (diagnosis, prescription, clinical notes), consultation history, and patient consultation/support request review.
  - **Nurse (`nurse`)**: Patient triage and vitals logging (blood pressure, heart rate, temperature, nursing notes), vitals history, and patient request review.
  - **Patient (`patient`)**: Personal care portal displaying medical records, recorded vitals history, and a form to submit consultation or support requests to the care team.
  - **Manager (`manager`) & Imputor (`imputor`)**: General operational entry submission (`imputor`) and team review (`manager`).
- **Automated & Encrypted Backups**:
  - **Live Snapshots & Encrypted Email**: Queues a consistent SQLite online backup (`db.backup()`) and emails an `AES-256-GCM` encrypted `.db.enc` attachment after every data modification.
  - **Scheduled Backups**: Runs every `AUTO_BACKUP_INTERVAL_MINUTES`, prunes local snapshots (`live` and `auto`) to `MAX_LOCAL_BACKUPS` (default `10`), and uploads to AWS S3 when configured. S3 objects use AES-256 server-side encryption, and cloud snapshots can be restored from the admin dashboard.
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
   - To enable AWS online backups, set `AWS_REGION` and `AWS_S3_BUCKET`. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for an IAM user, or run the app with an AWS IAM role that can access the bucket. Set `AWS_S3_PREFIX` to choose the folder prefix (defaults to `database-backups`). Keep AWS credentials in server environment settings; never put them in the browser or commit them to source control.
   - Set `BACKUP_EMAIL` to the inbox that should receive encrypted backups (defaults to `BOOTSTRAP_ADMIN_USERNAME`).
   - Set `OTP_SHARED_EMAIL` to the inbox that should receive verification codes for `doctor`, `nurse`, and `patient` accounts (defaults to `BOOTSTRAP_ADMIN_USERNAME` when empty). `admin`, `manager`, and `imputor` accounts receive codes at their own account email address.
5. Start the server:
   ```bash
   npm start
   ```
   Open `http://localhost:3000`. Health status is available at `GET /api/health`.

### AWS S3 Backup Setup

1. Create a private, general purpose S3 bucket in your chosen AWS region. Keep **Block all public access** enabled. Consider enabling bucket versioning and a lifecycle rule that matches your retention needs.
2. Give the app an IAM role or IAM user with only these permissions, replacing the bucket and prefix with your values:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME",
         "Condition": { "StringLike": { "s3:prefix": ["database-backups/*", "database-backups"] } }
       },
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/database-backups/*"
       }
     ]
   }
   ```
3. Set `AWS_REGION`, `AWS_S3_BUCKET`, and (optionally) `AWS_S3_PREFIX` in the server environment. If the host cannot use an IAM role, also set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as secret environment variables. Never enter these credentials in the browser.
4. Restart or redeploy the app. In **Admin Dashboard → Backup & Restore Management → Additional Export & Cloud Options**, click **Back Up to AWS S3**. The app uploads the snapshot with S3 AES-256 server-side encryption. Cloud snapshots appear in the restore selector and are downloaded and integrity-checked before restore.

## Expo Mobile App

The Android and iOS client is in [`mobile/`](mobile/). Follow [`mobile/README.md`](mobile/README.md) to configure the API address, start Expo, and run the app on a device or simulator. It uses this Express backend and the same role based workflows.

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
  3. Fill in `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `SMTP_USER`, and `SMTP_APP_PASSWORD` when prompted. Also set `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in the Render service environment to enable AWS backup uploads and restores.
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
