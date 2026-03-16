// ── WebSocket / audio state ────────────────────────────────────────────────
let ws                  = null;
let audioCtx            = null;
let mediaStream         = null;
let audioNode           = null;   // AudioWorkletNode or ScriptProcessorNode
let nextPlayTime        = 0;
let activeSources       = [];
let isConnected         = false;
let closedIntentionally = false;
let transcriptHasMessages = false;
let currentSession      = null;   // { id, prompt }
let selectedOutcome     = '';

// ── Prompt ─────────────────────────────────────────────────────────────────
async function loadAgentConfig() {
  setPromptStatus('Loading…');
  try {
    const data   = await apiFetch('/api/agent');
    const prompt = data?.conversation_config?.agent?.prompt?.prompt ?? '';
    document.getElementById('prompt').value = prompt;
    setPromptStatus('Loaded from dashboard ✓');
  } catch (e) {
    setPromptStatus('Could not load');
    showToast('Failed to load agent config: ' + e.message, 'error');
  }
}

function setPromptStatus(msg) {
  document.getElementById('promptStatus').textContent = msg;
}

// ── Conversation ───────────────────────────────────────────────────────────
async function toggleConversation() {
  if (isConnected) { stopConversation(); return; }
  await startConversation();
}

async function startConversation() {
  setStatus('connecting');
  transcriptHasMessages = false;
  closedIntentionally   = false;

  try {
    const prompt = document.getElementById('prompt').value.trim();

    // 1. Create session record in DB
    const { session_id } = await apiPost('/api/sessions', {
      prompt_used: prompt,
      is_override: true,
    });
    currentSession = { id: session_id, prompt };
    showSessionBadge(session_id);

    // 2. Get signed WebSocket URL
    const { signed_url } = await apiFetch('/api/signed-url');

    // 3. Open mic + AudioContext
    audioCtx = new AudioContext();
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (micErr) {
      const isDenied = micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError';
      throw new Error(isDenied
        ? 'Microphone access was denied. Please allow microphone access in your browser and try again.'
        : 'Could not access microphone: ' + micErr.message
      );
    }

    // 4. Open WebSocket
    ws = new WebSocket(signed_url);

    ws.onopen = async () => {
      isConnected = true;
      setStatus('connected');
      addMessage('system', `Session ${session_id} started.`);
      await setupAudioCapture();

      if (prompt) {
        ws.send(JSON.stringify({
          type: 'conversation_initiation_client_data',
          conversation_config_override: {
            agent: { prompt: { prompt } },
          },
        }));
      }
    };

    ws.onmessage = handleWsMessage;

    ws.onerror = () => {
      addMessage('system', 'Connection error — please try again.');
      cleanup('error');
    };

    ws.onclose = () => {
      if (!isConnected) return; // already handled by onerror
      addMessage('system', 'Conversation ended.');
      const wasIntentional = closedIntentionally;
      cleanup('idle');
      if (wasIntentional && currentSession) showFeedbackModal();
    };

  } catch (e) {
    addMessage('system', 'Error: ' + e.message);
    cleanup('error');
  }
}

function stopConversation() {
  closedIntentionally = true;
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
}

// ── Mic capture ────────────────────────────────────────────────────────────

