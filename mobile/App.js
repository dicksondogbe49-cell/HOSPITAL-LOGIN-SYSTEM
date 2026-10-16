import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const TOKEN_KEY = 'hospital.session';
const BASE_URL_KEY = 'hospital.apiUrl';
const ROLES = ['admin', 'doctor', 'nurse', 'patient', 'manager', 'imputor'];
const LABELS = { admin: 'Administrator', doctor: 'Doctor', nurse: 'Nurse', patient: 'Patient', manager: 'Manager', imputor: 'Imputor' };
const COLORS = { navy: '#12324a', blue: '#0879ad', pale: '#eff6f9', ink: '#172b3a', muted: '#657b8a', line: '#dbe5eb', green: '#16834b', red: '#c52d36', white: '#ffffff' };

function localDefaultUrl() {
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

function b64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | (second >> 4)];
    result += hasSecond ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    result += hasThird ? alphabet[third & 63] : '=';
  }
  return result;
}

function errorMessage(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(localDefaultUrl());
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [authStage, setAuthStage] = useState('loading');
  const [authInfo, setAuthInfo] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStep, setResetStep] = useState(1);
  const [screen, setScreen] = useState('Home');
  const [data, setData] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const api = useCallback(async (path, options = {}) => {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.resetToken ? { 'X-Password-Reset-Token': options.resetToken } : {}), ...(options.mobile ? { 'X-Mobile-Client': 'expo' } : {}), ...options.headers };
    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined });
    } catch {
      throw new Error(`Cannot reach ${baseUrl}. Set the API address to your computer's network URL and confirm the server is running.`);
    }
    if (options.raw) {
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Request failed (${response.status}).`);
      }
      return response;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }, [baseUrl, token]);

  const acceptAuth = useCallback(async (result) => {
    if (result.sessionToken) {
      await SecureStore.setItemAsync(TOKEN_KEY, result.sessionToken);
      setToken(result.sessionToken);
    }
    setAuthInfo(result);
    setAuthStage(result.stage === 'verify' ? 'verify' : 'app');
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const storedUrl = await SecureStore.getItemAsync(BASE_URL_KEY);
        if (storedUrl) setBaseUrl(storedUrl);
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (storedToken) {
          setToken(storedToken);
          const response = await fetch(`${(storedUrl || localDefaultUrl()).replace(/\/$/, '')}/api/session`, { headers: { Authorization: `Bearer ${storedToken}` } });
          const session = await response.json();
          if (session.authenticated) {
            if (session.stage === 'verify') {
              setAuthInfo(session);
              setAuthStage('verify');
            } else {
              setUser(session);
              setAuthStage('app');
            }
          } else {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            setAuthStage('login');
          }
        } else setAuthStage('login');
      } catch { setAuthStage('login'); }
    })();
  }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    setError('');
    try {
      const dashboard = await api('/api/dashboard');
      const next = { dashboard };
      if (user.role === 'admin') {
        const [users, roles, backups, requests] = await Promise.all([
          api('/api/admin/users'), api('/api/admin/roles'), api('/api/admin/backups'), api('/api/staff/patient-requests'),
        ]);
        Object.assign(next, { users: users.users || [], roles: roles.roles || [], archivedRoles: roles.archived_roles || [], backups, requests: requests.requests || [] });
      } else if (user.role === 'doctor') {
        const [patients, records, requests] = await Promise.all([api('/api/doctor/patients'), api('/api/doctor/records'), api('/api/staff/patient-requests')]);
        Object.assign(next, { patients: patients.patients || [], records: records.records || [], requests: requests.requests || [] });
      } else if (user.role === 'nurse') {
        const [patients, vitals, requests] = await Promise.all([api('/api/nurse/patients'), api('/api/nurse/vitals'), api('/api/staff/patient-requests')]);
        Object.assign(next, { patients: patients.patients || [], vitals: vitals.vitals || [], requests: requests.requests || [] });
      } else if (user.role === 'patient') {
        const [records, vitals, requests] = await Promise.all([api('/api/patient/my-records'), api('/api/patient/my-vitals'), api('/api/patient/my-requests')]);
        Object.assign(next, { records: records.records || [], vitals: vitals.vitals || [], requests: requests.requests || [] });
      } else if (user.role === 'manager') {
        const entries = await api('/api/manager/entries');
        next.entries = entries.entries || [];
      }
      setData(next);
    } catch (loadError) { setError(errorMessage(loadError)); }
  }, [api, user]);

  useEffect(() => { if (authStage === 'app' && user) loadData(); }, [authStage, user, loadData]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const action = useCallback(async (label, path, options = {}) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(path, options);
      setNotice(result.message || `${label} completed.`);
      await loadData();
      return result;
    } catch (actionError) { setError(errorMessage(actionError)); return null; }
    finally { setBusy(false); }
  }, [api, loadData]);

  const saveApiUrl = async (value) => {
    const next = value.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(next)) { setError('Enter an address beginning with http:// or https://'); return; }
    await SecureStore.setItemAsync(BASE_URL_KEY, next);
    if (next !== baseUrl) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setToken(null); setUser(null); setAuthStage('login');
    }
    setBaseUrl(next); setError(''); setNotice('Server address saved.');
  };

  const signOut = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* Clear the locally held token even if offline. */ }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null); setUser(null); setData({}); setAuthInfo(null); setScreen('Home'); setAuthStage('login');
  };

  const exportWorkbook = async (path, options = {}) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api(path, { ...options, raw: true });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const filename = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'hospital-export.xlsx';
      const fileUri = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, b64(bytes), { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Save or share Excel backup' });
      const emailSent = response.headers.get('X-Excel-Email-Status') === 'sent';
      setNotice(`${filename} is ready to save or share.${emailSent ? ' A copy was emailed to the admin.' : ' The admin email copy could not be sent.'}`);
      return true;
    } catch (exportError) { setError(errorMessage(exportError)); return false; }
    finally { setBusy(false); }
  };

  if (authStage === 'loading') return <Centered><ActivityIndicator size="large" color={COLORS.blue} /><Text style={styles.muted}>Connecting securely…</Text></Centered>;
  if (authStage === 'verify') return <AuthLayout title="Verify your email" subtitle={`Enter the six digit code sent to ${authInfo?.verificationEmail || authInfo?.username || 'your email'}.`} error={error}>
    <FormField label="Verification code" value={authInfo?.fallbackCode || ''} onChangeText={(value) => setAuthInfo({ ...authInfo, fallbackCode: value })} keyboardType="number-pad" placeholder="000000" maxLength={6} />
    {authInfo?.fallbackCode ? <Text style={styles.note}>Development fallback code is shown above.</Text> : null}
    <Button title="Verify and continue" loading={busy} onPress={async () => {
      setBusy(true); setError('');
      try { await api('/api/2fa/verify', { method: 'POST', body: { code: authInfo?.fallbackCode || '' } }); const session = await api('/api/session'); setUser(session); setAuthStage('app'); }
      catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }} />
    <Button title="Resend code" variant="quiet" onPress={async () => { const result = await action('Code resent', '/api/2fa/resend', { method: 'POST' }); if (result?.fallbackCode) setAuthInfo({ ...authInfo, fallbackCode: result.fallbackCode }); }} />
    <Button title="Use a different account" variant="quiet" onPress={signOut} />
  </AuthLayout>;

  if (authStage === 'reset') return <PasswordReset api={api} resetToken={resetToken} setResetToken={setResetToken} resetEmail={resetEmail} setResetEmail={setResetEmail} resetStep={resetStep} setResetStep={setResetStep} baseUrl={baseUrl} onBack={() => { setAuthStage('login'); setError(''); }} error={error} setError={setError} notice={notice} setNotice={setNotice} />;

  if (authStage === 'login' || authStage === 'register') return <LoginScreen mode={authStage} setMode={setAuthStage} baseUrl={baseUrl} onSaveApiUrl={saveApiUrl} api={api} onAuth={async (result) => {
    await acceptAuth(result);
    if (result.stage !== 'verify') { const session = await api('/api/session'); setUser(session); setAuthStage('app'); }
  }} setError={setError} error={error} busy={busy} setBusy={setBusy} onForgot={() => { setResetStep(1); setAuthStage('reset'); setError(''); }} />;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" backgroundColor={COLORS.navy} />
    <View style={styles.header}>
      <View><Text style={styles.brand}>HOSPITAL PORTAL</Text><Text style={styles.headerTitle}>{LABELS[user?.role] || 'Workspace'}</Text></View>
      <Pressable onPress={signOut} style={styles.headerSignout}><Text style={styles.headerSignoutText}>Sign out</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.blue} />} keyboardShouldPersistTaps="handled">
      <Text style={styles.greeting}>{user?.username}</Text>
      <Text style={styles.pageSubtitle}>{data.dashboard?.subtitle || 'Your secure hospital workspace'}</Text>
      {error ? <Banner text={error} tone="error" /> : null}
      {notice ? <Banner text={notice} tone="success" /> : null}
      {screen === 'Home' ? <HomeScreen user={user} data={data} /> : null}
      {screen === 'Records' ? <RecordsScreen user={user} data={data} /> : null}
      {screen === 'Actions' ? <ActionsScreen user={user} data={data} api={api} action={action} exportWorkbook={exportWorkbook} busy={busy} /> : null}
      {screen === 'Settings' ? <SettingsScreen user={user} baseUrl={baseUrl} onSave={saveApiUrl} signOut={signOut} /> : null}
    </ScrollView>
    <View style={styles.tabBar}>
      {['Home', 'Records', 'Actions', 'Settings'].map((tab) => <Pressable key={tab} style={[styles.tab, screen === tab && styles.tabActive]} onPress={() => { setScreen(tab); setError(''); }}><Text style={[styles.tabText, screen === tab && styles.tabTextActive]}>{tab}</Text></Pressable>)}
    </View>
  </SafeAreaView>;
}

function Centered({ children }) { return <SafeAreaView style={[styles.safe, styles.centered]}>{children}</SafeAreaView>; }

function AuthLayout({ title, subtitle, error, children }) {
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authRoot}><ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
    <View style={styles.authMark}><Text style={styles.authMarkText}>+</Text></View>
    <Text style={styles.brandAuth}>SECURE HOSPITAL PORTAL</Text><Text style={styles.authTitle}>{title}</Text><Text style={styles.authSubtitle}>{subtitle}</Text>
    {error ? <Banner text={error} tone="error" /> : null}<View style={styles.authCard}>{children}</View>
  </ScrollView></KeyboardAvoidingView>;
}

function LoginScreen({ mode, setMode, baseUrl, onSaveApiUrl, api, onAuth, error, setError, busy, setBusy, onForgot }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState('patient'); const [confirm, setConfirm] = useState('');
  const [serverUrl, setServerUrl] = useState(baseUrl);
  useEffect(() => setServerUrl(baseUrl), [baseUrl]);
  const register = mode === 'register';
  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (register && password !== confirm) throw new Error('Passwords do not match.');
      if (register && role === 'admin') throw new Error('Administrator accounts cannot self-register.');
      const result = await api(register ? '/api/register' : '/api/login', { method: 'POST', body: { username: username.trim(), password, role }, mobile: true });
      await onAuth(result);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <AuthLayout title={register ? 'Create your account' : 'Welcome back'} subtitle={register ? 'Register with your email and verify it to activate your workspace.' : 'Choose your role and sign in to continue securely.'} error={error}>
    <Text style={styles.fieldLabel}>Role</Text><View style={styles.roleWrap}>{ROLES.filter((item) => !register || item !== 'admin').map((item) => <Pressable key={item} onPress={() => setRole(item)} style={[styles.roleChip, role === item && styles.roleChipSelected]}><Text style={[styles.roleChipText, role === item && styles.roleChipTextSelected]}>{LABELS[item]}</Text></Pressable>)}</View>
    <FormField label="Email address" value={username} onChangeText={setUsername} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" />
    <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 6 characters" />
    {register ? <FormField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Repeat your password" /> : null}
    <Button title={register ? 'Register & verify email' : 'Continue securely'} loading={busy} onPress={submit} />
    {!register ? <Button title="Forgot password?" variant="quiet" onPress={onForgot} /> : null}
    <Button title={register ? 'Already registered? Sign in' : 'New here? Create an account'} variant="quiet" onPress={() => { setError(''); setMode(register ? 'login' : 'register'); }} />
    <View style={styles.divider} /><Text style={styles.fieldLabel}>Backend server address</Text><FormField label="API address" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://your-app.onrender.com" /><Button title="Save server address" variant="quiet" onPress={() => onSaveApiUrl(serverUrl)} /><Text style={styles.note}>Android emulator: 10.0.2.2:3000 · Physical phone: your computer's LAN IP · Hosted app: HTTPS URL</Text>
  </AuthLayout>;
}

function PasswordReset({ api, resetToken, setResetToken, resetEmail, setResetEmail, resetStep, setResetStep, error, setError, notice, setNotice, onBack }) {
  const [email, setEmail] = useState(resetEmail); const [code, setCode] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  const resendCode = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/forgot-password/resend', { method: 'POST', resetToken });
      if (result.fallbackCode) setCode(result.fallbackCode);
      setNotice(result.fallbackCode ? 'A new reset code is ready.' : 'A new reset code has been sent to your email.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (resetStep === 1) {
        const result = await api('/api/forgot-password', { method: 'POST', body: { email }, mobile: true });
        if (!result.resetToken) { setNotice('If that address has a verified account, a reset code has been sent. Check the inbox and try again in a moment.'); return; }
        setResetToken(result.resetToken); setResetEmail(email); setCode(result.fallbackCode || ''); setResetStep(2);
      } else if (resetStep === 2) {
        await api('/api/forgot-password/verify', { method: 'POST', body: { code }, resetToken }); setResetStep(3);
      } else {
        if (password !== confirm) throw new Error('Passwords do not match.');
        await api('/api/forgot-password/reset', { method: 'POST', body: { password }, resetToken });
        setResetStep(1); onBack(); Alert.alert('Password updated', 'You can now sign in with your new password.');
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <AuthLayout title="Reset password" subtitle="Verify your email address to set a new password." error={error}>
    {resetStep === 1 ? <FormField label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" /> : null}
    {resetStep === 2 ? <FormField label="Six digit reset code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} /> : null}
    {resetStep === 3 ? <><FormField label="New password" value={password} onChangeText={setPassword} secureTextEntry /><FormField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry /></> : null}
    <Button title={['Send reset code', 'Verify code', 'Update password'][resetStep - 1]} onPress={submit} loading={busy} />{resetStep === 2 ? <Button title="Resend reset code" variant="quiet" onPress={resendCode} loading={busy} /> : null}<Button title="Back to sign in" variant="quiet" onPress={onBack} />{notice ? <Banner text={notice} tone="success" /> : null}
  </AuthLayout>;
}

function FormField({ label, ...props }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor="#93a4af" style={styles.input} autoCorrect={false} {...props} /></View>;
}

function Button({ title, onPress, variant = 'primary', loading = false, disabled = false, style }) {
  return <Pressable disabled={loading || disabled} onPress={onPress} style={({ pressed }) => [styles.button, variant === 'quiet' && styles.quietButton, variant === 'danger' && styles.dangerButton, variant === 'success' && styles.successButton, (loading || disabled) && styles.buttonDisabled, pressed && styles.buttonPressed, style]}>
    {loading ? <ActivityIndicator color={variant === 'quiet' ? COLORS.blue : COLORS.white} /> : <Text style={[styles.buttonText, variant === 'quiet' && styles.quietButtonText]}>{title}</Text>}
  </Pressable>;
}

function Banner({ text, tone = 'success' }) { return <View style={[styles.banner, tone === 'error' ? styles.bannerError : styles.bannerSuccess]}><Text style={styles.bannerText}>{text}</Text></View>; }

function Card({ title, count, children, style }) {
  return <View style={[styles.card, style]}><View style={styles.cardHeading}><Text style={styles.cardTitle}>{title}</Text>{count !== undefined ? <Text style={styles.cardCount}>{count}</Text> : null}</View>{children}</View>;
}

function Metric({ label, value }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value ?? '—'}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }

function HomeScreen({ user, data }) {
  const d = data.dashboard || {};
  const metrics = user?.role === 'admin' ? [['Accounts', d.totalUsers], ['Doctors', d.doctors], ['Nurses', d.nurses], ['Patients', d.patients], ['Records', d.records], ['Vitals', d.vitals]]
    : user?.role === 'doctor' ? [['My records', d.myRecords], ['Patients', d.totalPatients], ['Care requests', d.patientRequests]]
      : user?.role === 'nurse' ? [['Vitals logged', d.myVitals], ['Patients', d.totalPatients], ['Care requests', d.patientRequests]]
        : user?.role === 'patient' ? [['Medical records', d.myRecords], ['Vitals entries', d.myVitals], ['My requests', d.myRequests]]
          : [['Team entries', d.entries ?? data.entries?.length ?? 0]];
  return <><View style={styles.hero}><Text style={styles.heroKicker}>YOUR WORKSPACE</Text><Text style={styles.heroTitle}>{d.title || 'Hospital Portal'}</Text><Text style={styles.heroSubtitle}>{d.subtitle || 'Your secure hospital workspace.'}</Text></View>
    <View style={styles.metricGrid}>{metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</View>
    {user?.role === 'admin' ? <Card title="System status"><Text style={styles.bodyText}>Role based access is active. Pull down to refresh the latest dashboard, account, and backup data.</Text></Card> : null}
    {user?.role === 'doctor' ? <Card title="Patient directory" count={data.patients?.length || 0}>{(data.patients || []).slice(0, 8).map((p) => <Text style={styles.listLine} key={p.id}><Text style={styles.bold}>#{p.id}</Text>  {p.username}</Text>)}</Card> : null}
    {user?.role === 'nurse' ? <Card title="Patient directory" count={data.patients?.length || 0}>{(data.patients || []).slice(0, 8).map((p) => <Text style={styles.listLine} key={p.id}><Text style={styles.bold}>#{p.id}</Text>  {p.username}</Text>)}</Card> : null}
    {user?.role === 'admin' || user?.role === 'doctor' || user?.role === 'nurse' ? <Card title="Care team requests" count={data.requests?.length || 0}>{(data.requests || []).slice(0, 5).map((r) => <Text style={styles.listLine} key={r.id}><Text style={styles.bold}>{r.subject}</Text>{` · ${r.patient_email}`}</Text>)}{!data.requests?.length ? <Text style={styles.muted}>No requests yet.</Text> : null}</Card> : null}
  </>;
}

function RecordsScreen({ user, data }) {
  if (user?.role === 'doctor') return <Card title="Consultation records" count={data.records?.length || 0}>{(data.records || []).map((item) => <RecordItem key={item.id} title={item.diagnosis} subtitle={`${item.patient_email} · ${item.created_at}`} detail={`${item.prescription || 'No prescription'}${item.notes ? `\n${item.notes}` : ''}`} />)}{!data.records?.length ? <Text style={styles.muted}>No consultations have been recorded.</Text> : null}</Card>;
  if (user?.role === 'nurse') return <Card title="Vitals log" count={data.vitals?.length || 0}>{(data.vitals || []).map((item) => <RecordItem key={item.id} title={`${item.patient_email} · ${item.blood_pressure}`} subtitle={`${item.created_at} · ${item.nurse_email}`} detail={`Heart rate: ${item.heart_rate || '—'} bpm   Temperature: ${item.temperature || '—'}\n${item.notes || ''}`} />)}{!data.vitals?.length ? <Text style={styles.muted}>No vitals have been recorded.</Text> : null}</Card>;
  if (user?.role === 'patient') return <><Card title="Medical records" count={data.records?.length || 0}>{(data.records || []).map((item) => <RecordItem key={item.id} title={item.diagnosis} subtitle={`${item.doctor_email} · ${item.created_at}`} detail={`${item.prescription || 'No prescription'}${item.notes ? `\n${item.notes}` : ''}`} />)}{!data.records?.length ? <Text style={styles.muted}>No medical records yet.</Text> : null}</Card><Card title="Vitals history" count={data.vitals?.length || 0}>{(data.vitals || []).map((item) => <RecordItem key={item.id} title={`${item.blood_pressure} · ${item.heart_rate || '—'} bpm`} subtitle={`${item.created_at} · ${item.nurse_email}`} detail={`Temperature: ${item.temperature || '—'}\n${item.notes || ''}`} />)}{!data.vitals?.length ? <Text style={styles.muted}>No vitals have been recorded.</Text> : null}</Card><Card title="My care requests" count={data.requests?.length || 0}>{(data.requests || []).map((item) => <RecordItem key={item.id} title={item.subject} subtitle={item.created_at} detail={item.message} />)}{!data.requests?.length ? <Text style={styles.muted}>You have not sent a request.</Text> : null}</Card></>;
  if (user?.role === 'manager') return <Card title="Recent team entries" count={data.entries?.length || 0}>{(data.entries || []).map((item) => <RecordItem key={item.id} title={item.title} subtitle={`${item.username} · ${item.created_at}`} detail={item.notes || 'No notes'} />)}{!data.entries?.length ? <Text style={styles.muted}>No entries to review.</Text> : null}</Card>;
  if (user?.role === 'admin') return <><Card title="Account directory" count={data.users?.length || 0}>{(data.users || []).map((item) => <RecordItem key={item.id} title={item.username} subtitle={`${LABELS[item.role] || item.role} · ${item.created_at}`} />)}</Card><Card title="Active roles" count={data.roles?.length || 0}>{(data.roles || []).map((item) => <RecordItem key={item.id} title={item.display_name || item.name} subtitle={`${item.name} · ${item.user_count || 0} accounts`} detail={item.description} />)}</Card><Card title="Archived roles" count={data.archivedRoles?.length || 0}>{(data.archivedRoles || []).map((item) => <RecordItem key={item.id} title={item.display_name || item.name} subtitle={`Archived ${item.archived_at} · ${item.archived_by}`} detail={item.archive_reason || item.description} />)}{!data.archivedRoles?.length ? <Text style={styles.muted}>No archived roles.</Text> : null}</Card></>;
  return <Card title="Your access"><Text style={styles.bodyText}>Submit operational entries from the Actions tab. Managers can review submitted entries.</Text></Card>;
}

function RecordItem({ title, subtitle, detail }) { return <View style={styles.record}><Text style={styles.recordTitle}>{title}</Text>{subtitle ? <Text style={styles.recordSubtitle}>{subtitle}</Text> : null}{detail ? <Text style={styles.recordDetail}>{detail}</Text> : null}</View>; }

function ActionsScreen({ user, data, api, action, exportWorkbook, busy }) {
  const role = user?.role;
  if (role === 'doctor') return <DoctorActions patients={data.patients || []} action={action} busy={busy} />;
  if (role === 'nurse') return <NurseActions patients={data.patients || []} action={action} busy={busy} />;
  if (role === 'patient') return <PatientActions action={action} busy={busy} />;
  if (role === 'manager') return <Card title="Team review"><Text style={styles.bodyText}>Your manager access is read only. Open Records to review submitted work.</Text></Card>;
  if (role === 'imputor') return <ImputorActions action={action} busy={busy} />;
  if (role === 'admin') return <AdminActions user={user} api={api} data={data} action={action} exportWorkbook={exportWorkbook} busy={busy} />;
  return null;
}

function DoctorActions({ patients, action, busy }) {
  const [id, setId] = useState(''); const [diagnosis, setDiagnosis] = useState(''); const [prescription, setPrescription] = useState(''); const [notes, setNotes] = useState('');
  return <><Card title="New consultation"><Text style={styles.note}>Choose a patient ID from the directory:</Text><View style={styles.choiceWrap}>{patients.map((p) => <Pressable key={p.id} style={[styles.roleChip, String(p.id) === id && styles.roleChipSelected]} onPress={() => setId(String(p.id))}><Text style={[styles.roleChipText, String(p.id) === id && styles.roleChipTextSelected]}>#{p.id} {p.username}</Text></Pressable>)}</View><FormField label="Diagnosis" value={diagnosis} onChangeText={setDiagnosis} placeholder="Diagnosis" /><FormField label="Prescription" value={prescription} onChangeText={setPrescription} placeholder="Optional" /><FormField label="Clinical notes" value={notes} onChangeText={setNotes} multiline placeholder="Consultation notes" /><Button title="Save consultation" loading={busy} onPress={async () => { if (!id || !diagnosis.trim()) return Alert.alert('Missing details', 'Select a patient and enter a diagnosis.'); const result = await action('Consultation saved', '/api/doctor/records', { method: 'POST', body: { patient_id: id, diagnosis, prescription, notes } }); if (result) { setDiagnosis(''); setPrescription(''); setNotes(''); } }} /></Card><Card title="Requests from patients" count={patients.length}><Text style={styles.bodyText}>Review consultation and support requests on the Home tab.</Text></Card></>;
}

function NurseActions({ patients, action, busy }) {
  const [id, setId] = useState(''); const [bp, setBp] = useState(''); const [heart, setHeart] = useState(''); const [temp, setTemp] = useState(''); const [notes, setNotes] = useState('');
  return <Card title="Record patient vitals"><Text style={styles.note}>Select a patient from the directory:</Text><View style={styles.choiceWrap}>{patients.map((p) => <Pressable key={p.id} style={[styles.roleChip, String(p.id) === id && styles.roleChipSelected]} onPress={() => setId(String(p.id))}><Text style={[styles.roleChipText, String(p.id) === id && styles.roleChipTextSelected]}>#{p.id} {p.username}</Text></Pressable>)}</View><FormField label="Blood pressure" value={bp} onChangeText={setBp} placeholder="120/80" /><FormField label="Heart rate (bpm)" value={heart} onChangeText={setHeart} keyboardType="number-pad" placeholder="Optional" /><FormField label="Temperature" value={temp} onChangeText={setTemp} keyboardType="decimal-pad" placeholder="Optional" /><FormField label="Triage notes" value={notes} onChangeText={setNotes} multiline placeholder="Notes" /><Button title="Save vitals" loading={busy} onPress={async () => { if (!id || !bp.trim()) return Alert.alert('Missing details', 'Select a patient and enter blood pressure.'); const result = await action('Vitals saved', '/api/nurse/vitals', { method: 'POST', body: { patient_id: id, blood_pressure: bp, heart_rate: heart, temperature: temp, notes } }); if (result) { setBp(''); setHeart(''); setTemp(''); setNotes(''); } }} /></Card>;
}

function PatientActions({ action, busy }) {
  const [subject, setSubject] = useState(''); const [message, setMessage] = useState('');
  return <Card title="Request care team support"><FormField label="Subject" value={subject} onChangeText={setSubject} placeholder="Appointment, follow-up, or support" maxLength={120} /><FormField label="Message" value={message} onChangeText={setMessage} multiline placeholder="Tell the care team what you need" maxLength={2000} /><Button title="Send request" loading={busy} onPress={async () => { if (subject.trim().length < 2 || !message.trim()) return Alert.alert('Missing details', 'Enter a subject and message.'); const result = await action('Request sent', '/api/patient/my-requests', { method: 'POST', body: { subject, message } }); if (result) { setSubject(''); setMessage(''); } }} /></Card>;
}

function ImputorActions({ action, busy }) {
  const [title, setTitle] = useState(''); const [notes, setNotes] = useState('');
  return <Card title="Submit an operational entry"><FormField label="Entry title" value={title} onChangeText={setTitle} maxLength={120} /><FormField label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="Optional details" /><Button title="Submit entry" loading={busy} onPress={async () => { if (title.trim().length < 2) return Alert.alert('Missing details', 'Enter an entry title.'); const result = await action('Entry submitted', '/api/imputor/entries', { method: 'POST', body: { title, notes } }); if (result) { setTitle(''); setNotes(''); } }} /></Card>;
}

function AdminActions({ user, api, data, action, exportWorkbook, busy }) {
  const [accountEmail, setAccountEmail] = useState(''); const [accountPassword, setAccountPassword] = useState(''); const [accountRole, setAccountRole] = useState('doctor');
  const [roleName, setRoleName] = useState(''); const [displayName, setDisplayName] = useState(''); const [description, setDescription] = useState(''); const [permissions, setPermissions] = useState('Clinical Staff'); const [snapshot, setSnapshot] = useState(''); const [selectedAccount, setSelectedAccount] = useState(null); const [newAccountRole, setNewAccountRole] = useState('');
  const [editingRole, setEditingRole] = useState(null); const [editDisplayName, setEditDisplayName] = useState(''); const [editDescription, setEditDescription] = useState(''); const [editPermissions, setEditPermissions] = useState('');
  const backups = data.backups?.backups || [];
  const createAccount = async () => { if (!accountEmail.trim() || accountPassword.length < 6) return Alert.alert('Check account details', 'Enter a valid email and a password of at least 6 characters.'); const result = await action('Account created', '/api/admin/users', { method: 'POST', body: { username: accountEmail, password: accountPassword, role: accountRole } }); if (result) { setAccountEmail(''); setAccountPassword(''); } };
  const createRole = async () => { if (!roleName.trim() || !displayName.trim()) return Alert.alert('Check role details', 'Enter a role key and display name.'); const result = await action('Role created', '/api/admin/roles', { method: 'POST', body: { name: roleName, display_name: displayName, description, permissions } }); if (result) { setRoleName(''); setDisplayName(''); setDescription(''); } };
  return <>
    <Card title="Backup and recovery">
      <Text style={styles.note}>{data.backups?.active_backup ? `Active snapshot: ${data.backups.active_backup.filename} · ${data.backups.active_backup.status}` : 'Active snapshot details will appear here.'}</Text>
      <Button title="Create & export current backup" loading={busy} onPress={() => exportWorkbook('/api/admin/backup/export.xlsx', { method: 'POST' })} />
      <Button title="Export deleted roles archive" variant="success" loading={busy} onPress={() => exportWorkbook('/api/admin/archived-roles/export.xlsx')} />
      <FormField label="Select backup to restore" value={snapshot} onChangeText={setSnapshot} placeholder={backups.map((item) => item.filename).join('\n') || 'Enter a backup filename'} />
      {backups.length ? <View style={styles.choiceWrap}>{backups.map((item) => <Pressable key={item.filename} style={[styles.roleChip, snapshot === item.filename && styles.roleChipSelected]} onPress={() => setSnapshot(item.filename)}><Text style={[styles.roleChipText, snapshot === item.filename && styles.roleChipTextSelected]}>{item.filename}</Text></Pressable>)}</View> : null}
      <Button title="Restore selected backup & export report" variant="danger" loading={busy} onPress={() => { if (!snapshot.trim()) return Alert.alert('Select a backup', 'Choose a saved snapshot to restore.'); Alert.alert('Confirm restore', `Restore ${snapshot}? This replaces current system data.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Restore', style: 'destructive', onPress: () => exportWorkbook('/api/admin/restore/export.xlsx', { method: 'POST', body: { filename: snapshot } }) }]); }} />
      <Button title="Refresh backup list" variant="quiet" onPress={() => action('Backups refreshed', '/api/admin/backups')} />
    </Card>
    <Card title="Create account"><FormField label="Email address" value={accountEmail} onChangeText={setAccountEmail} keyboardType="email-address" autoCapitalize="none" /><FormField label="Temporary password" value={accountPassword} onChangeText={setAccountPassword} secureTextEntry /><Text style={styles.fieldLabel}>Role</Text><RoleChoices value={accountRole} onChange={setAccountRole} roles={Array.from(new Set([...ROLES, ...(data.roles || []).map((item) => item.name)]))} /><Button title="Create account" loading={busy} onPress={createAccount} /></Card>
    <Card title="Account directory & security credentials" count={data.users?.length || 0}>
      <Text style={[styles.note, { marginBottom: 8 }]}>Infosec Zero-Knowledge: Plaintext passwords are never stored. Cryptographic scrypt hashes and salts are shown below.</Text>
      {(data.users || []).map((item) => <View style={styles.adminRow} key={item.id}><View style={styles.adminRowBody}><Text style={styles.recordTitle}>{item.username}</Text><Text style={styles.recordSubtitle}>{LABELS[item.role] || item.role} · Password: Never Stored (Zero Knowledge)</Text><Text style={[styles.note, { fontFamily: 'monospace', fontSize: 10, marginTop: 2 }]}>scrypt: {item.password_hash ? item.password_hash.slice(0, 14) + '…' : 'N/A'} · salt: {item.password_salt ? item.password_salt.slice(0, 8) + '…' : 'N/A'}</Text></View><Pressable style={styles.smallAction} onPress={() => { setSelectedAccount(item); setNewAccountRole(item.role); }}><Text style={styles.smallActionText}>Role</Text></Pressable>{item.id !== user.id ? <Pressable style={styles.smallDanger} onPress={() => Alert.alert('Delete account?', `Delete ${item.username}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => action('Account deleted', `/api/admin/users/${item.id}`, { method: 'DELETE' }) }])}><Text style={styles.smallDangerText}>Delete</Text></Pressable> : null}</View>)}
      {selectedAccount ? <View style={styles.inlineForm}><Text style={styles.fieldLabel}>Change {selectedAccount.username} role</Text><RoleChoices value={newAccountRole} onChange={setNewAccountRole} roles={Array.from(new Set([...ROLES, ...(data.roles || []).map((item) => item.name)]))} /><Button title="Save role" onPress={async () => { const result = await action('Account role updated', `/api/admin/users/${selectedAccount.id}`, { method: 'PUT', body: { role: newAccountRole } }); if (result) setSelectedAccount(null); }} /><Button title="Cancel" variant="quiet" onPress={() => setSelectedAccount(null)} /></View> : null}
    </Card>
    <Card title="Role management">
      <Text style={styles.fieldLabel}>Create role</Text><FormField label="Role key" value={roleName} onChangeText={setRoleName} autoCapitalize="none" placeholder="e.g. pharmacist" /><FormField label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="Hospital Pharmacist" /><FormField label="Description" value={description} onChangeText={setDescription} multiline /><FormField label="Permissions" value={permissions} onChangeText={setPermissions} /><Button title="Create role" loading={busy} onPress={createRole} />
      {(data.roles || []).map((item) => <View style={styles.adminRow} key={item.id}><View style={styles.adminRowBody}><Text style={styles.recordTitle}>{item.display_name || item.name}</Text><Text style={styles.recordSubtitle}>{item.name} · {item.user_count || 0} accounts</Text></View><Pressable style={styles.smallAction} onPress={() => { setEditingRole(item); setEditDisplayName(item.display_name || item.name); setEditDescription(item.description || ''); setEditPermissions(item.permissions || ''); }}><Text style={styles.smallActionText}>Modify</Text></Pressable>{item.name !== 'admin' && !item.is_system ? <Pressable style={styles.smallDanger} onPress={() => Alert.alert('Archive role?', `Archive ${item.display_name || item.name}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Archive', style: 'destructive', onPress: () => action('Role archived', `/api/admin/roles/${item.id}`, { method: 'DELETE' }) }])}><Text style={styles.smallDangerText}>Archive</Text></Pressable> : null}</View>)}
      {editingRole ? <View style={styles.inlineForm}><Text style={styles.fieldLabel}>Modify {editingRole.name}</Text><FormField label="Display name" value={editDisplayName} onChangeText={setEditDisplayName} /><FormField label="Description" value={editDescription} onChangeText={setEditDescription} multiline /><FormField label="Permissions" value={editPermissions} onChangeText={setEditPermissions} /><Button title="Save role changes" loading={busy} onPress={async () => { const result = await action('Role updated', `/api/admin/roles/${editingRole.id}`, { method: 'PUT', body: { display_name: editDisplayName, description: editDescription, permissions: editPermissions } }); if (result) setEditingRole(null); }} /><Button title="Cancel" variant="quiet" onPress={() => setEditingRole(null)} /></View> : null}
    </Card>
    <Card title="Patient requests" count={data.requests?.length || 0}>{(data.requests || []).map((r) => <RecordItem key={r.id} title={r.subject} subtitle={r.patient_email} detail={r.message} />)}</Card>
  </>;
}

function RoleChoices({ value, onChange, roles }) {
  return <View style={styles.roleWrap}>{roles.map((role) => <Pressable key={role} style={[styles.roleChip, value === role && styles.roleChipSelected]} onPress={() => onChange(role)}><Text style={[styles.roleChipText, value === role && styles.roleChipTextSelected]}>{LABELS[role] || role}</Text></Pressable>)}</View>;
}

function SettingsScreen({ user, baseUrl, onSave, signOut }) {
  const [url, setUrl] = useState(baseUrl);
  return <><Card title="Account"><Text style={styles.recordTitle}>{user?.username}</Text><Text style={styles.recordSubtitle}>{LABELS[user?.role] || user?.role}</Text><Button title="Sign out" variant="danger" onPress={signOut} /></Card><Card title="Backend server"><Text style={styles.bodyText}>Use the hosted website URL, or the computer's local network IP when testing on a phone.</Text><FormField label="API address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://your-app.example.com" /><Button title="Save server address" onPress={() => onSave(url)} /><Text style={styles.note}>Android emulator: http://10.0.2.2:3000 · Physical phone: http://YOUR-COMPUTER-LAN-IP:3000</Text></Card><Card title="Privacy"><Text style={styles.bodyText}>Your session token is stored in the phone's secure storage. Clinical information is loaded from the hospital server and is not cached after signing out.</Text></Card></>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f7fa' }, centered: { alignItems: 'center', justifyContent: 'center', gap: 12 }, content: { padding: 18, paddingBottom: 34 },
  header: { backgroundColor: COLORS.navy, paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 12 : 4, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: '#9fd8f1', fontSize: 10, letterSpacing: 1.4, fontWeight: '800' }, headerTitle: { color: COLORS.white, fontSize: 19, fontWeight: '800', marginTop: 3 }, headerSignout: { borderColor: '#ffffff55', borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 11 }, headerSignoutText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  greeting: { color: COLORS.ink, fontSize: 15, fontWeight: '800', marginTop: 2 }, pageSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 3, marginBottom: 15 }, hero: { backgroundColor: COLORS.navy, borderRadius: 18, padding: 20, marginBottom: 12 }, heroKicker: { color: '#9fd8f1', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 }, heroTitle: { color: COLORS.white, fontSize: 22, fontWeight: '800', marginTop: 7 }, heroSubtitle: { color: '#d6e8f0', fontSize: 12, marginTop: 5, lineHeight: 18 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 }, metric: { width: '31%', flexGrow: 1, minHeight: 83, backgroundColor: COLORS.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.line, justifyContent: 'center' }, metricValue: { color: COLORS.blue, fontSize: 24, fontWeight: '800' }, metricLabel: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  card: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 15, padding: 16, marginTop: 12 }, cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, cardTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800', flex: 1 }, cardCount: { backgroundColor: COLORS.pale, color: COLORS.blue, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '800', overflow: 'hidden' },
  bodyText: { color: '#4c6372', fontSize: 13, lineHeight: 20 }, listLine: { color: COLORS.ink, fontSize: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eef2f5' }, bold: { fontWeight: '800' }, muted: { color: COLORS.muted, fontSize: 12, lineHeight: 18 }, record: { borderTopWidth: 1, borderTopColor: '#edf1f4', paddingVertical: 12 }, recordTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800' }, recordSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 4 }, recordDetail: { color: '#435967', fontSize: 12, marginTop: 7, lineHeight: 18 },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.line, paddingBottom: Platform.OS === 'ios' ? 4 : 0 }, tab: { flex: 1, paddingVertical: 13, alignItems: 'center' }, tabActive: { borderTopWidth: 3, borderTopColor: COLORS.blue }, tabText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' }, tabTextActive: { color: COLORS.blue },
  authRoot: { flex: 1, backgroundColor: '#edf4f8' }, authScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 23, paddingVertical: 35 }, authMark: { width: 48, height: 48, borderRadius: 15, backgroundColor: COLORS.blue, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 13 }, authMarkText: { color: COLORS.white, fontSize: 30, fontWeight: '300', lineHeight: 34 }, brandAuth: { color: COLORS.blue, textAlign: 'center', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, authTitle: { color: COLORS.navy, textAlign: 'center', fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 12 }, authSubtitle: { color: COLORS.muted, textAlign: 'center', fontSize: 13, lineHeight: 20, marginTop: 6, marginBottom: 19 }, authCard: { backgroundColor: COLORS.white, padding: 19, borderRadius: 17, borderColor: COLORS.line, borderWidth: 1 },
  field: { marginBottom: 13 }, fieldLabel: { color: COLORS.ink, fontSize: 12, fontWeight: '800', marginBottom: 6 }, input: { minHeight: 47, borderColor: '#cfdae2', borderWidth: 1, borderRadius: 9, color: COLORS.ink, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff', textAlignVertical: 'top' }, button: { minHeight: 46, borderRadius: 9, backgroundColor: COLORS.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 11, marginTop: 10 }, dangerButton: { backgroundColor: COLORS.red }, successButton: { backgroundColor: COLORS.green }, quietButton: { backgroundColor: '#eef5f8', borderWidth: 1, borderColor: '#d7e5ec' }, buttonText: { color: COLORS.white, fontSize: 13, fontWeight: '800', textAlign: 'center' }, quietButtonText: { color: COLORS.blue }, buttonDisabled: { opacity: 0.55 }, buttonPressed: { opacity: 0.82 }, roleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }, roleChip: { backgroundColor: '#f4f7f9', borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 11, marginBottom: 2 }, roleChipSelected: { backgroundColor: COLORS.navy, borderColor: COLORS.navy }, roleChipText: { color: '#546a78', fontSize: 11, fontWeight: '700' }, roleChipTextSelected: { color: COLORS.white }, choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }, note: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginBottom: 10 }, serverUrl: { color: COLORS.blue, fontSize: 12, fontWeight: '700' }, divider: { height: 1, backgroundColor: COLORS.line, marginTop: 14, marginBottom: 12 }, banner: { borderRadius: 9, padding: 11, marginBottom: 12, borderWidth: 1 }, bannerError: { backgroundColor: '#fff0f0', borderColor: '#f0b6b8' }, bannerSuccess: { backgroundColor: '#edfaf2', borderColor: '#b7e3c7' }, bannerText: { color: COLORS.ink, fontSize: 12, lineHeight: 18 }, adminRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#edf1f4', paddingVertical: 11, gap: 6 }, adminRowBody: { flex: 1 }, smallAction: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: COLORS.pale, borderRadius: 7 }, smallActionText: { color: COLORS.blue, fontSize: 10, fontWeight: '800' }, smallDanger: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: '#fff0f0', borderRadius: 7 }, smallDangerText: { color: COLORS.red, fontSize: 10, fontWeight: '800' }, inlineForm: { backgroundColor: '#f6f9fb', borderRadius: 10, padding: 12, marginTop: 10 },
});
