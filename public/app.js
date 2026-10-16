const app = document.querySelector('#app');
let currentUser = null;

const roleLabels = {
  admin: 'Administrator',
  doctor: 'Doctor',
  nurse: 'Nurse',
  patient: 'Patient',
  manager: 'Manager',
  imputor: 'Imputor',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const responseText = await response.text();
  let data = {};
  try { data = JSON.parse(responseText); } catch {}
  if (!response.ok) {
    throw new Error(data.error || `The server returned HTTP ${response.status} without a JSON error message.`);
  }
  return data;
}

function setError(message) {
  const error = document.querySelector('[data-error]');
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
}

function clearError() {
  const error = document.querySelector('[data-error]');
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
}

function intro(eyebrow, heading, copy) {
  return `<section class="intro"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p class="intro-copy">${copy}</p><div class="intro-rule">Identity · Verification · Access</div></section>`;
}

function showLogin() {
  currentUser = null;
  document.body.classList.remove('admin-theme');
  document.body.classList.remove('doctor-theme');
  document.body.classList.remove('patient-theme');
  app.innerHTML = `<div class="auth-layout">
    ${intro('Account / Access', 'Your work, in the right hands.', 'Sign in or register with your own verified email address. Every registration and sign-in activity is verified directly through your personal inbox.')}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>Account access</span><span class="step-number">01 / 03</span></div>
      <h2 id="panel-title">Welcome back</h2>
      <p class="panel-lede">Choose your role, then enter your email address and password to continue.</p>
      <form id="login-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field">
          <label for="role">Role</label>
          <select id="role" name="role" required>
            <option value="">Select your role</option>
            <option value="admin">ADMIN</option>
            <option value="nurse">NURSE</option>
            <option value="doctor">DOCTOR</option>
            <option value="patient">PATIENT</option>
            <option value="manager">MANAGER</option>
            <option value="imputor">IMPUTOR</option>
          </select>
        </div>
        <div class="field"><label for="username">Your email address</label><input id="username" name="username" type="email" autocomplete="username" required maxlength="254" autofocus></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="6"></div>
        <p class="password-hint">A 6-digit verification code will be sent directly to your email address.</p>
        <button class="primary-button" type="submit"><span>Continue securely</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="go-register" type="button">New here? Register with your email</button>
      <button class="text-button resend-button" id="go-forgot" type="button" style="margin-top:6px;color:#0d5c8a;border-color:#b8d4e8;">Forgot your password?</button>
    </section>
  </div>`;
  document.querySelector('#login-form').addEventListener('submit', login);
  document.querySelector('#go-register').addEventListener('click', showRegister);
  document.querySelector('#go-forgot').addEventListener('click', showForgotPassword);
}

function showRegister() {
  currentUser = null;
  document.body.classList.remove('admin-theme');
  document.body.classList.remove('doctor-theme');
  document.body.classList.remove('patient-theme');
  app.innerHTML = `<div class="auth-layout">
    ${intro('Account / Registration', 'Create your verified account.', 'Register using your own email address. We will send a 6-digit verification code to your email to verify ownership and activate your workspace.')}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>Email registration</span><span class="step-number">01 / 03</span></div>
      <h2 id="panel-title">Register account</h2>
      <p class="panel-lede">Select your role and enter your own email address to receive your verification code.</p>
      <form id="register-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field">
          <label for="reg-role">Role</label>
          <select id="reg-role" name="role" required>
            <option value="">Select your role</option>
            <option value="patient">PATIENT</option>
            <option value="doctor">DOCTOR</option>
            <option value="nurse">NURSE</option>
            <option value="manager">MANAGER</option>
            <option value="imputor">IMPUTOR</option>
          </select>
        </div>
        <div class="field"><label for="reg-username">Your email address</label><input id="reg-username" name="username" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" autofocus></div>
        <div class="field"><label for="reg-password">Create password</label><input id="reg-password" name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></div>
        <div class="field"><label for="reg-confirm-password">Confirm password</label><input id="reg-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></div>
        <p class="password-hint">Minimum 6 characters. All registration and login codes will be sent to your email.</p>
        <button class="primary-button" type="submit"><span>Register &amp; verify email</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="go-login" type="button">Already have an account? Sign in</button>
    </section>
  </div>`;
  document.querySelector('#register-form').addEventListener('submit', register);
  document.querySelector('#go-login').addEventListener('click', showLogin);
}

