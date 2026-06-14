/* Wires Claude Code hook events -> music state + mascot animation. */

const IDLE_AFTER_MS = 30_000;     // no events for this long -> back to idle
const FLOURISH_MS = 2_500;        // how long success/error poses hold

const canvas = document.getElementById('stage');
const statusEl = document.getElementById('status');
const muteBtn = document.getElementById('mute');
const closeBtn = document.getElementById('close');
const startOverlay = document.getElementById('start-overlay');
const volumeEl = document.getElementById('volume');

let engine = null;
let mascot = null;
let appConfig = null;

// session_id -> contagem de subagents vivos daquela sessão. O modo busy é a
// soma de todas as sessões, então o Stop de uma não tira a outra da pista.
const subagentsBySession = new Map();
let activeSubagents = 0;   // soma em cache; currentBaseState/renderStatus leem isto
let lastActivity = 0;
let flourishUntil = 0;
let flourishState = null;
let flourishTimer = null;
let muted = false;
let volume = 0.9;
let currentState = 'idle';
let statusError = null;

const STATUS_LABEL = {
  waiting: 'waiting for you…',
  success: 'nailed it ✓',
  error: 'oof.',
};

// live status: state + bpm gliding in real time + zen mood + key of the day
function renderStatus() {
  if (statusError) {
    statusEl.textContent = statusError;
    return;
  }
  if (!engine) return;
  const { bpm, prog, key, arcStage } = engine.info();
  // once the build-up arc kicks in, show the stage (1 = +counter, 2 = +pad)
  const arc = arcStage > 0 ? ` · arc ${arcStage}` : '';
  switch (currentState) {
    case 'idle':
      statusEl.textContent = `zen ${prog} · ${bpm} bpm · key ${key}`;
      break;
    case 'working':
      statusEl.textContent = `in flow · ${bpm} bpm${arc}`;
      break;
    case 'busy':
      statusEl.textContent = `${Math.max(activeSubagents, 1)} agent(s) on the floor · ${bpm} bpm${arc}`;
      break;
    default:
      statusEl.textContent = STATUS_LABEL[currentState] || currentState;
  }
}

function applyState(name) {
  currentState = name;
  mascot.setState(name);
  // success/error are mascot poses; musically they're flourishes on top
  // of whichever groove is underneath
  if (name === 'success' || name === 'error') {
    if (name === 'success') engine.flourishSuccess();
    else engine.flourishError();
  } else {
    engine.setState(name);
  }
  renderStatus();
}

function currentBaseState() {
  if (activeSubagents > 0) return 'busy';
  if (Date.now() - lastActivity < IDLE_AFTER_MS) return 'working';
  return 'idle';
}

function refresh() {
  if (Date.now() < flourishUntil) {
    applyState(flourishState);
    return;
  }
  flourishState = null;
  applyState(currentBaseState());
}

function flourish(name) {
  flourishState = name;
  flourishUntil = Date.now() + FLOURISH_MS;
  refresh();
  // wind the music down right when the pose ends, not at the next poll
  clearTimeout(flourishTimer);
  flourishTimer = setTimeout(refresh, FLOURISH_MS + 50);
}

function bump() {
  lastActivity = Date.now();
}

// single source of truth for the subagent count -> music density + crowd size.
// the live count is the sum across sessions, so finishing one session never
// clears another's agents off the floor.
function recountSubagents() {
  let sum = 0;
  for (const n of subagentsBySession.values()) sum += n;
  activeSubagents = sum;
  engine.setBusyLevel(sum);
  mascot.setBusyLevel(sum);
}

function addSubagent(id, delta) {
  const next = Math.max(0, (subagentsBySession.get(id) || 0) + delta);
  if (next === 0) subagentsBySession.delete(id);
  else subagentsBySession.set(id, next);
  recountSubagents();
}

// a session's Stop/SessionEnd reaps only its own agents — and doubles as the
// safety net for a SubagentStop that got dropped (curl is fire-and-forget)
function clearSession(id) {
  if (subagentsBySession.delete(id)) recountSubagents();
}

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

