const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WIN_W = 272;
const WIN_H = 288; // 28px toolbar + 256px canvas, no dead margin below the art

const DEFAULT_CONFIG = {
  port: 8765,
  volume: 0.9,
  muted: false,
  position: null,      // [x, y]; null = bottom-right corner
  dailyKey: true,      // false = always the original key (C)
  skin: 'purple',        // purple | green | pink | cat
  engine: 'samples',   // 'samples' (use renderer/samples/ if present) | 'synth'
  toolVoices: true,    // per-tool sounds on PreToolUse; false = one generic blip
  flowArc: { enabled: true, counterMin: 5, padMin: 10 }, // build-up over time in flow
  dayNight: 'zen',     // background scene by time of day: 'off' | 'zen' | 'always'
  dayNightHour: null,  // pin the hour (0-23) for testing / a fixed vibe; null = clock
  stateParams: {},     // deep-merged over the music defaults (see README)
  zenMoods: null,      // replaces the zen mood list entirely when set
};

// Web Audio must start without a click, and transparent visuals need
// these switches on some Linux compositors.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

let win = null;
let tray = null;
let config = null;
let configPath = null;
let saveTimer = null;

function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  config = { ...DEFAULT_CONFIG };
  try {
    Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    // no config yet (or invalid) -> defaults
  }
}

function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    } catch (err) {
      console.error('lofi-code: failed to save config:', err);
    }
  }, 300);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const [x, y] = config.position || [
    workArea.x + workArea.width - WIN_W - 24,
    workArea.y + workArea.height - WIN_H - 24,
  ];

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x, y,
    // dock-type windows are exempt from the WM's work-area constraint,
    // so the DJ can sit over the top bar / dock areas
    ...(process.platform === 'linux' ? { type: 'dock' } : {}),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' keeps it above fullscreen apps on mac/win
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.LOFI_DEBUG) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  win.on('closed', () => { win = null; });
}

// Local-only HTTP endpoint that Claude Code hooks POST their event JSON to.
function startEventServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy(); // hook payloads are small
    });
    req.on('end', () => {
      try {
        const event = JSON.parse(body || '{}');
        if (win && !win.isDestroyed()) {
          win.webContents.send('claude-event', event);
        }
        res.writeHead(200);
        res.end('ok');
      } catch {
        res.writeHead(400);
        res.end('bad json');
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`lofi-code: port ${config.port} already in use — is another instance running?`);
      app.quit();
    } else {
      console.error('lofi-code event server error:', err);
    }
  });

  server.listen(config.port, '127.0.0.1');
}

// --- autostart ---

const autostartDesktop = () =>
  path.join(app.getPath('appData'), 'autostart', 'lofi-code.desktop');

function getAutostart() {
  if (process.platform === 'linux') return fs.existsSync(autostartDesktop());
  return app.getLoginItemSettings().openAtLogin;
}

function setAutostart(enabled) {
  if (process.platform === 'linux') {
    const file = autostartDesktop();
    if (enabled) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, [
        '[Desktop Entry]',
        'Type=Application',
        'Name=lofi-code',
        `Exec="${process.execPath}" "${app.getAppPath()}"`,
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'));
    } else {
      fs.rmSync(file, { force: true });
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

// --- tray ---

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? 'Hide DJ' : 'Show DJ',
      click: () => {
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
        rebuildTrayMenu();
      },
    },
    {
      label: 'Muted',
      type: 'checkbox',
      checked: config.muted,
      click: (item) => {
        config.muted = item.checked;
        saveConfig();
        if (win) win.webContents.send('set-muted', config.muted);
      },
    },
    { type: 'separator' },
    {
      label: 'Start with system',
      type: 'checkbox',
      checked: getAutostart(),
      click: (item) => setAutostart(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function createTray(iconDataURL) {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(iconDataURL);
  tray = new Tray(icon.resize({ width: 22, height: 22 }));
  tray.setToolTip('lofi-code');
  rebuildTrayMenu();
}

// --- IPC ---

ipcMain.handle('get-config', () => config);

// Samples can't be fetched by the renderer: it runs from a file:// origin and
// Tone.js loads buffers via fetch(), which Chromium blocks for file://. So we
// read them here and hand raw bytes over IPC; the renderer decodes them. This
// also works transparently inside an asar archive once packaged.
const SAMPLES_DIR = path.join(__dirname, 'renderer', 'samples');

function collectSamples(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing dir -> caller returns {} (synth fallback)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // path-traversal guard: never read outside the samples dir
    if (!path.resolve(full).startsWith(SAMPLES_DIR + path.sep)) continue;
    if (entry.isDirectory()) {
      collectSamples(full, out);
    } else if (/\.(wav|ogg)$/i.test(entry.name)) {
      const rel = path.relative(SAMPLES_DIR, full).split(path.sep).join('/');
      try {
        out[rel] = fs.readFileSync(full); // Buffer -> Uint8Array in renderer
      } catch {
        // unreadable file: skip it, that layer falls back to synth
      }
    }
  }
}

ipcMain.handle('load-samples', () => {
  if (config.engine === 'synth') return {};
  const out = {};
  collectSamples(SAMPLES_DIR, out);
  return out;
});

ipcMain.on('set-volume', (_e, v) => {
  config.volume = Math.min(Math.max(v, 0), 1);
  saveConfig();
});

ipcMain.on('set-muted', (_e, muted) => {
  config.muted = !!muted;
  saveConfig();
  rebuildTrayMenu();
});

// settings panel: merge a partial config and persist. only whitelisted keys,
// so the renderer can't write arbitrary fields.
const SETTABLE = new Set(['skin', 'engine', 'dailyKey', 'transpose', 'volume', 'toolVoices', 'flowArc', 'dayNight']);
ipcMain.on('set-config', (_e, partial) => {
  if (!partial || typeof partial !== 'object') return;
  for (const [k, v] of Object.entries(partial)) {
    if (SETTABLE.has(k)) config[k] = v;
  }
  saveConfig();
});

ipcMain.on('relaunch', () => {
  app.relaunch();
  app.quit();
});

// dragging is driven here: following the cursor from the main process is
// smooth, while renderer mousemove lags behind a window moving under it
let dragInterval = null;

ipcMain.on('drag-start', (_e, offX, offY) => {
  if (!win) return;
  clearInterval(dragInterval);
  dragInterval = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    win.setPosition(Math.round(p.x - offX), Math.round(p.y - offY));
  }, 16);
});

ipcMain.on('drag-end', () => {
  clearInterval(dragInterval);
  dragInterval = null;
  if (win) {
    config.position = win.getPosition();
    saveConfig();
  }
});

ipcMain.on('tray-icon', (_e, dataURL) => createTray(dataURL));

ipcMain.on('app-quit', () => app.quit());

app.whenReady().then(() => {
  loadConfig();
  startEventServer();
  // Transparent windows on Linux render black if created before the
  // compositor is ready; a short delay is the standard workaround.
  if (process.platform === 'linux') {
    setTimeout(createWindow, 300);
  } else {
    createWindow();
  }
});

app.on('window-all-closed', () => app.quit());