async function register(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  clearError();
  try {
    const role = String(form.get('role') || '').trim().toLowerCase();
    if (role === 'admin') {
      throw new Error('Administrator accounts cannot be self-registered.');
    }
    if (!Object.prototype.hasOwnProperty.call(roleLabels, role)) {
      throw new Error('Please select a role for your account.');
    }
    const password = String(form.get('password') || '');
    const confirmPassword = String(form.get('confirmPassword') || '');
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }
    const result = await api('/api/register', {
      method: 'POST',
      body: {
        username: form.get('username'),
        password,
        role,
      },
    });
    currentUser = result;
    showTwoFactorVerify();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    const role = String(form.get('role') || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(roleLabels, role)) {
      throw new Error('Please select your role before signing in.');
    }
    const result = await api('/api/login', {
      method: 'POST',
      body: {
        username: form.get('username'),
        password: form.get('password'),
        role,
      },
    });
    currentUser = result;
    showTwoFactorVerify();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

function showTwoFactorVerify() {
  const verificationEmail = escapeHtml(currentUser?.verificationEmail || currentUser?.username || 'your email inbox');
  const isRegistration = Boolean(currentUser?.isRegistration);
  const fallbackNote = currentUser?.fallbackCode
    ? `Fallback verification code for ${verificationEmail}: ${escapeHtml(currentUser.fallbackCode)}`
    : '';
  app.innerHTML = `<div class="auth-layout">
    ${intro(
      isRegistration ? 'Registration / Email Verification' : 'Account / Verification',
      'Check your email.',
      isRegistration
        ? `Enter the six-digit registration code sent to ${verificationEmail} to verify ownership and activate your account.`
        : `Enter the six-digit sign-in code sent to ${verificationEmail}.`,
    )}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>${isRegistration ? 'Verify your email' : 'Two-step verification'}</span><span class="step-number">02 / 03</span></div>
      <h2 id="panel-title">${isRegistration ? 'Confirm registration' : 'Enter your code'}</h2>
      <p class="panel-lede">A six-digit code was sent to <strong>${verificationEmail}</strong>. It expires in five minutes.</p>
      <form id="totp-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field"><label for="code">Email verification code</label><input class="code-input" id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autofocus></div>
        <button class="primary-button" type="submit"><span>${isRegistration ? 'Verify email &amp; complete registration' : 'Verify and continue'}</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="resend-code" type="button">Resend code to ${verificationEmail}</button>
      <button class="text-button resend-button" id="cancel-verify" type="button">Use a different email address</button>
      <p class="security-note ${fallbackNote ? '' : 'hidden'}" data-status role="status">${fallbackNote}</p>
    </section>
  </div>`;
  document.querySelector('#totp-form').addEventListener('submit', verifyTwoFactor);
  document.querySelector('#resend-code').addEventListener('click', resendEmailCode);
  document.querySelector('#cancel-verify').addEventListener('click', logout);
}

async function resendEmailCode(event) {
  const button = event.currentTarget;
  button.disabled = true;
  clearError();
  const status = document.querySelector('[data-status]');
  status.classList.add('hidden');
  try {
    const result = await api('/api/2fa/resend', { method: 'POST' });
    if (result.fallbackCode) {
      status.textContent = `Verification notice: check your inbox for the code.`;
    } else {
      status.textContent = `A new code was sent to ${result.verificationEmail || currentUser?.username || 'your email inbox'}.`;
    }
    status.classList.remove('hidden');
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function verifyTwoFactor(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    await api('/api/2fa/verify', { method: 'POST', body: { code: new FormData(event.currentTarget).get('code') } });
    renderWorkspace();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

// ─── Forgot Password Flow ─────────────────────────────────────────────────────

// Step 1 – Enter email
function showForgotPassword() {
  currentUser = null;
  document.body.classList.remove('admin-theme', 'doctor-theme', 'patient-theme');
  app.innerHTML = `<div class="auth-layout">
    ${intro('Account / Password Reset', 'Recover your access.', 'Enter your registered email address below. We will send a 6-digit verification code to confirm your identity before allowing you to set a new password.')}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>Forgot password</span><span class="step-number">01 / 03</span></div>
      <h2 id="panel-title">Reset your password</h2>
      <p class="panel-lede">Enter the email address linked to your account and we'll send you a reset code.</p>
      <form id="forgot-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field">
          <label for="forgot-email">Your email address</label>
          <input id="forgot-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" autofocus>
        </div>
        <button class="primary-button" type="submit" style="background:linear-gradient(110deg,#0b3562,#11689a 62%,#0c527b)"><span>Send reset code</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="go-login-from-forgot" type="button">Back to sign in</button>
    </section>
  </div>`;
  document.querySelector('#forgot-form').addEventListener('submit', submitForgotPassword);
  document.querySelector('#go-login-from-forgot').addEventListener('click', showLogin);
}

// Step 2 – Enter 6-digit code
function showForgotPasswordVerify(email, fallbackCode) {
  const safeEmail = escapeHtml(email || 'your email inbox');
  app.innerHTML = `<div class="auth-layout">
    ${intro('Account / Password Reset', 'Check your email.', `A 6-digit reset code has been sent to ${safeEmail}. Enter it below to verify your identity.`)}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>Verify identity</span><span class="step-number">02 / 03</span></div>
      <h2 id="panel-title">Enter your reset code</h2>
      <p class="panel-lede">A six-digit code was sent to <strong>${safeEmail}</strong>. It expires in 5 minutes.</p>
      <form id="forgot-verify-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field">
          <label for="reset-code">6-digit reset code</label>
          <input class="code-input" id="reset-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autofocus>
        </div>
        <button class="primary-button" type="submit" style="background:linear-gradient(110deg,#0b3562,#11689a 62%,#0c527b)"><span>Verify code</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="resend-reset-code" type="button">Resend code to ${safeEmail}</button>
      <button class="text-button resend-button" id="go-login-from-verify" type="button" style="margin-top:6px">Back to sign in</button>
      ${fallbackCode ? `<p class="security-note" role="status">Fallback code (dev mode): ${escapeHtml(fallbackCode)}</p>` : ''}
    </section>
  </div>`;
  document.querySelector('#forgot-verify-form').addEventListener('submit', submitForgotVerify);
  document.querySelector('#resend-reset-code').addEventListener('click', resendResetCode);
  document.querySelector('#go-login-from-verify').addEventListener('click', showLogin);
  // Store email for resend reference
  window._resetEmail = email;
}

// Step 3 – Set new password
function showForgotPasswordReset() {
  app.innerHTML = `<div class="auth-layout">
    ${intro('Account / Password Reset', 'Set your new password.', 'Your identity has been verified. Choose a strong new password for your account.')}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>New password</span><span class="step-number">03 / 03</span></div>
      <h2 id="panel-title">Create new password</h2>
      <p class="panel-lede">Enter and confirm your new password. Minimum 6 characters.</p>
      <form id="forgot-reset-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field">
          <label for="new-password">New password</label>
          <input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200" autofocus>
        </div>
        <div class="field">
          <label for="confirm-new-password">Confirm new password</label>
          <input id="confirm-new-password" name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="200">
        </div>
        <p class="password-hint">Minimum 6 characters. You will be signed out from all active sessions.</p>
        <button class="primary-button" type="submit" style="background:linear-gradient(110deg,#0b3562,#11689a 62%,#0c527b)"><span>Update password</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="go-login-from-reset" type="button">Back to sign in</button>
    </section>
  </div>`;
  document.querySelector('#forgot-reset-form').addEventListener('submit', submitNewPassword);
  document.querySelector('#go-login-from-reset').addEventListener('click', showLogin);
}

// ─── Handler Functions ────────────────────────────────────────────────────────

async function submitForgotPassword(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  clearError();
  try {
    const email = document.querySelector('#forgot-email').value.trim();
    const result = await api('/api/forgot-password', { method: 'POST', body: { email } });
    // Always proceed to code entry — server never reveals if email exists
    showForgotPasswordVerify(email, result.fallbackCode || null);
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

async function submitForgotVerify(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  clearError();
  try {
    const code = document.querySelector('#reset-code').value.trim();
    await api('/api/forgot-password/verify', { method: 'POST', body: { code } });
    showForgotPasswordReset();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

async function resendResetCode(event) {
  const button = event.currentTarget;
  button.disabled = true;
  clearError();
  try {
    const result = await api('/api/forgot-password/resend', { method: 'POST' });
    const status = document.createElement('p');
    status.className = 'security-note';
    status.setAttribute('role', 'status');
    if (result.fallbackCode) {
      status.textContent = `A new reset code has been sent. Check your email.`;
    } else {
      status.textContent = `A new code has been sent to ${escapeHtml(window._resetEmail || 'your email')}.`;
    }
    const existingNote = document.querySelector('.security-note');
    if (existingNote) existingNote.replaceWith(status);
    else document.querySelector('.panel').appendChild(status);
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function submitNewPassword(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  clearError();
  try {
    const password = document.querySelector('#new-password').value;
    const confirmPassword = document.querySelector('#confirm-new-password').value;
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match. Please try again.');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    await api('/api/forgot-password/reset', { method: 'POST', body: { password } });
    // Show success then redirect to login
    app.innerHTML = `<div class="auth-layout">
      ${intro('Account / Password Reset', 'Password updated!', 'Your new password has been set successfully. You have been signed out from all active sessions for security.')}
      <section class="panel" aria-labelledby="panel-title">
        <div class="panel-label"><span>Success</span><span class="step-number" style="color:#2e7d32">✓ Complete</span></div>
        <h2 id="panel-title" style="color:#2e7d32">Password changed</h2>
        <p class="panel-lede">Your password has been updated successfully. Please sign in with your new password.</p>
        <div style="padding:18px;background:#f0faf0;border:1px solid #c8e6c9;border-radius:4px;margin-bottom:20px">
          <p style="margin:0;font-size:13px;color:#2e7d32;font-weight:600">✓ Your password was changed.</p>
          <p style="margin:6px 0 0;font-size:12px;color:#388e3c">A confirmation email has been sent to your registered email address.</p>
        </div>
        <button class="primary-button" id="go-login-success" type="button"><span>Sign in with new password</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </section>
    </div>`;
    document.querySelector('#go-login-success').addEventListener('click', showLogin);
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
}

function section(title, body, fullWidth = false, extraClass = '') {
  return `<section class="workspace-section${fullWidth ? ' full-width' : ''}${extraClass ? ` ${extraClass}` : ''}"><div class="section-heading"><h2>${title}</h2></div>${body}</section>`;
}

async function renderWorkspace() {
  if (!currentUser) return showLogin();
  app.innerHTML = `<div class="loading-state"><span class="loader"></span><span>Opening your workspace</span></div>`;
  try {
    const [dashboard] = await Promise.all([api('/api/dashboard')]);
    const role = currentUser.role;
    document.body.classList.toggle('admin-theme', role === 'admin');
    document.body.classList.toggle('doctor-theme', role === 'doctor');
    document.body.classList.toggle('patient-theme', role === 'patient');
    const eyebrow = role === 'admin'
      ? 'Hospital Administration / Overall Admin'
      : `Healthcare Portal / ${roleLabels[role] || role}`;
    let sections = '';

    if (role === 'admin') {
      sections += `<div class="admin-toolbar">
        <div>
          <span class="admin-toolbar-title">Hospital Executive Administration</span>
          <p class="field-hint" style="margin:2px 0 0 0; color: #000;">Manage hospital roles, automated backups, and system records.</p>
        </div>
        <a href="/api/admin/report/pdf" target="_blank" rel="noopener noreferrer" class="btn-pdf-view" id="admin-view-pdf-btn">
          <span class="btn-pdf-icon" aria-hidden="true">📄</span>
          <span>View PDF Document</span>
        </a>
      </div>`;

      sections += `<section class="workspace-section admin-overview-card">
        <figure class="admin-doctor-photo"><img src="/img/DOCTOR%203.jpg" alt="Doctor holding a tablet"></figure>
        <div class="admin-overview-content">
          <div class="section-heading"><h2>Hospital Snapshot</h2></div>
          <div class="admin-metric-grid">
            <div><span class="metric-value">${dashboard.totalUsers}</span><span class="metric-label">Total Accounts</span></div>
            <div><span class="metric-value">${dashboard.doctors}</span><span class="metric-label">Doctors</span></div>
            <div><span class="metric-value">${dashboard.nurses}</span><span class="metric-label">Nurses</span></div>
            <div><span class="metric-value">${dashboard.patients}</span><span class="metric-label">Patients</span></div>
            <div><span class="metric-value">${dashboard.records}</span><span class="metric-label">Consultations</span></div>
            <div><span class="metric-value">${dashboard.vitals}</span><span class="metric-label">Vitals Logs</span></div>
          </div>
        </div>
      </section>`;

      // 1. Role Management Section (Requirement 2 & 1.3)
      sections += section('Role Management', `
        <div class="loading-state"><span class="loader"></span><span>Loading role management controls</span></div>
      `, true, 'js-roles-section');

      // 2. Backup & Restore Management Section (Requirement 1)
      sections += section('Backup & Restore Management', `
        <p class="security-note hidden" data-backup-status role="status"></p>
        <div class="error-message hidden" data-error role="alert"></div>

        <!-- Active Backup Viewer (Requirement 1.4) -->
        <div class="active-backup-viewer" id="active-backup-viewer-panel">
          <div class="backup-viewer-header">
            <h3><span class="status-dot"></span> Active Backup Details</h3>
            <span class="backup-status-tag" id="active-backup-tag">Current / Active</span>
          </div>
          <div id="active-backup-content">
            <div class="loading-state"><span class="loader"></span><span>Loading active backup details</span></div>
          </div>
        </div>

        <div class="form-divider" style="margin:20px 0;"></div>
        <details class="advanced-backup-options">
          <summary style="cursor:pointer; font-weight:600; color:#334155; font-size:13px;">Additional Export &amp; Cloud Options</summary>
          <div style="margin-top:12px;">
            <p class="password-hint">Create an encrypted offline copy, email a recovery copy, or store a backup in the configured AWS S3 bucket.</p>
            <button class="primary-button" id="offline-backup-button" type="button" style="margin-bottom:12px;"><span>Download offline backup (.enc)</span><span class="button-arrow" aria-hidden="true">↓</span></button>
            <p class="security-note hidden" data-offline-backup-status role="status"></p>
            <div class="form-divider"></div>
            <button class="primary-button" id="system-backup-button" type="button" style="margin-bottom:12px;"><span>Email encrypted backup</span><span class="button-arrow" aria-hidden="true">✉</span></button>
            <div class="form-divider"></div>
            <form id="cloud-backup-form">
              <div class="error-message hidden" data-cloud-backup-error role="alert"></div>
              <button class="primary-button" type="submit"><span>Back Up to AWS S3</span><span class="button-arrow" aria-hidden="true">☁</span></button>
              <p class="security-note hidden" data-cloud-backup-status role="status"></p>
            </form>
          </div>
        </details>
      `, false, 'js-backup-section');

      // Create Account (Staff or Patient)
      sections += section('Create Account (Staff or Patient)', `
        <form id="create-user-form">
          <div class="error-message hidden" data-error role="alert"></div>
          <div class="field">
            <label for="new-username">Email address</label>
            <input id="new-username" name="username" type="email" autocomplete="email" maxlength="254" placeholder="person@hospital.com" required>
          </div>
          <div class="field">
            <label for="new-password">Temporary password (min 6 chars)</label>
            <input id="new-password" name="password" type="password" autocomplete="new-password" minlength="6" maxlength="200" placeholder="Minimum 6 characters" required>
          </div>
          <div class="field">
            <label for="new-role">Role</label>
            <select id="new-role" name="role">
              <option value="doctor">Doctor</option>
              <option value="nurse">Nurse</option>
              <option value="patient">Patient</option>
              <option value="admin">Administrator</option>
              <option value="manager">Manager</option>
              <option value="imputor">Imputor</option>
            </select>
          </div>
          <button class="btn-crud-add" type="submit">ADD</button>
        </form>
      `);

      // Information Security Principles & Cryptographic Architecture Section
      sections += section('Information Security Principles & Cryptographic Architecture', `
        <p class="field-hint" style="margin-bottom:14px; color:#334155;">
          The system strictly adheres to the core <strong>Information Security Principles (CIA Triad: Confidentiality, Integrity, Availability)</strong>, NIST SP 800-63B guidelines, and OWASP Zero-Knowledge password storage standards.
        </p>
        <div class="infosec-principles-grid">
          <div class="infosec-card">
            <div class="infosec-card-header">
              <span class="infosec-badge badge-conf">Confidentiality</span>
              <h4>Zero-Knowledge Password Storage</h4>
            </div>
            <p class="infosec-desc">
              Plaintext passwords are <strong>NEVER stored</strong>, logged, or recoverable. In compliance with NIST SP 800-63B §5.1.1, passwords undergo one-way cryptographic derivation and are immediately wiped from volatile memory.
            </p>
            <div class="infosec-metric">Status: <strong>Zero Plaintext Retention</strong></div>
          </div>

          <div class="infosec-card">
            <div class="infosec-card-header">
              <span class="infosec-badge badge-integ">Integrity</span>
              <h4>scrypt KDF &amp; Salt Randomization</h4>
            </div>
            <p class="infosec-desc">
              Credentials use memory-hard <code>scrypt</code> (N=32768, r=8, p=1) generating 64-byte hashes. Every user receives an isolated 16-byte random salt, rendering precomputed rainbow tables useless.
            </p>
            <div class="infosec-metric">KDF: <strong>scrypt + 128-bit Salt</strong></div>
          </div>

          <div class="infosec-card">
            <div class="infosec-card-header">
              <span class="infosec-badge badge-defense">Defense-in-Depth</span>
              <h4>Keyed Application Pepper</h4>
            </div>
            <p class="infosec-desc">
              A 32+ character server-side pepper (<code>PASSWORD_PEPPER</code>) isolated in environment settings is appended prior to derivation. A leaked database alone cannot be cracked without server secrets.
            </p>
            <div class="infosec-metric">Separation: <strong>Server Environment Pepper</strong></div>
          </div>

          <div class="infosec-card">
            <div class="infosec-card-header">
              <span class="infosec-badge badge-auth">Authenticity</span>
              <h4>Two-Factor Authentication (2FA OTP)</h4>
            </div>
            <p class="infosec-desc">
              Sign-in requires a single-use 6-digit email OTP. Verification digests are stored as <code>HMAC-SHA256</code> with a 5-minute expiry, 5-attempt brute-force lockout, and 60-second cooldown.
            </p>
            <div class="infosec-metric">MFA: <strong>HMAC-SHA256 OTP (5-min TTL)</strong></div>
          </div>

          <div class="infosec-card">
            <div class="infosec-card-header">
              <span class="infosec-badge badge-priv">Least Privilege</span>
              <h4>Role-Based Access Control (RBAC)</h4>
            </div>
            <p class="infosec-desc">
              Access is segregated across 6 clinical and administrative roles. Express route middleware (<code>requireSession</code>, <code>allowRoles</code>) verifies credentials on every API request.
            </p>
            <div class="infosec-metric">Authorization: <strong>Strict Server RBAC</strong></div>
          </div>

          <div class="infosec-card">
            <div class="infosec-card-header">
              <span class="infosec-badge badge-avail">Availability</span>
              <h4>Encrypted Disaster Recovery</h4>
            </div>
            <p class="infosec-desc">
              Continuous SQLite WAL point-in-time snapshots are encrypted with <code>AES-256-GCM</code> via HKDF-SHA256 keys, automatically emailed and replicated to AWS S3 cloud storage.
            </p>
            <div class="infosec-metric">Resilience: <strong>AES-256-GCM Snapshots</strong></div>
          </div>
        </div>
      `, true, 'infosec-principles-section');

      sections += section('Accounts Directory', '<div class="loading-state"><span class="loader"></span><span>Loading accounts</span></div>', true, 'js-users-section');
      sections += section('Patient Consultation & Support Requests', '<div class="loading-state"><span class="loader"></span><span>Loading patient requests</span></div>', true, 'js-staff-requests-section');
    } else if (role === 'doctor') {
      sections += section("Doctor's Overview", `
        <div class="doctor-overview-layout">
          <figure class="doctor-box-image-wrap">
            <img class="doctor-box-image" src="/img/DOCTOR%201.jpg" alt="Doctor in blue scrubs with colleagues">
            <figcaption class="doctor-badge-overlay"><span class="pulse-indicator"></span>Doctor overview</figcaption>
          </figure>
          <div class="doctor-metrics">
            <div class="metric-pill"><span class="metric-value">${dashboard.myRecords}</span><span class="metric-label">My Consultations</span></div>
            <div class="metric-pill"><span class="metric-value">${dashboard.totalPatients}</span><span class="metric-label">Registered Patients</span></div>
          </div>
        </div>
      `, false, 'doctor-overview-card');

      sections += section('New Consultation & Prescription', `
        <form id="doctor-record-form">
          <div class="error-message hidden" data-error role="alert"></div>
          <div class="field">
            <label for="doctor-patient-select">Patient</label>
            <select id="doctor-patient-select" name="patient_id" required>
              <option value="">Loading patients...</option>
            </select>
          </div>
          <div class="field">
            <label for="doctor-diagnosis">Diagnosis</label>
            <input id="doctor-diagnosis" name="diagnosis" minlength="2" maxlength="120" placeholder="e.g. Hypertension Stage 1, Type 2 Diabetes" required>
          </div>
          <div class="field">
            <label for="doctor-prescription">Prescription</label>
            <input id="doctor-prescription" name="prescription" maxlength="200" placeholder="e.g. Amlodipine 5mg once daily">
          </div>
          <div class="field">
            <label for="doctor-notes">Clinical Notes</label>
            <textarea id="doctor-notes" name="notes" maxlength="2000" placeholder="Observations, test results, lifestyle advice, follow-up plan..."></textarea>
          </div>
          <button class="primary-button" type="submit"><span>Save Consultation</span><span class="button-arrow" aria-hidden="true">→</span></button>
        </form>
      `, true);

      sections += section('Recent Consultation Records', '<div class="loading-state"><span class="loader"></span><span>Loading clinical records</span></div>', true, 'js-doctor-records-section');
      sections += section('Patient Consultation & Support Requests', '<div class="loading-state"><span class="loader"></span><span>Loading patient requests</span></div>', true, 'js-staff-requests-section');
    } else if (role === 'nurse') {
      sections += section("Nurse's Station Overview", `
        <div class="metric-row">
          <div><span class="metric-value">${dashboard.myVitals}</span><span class="metric-label">Vitals Taken By Me</span></div>
          <div><span class="metric-value">${dashboard.totalPatients}</span><span class="metric-label">Registered Patients</span></div>
        </div>
      `);

      sections += section('Record Patient Vitals & Triage', `
        <form id="nurse-vitals-form">
          <div class="error-message hidden" data-error role="alert"></div>
          <div class="field">
            <label for="nurse-patient-select">Patient</label>
            <select id="nurse-patient-select" name="patient_id" required>
              <option value="">Loading patients...</option>
            </select>
          </div>
          <div class="field">
            <label for="nurse-bp">Blood Pressure</label>
            <input id="nurse-bp" name="blood_pressure" placeholder="e.g. 120/80 mmHg" required>
          </div>
          <div class="field">
            <label for="nurse-hr">Heart Rate / Pulse</label>
            <input id="nurse-hr" name="heart_rate" placeholder="e.g. 72 bpm">
          </div>
          <div class="field">
            <label for="nurse-temp">Body Temperature</label>
            <input id="nurse-temp" name="temperature" placeholder="e.g. 98.6 °F or 37.0 °C">
          </div>
          <div class="field">
            <label for="nurse-notes">Triage / Nursing Notes</label>
            <textarea id="nurse-notes" name="notes" maxlength="2000" placeholder="Patient symptoms, triage status, medication administration..."></textarea>
          </div>
          <button class="primary-button" type="submit"><span>Record Vitals</span><span class="button-arrow" aria-hidden="true">→</span></button>
        </form>
      `);

      sections += section('Recent Vitals Logs', '<div class="loading-state"><span class="loader"></span><span>Loading vitals logs</span></div>', true, 'js-nurse-vitals-section');
      sections += section('Patient Consultation & Support Requests', '<div class="loading-state"><span class="loader"></span><span>Loading patient requests</span></div>', true, 'js-staff-requests-section');
    } else if (role === 'patient') {
      sections += `<section class="workspace-section patient-overview-card">
        <figure class="patient-care-photo"><img src="/img/PATIENT%201.jpg" alt="Patient resting in a hospital bed"></figure>
        <div class="patient-overview-content">
          <div class="section-heading"><h2>Care overview</h2></div>
          <div class="patient-metric-grid">
            <div><span class="metric-value">${dashboard.myRecords}</span><span class="metric-label">Medical Records</span></div>
            <div><span class="metric-value">${dashboard.myVitals}</span><span class="metric-label">Vitals Entries</span></div>
            <div><span class="metric-value">${dashboard.myRequests}</span><span class="metric-label">My Requests</span></div>
          </div>
        </div>
      </section>`;
      sections += section('Request a consultation or support', `
        <form id="patient-request-form">
          <div class="error-message hidden" data-error role="alert"></div>
          <div class="field"><label for="patient-subject">Subject</label><input id="patient-subject" name="subject" minlength="2" maxlength="120" placeholder="Appointment, follow-up, or support" required></div>
          <div class="field"><label for="patient-message">Message</label><textarea id="patient-message" name="message" maxlength="2000" placeholder="Tell the care team what you need" required></textarea></div>
          <button class="primary-button" type="submit"><span>Send request</span><span class="button-arrow" aria-hidden="true">→</span></button>
        </form>
      `);
      sections += section('Medical records', '<div class="loading-state"><span class="loader"></span><span>Loading your records</span></div>', true);
      sections += section('Vitals history', '<div class="loading-state"><span class="loader"></span><span>Loading your vitals</span></div>', true);
      sections += section('My consultation and support requests', '<div class="loading-state"><span class="loader"></span><span>Loading your requests</span></div>', true);
    } else if (role === 'manager') {
      sections += section('Team overview', `<div class="metric-row"><div><span class="metric-value">${dashboard.entries}</span><span class="metric-label">Submitted entries</span></div></div>`);
      sections += section('Recent entries', '<div class="loading-state"><span class="loader"></span><span>Loading entries</span></div>', true);
    } else {
      sections += section('New entry', `<form id="create-entry-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field"><label for="entry-title">Title</label><input id="entry-title" name="title" minlength="2" maxlength="120" required></div>
        <div class="field"><label for="entry-notes">Notes <span class="role-pill">Optional</span></label><textarea id="entry-notes" name="notes" maxlength="2000" placeholder="Add any useful details"></textarea></div>
        <button class="primary-button" type="submit"><span>Submit entry</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>`);
      sections += section('Your access', '<p class="empty-state">Your entries are recorded for manager review.</p>');
    }

    if (role === 'admin') {
      sections += section('Backup Actions', `
        <p class="admin-bottom-actions-lede">Restore a snapshot, review deleted roles, or export the current system backup.</p>
        <div class="admin-bottom-action-grid">
          <article class="admin-bottom-action-card restore-action-card">
            <span class="admin-action-kicker">01 / Recovery</span>
            <h3>Restore Backup</h3>
            <p>Select a saved snapshot. The restore workbook will include the restored data and restore history.</p>
            <label for="restore-backup-select">Backup snapshot</label>
            <select id="restore-backup-select" class="restore-select">
              <option value="">Loading available backups...</option>
            </select>
            <button class="btn-restore" id="execute-restore-button" type="button">Restore Backup &amp; Export Excel</button>
            <p class="security-note hidden" data-restore-status role="status"></p>
          </article>
          <article class="admin-bottom-action-card archive-action-card">
            <span class="admin-action-kicker">02 / Audit</span>
            <h3>Deleted Roles Archive</h3>
            <p>Deleted roles remain archived in the backup database. Export the full archive log for review.</p>
            <button class="btn-export-archive" id="export-archived-roles-button" type="button">Export Deleted Roles (.xlsx)</button>
          </article>
          <article class="admin-bottom-action-card current-backup-action-card">
            <span class="admin-action-kicker">03 / Current Snapshot</span>
            <h3>Current Backup Viewer</h3>
            <p>Refresh and display the active backup details, then export its data for offline review.</p>
            <button class="btn-backup" id="current-backup-viewer-button" type="button">View &amp; Export Current Backup (.xlsx)</button>
          </article>
        </div>
      `, true, 'admin-bottom-actions-section');
    }

    app.innerHTML = `<div class="workspace">
      <header class="workspace-head">
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h1>${escapeHtml(dashboard.title)}</h1>
        </div>
        <div class="user-tools">
          ${role === 'admin' ? `
            <a href="/api/admin/report/pdf" target="_blank" rel="noopener noreferrer" class="btn-pdf-view" id="admin-view-pdf-head-btn" title="Open generated hospital report in new tab">
              <span class="btn-pdf-icon" aria-hidden="true">📄</span>
              <span>View PDF Document</span>
            </a>
          ` : ''}
          <div class="identity">
            <span class="identity-name">${escapeHtml(currentUser.username)}</span>
            <span class="role-pill">${roleLabels[role] || role}</span>
          </div>
          <button class="text-button" id="logout-button" type="button">Sign out</button>
        </div>
      </header>
      <div class="workspace-body">${sections}</div>
    </div>`;

    document.querySelector('#logout-button').addEventListener('click', logout);

    if (role === 'admin') {
      document.querySelector('#offline-backup-button')?.addEventListener('click', downloadOfflineBackup);
      document.querySelector('#system-backup-button')?.addEventListener('click', createSystemBackup);
      document.querySelector('#cloud-backup-form')?.addEventListener('submit', createCloudBackup);
      document.querySelector('#create-user-form')?.addEventListener('submit', createUser);
      document.querySelector('#execute-restore-button')?.addEventListener('click', executeSystemRestore);
      document.querySelector('#export-archived-roles-button')?.addEventListener('click', exportArchivedRoles);
      document.querySelector('#current-backup-viewer-button')?.addEventListener('click', executeOneClickBackup);

      loadRoles();
      loadUsers();
      loadActiveBackupDetails();
      loadStaffPatientRequests();
    } else if (role === 'doctor') {
      document.querySelector('#doctor-record-form')?.addEventListener('submit', createDoctorRecord);
      loadDoctorData();
      loadStaffPatientRequests();
    } else if (role === 'nurse') {
      document.querySelector('#nurse-vitals-form')?.addEventListener('submit', createNurseVitals);
      loadNurseData();
      loadStaffPatientRequests();
    } else if (role === 'patient') {
      document.querySelector('#patient-request-form')?.addEventListener('submit', createPatientRequest);
      loadPatientData();
    } else if (role === 'manager') {
      loadEntries();
    } else {
      document.querySelector('#create-entry-form')?.addEventListener('submit', createEntry);
    }
  } catch (error) {
    if (error.message === 'Please sign in.') return showLogin();
    app.innerHTML = `<div class="panel"><div class="error-message" role="alert">${escapeHtml(error.message)}</div><button class="text-button" id="reload-button" type="button">Reload workspace</button></div>`;
    document.querySelector('#reload-button').addEventListener('click', renderWorkspace);
  }
}

async function loadStaffPatientRequests() {
  const container = document.querySelector('.js-staff-requests-section');
  if (!container) return;
  try {
    const { requests } = await api('/api/staff/patient-requests');
    const rows = requests.length
      ? requests.map((r) => `<tr>
          <td><strong>${escapeHtml(r.patient_email)}</strong></td>
          <td><span class="role-tag role-patient">${escapeHtml(r.subject)}</span></td>
          <td>${escapeHtml(r.message)}</td>
          <td>${escapeHtml(r.created_at)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty-state">No patient consultation or support requests submitted yet.</td></tr>';

    container.innerHTML = `<div class="section-heading"><h2>Patient Consultation &amp; Support Requests</h2><span class="section-count">${requests.length} total</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Patient</th><th>Subject</th><th>Message</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (error) {
    container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
  }
}

let cachedActiveRoles = [];

function showTemporaryNotification(message, isError = false) {
  const existing = document.querySelector('#global-temp-toast');
  if (existing) existing.remove();
  const alert = document.createElement('div');
  alert.id = 'global-temp-toast';
  alert.className = 'security-note';
  alert.style.position = 'fixed';
  alert.style.bottom = '24px';
  alert.style.right = '24px';
  alert.style.zIndex = '100000';
  alert.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
  alert.style.backgroundColor = isError ? '#dc2626' : '#16a34a';
  alert.style.color = '#ffffff';
  alert.style.border = 'none';
  alert.style.fontWeight = '700';
  alert.style.fontSize = '13px';
  alert.style.letterSpacing = '0.02em';
  alert.style.padding = '12px 24px';
  alert.style.borderRadius = '6px';
  alert.textContent = message;
  document.body.appendChild(alert);
  setTimeout(() => alert.remove(), 4500);
}

// Safe Delete Confirmation Modal (Prompt: "Are you sure you want to delete?" with YES and NO options)
function showSafeDeleteConfirm({
  title = 'Are you sure you want to delete?',
  description = 'This action will safely archive the item within the system backup data. It will not be permanently expunged or removed.',
  confirmLabel = 'YES',
  cancelLabel = 'NO',
  onYes,
  onNo,
}) {
  document.querySelector('#safe-delete-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'safe-delete-modal';
  modal.className = 'safe-modal-backdrop';
  modal.innerHTML = `
    <div class="safe-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="safe-delete-prompt-title">
      <div class="safe-modal-icon" aria-hidden="true">⚠️</div>
      <h3 id="safe-delete-prompt-title" class="safe-modal-title">${escapeHtml(title)}</h3>
      <p class="safe-modal-desc">${escapeHtml(description)}</p>
      <div class="safe-modal-actions">
        <button type="button" class="btn-modal-yes" id="btn-modal-confirm-yes">${escapeHtml(confirmLabel)}</button>
        <button type="button" class="btn-modal-no" id="btn-modal-confirm-no">${escapeHtml(cancelLabel)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let responded = false;
  const closeModal = () => {
    if (!responded) {
      responded = true;
      modal.remove();
    }
  };

  modal.querySelector('#btn-modal-confirm-yes').addEventListener('click', () => {
    closeModal();
    if (typeof onYes === 'function') onYes();
  });

  modal.querySelector('#btn-modal-confirm-no').addEventListener('click', () => {
    closeModal();
    if (typeof onNo === 'function') onNo();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
      if (typeof onNo === 'function') onNo();
    }
  });

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', handleKey);
      closeModal();
      if (typeof onNo === 'function') onNo();
    }
  };
  window.addEventListener('keydown', handleKey);
}

// Modals for Role Management CRUD
function showAddRoleModal() {
  document.querySelector('#role-action-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'role-action-modal';
  modal.className = 'safe-modal-backdrop';
  modal.innerHTML = `
    <div class="safe-modal-dialog form-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>Add New Role</h3>
        <button type="button" class="btn-modal-close" id="modal-close-x">&times;</button>
      </div>
      <form id="add-role-modal-form">
        <div class="error-message hidden" data-modal-error role="alert"></div>
        <div class="field">
          <label for="new-role-key">Role Key (e.g. radiologist, pharmacist)</label>
          <input id="new-role-key" name="name" type="text" placeholder="e.g. pharmacist" required pattern="[a-zA-Z0-9_-]{2,30}">
        </div>
        <div class="field">
          <label for="new-role-display">Display Name</label>
          <input id="new-role-display" name="display_name" type="text" placeholder="e.g. Hospital Pharmacist" required minlength="2" maxlength="60">
        </div>
        <div class="field">
          <label for="new-role-desc">Description</label>
          <textarea id="new-role-desc" name="description" placeholder="Description of role responsibilities..." rows="2"></textarea>
        </div>
        <div class="field">
          <label for="new-role-perm">Permissions Scope</label>
          <input id="new-role-perm" name="permissions" type="text" placeholder="e.g. Pharmacy & Dispensing" value="Clinical Staff">
        </div>
        <div class="modal-buttons">
          <button type="submit" class="btn-crud-add">ADD</button>
          <button type="button" class="btn-modal-no" id="modal-cancel-btn">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#modal-close-x').addEventListener('click', closeModal);
  modal.querySelector('#modal-cancel-btn').addEventListener('click', closeModal);

  modal.querySelector('#add-role-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = modal.querySelector('[data-modal-error]');
    errDiv.classList.add('hidden');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api('/api/admin/roles', { method: 'POST', body: form });
      closeModal();
      await loadRoles();
      await loadActiveBackupDetails();
      showTemporaryNotification(`Role "${form.display_name}" created successfully.`);
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  });
}

function showModifyRoleModal(role) {
  document.querySelector('#role-action-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'role-action-modal';
  modal.className = 'safe-modal-backdrop';
  modal.innerHTML = `
    <div class="safe-modal-dialog form-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>Modify Role: ${escapeHtml(role.display_name || role.name)}</h3>
        <button type="button" class="btn-modal-close" id="modal-close-x">&times;</button>
      </div>
      <form id="modify-role-modal-form">
        <div class="error-message hidden" data-modal-error role="alert"></div>
        <div class="field">
          <label>Role Key</label>
          <input type="text" value="${escapeHtml(role.name)}" disabled class="disabled-input">
        </div>
        <div class="field">
          <label for="edit-role-display">Display Name</label>
          <input id="edit-role-display" name="display_name" type="text" value="${escapeHtml(role.display_name || '')}" required minlength="2" maxlength="60">
        </div>
        <div class="field">
          <label for="edit-role-desc">Description</label>
          <textarea id="edit-role-desc" name="description" rows="2">${escapeHtml(role.description || '')}</textarea>
        </div>
        <div class="field">
          <label for="edit-role-perm">Permissions Scope</label>
          <input id="edit-role-perm" name="permissions" type="text" value="${escapeHtml(role.permissions || 'Standard Access')}">
        </div>
        <div class="modal-buttons">
          <button type="submit" class="btn-crud-modify">MODIFY</button>
          <button type="button" class="btn-modal-no" id="modal-cancel-btn">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#modal-close-x').addEventListener('click', closeModal);
  modal.querySelector('#modal-cancel-btn').addEventListener('click', closeModal);

  modal.querySelector('#modify-role-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = modal.querySelector('[data-modal-error]');
    errDiv.classList.add('hidden');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/api/admin/roles/${encodeURIComponent(role.id)}`, { method: 'PUT', body: form });
      closeModal();
      await loadRoles();
      await loadActiveBackupDetails();
      showTemporaryNotification(`Role "${form.display_name}" updated successfully.`);
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  });
}

function showModifyUserModal(user) {
  document.querySelector('#role-action-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'role-action-modal';
  modal.className = 'safe-modal-backdrop';

  const roleOpts = (cachedActiveRoles.length > 0 ? cachedActiveRoles : Object.keys(roleLabels).map(k => ({ name: k, display_name: roleLabels[k] })))
    .map(r => `
      <option value="${escapeHtml(r.name)}" ${r.name.toLowerCase() === user.role.toLowerCase() ? 'selected' : ''}>
        ${escapeHtml(r.display_name || r.name)} (${escapeHtml(r.name)})
      </option>
    `).join('');

  modal.innerHTML = `
    <div class="safe-modal-dialog form-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>Modify Account Role</h3>
        <button type="button" class="btn-modal-close" id="modal-close-x">&times;</button>
      </div>
      <form id="modify-user-modal-form">
        <div class="error-message hidden" data-modal-error role="alert"></div>
        <div class="field">
          <label>User Account</label>
          <input type="text" value="${escapeHtml(user.username)}" disabled class="disabled-input">
        </div>
        <div class="field">
          <label for="edit-user-role-select">Assigned Role</label>
          <select id="edit-user-role-select" name="role" required>
            ${roleOpts}
          </select>
        </div>
        <div class="modal-buttons">
          <button type="submit" class="btn-crud-modify">MODIFY</button>
          <button type="button" class="btn-modal-no" id="modal-cancel-btn">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#modal-close-x').addEventListener('click', closeModal);
  modal.querySelector('#modal-cancel-btn').addEventListener('click', closeModal);

  modal.querySelector('#modify-user-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = modal.querySelector('[data-modal-error]');
    errDiv.classList.add('hidden');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: form });
      closeModal();
      await loadUsers();
      await loadRoles();
      showTemporaryNotification(`Account ${user.username} role modified to ${form.role}.`);
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  });
}

// Role Management Loader (CRUD)
async function loadRoles() {
  const container = document.querySelector('.js-roles-section');
  if (!container) return;
  try {
    const { roles, archived_roles } = await api('/api/admin/roles');
    cachedActiveRoles = roles || [];

    // Sync role selector in create-user-form
    const roleSelect = document.querySelector('#new-role');
    if (roleSelect && cachedActiveRoles.length > 0) {
      const currentVal = roleSelect.value;
      roleSelect.innerHTML = cachedActiveRoles.map(r => `
        <option value="${escapeHtml(r.name)}" ${r.name === currentVal ? 'selected' : ''}>
          ${escapeHtml(r.display_name || r.name)}
        </option>
      `).join('');
    }

    const roleRows = roles.length
      ? roles.map((r) => `
        <tr>
          <td><span class="role-tag role-${escapeHtml(r.name)}">${escapeHtml(r.name.toUpperCase())}</span></td>
          <td><strong>${escapeHtml(r.display_name || r.name)}</strong></td>
          <td>${escapeHtml(r.description || 'No description')}</td>
          <td><span class="role-pill">${escapeHtml(r.permissions || 'Standard Access')}</span></td>
          <td><strong>${r.user_count || 0}</strong></td>
          <td>
            <div class="table-action-cell">
              <button class="btn-crud-modify role-btn-modify" type="button" data-modify-role="${r.id}">MODIFY</button>
              <button class="btn-crud-delete role-btn-delete" type="button" data-delete-role="${r.id}" data-role-name="${escapeHtml(r.display_name || r.name)}" ${r.name === 'admin' ? 'disabled title="Admin role cannot be deleted"' : ''}>DELETE</button>
            </div>
          </td>
        </tr>
      `).join('')
      : '<tr><td colspan="6" class="empty-state">No roles found.</td></tr>';

    const archivedList = archived_roles && archived_roles.length
      ? archived_roles.map((a) => `
        <tr>
          <td><span class="archived-pill">${escapeHtml(a.name.toUpperCase())}</span></td>
          <td><strong>${escapeHtml(a.display_name || a.name)}</strong></td>
          <td>${escapeHtml(a.permissions || 'Standard')}</td>
          <td>${escapeHtml(new Date(a.archived_at).toLocaleString())}</td>
          <td><span class="status-dot"></span> Preserved in backup</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="empty-state">No deleted roles yet. Any deleted roles are safely preserved here and in backups.</td></tr>';

    container.innerHTML = `
      <div class="section-heading" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <h2>Role Management</h2>
          <span class="section-count">${roles.length} active roles</span>
        </div>
        <button class="btn-crud-add role-btn-add" id="open-add-role-btn" type="button">ADD</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Role Key</th>
              <th>Display Name</th>
              <th>Description</th>
              <th>Permissions</th>
              <th>Users</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${roleRows}</tbody>
        </table>
      </div>

      <!-- Safely Archived Roles Panel (Data Persistence on Deletion) -->
      <div class="archived-roles-container">
        <div class="archived-roles-heading">
          <h4>📦 Safely Archived Roles (Backup Data Persistence)</h4>
        </div>
        <p class="password-hint" style="margin-bottom:10px;">Deleted roles are retained in the archive and backup records, and are not permanently expunged.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Archived Role</th>
                <th>Display Name</th>
                <th>Permissions</th>
                <th>Archived Date</th>
                <th>Backup Status</th>
              </tr>
            </thead>
            <tbody>${archivedList}</tbody>
          </table>
        </div>
      </div>
    `;

    // Hook ADD button
    container.querySelector('#open-add-role-btn')?.addEventListener('click', showAddRoleModal);
    // Hook MODIFY buttons
    container.querySelectorAll('[data-modify-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rId = Number(btn.dataset.modifyRole);
        const rObj = cachedActiveRoles.find(r => r.id === rId);
        if (rObj) showModifyRoleModal(rObj);
      });
    });

    // Hook DELETE buttons
    container.querySelectorAll('[data-delete-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rId = Number(btn.dataset.deleteRole);
        const rName = btn.dataset.roleName;
        showSafeDeleteConfirm({
          title: 'Are you sure you want to delete?',
          onYes: async () => {
            try {
              await api(`/api/admin/roles/${encodeURIComponent(rId)}`, { method: 'DELETE' });
              await loadRoles();
              await loadActiveBackupDetails();
              showTemporaryNotification(`Role "${rName}" safely archived in backup data.`);
            } catch (err) {
              window.alert(err.message || 'Failed to archive role.');
            }
          },
          onNo: () => {
            // Cancel action immediately (do not delete)
          }
        });
      });
    });

  } catch (error) {
    container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
  }
}

async function copyToClipboard(text, label = 'Content') {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showTemporaryNotification(`${label} copied to clipboard.`);
  } catch (err) {
    window.alert(`Could not copy: ${err.message}`);
  }
}

function showCredentialAuditModal(user) {
  document.querySelector('#credential-audit-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'credential-audit-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-box modal-audit" role="dialog" aria-modal="true" aria-labelledby="audit-modal-title">
      <div class="modal-header">
        <h3 id="audit-modal-title">🔐 Cryptographic Credential Audit</h3>
        <button class="modal-close" id="audit-modal-close-x" type="button" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="infosec-alert-box">
          <strong>Information Security Principle (NIST SP 800-63B &amp; OWASP Zero-Knowledge):</strong><br>
          Plaintext passwords are <strong>NEVER stored</strong> in the database, volatile memory, or logs. Passwords undergo irreversible one-way cryptographic key derivation via <code>scrypt</code> with a unique 128-bit random salt and secret server pepper. It is mathematically and computationally infeasible to reverse this hash into plaintext.
        </div>

        <div class="cred-audit-info-grid">
          <div class="cred-audit-info-item">
            <span class="cred-audit-label">Account Username</span>
            <span class="cred-audit-val">${escapeHtml(user.username)}</span>
          </div>
          <div class="cred-audit-info-item">
            <span class="cred-audit-label">Email Address</span>
            <span class="cred-audit-val">${escapeHtml(user.email || user.username)}</span>
          </div>
          <div class="cred-audit-info-item">
            <span class="cred-audit-label">System Role</span>
            <span class="cred-audit-val"><span class="role-tag role-${escapeHtml(user.role)}">${escapeHtml(roleLabels[user.role] || user.role)}</span></span>
          </div>
          <div class="cred-audit-info-item">
            <span class="cred-audit-label">Plaintext Password Status</span>
            <span class="cred-audit-val"><span class="pwd-status-pill">🛡️ Never Stored (Zero Knowledge)</span></span>
          </div>
        </div>

        <div class="cred-audit-box">
          <div class="cred-audit-box-header">
            <span class="cred-audit-label">Password Hash (scrypt verifier · 64 bytes / 128 hex characters)</span>
            <button type="button" class="btn-copy-tiny" id="modal-copy-hash-btn">Copy Full Hash</button>
          </div>
          <code class="cred-audit-full-code" id="modal-hash-text">${escapeHtml(user.password_hash || 'N/A')}</code>
        </div>

        <div class="cred-audit-box">
          <div class="cred-audit-box-header">
            <span class="cred-audit-label">Cryptographic Salt (Isolated CSPRNG · 16 bytes / 32 hex characters)</span>
            <button type="button" class="btn-copy-tiny" id="modal-copy-salt-btn">Copy Full Salt</button>
          </div>
          <code class="cred-audit-full-code" id="modal-salt-text">${escapeHtml(user.password_salt || 'N/A')}</code>
        </div>

        <div class="cred-audit-box">
          <span class="cred-audit-label">Cryptographic KDF Specifications (RFC 7914 scrypt)</span>
          <div style="font-size:11.5px; color:#475569; margin-top:6px; line-height:1.6;">
            <div>• <strong>Algorithm:</strong> scrypt (Memory-Hard Key Derivation Function)</div>
            <div>• <strong>CPU/Memory Cost (N):</strong> 32,768 (2<sup>15</sup>) — GPU/ASIC brute-force resistant</div>
            <div>• <strong>Block Size (r):</strong> 8</div>
            <div>• <strong>Parallelization (p):</strong> 1</div>
            <div>• <strong>Derived Key Length:</strong> 64 bytes (512 bits)</div>
            <div>• <strong>Defense-in-Depth:</strong> 32+ character server pepper appended prior to hashing</div>
          </div>
        </div>

        <div class="modal-buttons" style="margin-top:16px;">
          <button type="button" class="btn-modal-no" id="audit-modal-close-btn">Close Audit</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#audit-modal-close-x').addEventListener('click', closeModal);
  modal.querySelector('#audit-modal-close-btn').addEventListener('click', closeModal);

  modal.querySelector('#modal-copy-hash-btn')?.addEventListener('click', () => {
    if (user.password_hash) copyToClipboard(user.password_hash, 'Full 128-char password hash');
  });

  modal.querySelector('#modal-copy-salt-btn')?.addEventListener('click', () => {
    if (user.password_salt) copyToClipboard(user.password_salt, 'Full 32-char cryptographic salt');
  });
}

// Accounts Directory & Credential Security Loader
let cachedAdminUsers = [];

async function loadUsers() {
  const container = document.querySelector('.js-users-section') || document.querySelector('.workspace-section.full-width');
  if (!container) return;
  try {
    const { users } = await api('/api/admin/users');
    cachedAdminUsers = users || [];
    container.innerHTML = `
      <div class="section-heading" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <h2>Accounts &amp; Credential Security Directory</h2>
          <span class="section-count">${users.length} total accounts</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <a href="/api/admin/report/pdf" target="_blank" rel="noopener noreferrer" class="btn-pdf-view" id="admin-users-pdf-btn" title="View and download complete credential audit PDF report">
            <span class="btn-pdf-icon" aria-hidden="true">📄</span>
            <span>View PDF Audit Report</span>
          </a>
        </div>
      </div>
      <p class="field-hint" style="margin:2px 0 12px 0; color:#475569;">
        Displaying authenticated emails, usernames, password protection status, and cryptographic scrypt password hashes. Plaintext passwords are never stored under Information Security Zero-Knowledge standards.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Password (Plaintext)</th>
              <th>Password Hash (scrypt)</th>
              <th>Cryptographic Salt</th>
              <th>Role</th>
              <th>Registered</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => `<tr>
              <td><strong>${escapeHtml(u.username)}</strong></td>
              <td><span>${escapeHtml(u.email || u.username)}</span></td>
              <td>
                <span class="pwd-status-pill" title="Information Security Principle: Plaintext passwords are never stored (Zero-Knowledge Architecture / NIST SP 800-63B)">🛡️ Never Stored</span>
                <span class="meta-sub" style="font-size:10px; color:#64748b;">Zero-Knowledge scrypt</span>
              </td>
              <td>
                <div class="hash-cell">
                  <code class="cred-hash-code" title="${escapeHtml(u.password_hash || '')}">${escapeHtml(u.password_hash ? u.password_hash.slice(0, 14) + '...' + u.password_hash.slice(-8) : 'N/A')}</code>
                  <button type="button" class="btn-copy-tiny" data-copy-hash="${escapeHtml(u.password_hash || '')}" title="Copy full 128-char password hash">Copy</button>
                </div>
              </td>
              <td>
                <div class="hash-cell">
                  <code class="cred-salt-code" title="${escapeHtml(u.password_salt || '')}">${escapeHtml(u.password_salt ? u.password_salt.slice(0, 10) + '...' : 'N/A')}</code>
                  <button type="button" class="btn-copy-tiny" data-copy-salt="${escapeHtml(u.password_salt || '')}" title="Copy full 32-char salt">Copy</button>
                </div>
              </td>
              <td><span class="role-tag role-${escapeHtml(u.role)}">${escapeHtml(roleLabels[u.role] || u.role)}</span></td>
              <td><span style="font-size:11px;">${escapeHtml(u.created_at)}</span></td>
              <td>
                <div class="table-action-cell">
                  <button class="btn-crud-audit" type="button" data-audit-user="${u.id}" title="Audit full credentials and Infosec parameters">AUDIT</button>
                  <button class="btn-crud-modify" type="button" data-modify-user="${u.id}" data-username="${escapeHtml(u.username)}" data-role="${escapeHtml(u.role)}">MODIFY</button>
                  <button class="btn-crud-delete" type="button" data-delete-user="${u.id}" data-username="${escapeHtml(u.username)}" ${u.id === currentUser.id ? 'disabled title="You cannot delete your own account"' : ''}>DELETE</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    container.querySelectorAll('[data-audit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uId = Number(btn.dataset.auditUser);
        const user = cachedAdminUsers.find((u) => u.id === uId);
        if (user) showCredentialAuditModal(user);
      });
    });

    container.querySelectorAll('[data-copy-hash]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hash = btn.dataset.copyHash;
        if (hash) copyToClipboard(hash, 'Password hash');
      });
    });

    container.querySelectorAll('[data-copy-salt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const salt = btn.dataset.copySalt;
        if (salt) copyToClipboard(salt, 'Cryptographic salt');
      });
    });

    container.querySelectorAll('[data-modify-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uId = Number(btn.dataset.modifyUser);
        const username = btn.dataset.username;
        const role = btn.dataset.role;
        showModifyUserModal({ id: uId, username, role });
      });
    });

    container.querySelectorAll('[data-delete-user]').forEach((button) => {
      button.addEventListener('click', () => {
        const uId = button.dataset.deleteUser;
        const username = button.dataset.username;
        showSafeDeleteConfirm({
          title: 'Are you sure you want to delete?',
          onYes: async () => {
            try {
              await api(`/api/admin/users/${encodeURIComponent(uId)}`, { method: 'DELETE' });
              await loadUsers();
              await loadRoles();
              await loadActiveBackupDetails();
              showTemporaryNotification(`Account ${username} deleted and archived.`);
            } catch (err) {
              window.alert(err.message || 'Failed to delete account.');
            }
          },
          onNo: () => {
            // Cancel action immediately (do not delete)
          }
        });
      });
    });
  } catch (error) { container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
}