function handleClaudeEvent(evt) {
  const name = evt.hook_event_name || '';
  // payloads without a session_id share a single 'default' bucket -> today's behavior
  const id = evt.session_id || 'default';
  switch (name) {
    case 'SessionStart':
    case 'UserPromptSubmit':
      bump();
      flourishUntil = 0; // new prompt cancels any lingering pose
      refresh();
      break;

    case 'PreToolUse':
      bump();
      if (SUBAGENT_TOOLS.has(evt.tool_name)) {
        addSubagent(id, +1);
      }
      engine.toolTick(evt.tool_name);
      refresh();
      break;

    case 'PostToolUse': {
      bump();
      // minimal payloads send a pre-computed boolean; full payloads
      // (someone piping the raw hook JSON) still work via sniffing
      const resp = evt.tool_response;
      const errored =
        evt.errored === true ||
        (resp && typeof resp === 'object' && (resp.is_error || resp.isError)) ||
        (typeof resp === 'string' && /^error:/i.test(resp));
      if (errored) flourish('error');
      else refresh();
      break;
    }

    case 'SubagentStop':
      addSubagent(id, -1);
      bump();
      refresh();
      break;

    case 'Notification':
      // Claude is asking for permission / waiting on the user
      flourishUntil = 0;
      applyState('waiting');
      break;

    case 'Stop':
      // turn finished cleanly -> celebrate, then wind down to zen. only this
      // session's agents leave the floor; busy siblings keep playing.
      clearSession(id);
      lastActivity = 0;
      flourish('success');
      break;

    case 'SessionEnd':
      clearSession(id);
      lastActivity = 0;
      refresh();
      break;
  }
}

// --- volume: mouse wheel anywhere on the widget ---

let volumeFadeTimer = null;

function showVolume() {
  const bars = '▮'.repeat(Math.round(volume * 10)).padEnd(10, '▯');
  volumeEl.textContent = `♪ ${bars} ${Math.round(volume * 100)}%`;
  volumeEl.classList.add('visible');
  clearTimeout(volumeFadeTimer);
  volumeFadeTimer = setTimeout(() => volumeEl.classList.remove('visible'), 1200);
}

function setVolume(v) {
  volume = Math.min(Math.max(v, 0), 1);
  engine.setVolume(volume);
  window.lofi.setVolume(volume);
  showVolume();
}

// --- mute, shared between the widget button and the tray menu ---

function applyMuted(m) {
  muted = m;
  engine.setMuted(muted);
  muteBtn.classList.toggle('muted', muted);
}

// --- window dragging: the widget is NOT an app-region (drag regions
// swallow wheel/click events). The renderer only signals start/end with
// the grab offset; the main process follows the cursor, which is smooth ---

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) window.lofi.dragStart(e.clientX, e.clientY);
});
window.addEventListener('mouseup', () => window.lofi.dragEnd());
window.addEventListener('blur', () => window.lofi.dragEnd());

// --- tray icon: a little vinyl, drawn here because main has no canvas ---

