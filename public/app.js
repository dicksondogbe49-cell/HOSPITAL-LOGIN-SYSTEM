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
    ${intro('Account / Access', 'Your work, in the right hands.', 'Sign in to your workspace with your account credentials. Two-step verification keeps every account protected.')}
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
        <div class="field"><label for="username">Email address</label><input id="username" name="username" type="email" autocomplete="username" required maxlength="254" autofocus></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="6"></div>
        <p class="password-hint">Use the account provided by your workspace administrator.</p>
        <button class="primary-button" type="submit"><span>Continue securely</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
    </section>
  </div>`;
  document.querySelector('#login-form').addEventListener('submit', login);
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
  const verificationEmail = escapeHtml(currentUser?.verificationEmail || 'the configured inbox');
  const fallbackNote = currentUser?.fallbackCode
    ? `Cloud SMTP port blocked on free tier — use verification code: ${escapeHtml(currentUser.fallbackCode)}`
    : '';
  app.innerHTML = `<div class="auth-layout">
    ${intro('Account / Verification', 'Check your email.', `Enter the six-digit sign-in code sent to ${verificationEmail}.`)}
    <section class="panel" aria-labelledby="panel-title">
      <div class="panel-label"><span>Two-step verification</span><span class="step-number">02 / 03</span></div>
      <h2 id="panel-title">Enter your code</h2>
      <p class="panel-lede">A six-digit code was sent to ${verificationEmail}. It expires in five minutes.</p>
      <form id="totp-form">
        <div class="error-message hidden" data-error role="alert"></div>
        <div class="field"><label for="code">Email verification code</label><input class="code-input" id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" value="${currentUser?.fallbackCode ? escapeHtml(currentUser.fallbackCode) : ''}" required autofocus></div>
        <button class="primary-button" type="submit"><span>Verify and continue</span><span class="button-arrow" aria-hidden="true">→</span></button>
      </form>
      <button class="text-button resend-button" id="resend-code" type="button">Resend email code</button>
      <p class="security-note ${fallbackNote ? '' : 'hidden'}" data-status role="status">${fallbackNote}</p>
    </section>
  </div>`;
  document.querySelector('#totp-form').addEventListener('submit', verifyTwoFactor);
  document.querySelector('#resend-code').addEventListener('click', resendEmailCode);
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
      const codeInput = document.querySelector('#code');
      if (codeInput) codeInput.value = result.fallbackCode;
      status.textContent = `Cloud SMTP port blocked on free tier — use verification code: ${result.fallbackCode}`;
    } else {
      status.textContent = `A new code was sent to ${result.verificationEmail || 'the configured inbox'}.`;
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
          <p class="password-hint">Doctor, Nurse, and Patient sign-in codes go to the shared verification inbox.</p>
          <button class="primary-button" type="submit"><span>Create account</span><span class="button-arrow" aria-hidden="true">+</span></button>
        </form>
      `);

      sections += section('System Backup', `
        <div class="error-message hidden" data-error role="alert"></div>
        <p class="password-hint">A local snapshot and encrypted email backup are queued after each successful data change. Download an encrypted copy to this PC for offline storage.</p>
        <button class="primary-button" id="offline-backup-button" type="button"><span>Download offline backup</span><span class="button-arrow" aria-hidden="true">↓</span></button>
        <p class="security-note hidden" data-offline-backup-status role="status"></p>
        <p class="password-hint">Keep the original SESSION_SECRET; it is required to decrypt this backup.</p>
        <div class="form-divider"></div>
        <button class="primary-button" id="system-backup-button" type="button"><span>Email backup now</span><span class="button-arrow" aria-hidden="true">↓</span></button>
        <p class="security-note hidden" data-backup-status role="status"></p>
        <div class="form-divider"></div>
        <form id="cloud-backup-form">
          <div class="error-message hidden" data-cloud-backup-error role="alert"></div>
          <div class="field"><label for="r2-endpoint">Cloudflare R2 endpoint</label><input id="r2-endpoint" name="endpoint" type="url" placeholder="https://account-id.r2.cloudflarestorage.com" required></div>
          <div class="field"><label for="r2-bucket">Bucket name</label><input id="r2-bucket" name="bucket" type="text" autocomplete="off" required></div>
          <div class="field"><label for="r2-access-key">Access key ID</label><input id="r2-access-key" name="accessKeyId" type="text" autocomplete="off" required></div>
          <div class="field"><label for="r2-secret-key">Secret access key</label><input id="r2-secret-key" name="secretAccessKey" type="password" autocomplete="new-password" required></div>
          <p class="password-hint">Credentials are used for this upload only and are not saved by the app.</p>
          <button class="primary-button" type="submit"><span>Backup to Cloudflare</span><span class="button-arrow" aria-hidden="true">↓</span></button>
          <p class="security-note hidden" data-cloud-backup-status role="status"></p>
        </form>
      `);

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

    app.innerHTML = `<div class="workspace">
      <header class="workspace-head">
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h1>${escapeHtml(dashboard.title)}</h1>
        </div>
        <div class="user-tools">
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
      loadUsers();
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

// Admin Loader
async function loadUsers() {
  const container = document.querySelector('.js-users-section') || document.querySelector('.workspace-section.full-width');
  if (!container) return;
  try {
    const { users } = await api('/api/admin/users');
    container.innerHTML = `<div class="section-heading"><h2>Accounts Directory</h2><span class="section-count">${users.length} total</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email Account</th><th>Role</th><th>Registered</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            ${users.map((u) => `<tr>
              <td><strong>${escapeHtml(u.username)}</strong></td>
              <td><span class="role-tag role-${escapeHtml(u.role)}">${escapeHtml(roleLabels[u.role] || u.role)}</span></td>
              <td>${escapeHtml(u.created_at)}</td>
              <td><button class="danger-button" type="button" data-delete-user="${u.id}" data-username="${escapeHtml(u.username)}" ${u.id === currentUser.id ? 'disabled title="You cannot delete your own account"' : ''}>Delete</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    container.querySelectorAll('[data-delete-user]').forEach((button) => {
      button.addEventListener('click', () => deleteUser(button.dataset.deleteUser, button.dataset.username));
    });
  } catch (error) { container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
}

async function deleteUser(id, username) {
  if (!window.confirm(`Delete ${username}? This also removes their sign-in sessions and linked care records. This cannot be undone.`)) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadUsers();
  } catch (error) {
    window.alert(error.message);
  }
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

  button.disabled = true;
  error.classList.add('hidden');
  status.classList.add('hidden');

  try {
    const result = await api('/api/admin/backup/cloud', { method: 'POST', body });
    status.textContent = `Database backup uploaded to Cloudflare R2: ${result.backup.cloudflare.bucket}/${result.backup.cloudflare.key}`;
    status.classList.remove('hidden');
  } catch (backupError) {
    error.textContent = backupError.message;
    error.classList.remove('hidden');
  } finally {
    form.elements.secretAccessKey.value = '';
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
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  clearError();
  try {
    await api('/api/patient/my-requests', { method: 'POST', body: form });
    event.currentTarget.reset();
    await loadPatientData();
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
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