// AudioWorklet processor code — inlined as a Blob so no separate file is needed.
// Accumulates 4096 raw samples, downsamples to 16 kHz, converts to Int16, sends
// the buffer to the main thread via postMessage.
const WORKLET_CODE = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf      = new Float32Array(4096);
    this._count    = 0;
    this._toRate   = 16000;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const space  = this._buf.length - this._count;
      const copy   = Math.min(space, ch.length - i);
      this._buf.set(ch.subarray(i, i + copy), this._count);
      this._count += copy;
      i           += copy;
      if (this._count === this._buf.length) {
        this._flush();
        this._count = 0;
      }
    }
    return true;
  }
  _flush() {
    const ratio  = sampleRate / this._toRate;
    const outLen = Math.floor(this._buf.length / ratio);
    const i16    = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const lo = Math.floor(i * ratio);
      const hi = Math.min(Math.floor((i + 1) * ratio), this._buf.length);
      let s = 0;
      for (let j = lo; j < hi; j++) s += this._buf[j];
      const v  = Math.max(-1, Math.min(1, s / (hi - lo)));
      i16[i]   = v < 0 ? v * 32768 : v * 32767;
    }
    this.port.postMessage({ pcm: i16.buffer }, [i16.buffer]);
  }
}
registerProcessor('audio-capture', AudioCaptureProcessor);
`;

async function setupAudioCapture() {
  const source = audioCtx.createMediaStreamSource(mediaStream);

  if (audioCtx.audioWorklet) {
    try {
      const blob    = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const workletNode = new AudioWorkletNode(audioCtx, 'audio-capture');
      workletNode.port.onmessage = ({ data }) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ user_audio_chunk: bufToBase64(data.pcm) }));
      };
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);
      audioNode = workletNode;
      return;
    } catch (e) {
      console.warn('AudioWorklet unavailable, falling back to ScriptProcessor:', e);
    }
  }

  // Fallback: deprecated ScriptProcessor (still works, just runs on main thread)
  const fromRate    = audioCtx.sampleRate;
  const scriptNode  = audioCtx.createScriptProcessor(4096, 1, 1);
  scriptNode.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const raw   = e.inputBuffer.getChannelData(0);
    const ratio = fromRate / 16000;
    const out   = new Float32Array(Math.floor(raw.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const lo = Math.floor(i * ratio);
      const hi = Math.min(Math.floor((i + 1) * ratio), raw.length);
      let s = 0;
      for (let j = lo; j < hi; j++) s += raw[j];
      out[i] = s / (hi - lo);
    }
    const i16 = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const s = Math.max(-1, Math.min(1, out[i]));
      i16[i]  = s < 0 ? s * 32768 : s * 32767;
    }
    ws.send(JSON.stringify({ user_audio_chunk: bufToBase64(i16.buffer) }));
  };
  source.connect(scriptNode);
  scriptNode.connect(audioCtx.destination);
  audioNode = scriptNode;
}

function bufToBase64(buf) {
  const bytes  = new Uint8Array(buf);
  let   binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

// ── Incoming WebSocket messages ────────────────────────────────────────────
function handleWsMessage(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }

  switch (data.type) {
    case 'audio':
      setMode('agent');
      queueAudio(data.audio_event.audio_base_64);
      break;
    case 'agent_response':
      addMessage('agent', data.agent_response_event.agent_response);
      break;
    case 'user_transcript':
      addMessage('user', data.user_transcription_event.user_transcript);
      setMode('user');
      break;
    case 'interruption':
      clearAudio();
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', event_id: data.ping_event.event_id }));
      break;
  }
}

// ── Audio playback ─────────────────────────────────────────────────────────
async function queueAudio(base64) {
  if (!audioCtx) return;
  try {
    const bytes   = base64ToBytes(base64);
    const backup  = bytes.buffer.slice(0);
    let   audioBuf;
    try   { audioBuf = await audioCtx.decodeAudioData(bytes.buffer); }
    catch { audioBuf = pcmToBuffer(new Uint8Array(backup)); }
    scheduleBuffer(audioBuf);
  } catch (e) { console.error('Audio error', e); }
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function pcmToBuffer(bytes) {
  const i16 = new Int16Array(bytes.buffer);
  const buf = audioCtx.createBuffer(1, i16.length, 16000);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 32768;
  return buf;
}

function scheduleBuffer(audioBuf) {
  const src  = audioCtx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(audioCtx.destination);
  const now  = audioCtx.currentTime;
  const t    = Math.max(now, nextPlayTime);
  src.start(t);
  nextPlayTime = t + audioBuf.duration;
  activeSources.push(src);
  src.onended = () => {
    activeSources = activeSources.filter(s => s !== src);
    if (!activeSources.length) setMode('none');
  };
}

function clearAudio() {
  activeSources.forEach(s => { try { s.stop(); } catch (_) {} });
  activeSources = [];
  nextPlayTime  = audioCtx ? audioCtx.currentTime : 0;
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function cleanup(statusKey) {
  isConnected         = false;
  closedIntentionally = false;
  clearAudio();
  if (audioNode)   { audioNode.disconnect(); audioNode = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioCtx)    { audioCtx.close(); audioCtx = null; }
  ws = null; nextPlayTime = 0;
  setStatus(statusKey || 'idle');
  setMode('none');
}