function makeTrayIcon() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#23232f';
  g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a4a5e';
  g.lineWidth = 2;
  g.beginPath(); g.arc(16, 16, 9, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#c75e5e';
  g.beginPath(); g.arc(16, 16, 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd9a0';
  g.fillRect(24, 5, 3, 3);
  return c.toDataURL('image/png');
}

// --- settings panel: gear button toggles a modal over the DJ ---

const settingsPanel = document.getElementById('settings-panel');
const settingsHint = document.getElementById('settings-hint');
const cfgSkin = document.getElementById('cfg-skin');
const cfgEngine = document.getElementById('cfg-engine');
const cfgToolVoices = document.getElementById('cfg-tool-voices');
const cfgBuildUp = document.getElementById('cfg-build-up');
const cfgCounterMin = document.getElementById('cfg-counter-min');
const cfgPadMin = document.getElementById('cfg-pad-min');
const cfgKey = document.getElementById('cfg-key');
const cfgVolume = document.getElementById('cfg-volume');

function openSettings() {
  // reflect the current config into the controls each time it opens
  cfgSkin.value = appConfig.skin || 'purple';
  cfgEngine.value = appConfig.engine || 'samples';
  cfgToolVoices.value = appConfig.toolVoices === false ? 'off' : 'on';
  cfgBuildUp.value = appConfig.flowArc?.enabled === false ? 'off' : 'on';
  cfgCounterMin.value = appConfig.flowArc?.counterMin ?? 5;
  cfgPadMin.value = appConfig.flowArc?.padMin ?? 10;
  // transpose (an integer) pins the key and overrides daily; else "daily"
  cfgKey.value = Number.isInteger(appConfig.transpose)
    ? String(((appConfig.transpose % 12) + 12) % 12)
    : appConfig.dailyKey !== false ? 'daily' : '0';
  cfgVolume.value = Math.round(volume * 100);
  settingsHint.textContent = '';
  settingsPanel.classList.remove('hidden');
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
}

function toggleSettings() {
  settingsPanel.classList.contains('hidden') ? openSettings() : closeSettings();
}

// changes that the running engine can't pick up live need a restart
function flagRestart() {
  settingsHint.textContent = 'restart to apply ↓';
}

// --- audio bootstrap (autoplay may or may not be allowed) ---

async function startAudio() {
  try {
    await engine.start();
    mascot.setPlaying(true);
    startOverlay.classList.add('hidden');
    statusError = null;
    renderStatus();
  } catch (err) {
    console.error('failed to start audio:', err);
    statusError = `audio error: ${err.message}`;
    renderStatus();
    startOverlay.classList.remove('hidden');
  }
}

window.addEventListener('error', (e) => {
  console.error('unhandled error:', e.error || e.message);
  statusError = `error: ${e.message}`;
  renderStatus();
});

async function init() {
  const config = await window.lofi.getConfig();
  appConfig = config;
  volume = config.volume ?? 0.9;
  mascot = new Mascot(canvas, config.skin);
  engine = new LofiEngine(config);
  engine.onBeat((n) => mascot.beat(n));
  mascot.setAudioSource(() => engine.audioData());

  applyMuted(!!config.muted);

  window.lofi.onClaudeEvent(handleClaudeEvent);
  window.lofi.onSetMuted(applyMuted);
  window.lofi.sendTrayIcon(makeTrayIcon());

  document.getElementById('widget').addEventListener('wheel', (e) => {
    setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05));
  });

  muteBtn.addEventListener('click', () => {
    applyMuted(!muted);
    window.lofi.setMuted(muted);
  });

  closeBtn.addEventListener('click', () => window.lofi.quit());
  startOverlay.addEventListener('click', startAudio);

  // settings panel wiring
  document.getElementById('settings-toggle').addEventListener('click', toggleSettings);
  document.getElementById('settings-done').addEventListener('click', closeSettings);
  document.getElementById('settings-restart').addEventListener('click', () => window.lofi.relaunch());

  cfgSkin.addEventListener('change', () => {
    appConfig.skin = cfgSkin.value;
    window.lofi.setConfig({ skin: cfgSkin.value });
    mascot.setSkin(cfgSkin.value); // live
  });
  cfgEngine.addEventListener('change', () => {
    appConfig.engine = cfgEngine.value;
    window.lofi.setConfig({ engine: cfgEngine.value });
    flagRestart(); // sample/synth swap happens at audio start
  });
  cfgToolVoices.addEventListener('change', () => {
    const on = cfgToolVoices.value === 'on';
    appConfig.toolVoices = on;
    window.lofi.setConfig({ toolVoices: on });
    engine.setToolVoices(on); // live, no restart needed
  });
  cfgBuildUp.addEventListener('change', () => {
    const on = cfgBuildUp.value === 'on';
    // keep the configured thresholds, only flip enabled
    appConfig.flowArc = { ...(appConfig.flowArc || {}), enabled: on };
    window.lofi.setConfig({ flowArc: appConfig.flowArc });
    engine.setFlowArc(on); // live, no restart needed
  });
  // counter/pad thresholds (minutes) apply live — recompute the bar counts
  const pushFlowThresholds = () => {
    const counterMin = parseFloat(cfgCounterMin.value);
    const padMin = parseFloat(cfgPadMin.value);
    if (!(counterMin > 0) || !(padMin > 0)) return;
    appConfig.flowArc = { ...(appConfig.flowArc || {}), counterMin, padMin };
    window.lofi.setConfig({ flowArc: appConfig.flowArc });
    engine.setFlowThresholds(counterMin, padMin);
  };
  cfgCounterMin.addEventListener('change', pushFlowThresholds);
  cfgPadMin.addEventListener('change', pushFlowThresholds);
  cfgKey.addEventListener('change', () => {
    // "daily" -> date-derived key (clear any pinned transpose); a note -> pin it
    const partial = cfgKey.value === 'daily'
      ? { dailyKey: true, transpose: null }
      : { dailyKey: false, transpose: Number(cfgKey.value) };
    Object.assign(appConfig, partial);
    window.lofi.setConfig(partial);
    flagRestart(); // key is computed in the engine constructor
  });
  cfgVolume.addEventListener('input', () => {
    setVolume(cfgVolume.value / 100); // live + persisted via the existing path
  });

  // fall back to idle when things go quiet
  setInterval(refresh, 5_000);
  // keep bpm/mood in the status gliding live
  setInterval(renderStatus, 1_000);

  startAudio();
}

init();
