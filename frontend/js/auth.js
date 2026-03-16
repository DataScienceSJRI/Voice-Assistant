// ── Auth state ──────────────────────────────────────────────────────────────
let supabaseClient  = null;
let currentUser     = null;
let testerName      = '';
let cachedToken     = null;   // kept in sync for use in beforeunload

// ── User state ─────────────────────────────────────────────────────────────
let isAdmin        = false;
let adminViewActive = false;

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    const config = await fetch('/api/config').then(r => r.json());
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_anon_key);
  } catch (e) {
    console.error('Failed to load config:', e);
    showToast('Could not reach server.', 'error');
    return;
  }

  // Listen for auth state changes (handles token refresh, sign-out, etc.)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    cachedToken = session?.access_token || null;
    if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
      currentUser = null;
      testerName  = '';
      showLoginOverlay();
    }
  });

  // Check for an existing session
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    cachedToken = session.access_token;
    currentUser = session.user;
    testerName  = currentUser.user_metadata?.full_name || currentUser.email;
    showApp();
  } else {
    showLoginOverlay();
  }

  // Abandon the active session if the tab is closed mid-conversation
  window.addEventListener('beforeunload', () => {
    if (!currentSession || !cachedToken) return;
    fetch(`/api/sessions/${currentSession.id}/abandon`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Authorization': `Bearer ${cachedToken}` },
    });
  });

  document.getElementById('loginEmail').addEventListener('keydown',    e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

bootstrap();

// ── Login / auth ────────────────────────────────────────────────────────────
function showLoginOverlay() {
  document.getElementById('loginOverlay').style.display = 'flex';
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  errEl.className = 'login-error';
  document.getElementById('loginBtn').disabled    = false;
  document.getElementById('loginBtn').textContent = 'Sign In';
  setTimeout(() => document.getElementById('loginEmail').focus(), 50);
}

async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errEl    = document.getElementById('loginError');

  if (!email || !password) {
    errEl.textContent    = 'Email and password are required.';
    errEl.style.display  = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';
  errEl.style.display = 'none';

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errEl.className     = 'login-error';
    errEl.textContent   = error.message;
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = 'Sign In';
    return;
  }

  cachedToken = data.session.access_token;
  currentUser = data.user;
  testerName  = currentUser.user_metadata?.full_name || currentUser.email;
  showApp();
}

async function forgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  const errEl = document.getElementById('loginError');

  if (!email) {
    errEl.className     = 'login-error';
    errEl.textContent   = 'Enter your email address first.';
    errEl.style.display = 'block';
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
  errEl.style.display = 'block';
  if (error) {
    errEl.className   = 'login-error';
    errEl.textContent = error.message;
  } else {
    errEl.className   = 'login-error success';
    errEl.textContent = 'Password reset email sent — check your inbox.';
  }
}

async function signOut() {
  if (isConnected) { showToast('End the current conversation first.', 'error'); return; }
  await supabaseClient.auth.signOut();
  // onAuthStateChange handles the rest
}

function showApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('headerName').textContent = testerName;
  loadAgentConfig();
  apiFetch('/api/me').then(me => {
    isAdmin = me.is_admin;
    if (isAdmin) document.getElementById('adminTabBtn').style.display = '';
  }).catch(() => {});
}

// ── API helpers ────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showLoginOverlay();
    throw new Error('Not signed in');
  }

  const headers = {
    'Authorization': `Bearer ${session.access_token}`,
    ...(opts.headers || {}),
  };

  const r = await fetch(path, { ...opts, headers });

  if (r.status === 401) {
    // Only sign out if it's our own auth endpoint rejecting the token
    const body = await r.json().catch(() => ({}));
    if (body.detail === 'Invalid or expired token') {
      await supabaseClient.auth.signOut();
      throw new Error('Session expired — please sign in again.');
    }
    throw new Error(body.detail || 'Unauthorised');
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t}`);
  }
  return r.json();
}

function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