// Backup & Restore Handlers
async function downloadExcel(url, options = {}) {
  const requestOptions = { ...options, credentials: 'same-origin' };
  if (requestOptions.body && typeof requestOptions.body !== 'string' && !(requestOptions.body instanceof Blob)) {
    requestOptions.headers = { ...requestOptions.headers, 'Content-Type': 'application/json' };
    requestOptions.body = JSON.stringify(requestOptions.body);
  }
  const response = await fetch(url, requestOptions);
  if (!response.ok) {
    let message = `The server returned HTTP ${response.status}.`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const filename = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] || 'hospital-export.xlsx';
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return { filename, emailSent: response.headers.get('X-Excel-Email-Status') === 'sent' };
}

async function exportArchivedRoles(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Exporting archive...';
  try {
    const result = await downloadExcel('/api/admin/archived-roles/export.xlsx');
    showTemporaryNotification(result.emailSent ? 'Deleted roles archive exported and emailed to the admin.' : 'Archive exported; the admin email copy could not be sent.');
  } catch (error) {
    window.alert(error.message || 'Could not export the deleted roles archive.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function loadActiveBackupDetails() {
  const container = document.querySelector('#active-backup-content');
  const select = document.querySelector('#restore-backup-select');
  if (!container) return;

  try {
    const data = await api('/api/admin/backups');
    const active = data.active_backup;
    const backups = data.backups || [];
    const archived = data.archived_roles || [];

    if (active) {
      const sizeKb = active.size ? (active.size / 1024).toFixed(1) + ' KB' : '40.0 KB';
      const createdDate = active.created_at ? new Date(active.created_at).toLocaleString() : 'Recent';

      container.innerHTML = `
        <div class="backup-meta-grid">
          <div class="backup-meta-item">
            <span class="meta-label">Active Snapshot File</span>
            <span class="meta-val">${escapeHtml(active.filename || 'app-backup-live-latest.db')}</span>
          </div>
          <div class="backup-meta-item">
            <span class="meta-label">Creation Timestamp</span>
            <span class="meta-val">${escapeHtml(createdDate)}</span>
          </div>
          <div class="backup-meta-item">
            <span class="meta-label">File Size</span>
            <span class="meta-val">${escapeHtml(sizeKb)}</span>
          </div>
          <div class="backup-meta-item">
            <span class="meta-label">Status &amp; Integrity</span>
            <span class="meta-val" style="color:#0284c7;">✓ ${escapeHtml(active.status || 'Active & Operational')}</span>
          </div>
          <div class="backup-meta-item">
            <span class="meta-label">Active Accounts In Backup</span>
            <span class="meta-val">${active.total_users_count || 0} Accounts</span>
          </div>
          <div class="backup-meta-item">
            <span class="meta-label">Safely Persisted Roles</span>
            <span class="meta-val">${(active.total_roles_count || 0) + (active.archived_roles_count || 0)} Total (${active.archived_roles_count || 0} Archived)</span>
          </div>
        </div>

        ${archived.length > 0 ? `
          <section class="backup-archived-roles" aria-label="Deleted roles preserved in active backup">
            <h5 class="backup-archived-roles-title">Safely Preserved Deleted Roles in Active Backup</h5>
            <div class="backup-archived-roles-list">
              ${archived.map(a => `<span class="archived-pill">✓ ${escapeHtml(a.display_name || a.name)} (Archived ${escapeHtml(new Date(a.archived_at).toLocaleDateString())})</span>`).join('')}
            </div>
          </section>
        ` : ''}
      `;
    } else {
      container.innerHTML = `<p class="empty-state">No backups recorded yet. Click "Backup" above to generate an instant snapshot.</p>`;
    }

    if (select) {
      if (backups.length > 0) {
        select.innerHTML = backups.map(b => {
          const bDate = new Date(b.created_at).toLocaleString();
          const bSize = b.size ? (b.size / 1024).toFixed(1) + ' KB' : '';
          const backupName = b.storage === 'AWS S3'
            ? `AWS S3 · ${String(b.filename).replace(/^aws:/, '')}`
            : b.filename;
          return `<option value="${escapeHtml(b.filename)}">${escapeHtml(backupName)} (${bDate} - ${bSize})</option>`;
        }).join('');
      } else {
        select.innerHTML = `<option value="">No backups available to restore</option>`;
      }
    }
  } catch (error) {
    container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
  }
}

async function executeOneClickBackup() {
  const button = document.querySelector('#current-backup-viewer-button');
  const status = document.querySelector('[data-backup-status]');
  if (!button) return;

  button.disabled = true;
  const originalText = button.innerHTML;
  button.innerHTML = '<span>Creating backup &amp; Excel export...</span>';
  if (status) {
    status.textContent = '';
    status.classList.add('hidden');
  }

  try {
    const result = await downloadExcel('/api/admin/backup/export.xlsx', { method: 'POST' });
    if (status) {
      status.textContent = result.emailSent ? 'Backup created, exported and emailed to the admin.' : 'Backup created and exported; the admin email copy could not be sent.';
      status.classList.remove('hidden');
    }
    await loadActiveBackupDetails();
    document.querySelector('#active-backup-viewer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showTemporaryNotification(result.emailSent ? 'Backup Excel file emailed to the admin.' : 'Backup Excel email could not be sent.');
  } catch (error) {
    if (status) {
      status.textContent = `Backup failed: ${error.message}`;
      status.classList.remove('hidden');
    }
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

async function executeSystemRestore() {
  const select = document.querySelector('#restore-backup-select');
  const status = document.querySelector('[data-restore-status]');
  const button = document.querySelector('#execute-restore-button');
  if (!select || !select.value) {
    window.alert('Please select a backup file from the list to restore.');
    return;
  }

  const selectedFile = select.value;

  showSafeDeleteConfirm({
    title: 'Restore system state from this backup?',
    description: 'The selected backup will replace current system data. A safety snapshot of the current state will be created first.',
    confirmLabel: 'RESTORE',
    cancelLabel: 'CANCEL',
    onYes: async () => {
      button.disabled = true;
      button.textContent = 'Restoring...';
      if (status) status.classList.add('hidden');
      try {
        const result = await downloadExcel('/api/admin/restore/export.xlsx', { method: 'POST', body: { filename: selectedFile } });
        if (status) {
          status.textContent = `✓ ${result.message || 'System state successfully restored.'}`;
          status.classList.remove('hidden');
        }
        await loadRoles();
        await loadUsers();
        await loadActiveBackupDetails();
        showTemporaryNotification(result.emailSent ? 'System restored; restoration workbook emailed to the admin.' : 'System restored; admin email copy could not be sent.');
      } catch (err) {
        if (status) {
          status.textContent = `Restore failed: ${err.message}`;
          status.classList.remove('hidden');
        }
      } finally {
        button.disabled = false;
        button.textContent = 'Restore Backup & Export Excel';
      }
    },
    onNo: () => {
      // Cancel restore action immediately
    }
  });
}

async function createUser(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    await api('/api/admin/users', { method: 'POST', body: form });
    event.currentTarget.reset();
    await loadUsers();
    const alert = document.createElement('p');
    alert.className = 'empty-state';
    alert.style.color = '#244834';
    alert.textContent = `Account for ${form.username} created successfully as ${roleLabels[form.role] || form.role}.`;
    event.currentTarget.after(alert);
    setTimeout(() => alert.remove(), 6000);
  } catch (error) { setError(error.message); }
  button.disabled = false;
}

async function createSystemBackup() {
  const button = document.querySelector('#system-backup-button');
  const status = document.querySelector('[data-backup-status]');
  const error = document.querySelector('[data-error]');
  if (!button || !status) return;

  button.disabled = true;
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
  status.classList.add('hidden');

  try {
    const result = await api('/api/admin/backup', { method: 'POST', body: { label: 'manual' } });
    status.textContent = `Encrypted backup emailed to ${result.backup.emailed_to}. A local recovery copy was also created.`;
    status.classList.remove('hidden');
  } catch (error) {
    const backupError = document.querySelector('[data-error]');
    if (backupError) {
      backupError.textContent = error.message;
      backupError.classList.remove('hidden');
    }
  } finally {
    button.disabled = false;
  }
}

async function downloadOfflineBackup() {
  const button = document.querySelector('#offline-backup-button');
  const status = document.querySelector('[data-offline-backup-status]');
  const error = document.querySelector('[data-error]');
  if (!button || !status) return;

  button.disabled = true;
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
  status.classList.add('hidden');

  try {
    const response = await fetch('/api/admin/backup/download', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Backup download failed (HTTP ${response.status}).`);
    }

    const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/i)?.[1]
      || 'healthcare-backup.db.enc';
    const downloadUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    status.textContent = 'Encrypted backup download started. Keep the original SESSION_SECRET to decrypt it.';
    status.classList.remove('hidden');
  } catch (backupError) {
    if (error) {
      error.textContent = backupError.message;
      error.classList.remove('hidden');
    }
  } finally {
    button.disabled = false;
  }
}

async function createCloudBackup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = form.querySelector('[data-cloud-backup-error]');
  const status = form.querySelector('[data-cloud-backup-status]');
  const body = Object.fromEntries(new FormData(form));
  const originalButtonMarkup = button.innerHTML;

  button.disabled = true;
  button.textContent = 'Creating AWS S3 backup...';
  error.classList.add('hidden');
  status.classList.add('hidden');

  try {
    const result = await api('/api/admin/backup/cloud', { method: 'POST', body });
    status.textContent = `Database backup uploaded to AWS S3: ${result.backup.aws.bucket}/${result.backup.aws.key}`;
    status.classList.remove('hidden');
    await loadActiveBackupDetails();
  } catch (backupError) {
    error.textContent = backupError.message;
    error.classList.remove('hidden');
  } finally {
    button.innerHTML = originalButtonMarkup;
    button.disabled = false;
  }
}

// Doctor Loaders & Handlers
async function loadDoctorData() {
  try {
    const [{ patients }, { records }] = await Promise.all([
      api('/api/doctor/patients'),
      api('/api/doctor/records'),
    ]);

    const select = document.querySelector('#doctor-patient-select');
    if (select) {
      select.innerHTML = patients.length
        ? `<option value="">-- Choose a patient --</option>` + patients.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}</option>`).join('')
        : `<option value="">No registered patients yet</option>`;
    }

    const container = document.querySelector('.js-doctor-records-section') || document.querySelector('.workspace-section.full-width');
    if (container) {
      const rows = records.length
        ? records.map((r) => `<tr>
            <td><strong>${escapeHtml(r.patient_email)}</strong></td>
            <td><span class="role-tag role-doctor">${escapeHtml(r.diagnosis)}</span></td>
            <td>${r.prescription ? escapeHtml(r.prescription) : '<em>None</em>'}</td>
            <td>${r.notes ? escapeHtml(r.notes) : '<em>None</em>'}</td>
            <td>${escapeHtml(r.created_at)}</td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="empty-state">No clinical consultations recorded yet.</td></tr>';

      container.innerHTML = `<div class="section-heading"><h2>Consultation Records</h2><span class="section-count">${records.length} records</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Patient</th><th>Diagnosis</th><th>Prescription</th><th>Clinical Notes</th><th>Date</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
  } catch (error) {
    setError(error.message);
  }
}

async function createDoctorRecord(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    await api('/api/doctor/records', { method: 'POST', body: form });
    event.currentTarget.reset();
    await loadDoctorData();
  } catch (error) { setError(error.message); }
  button.disabled = false;
}

// Nurse Loaders & Handlers
async function loadNurseData() {
  try {
    const [{ patients }, { vitals }] = await Promise.all([
      api('/api/nurse/patients'),
      api('/api/nurse/vitals'),
    ]);

    const select = document.querySelector('#nurse-patient-select');
    if (select) {
      select.innerHTML = patients.length
        ? `<option value="">-- Choose a patient --</option>` + patients.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}</option>`).join('')
        : `<option value="">No registered patients yet</option>`;
    }

    const container = document.querySelector('.js-nurse-vitals-section') || document.querySelector('.workspace-section.full-width');
    if (container) {
      const rows = vitals.length
        ? vitals.map((v) => `<tr>
            <td><strong>${escapeHtml(v.patient_email)}</strong></td>
            <td><span class="role-tag role-nurse">${escapeHtml(v.blood_pressure)}</span></td>
            <td>${v.heart_rate ? `${escapeHtml(v.heart_rate)} bpm` : '<em>N/A</em>'}</td>
            <td>${v.temperature ? `${escapeHtml(v.temperature)}` : '<em>N/A</em>'}</td>
            <td>${v.notes ? escapeHtml(v.notes) : '<em>None</em>'}</td>
            <td>${escapeHtml(v.nurse_email)}</td>
            <td>${escapeHtml(v.created_at)}</td>
          </tr>`).join('')
        : '<tr><td colspan="7" class="empty-state">No vitals logs recorded yet.</td></tr>';

      container.innerHTML = `<div class="section-heading"><h2>Recent Vitals Logs</h2><span class="section-count">${vitals.length} logs</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Patient</th><th>Blood Pressure</th><th>Heart Rate</th><th>Temp</th><th>Observations</th><th>Nurse</th><th>Date</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
  } catch (error) {
    setError(error.message);
  }
}

async function createNurseVitals(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    await api('/api/nurse/vitals', { method: 'POST', body: form });
    event.currentTarget.reset();
    await loadNurseData();
  } catch (error) { setError(error.message); }
  button.disabled = false;
}

async function loadPatientData() {
  const containers = document.querySelectorAll('.workspace-section.full-width');
  if (containers.length < 3) return;
  const [recordsContainer, vitalsContainer, requestsContainer] = containers;

  try {
    const [{ records }, { vitals }, { requests }] = await Promise.all([
      api('/api/patient/my-records'),
      api('/api/patient/my-vitals'),
      api('/api/patient/my-requests'),
    ]);
    const recordRows = records.map((record) => `<tr>
      <td>${escapeHtml(record.created_at)}</td>
      <td>${escapeHtml(record.doctor_email)}</td>
      <td><strong>${escapeHtml(record.diagnosis)}</strong></td>
      <td>${escapeHtml(record.prescription || 'None')}</td>
      <td>${escapeHtml(record.notes || 'None')}</td>
    </tr>`).join('');
    recordsContainer.innerHTML = `<div class="section-heading"><h2>Medical records</h2><span class="section-count">${records.length} total</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Doctor</th><th>Diagnosis</th><th>Prescription</th><th>Notes</th></tr></thead>
      <tbody>${recordRows || '<tr><td colspan="5" class="empty-state">No medical records have been added yet.</td></tr>'}</tbody></table></div>`;

    const vitalRows = vitals.map((vital) => `<tr>
      <td>${escapeHtml(vital.created_at)}</td>
      <td>${escapeHtml(vital.blood_pressure)}</td>
      <td>${escapeHtml(vital.heart_rate || 'Not recorded')}</td>
      <td>${escapeHtml(vital.temperature || 'Not recorded')}</td>
      <td>${escapeHtml(vital.nurse_email)}</td>
      <td>${escapeHtml(vital.notes || 'None')}</td>
    </tr>`).join('');
    vitalsContainer.innerHTML = `<div class="section-heading"><h2>Vitals history</h2><span class="section-count">${vitals.length} total</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Blood pressure</th><th>Heart rate</th><th>Temperature</th><th>Recorded by</th><th>Notes</th></tr></thead>
      <tbody>${vitalRows || '<tr><td colspan="6" class="empty-state">No vitals have been recorded yet.</td></tr>'}</tbody></table></div>`;

    const requestRows = requests.map((request) => `<tr>
      <td>${escapeHtml(request.created_at)}</td>
      <td><strong>${escapeHtml(request.subject)}</strong></td>
      <td>${escapeHtml(request.message)}</td>
    </tr>`).join('');
    requestsContainer.innerHTML = `<div class="section-heading"><h2>Consultation and support requests</h2><span class="section-count">${requests.length} total</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Message</th></tr></thead>
      <tbody>${requestRows || '<tr><td colspan="3" class="empty-state">You have not sent any requests yet.</td></tr>'}</tbody></table></div>`;
  } catch (error) {
    setError(error.message);
  }
}

async function createPatientRequest(event) {
  event.preventDefault();
  // currentTarget is only populated while the submit event is dispatching.
  // Keep the form element before awaiting the network request.
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const button = formElement.querySelector('button');
  const error = formElement.querySelector('[data-error]');
  button.disabled = true;
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
  try {
    await api('/api/patient/my-requests', { method: 'POST', body: form });
    formElement.reset();
    await loadPatientData();
  } catch (error) {
    const errorMessage = formElement.querySelector('[data-error]');
    if (errorMessage) {
      errorMessage.textContent = error.message;
      errorMessage.classList.remove('hidden');
    }
  } finally {
    if (button) button.disabled = false;
  }
}

// Manager Loaders
async function loadEntries() {
  const container = document.querySelector('.workspace-section.full-width');
  if (!container) return;
  try {
    const { entries } = await api('/api/manager/entries');
    const body = entries.length ? `<div class="table-wrap"><table><thead><tr><th>Entry</th><th>Submitted by</th><th>Date</th></tr></thead><tbody>${entries.map((entry) => `<tr><td><strong>${escapeHtml(entry.title)}</strong>${entry.notes ? `<br><span class="role-pill">${escapeHtml(entry.notes)}</span>` : ''}</td><td>${escapeHtml(entry.username)}</td><td>${escapeHtml(entry.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-state">No entries have been submitted yet.</p>';
    container.innerHTML = `<div class="section-heading"><h2>Recent entries</h2><span class="section-count">${entries.length} total</span></div>${body}`;
  } catch (error) { container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
}

async function createEntry(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    await api('/api/imputor/entries', { method: 'POST', body: form });
    event.currentTarget.reset();
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = 'Entry submitted successfully.';
    event.currentTarget.after(message);
  } catch (error) { setError(error.message); }
  button.disabled = false;
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* The local view still returns to sign-in. */ }
  showLogin();
}

async function init() {
  try {
    const session = await api('/api/session');
    if (!session.authenticated) return showLogin();
    currentUser = session;
    if (session.stage === 'verify') return showTwoFactorVerify();
    renderWorkspace();
  } catch {
    showLogin();
  }
}

init();
