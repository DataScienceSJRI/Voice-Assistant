// ── UI: status / mode ──────────────────────────────────────────────────────
const STATUSES = {
  idle:       { dot: 'idle',       text: 'Ready',        btn: 'Start Conversation', cls: '' },
  connecting: { dot: 'connecting', text: 'Connecting…',  btn: 'Connecting…',        cls: 'connecting' },
  connected:  { dot: 'connected',  text: 'Connected',    btn: 'End Conversation',   cls: 'stop' },
  error:      { dot: 'error',      text: 'Error',        btn: 'Start Conversation', cls: '' },
};

function setStatus(key) {
  const s = STATUSES[key] || STATUSES.idle;
  document.getElementById('statusDot').className = 'dot ' + s.dot;
  document.getElementById('statusText').textContent = s.text;
  const btn = document.getElementById('toggleBtn');
  btn.textContent = s.btn;
  btn.className   = s.cls;
  btn.disabled    = key === 'connecting';
  document.getElementById('footerHint').textContent =
    key === 'connected'
      ? 'Speak naturally. Click "End Conversation" when done.'
      : 'Your browser will request microphone access when you start.';
}

function setMode(mode) {
  const el = document.getElementById('modeBadge');
  if (mode === 'agent')     { el.className = 'mode-badge agent'; el.textContent = '🔊 Agent speaking'; }
  else if (mode === 'user') { el.className = 'mode-badge user';  el.textContent = '🎤 You are speaking'; }
  else                      { el.className = 'mode-badge';       el.textContent = ' '; }
}

function showSessionBadge(id) {
  const el = document.getElementById('sessionBadge');
  el.textContent = id;
  el.classList.add('visible');
}

function hideSessionBadge() {
  document.getElementById('sessionBadge').classList.remove('visible');
}

// ── Transcript ─────────────────────────────────────────────────────────────
function addMessage(role, text) {
  const container = document.getElementById('transcript');
  if (!transcriptHasMessages) {
    container.innerHTML = '';
    transcriptHasMessages = true;
  }

  const name = role === 'user' ? testerName : role === 'agent' ? 'Agent' : '';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const div  = document.createElement('div');
  div.className = 'msg ' + role;

  if (role !== 'system') {
    div.innerHTML = `<div class="meta"><strong>${esc(name)}</strong><span>${time}</span></div>${esc(text)}`;
  } else {
    div.textContent = text;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  if (currentSession && role !== 'system') {
    postTranscriptWithRetry(currentSession.id, role, text);
  }
}

async function postTranscriptWithRetry(sessionId, role, message, attempt = 0) {
  const MAX_ATTEMPTS = 3;
  try {
    await apiPost(`/api/sessions/${sessionId}/transcript`, { role, message });
  } catch (e) {
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); // 500ms, 1s, 2s
      return postTranscriptWithRetry(sessionId, role, message, attempt + 1);
    }
    console.error('Transcript write failed after', MAX_ATTEMPTS, 'attempts:', e);
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}
