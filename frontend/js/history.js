// ── Feedback modal ─────────────────────────────────────────────────────────
function showFeedbackModal() {
  if (!currentSession) return;
  selectedOutcome = '';
  document.querySelectorAll('.outcome-btn').forEach(b => b.className = 'outcome-btn');
  document.getElementById('feedbackNotes').value = '';
  document.getElementById('feedbackModal').classList.remove('hidden');
}

function skipFeedback() {
  document.getElementById('feedbackModal').classList.add('hidden');
  hideSessionBadge();
  currentSession = null;
}

function selectOutcome(outcome) {
  selectedOutcome = outcome;
  document.querySelectorAll('.outcome-btn').forEach(b => {
    b.className = 'outcome-btn' + (b.dataset.outcome === outcome ? ' selected-' + outcome : '');
  });
}

async function submitFeedback() {
  if (!selectedOutcome) { showToast('Please select an outcome first.', 'error'); return; }
  const notes = document.getElementById('feedbackNotes').value.trim();
  try {
    await apiPut(`/api/sessions/${currentSession.id}/end`, { outcome: selectedOutcome, notes });
    showToast('Session saved ✓', 'success');
    document.getElementById('feedbackModal').classList.add('hidden');
    hideSessionBadge();
    currentSession = null;
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

// ── History modal ──────────────────────────────────────────────────────────
let allSessions  = [];
let activeFilter = 'all';

function toggleAdminView() {
  adminViewActive = !adminViewActive;
  const btn = document.getElementById('adminTabBtn');
  btn.classList.toggle('active', adminViewActive);
  btn.textContent = adminViewActive ? '👤 My Sessions' : '👥 All Testers';
  refreshHistory();
}

async function downloadCSV() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { showToast('Not signed in', 'error'); return; }
  const endpoint = adminViewActive ? '/api/admin/sessions/export' : '/api/sessions/export';
  try {
    const r = await fetch(BASE_PATH + endpoint, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    if (!r.ok) throw new Error(r.status);
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (adminViewActive ? 'all-sessions' : 'my-sessions') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  }
}

async function openHistory() {
  document.getElementById('historyModal').classList.remove('hidden');
  await refreshHistory();
}

function closeHistory() {
  document.getElementById('historyModal').classList.add('hidden');
}

async function refreshHistory() {
  document.getElementById('sessionList').innerHTML = '<div class="empty-history">Loading…</div>';
  try {
    const endpoint = adminViewActive ? '/api/admin/sessions' : '/api/sessions';
    allSessions = await apiFetch(endpoint);
    renderHistory();
  } catch (e) {
    document.getElementById('sessionList').innerHTML =
      `<div class="empty-history">Failed to load: ${esc(e.message)}</div>`;
  }
}

function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('filter' + f.charAt(0).toUpperCase() + f.slice(1)).classList.add('active');
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('sessionList');
  let sessions = allSessions;

  if (activeFilter === 'worked')  sessions = sessions.filter(s => s.outcome === 'worked');
  if (activeFilter === 'partial') sessions = sessions.filter(s => s.outcome === 'partial');
  if (activeFilter === 'failed')  sessions = sessions.filter(s => s.outcome === 'failed');

  if (!sessions.length) {
    list.innerHTML = '<div class="empty-history">No sessions found.</div>';
    return;
  }

  list.innerHTML = '';
  sessions.forEach(s => list.appendChild(buildSessionCard(s)));
}

function buildSessionCard(s) {
  const card = document.createElement('div');
  card.className = 'session-card';

  const outcome      = s.outcome || (s.ended_at ? 'ended' : 'pending');
  const outcomeLabel = { worked: '✓ Worked', partial: '~ Partial', failed: '✗ Failed', pending: 'In progress', ended: 'Ended' }[outcome] || outcome;
  const startTime    = s.started_at ? s.started_at.replace('T', ' ').slice(0, 16) : '—';
  const duration     = (s.started_at && s.ended_at)
    ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 60000) + ' min'
    : '—';

  const hdr = document.createElement('div');
  hdr.className = 'session-card-hdr';
  hdr.innerHTML = `
    <span class="session-id">${esc(s.id)}</span>
    ${adminViewActive ? `<span class="session-tester">${esc(s.tester_name)}</span>` : ''}
    <span class="outcome-tag ${outcome}">${outcomeLabel}</span>
    <span class="session-time">${startTime} · ${duration} · ${s.message_count} msgs</span>
    <span style="color:var(--muted);font-size:12px;margin-left:4px;">▾</span>
  `;

  const detail = document.createElement('div');
  detail.className = 'session-detail';
  detail.innerHTML = `
    <div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">
        Prompt ${s.is_override ? '(session override)' : '(dashboard)'}
      </div>
      <div class="detail-prompt">${esc(s.prompt_used || '(none)')}</div>
    </div>
    ${s.notes ? `<div class="session-notes">"${esc(s.notes)}"</div>` : ''}
    <div class="detail-transcript" id="transcript-${esc(s.id)}">
      <div style="font-size:11px;color:var(--muted);">Loading transcript…</div>
    </div>
  `;

  hdr.addEventListener('click', async () => {
    const isOpen = detail.classList.contains('open');
    detail.classList.toggle('open', !isOpen);
    if (!isOpen) await loadDetailTranscript(s.id);
  });

  card.appendChild(hdr);
  card.appendChild(detail);
  return card;
}

async function loadDetailTranscript(sessionId) {
  const el = document.getElementById(`transcript-${sessionId}`);
  if (!el) return;
  try {
    const data = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!data.transcript.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--muted);">No transcript entries.</div>';
      return;
    }
    el.innerHTML = data.transcript.map(e => `
      <div class="mini-msg ${e.role}">
        <div class="mini-role">${esc(e.role === 'user' ? data.tester_name : 'Agent')}</div>
        ${esc(e.message)}
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div style="font-size:11px;color:var(--danger);">Failed: ${esc(e.message)}</div>`;
  }
}
