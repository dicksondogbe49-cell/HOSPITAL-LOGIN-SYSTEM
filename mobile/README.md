# Secure Hospital Portal mobile app

This Expo app is a native mobile client for the Express API in the repository root. It includes email/password registration and sign-in with email verification, role based dashboards, clinical and patient workflows, manager/imputor entries, and administrator account, role, backup, restore, and Excel export actions.

## Run it

1. Start the backend from the repository root with `npm start`.
2. In this directory, run `npm install` and then `npx expo start`.
3. Open the QR code with Expo Go, or use `npx expo start --android` / `npx expo start --ios` with a configured simulator.
4. On the mobile sign-in screen, set the backend address if the default does not reach your machine:
   - Android emulator: `http://10.0.2.2:3000`
   - Physical Android phone: `http://YOUR-COMPUTER-LAN-IP:3000` (phone and computer must share a network)
   - Physical iPhone: use the deployed HTTPS host; iOS blocks plain HTTP LAN requests by default.
   - Deployed app: use its HTTPS host, for example `https://your-app.onrender.com`.

The admin Excel actions save the workbook to the app's local files and open the native share sheet so it can be saved to Files/Downloads or opened in a spreadsheet app. The backend emails a second copy when its configured SMTP or email webhook is available. Exported workbooks remain on the device until removed by the user.

The mobile bearer session uses the backend's normal expiring session records. The token is stored with Expo SecureStore and revoked at sign out. Do not expose the backend over an untrusted network; use HTTPS for hosted deployments.
