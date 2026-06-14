/* Pixel-art DJ mascot, drawn procedurally on canvas (no image assets).
 * Everything is drawn on a virtual pixel grid scaled up with crisp edges.
 */

const P = 4; // size of one virtual pixel on screen

// desk-front oscilloscope span (in virtual px), shared by update + draw
const SCOPE_X0 = 9;
const SCOPE_X1 = 59;

const C = {
  skin: '#f2c79c',
  skinShade: '#d9a878',
  hair: '#4a3226',
  hoodie: '#7c5cbf',
  hoodieShade: '#5f4496',
  phones: '#23232f',
  phonesPad: '#3a3a4c',
  accent: '#ffd9a0',
  deskTop: '#4a3d5e',
  deskFront: '#352b45',
  disc: '#16161e',
  discGroove: '#2c2c3a',
  discLabel: '#c75e5e',
  mixer: '#241d31',
  led: '#7dffa0',
  ledOff: '#3a4a3e',
  fader: '#cdb4f0',
  eye: '#23232f',
  mouth: '#a86b4c',
  white: '#f5f0ff',
  shadow: 'rgba(0,0,0,0.35)',
  bubble: 'rgba(30,24,44,0.9)',
  earInner: '#f0a8c0',
};

// skins override parts of the base palette; `cat` adds ears/nose/whiskers
const SKINS = {
  purple: {},
  green: {
    hoodie: '#4f9e6b',
    hoodieShade: '#39784f',
    accent: '#ffe9a0',
    fader: '#b7f0c4',
  },
  pink: {
    hoodie: '#d96aa8',
    hoodieShade: '#b04e87',
    accent: '#ffe1ee',
    fader: '#f5b8da',
  },
  cat: {
    cat: true,
    skin: '#e8a866',       // orange tabby fur
    skinShade: '#c98445',
    hair: '#d18b4f',
    hoodie: '#5d7fb8',
    hoodieShade: '#46618f',
    accent: '#ffd9a0',
    fader: '#bcd3f5',
  },
};

class Mascot {
  constructor(canvas, skinName = 'purple', opts = {}) {
    const preset = SKINS[skinName] || SKINS.purple;
    const { cat, ...colors } = preset;
    this.cat = !!cat;
    // day-night scene: 'off' | 'zen' | 'always'. dayNightHour pins the clock
    // (null = real time) — handy for testing and for locking a favorite vibe.
    this.dayNight = opts.dayNight || 'zen';
    this.dayNightHour = typeof opts.dayNightHour === 'number' ? opts.dayNightHour : null;
    this.sceneAlpha = 0;     // eased 0..1 master alpha for the whole scene
    this.dust = [];          // morning dust motes drifting in the sunbeam
    this.dustCooldown = 0;
    this.discoT = 0;         // sweep/side phase for the late-night disco balls
    this.c = { ...C, ...colors };
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.w = canvas.width;
    this.h = canvas.height;
    this.state = 'idle';
    this.playing = false;
    this.t = 0;
    this.bob = 0;            // decaying head-bob impulse, fed by beats
    this.beatNum = 0;
    this.discAngle = 0;
    this.blinkTimer = 2;
    this.blinking = 0;
    this.stateTime = 0;
    this.busyLevel = 0;      // active subagents -> dancefloor crowd size
    this.crowdEase = 0;      // smoothed busyLevel so the crowd grows/shrinks
    // coffee-break cycle during long zen: stretch+yawn, then sip
    this.breakIn = 40 + Math.random() * 40; // seconds of idle until a break
    this.breakPhase = null;                 // null | 'stretch' | 'sip'
    this.breakT = 0;
    this.notes = [];         // floating ♪ particles
    // audio-reactive readings (smoothed), fed by setAudioSource()
    this._audio = null;
    this.bass = 0;           // 0..1, drives the deck pulse
    this.level = 0;          // 0..1, overall energy
    this.levelEnv = 0;       // slow envelope of level, for transient detection
    this.scopeCols = null;   // per-column smoothed heights for the desk scope
    this.noteCooldown = 0;
    this.last = performance.now();
    requestAnimationFrame((ts) => this._frame(ts));
  }

  // a function returning the engine's audioData() (or null). when set, notes
  // fire on transients and the decks/equalizer react to the real signal.
  setAudioSource(fn) {
    this._audio = fn;
  }

  setState(name) {
    if (name !== this.state) {
      this.state = name;
      this.stateTime = 0;
      // leaving zen cancels any coffee break and rearms the timer
      this.breakPhase = null;
      this.breakIn = 40 + Math.random() * 40;
    }
  }

  setPlaying(playing) {
    this.playing = playing;
  }

  // active subagent count -> size of the dancefloor crowd
  setBusyLevel(n) {
    this.busyLevel = Math.max(0, n);
  }

  // swap the palette live (settings panel); next frame picks it up
  setSkin(skinName) {
    const preset = SKINS[skinName] || SKINS.purple;
    const { cat, ...colors } = preset;
    this.cat = !!cat;
    this.c = { ...C, ...colors };
  }

  // live toggle from the settings panel: 'off' | 'zen' | 'always'
  setDayNight(mode) {
    this.dayNight = mode || 'zen';
  }

  beat(n) {
    this.beatNum = n;
    this.bob = 1;
    // with an audio source, notes fire on transients instead; this is the
    // fallback when there's no analyser (e.g. before audio starts)
    if (!this._audio && this.playing && this.state !== 'waiting' && n % 2 === 0) {
      this._spawnNote();
    }
  }

  _spawnNote() {
    this.notes.push({
      x: 8 + Math.random() * 52,
      y: 36,
      vy: -4 - Math.random() * 3,
      vx: (Math.random() - 0.5) * 2,
      life: 1,
      color: Math.random() < 0.5 ? this.c.accent : this.c.fader,
    });
  }

  _frame(ts) {
    const dt = Math.min((ts - this.last) / 1000, 0.1);
    this.last = ts;
    this.t += dt;
    this.stateTime += dt;
    this.bob = Math.max(0, this.bob - dt * 3);

    // turntables spin while music plays; frantic when busy
    if (this.playing) {
      const speed = this.state === 'busy' ? 7 : this.state === 'waiting' ? 0.4 : 2.2;
      this.discAngle += dt * speed;
    }

    // audio-reactive readings: smooth toward the live signal, decay otherwise
    const data = this.playing && this._audio ? this._audio() : null;
    if (data) {
      const k = Math.min(1, dt * 12);
      this.bass += (data.bass - this.bass) * k;
      this.level += (data.level - this.level) * k;
      this._updateScope(data.wave, dt);
      // transient = level rising clearly above its slow envelope -> spawn a note
      this.levelEnv += (data.level - this.levelEnv) * Math.min(1, dt * 3);
      this.noteCooldown -= dt;
      if (this.state !== 'waiting' && data.level > this.levelEnv + 0.06 && this.noteCooldown <= 0) {
        this._spawnNote();
        this.noteCooldown = 0.11;
      }
    } else {
      const d = Math.min(1, dt * 4);
      this.bass -= this.bass * d;
      this.level -= this.level * d;
      this._updateScope(null, dt);
    }

    // coffee break: only during zen, stretch+yawn then a sip
    if (this.state === 'idle' && this.playing) {
      if (this.breakPhase) {
        this.breakT += dt;
        if (this.breakPhase === 'stretch' && this.breakT > 2.2) {
          this.breakPhase = 'sip';
          this.breakT = 0;
        } else if (this.breakPhase === 'sip' && this.breakT > 2.8) {
          this.breakPhase = null;
          this.breakIn = 45 + Math.random() * 45;
        }
      } else {
        this.breakIn -= dt;
        if (this.breakIn <= 0) {
          this.breakPhase = 'stretch';
          this.breakT = 0;
        }
      }
    }

    // dancefloor crowd eases toward the subagent count
    this.crowdEase += (this.busyLevel - this.crowdEase) * Math.min(1, dt * 4);

    // blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinking = 0.12;
      this.blinkTimer = 1.5 + Math.random() * 3;
    }
    this.blinking = Math.max(0, this.blinking - dt);

    // particles
    for (const note of this.notes) {
      note.y += note.vy * dt;
      note.x += note.vx * dt;
      note.life -= dt * 0.45;
    }
    this.notes = this.notes.filter((n) => n.life > 0);

    // day-night scene: ease the master alpha toward the current scope, advance
    // the disco phase, and spawn/drift dust motes while the morning beam is up
    const sceneTarget = this.dayNight === 'off' ? 0
      : this.dayNight === 'always' ? 1
      : (this.state === 'idle' ? 1 : 0);
    this.sceneAlpha += (sceneTarget - this.sceneAlpha) * Math.min(1, dt * 2);
    this.discoT += dt;
    if (this.sceneAlpha > 0.05) {
      const sun = this._dayWeights(this.hourNow()).sun;
      if (sun > 0.1) {
        this.dustCooldown -= dt;
        if (this.dustCooldown <= 0) {
          this.dust.push({ x: 42 + Math.random() * 16, y: 11 + Math.random() * 16, life: 1 });
          this.dustCooldown = 0.5;
        }
      }
      for (const d of this.dust) {
        d.x -= dt * (0.8 + d.life);   // drift down-left along the beam
        d.y += dt * 0.5;
        d.life -= dt * 0.2;
      }
      this.dust = this.dust.filter((d) => d.life > 0);
    } else if (this.dust.length) {
      this.dust.length = 0;
    }

    this._draw();
    requestAnimationFrame((t2) => this._frame(t2));
  }

  // --- drawing helpers on the virtual grid ---

  px(x, y, color, w = 1, h = 1) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x) * P, Math.round(y) * P, w * P, h * P);
  }

  line(x0, y0, x1, y1, color, thick = 2) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      this.px(x, y, color, thick > 1 ? 2 : 1, thick > 1 ? 2 : 1);
    }
  }

  circle(cx, cy, r, color) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) this.px(cx + x, cy + y, color);
      }
    }
  }

  ring(cx, cy, r, color) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d <= r * r && d > (r - 1.2) * (r - 1.2)) this.px(cx + x, cy + y, color);
      }
    }
  }

  // --- main draw ---

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const bobY = this.bob > 0.5 ? -1 : 0;            // discrete head-bob, keeps it pixel-y
    const sway = Math.round(Math.sin(this.t * 1.2)); // slow idle sway

    this._drawBackdrop();
    this._drawDesk();
    this._drawCharacter(bobY, sway);
    this._drawArms(bobY);
    this._drawDeskFront();   // front panel
    this._drawScope();       // oscilloscope on the panel
    this._drawDeskLogo();    // logo on top of the scope
    this._drawCrowd();       // dancefloor in front, sized by subagents
    this._drawOverlays(bobY);
    this._drawNotes();
  }

  _drawBackdrop() {
    // soft vignette so the sprite reads on any wallpaper
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(18,14,28,0.30)';
    ctx.beginPath();
    ctx.roundRect(3 * P, 6 * P, 62 * P, 56 * P, 14);
    ctx.fill();
    // day-night scene on the back wall (behind desk + character)
    this._drawAmbience();
    // floor shadow
    ctx.fillStyle = this.c.shadow;
    ctx.beginPath();
    ctx.ellipse(34 * P, 60 * P, 26 * P, 3 * P, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- day-night ambience: a window + tint that follow the clock, with one
  // signature prop per period. all multiplied by sceneAlpha (the scope gate). ---

  hourNow() {
    if (this.dayNightHour != null) return this.dayNightHour;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  _lin(x, a, b) {
    if (a === b) return x >= a ? 1 : 0;
    return Math.max(0, Math.min(1, (x - a) / (b - a)));
  }

  // trapezoid: 0 below a, ramps up a->b, 1 across b..c, ramps down c->d, 0 above
  _band(h, a, b, c, d) {
    return Math.max(0, Math.min(this._lin(h, a, b), 1 - this._lin(h, c, d)));
  }

  // per-period intensities (0..1), smooth so neighbours cross-fade at the edges
  _dayWeights(h) {
    const hh = h < 5 ? h + 24 : h; // night wraps past midnight
    return {
      sun: this._band(h, 5, 7, 10, 12),
      afternoon: this._band(h, 11, 12, 16, 17),
      neon: this._band(h, 17, 18, 21, 22),
      disco: this._band(hh, 22, 23, 28, 29),
    };
  }

  // wall/sky light colour, lerped across the day (circular over 24h)
  _tint(h) {
    const k = [
      { h: 2, c: [22, 24, 52] },     // madrugada: cold indigo
      { h: 8, c: [240, 214, 176] },  // manhã: warm cream
      { h: 14, c: [248, 206, 140] }, // tarde: amber/gold
      { h: 19, c: [232, 128, 86] },  // noite: sunset orange
      { h: 26, c: [22, 24, 52] },    // wrap back to madrugada
    ];
    const hh = h < 2 ? h + 24 : h;
    for (let i = 0; i < k.length - 1; i++) {
      if (hh >= k[i].h && hh <= k[i + 1].h) {
        const t = (hh - k[i].h) / (k[i + 1].h - k[i].h);
        return k[i].c.map((v, j) => Math.round(v + (k[i + 1].c[j] - v) * t));
      }
    }
    return k[0].c;
  }

  _drawAmbience() {
    const A = this.sceneAlpha;
    if (A <= 0.01) return;
    const ctx = this.ctx;
    const h = this.hourNow();
    const [r, g, b] = this._tint(h);
    const rgb = `${r},${g},${b}`;
    const w = this._dayWeights(h);

    // window on the upper-right wall + sky in the current light colour
    const wx = 45, wy = 9, ww = 15, wh = 14;
    this.px(wx - 1, wy - 1, '#2a2336', ww + 2, wh + 2); // frame
    ctx.globalAlpha = 0.95 * A;
    this.px(wx, wy, `rgb(${rgb})`, ww, wh);             // sky
    ctx.globalAlpha = 1;
    this.px(wx + (ww >> 1), wy, '#2a2336', 1, wh);      // mullions
    this.px(wx, wy + (wh >> 1), '#2a2336', ww, 1);

    // morning: a sunbeam from the window + dust motes drifting inside it
    if (w.sun > 0.01) {
      const grad = ctx.createLinearGradient(wx * P, wy * P, 12 * P, 40 * P);
      grad.addColorStop(0, `rgba(255,238,200,${0.22 * w.sun * A})`);
      grad.addColorStop(1, 'rgba(255,238,200,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo((wx + 2) * P, wy * P);
      ctx.lineTo((wx + ww) * P, wy * P);
      ctx.lineTo(20 * P, 40 * P);
      ctx.lineTo(8 * P, 40 * P);
      ctx.closePath();
      ctx.fill();
      for (const d of this.dust) {
        ctx.globalAlpha = 0.5 * d.life * w.sun * A;
        this.px(d.x, d.y, '#fff3d0');
      }
      ctx.globalAlpha = 1;
    }

    // afternoon: just the window (its amber sky carries the time of day)

    // evening: city bokeh in the window, a flickering neon sign, a lamp pool
    if (w.neon > 0.01) {
      ctx.globalAlpha = 0.5 * w.neon * A;
      for (const [bx, by] of [[wx + 3, wy + 3], [wx + 9, wy + 5], [wx + 5, wy + 9], [wx + 12, wy + 8]]) {
        this.px(bx, by, '#ffd9a0');
      }
      const flick = 0.6 + 0.4 * Math.abs(Math.sin(this.t * 6));
      ctx.globalAlpha = w.neon * A * flick;
      this.px(7, 12, '#ff6ad0', 1, 4); this.px(12, 12, '#ff6ad0', 1, 4); // neon "headphone" cups
      this.px(8, 11, '#ff6ad0', 4, 1);                                    // band
      ctx.globalAlpha = 1;
    }

    // late night: stars + two disco balls, the active side alternating
    if (w.disco > 0.01) {
      ctx.globalAlpha = (0.5 + 0.3 * Math.sin(this.t * 3)) * w.disco * A;
      for (const [sx, sy] of [[wx + 3, wy + 2], [wx + 10, wy + 4], [wx + 6, wy + 7], [wx + 13, wy + 11]]) {
        this.px(sx, sy, '#dfe6ff');
      }
      ctx.globalAlpha = 1;
      const side = Math.floor(this.discoT / 2) % 2; // swap sides every 2s
      const balls = [{ x: 9, y: 9, on: side === 0 }, { x: 58, y: 9, on: side === 1 }];
      for (const ball of balls) {
        ctx.globalAlpha = w.disco * A;
        this.circle(ball.x, ball.y, 2, ball.on ? '#cfd6ff' : '#5b6488');
        ctx.globalAlpha = 1;
        if (!ball.on) continue;
        for (let i = 0; i < 6; i++) {
          const a = this.discoT * 2 + i * 1.05;
          const rad = 8 + ((i * 5 + this.discoT * 14) % 22);
          const dy = ball.y + Math.abs(Math.sin(a)) * rad * 0.7;
          if (dy > 38) continue;
          ctx.globalAlpha = (0.5 + 0.5 * Math.sin(a * 2)) * w.disco * A;
          this.px(ball.x + Math.cos(a) * rad, dy, i % 2 ? '#9fd0ff' : '#ff9fe0');
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // scope columns (x 9..59). each column eases toward the waveform envelope so
  // the motion flows instead of flickering frame-to-frame. wave=null -> decay.
  _updateScope(wave, dt) {
    const cols = SCOPE_X1 - SCOPE_X0;
    if (!this.scopeCols || this.scopeCols.length !== cols) {
      this.scopeCols = new Float32Array(cols);
    }
    const sc = this.scopeCols;
    const k = Math.min(1, dt * 9); // easing speed: higher = snappier, lower = smoother
    for (let i = 0; i < cols; i++) {
      let target = 0;
      if (wave && wave.length) {
        const v = wave[Math.floor((i / cols) * wave.length)] || 0;
        target = Math.min(1, Math.abs(v) * 2.2); // gain up the quiet lofi signal
      }
      sc[i] += (target - sc[i]) * k;
    }
  }

  // bottom-anchored waveform on the desk front, behind the logo. drawn at
  // screen-pixel vertical resolution (not the chunky P grid) so it's smooth.
  _drawScope() {
    const sc = this.scopeCols;
    if (!sc) return;
    const ctx = this.ctx;
    const baseY = 56 * P;  // sits on the bottom lip of the desk front
    const ampPx = 13;      // max height in screen pixels
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < sc.length; i++) {
      const hpx = Math.round(sc[i] * ampPx);
      if (hpx <= 0) continue;
      ctx.fillStyle = (i & 1) ? this.c.fader : this.c.accent;
      ctx.fillRect((SCOPE_X0 + i) * P, baseY - hpx, P, hpx);
    }
    ctx.globalAlpha = 1;
  }

  _drawDesk() {
    // table top (turntables + mixer sit on it, drawn before the character's arms)
    this.px(6, 40, this.c.deskTop, 56, 4);

    this._drawTurntable(19, 44);
    this._drawTurntable(49, 44);
    this._drawMixer();

    // mug parked on the desk corner during zen (unless it's being sipped)
    if (this.state === 'idle' && this.breakPhase !== 'sip') {
      this._drawMug(8, 36, this.breakPhase === 'stretch');
    }
  }

  _drawTurntable(cx, cy) {
    // discs thump on the real bass: +1px on a strong low end
    const pulse = this.bass > 0.5 ? 1 : 0;
    this.circle(cx, cy, 7 + pulse, this.c.disc);
    this.ring(cx, cy, 5 + pulse, this.c.discGroove);
    this.circle(cx, cy, 2, this.c.discLabel);
    // rotating marker on the rim
    const jitter = this.state === 'busy' ? Math.sin(this.t * 25) * 0.8 : 0;
    const a = this.discAngle + jitter;
    this.px(cx + Math.round(Math.cos(a) * 5), cy + Math.round(Math.sin(a) * 5), this.c.accent);
    // tonearm stub
    this.px(cx + 6, cy - 6, this.c.phonesPad, 2, 1);
  }

  // the mug lives on the desk corner during zen; during the sip it's in hand
  _drawMug(x, y, steaming) {
    this.px(x, y, this.c.discLabel, 3, 4);
    this.px(x + 3, y + 1, this.c.discLabel, 1, 2); // handle
    this.px(x, y, '#5a3a26', 3, 1);           // coffee on top
    if (steaming) {
      const drift = Math.round(Math.sin(this.t * 2));
      this.ctx.globalAlpha = 0.6;
      this.px(x + 1 + drift, y - 2, this.c.white);
      this.px(x + 1 - drift, y - 4, this.c.white);
      this.ctx.globalAlpha = 1;
    }
  }

  _drawMixer() {
    this.px(28, 41, this.c.mixer, 12, 13);
    // LEDs react to state
    const ledOn = this.playing && this.state !== 'waiting';
    const blink = Math.floor(this.t * (this.state === 'busy' ? 8 : 3));
    for (let i = 0; i < 4; i++) {
      const on = ledOn && (blink + i) % 4 !== 0;
      this.px(29 + i * 3, 42, on ? this.c.led : this.c.ledOff, 2, 1);
    }
    // crossfader: drops low on error/waiting
    this.px(30, 49, this.c.disc, 8, 1);
    const faderX = this.state === 'error' || this.state === 'waiting'
      ? 30
      : 33 + Math.round(Math.sin(this.t * (this.state === 'busy' ? 10 : 2)) * 2);
    this.px(faderX, 48, this.c.fader, 2, 3);
  }

  _drawCharacter(bobY, sway) {
    const hx = 27 + (this.state === 'waiting' ? sway : 0); // head left edge
    const hy = 14 + bobY;

    // body / hoodie
    this.px(24, 28 + bobY, this.c.hoodie, 20, 12);
    this.px(24, 28 + bobY, this.c.hoodieShade, 20, 2);
    this.px(33, 32 + bobY, this.c.accent, 2, 4); // zipper

    // neck + head
    this.px(32, 26 + bobY, this.c.skinShade, 4, 2);
    this.px(hx, hy, this.c.skin, 14, 12);
    // hair
    this.px(hx, hy, this.c.hair, 14, 4);
    this.px(hx, hy + 4, this.c.hair, 2, 3);
    this.px(hx + 12, hy + 4, this.c.hair, 2, 3);

    // headphones: band + cups
    this.px(hx - 1, hy - 1, this.c.phones, 16, 2);
    this.px(hx - 2, hy + 4, this.c.phones, 2, 6);
    this.px(hx + 14, hy + 4, this.c.phones, 2, 6);
    this.px(hx - 2, hy + 5, this.c.phonesPad, 1, 4);
    this.px(hx + 15, hy + 5, this.c.phonesPad, 1, 4);

    if (this.cat) {
      // ears poking above the headphone band
      this.px(hx + 1, hy - 3, this.c.skin, 3, 2);
      this.px(hx + 2, hy - 4, this.c.skin);
      this.px(hx + 2, hy - 3, this.c.earInner);
      this.px(hx + 10, hy - 3, this.c.skin, 3, 2);
      this.px(hx + 11, hy - 4, this.c.skin);
      this.px(hx + 11, hy - 3, this.c.earInner);
    }

    this._drawFace(hx, hy);

    if (this.cat) {
      // pink nose + whiskers on the cheeks
      this.px(hx + 6, hy + 8, this.c.earInner, 2, 1);
      this.px(hx, hy + 9, this.c.skinShade, 2, 1);
      this.px(hx + 12, hy + 9, this.c.skinShade, 2, 1);
    }
  }

  _drawFace(hx, hy) {
    const ey = hy + 6;

    // coffee break expressions take over the whole face
    if (this.breakPhase === 'stretch') {
      // squeezed-shut eyes + big yawn
      this.px(hx + 3, ey, this.c.eye, 3, 1);
      this.px(hx + 8, ey, this.c.eye, 3, 1);
      this.px(hx + 5, hy + 9, this.c.mouth, 3, 3);
      return;
    }
    if (this.breakPhase === 'sip') {
      // content closed eyes; the mug covers the mouth
      this.px(hx + 3, ey, this.c.eye, 3, 1);
      this.px(hx + 8, ey, this.c.eye, 3, 1);
      return;
    }

    const happy = this.state === 'success';
    const closed = this.blinking > 0 || this.state === 'idle' && Math.sin(this.t * 0.7) > 0.93;
    const lookSide = this.state === 'waiting' ? 1 : 0;

    if (happy) {
      // ^ ^ eyes
      this.px(hx + 3, ey, this.c.eye); this.px(hx + 4, ey - 1, this.c.eye); this.px(hx + 5, ey, this.c.eye);
      this.px(hx + 8, ey, this.c.eye); this.px(hx + 9, ey - 1, this.c.eye); this.px(hx + 10, ey, this.c.eye);
    } else if (closed) {
      this.px(hx + 3, ey, this.c.eye, 3, 1);
      this.px(hx + 8, ey, this.c.eye, 3, 1);
    } else if (this.state === 'error') {
      // wide worried eyes
      this.px(hx + 3, ey - 1, this.c.white, 3, 3);
      this.px(hx + 8, ey - 1, this.c.white, 3, 3);
      this.px(hx + 4, ey, this.c.eye, 1, 2);
      this.px(hx + 9, ey, this.c.eye, 1, 2);
    } else {
      this.px(hx + 3 + lookSide, ey, this.c.eye, 2, 2);
      this.px(hx + 8 + lookSide, ey, this.c.eye, 2, 2);
    }

    // mouth
    const my = hy + 10;
    if (happy) {
      this.px(hx + 5, my, this.c.mouth, 4, 1);
      this.px(hx + 4, my - 1, this.c.mouth); this.px(hx + 9, my - 1, this.c.mouth);
    } else if (this.state === 'error') {
      this.px(hx + 5, my, this.c.mouth, 3, 1); // flat worried line
    } else if (this.state === 'waiting') {
      this.px(hx + 6, my, this.c.mouth, 2, 2); // small "o"
    } else {
      this.px(hx + 5, my, this.c.mouth, 4, 1);
    }
  }

  _drawArms(bobY) {
    const shL = { x: 25, y: 30 + bobY };
    const shR = { x: 42, y: 30 + bobY };
    const scratch = Math.sin(this.t * 14);
    let handL, handR;

    if (this.breakPhase === 'stretch') {
      // both arms reaching up, with a lazy sway
      const sway = Math.round(Math.sin(this.t * 2.5));
      handL = { x: 21 + sway, y: 11 };
      handR = { x: 46 + sway, y: 11 };
      this.line(shL.x, shL.y, handL.x, handL.y, this.c.hoodie);
      this.line(shR.x, shR.y, handR.x, handR.y, this.c.hoodie);
      this.px(handL.x, handL.y, this.c.skin, 2, 2);
      this.px(handR.x, handR.y, this.c.skin, 2, 2);
      return;
    }
    if (this.breakPhase === 'sip') {
      // right hand brings the mug up to the mouth, left rests on the desk
      handL = { x: 24, y: 40 };
      handR = { x: 37, y: 23 + bobY };
      this.line(shL.x, shL.y, handL.x, handL.y, this.c.hoodie);
      this.line(shR.x, shR.y, handR.x, handR.y, this.c.hoodie);
      this.px(handL.x, handL.y, this.c.skin, 2, 2);
      this.px(handR.x, handR.y, this.c.skin, 2, 2);
      this._drawMug(33, 21 + bobY, true);
      return;
    }

    switch (this.state) {
      case 'busy': // both hands scratching the decks
        handL = { x: 19 + Math.round(scratch * 3), y: 43 };
        handR = { x: 49 - Math.round(scratch * 3), y: 43 };
        break;
      case 'working': // one hand on the headphone cup, one riding the mixer
        handL = { x: 26, y: 19 + bobY };
        handR = { x: 34 + Math.round(Math.sin(this.t * 2) * 2), y: 42 };
        break;
      case 'success': // hands in the air
        handL = { x: 21, y: 16 + Math.round(Math.sin(this.t * 6) * 1) };
        handR = { x: 46, y: 16 + Math.round(Math.cos(this.t * 6) * 1) };
        break;
      case 'error': // scratching head, other hand limp on desk
        handL = { x: 28, y: 13 };
        handR = { x: 45, y: 40 };
        break;
      case 'waiting': // arms resting, drumming fingers
        handL = { x: 24, y: 40 };
        handR = { x: 43, y: 40 + (Math.floor(this.t * 6) % 2 ? 0 : -1) };
        break;
      default: // idle: resting on desk edge
        handL = { x: 24, y: 40 };
        handR = { x: 43, y: 40 };
    }

    this.line(shL.x, shL.y, handL.x, handL.y, this.c.hoodie);
    this.line(shR.x, shR.y, handR.x, handR.y, this.c.hoodie);
    this.px(handL.x, handL.y, this.c.skin, 2, 2);
    this.px(handR.x, handR.y, this.c.skin, 2, 2);
  }

  _drawDeskFront() {
    // front panel drawn after arms so hands appear "on" the desk
    this.px(6, 44, this.c.deskFront, 56, 12);
    this.px(6, 44, this.c.deskTop, 56, 1);
  }

  // the little "LP" mark, drawn last so it sits on top of the equalizer bars
  _drawDeskLogo() {
    this.px(31, 48, this.c.accent, 1, 4);
    this.px(32, 51, this.c.accent, 2, 1);
    this.px(35, 48, this.c.fader, 1, 4);
    this.px(36, 48, this.c.fader, 2, 1);
  }

  _drawOverlays(bobY) {
    if (this.state === 'waiting') {
      // "!" speech bubble pointing at the user
      const bx = 44, by = 6;
      this.ctx.fillStyle = this.c.bubble;
      this.ctx.beginPath();
      this.ctx.roundRect(bx * P, by * P, 10 * P, 9 * P, 8);
      this.ctx.fill();
      this.px(bx + 1, by + 9, this.c.bubble, 2, 2);
      this.px(bx + 4, by + 2, this.c.accent, 2, 4);
      this.px(bx + 4, by + 7, this.c.accent, 2, 1);
    }
    if (this.state === 'error') {
      // sweat drop sliding down the head
      const sy = 15 + bobY + Math.floor(this.stateTime * 2) % 4;
      this.px(43, sy, '#9ad7ff', 1, 2);
    }
  }

  _drawNotes() {
    for (const note of this.notes) {
      this.ctx.globalAlpha = Math.max(0, note.life);
      const x = note.x, y = note.y;
      this.px(x + 2, y, note.color, 1, 4);
      this.px(x + 2, y, note.color, 2, 1);
      this.px(x, y + 3, note.color, 2, 2);
      this.ctx.globalAlpha = 1;
    }
  }

  // pixel crowd along the bottom, in front of the desk. size tracks the
  // subagent count: a couple of heads for one agent, a packed club for
  // several. heads bob out of phase; alternating fans wave glow-sticks.
  _drawCrowd() {
    if (this.crowdEase < 0.05) return;
    const target = Math.min(11, this.crowdEase * 2 + 1); // 1 agent ~3, 5 ~11
    const full = Math.floor(target);
    const frac = target - full;
    const count = frac > 0.02 ? full + 1 : full;
    const spacing = 6, baseY = 58;
    const startX = 34 - ((count - 1) * spacing) / 2;
    const dark = ['#191522', '#241d31'];
    const glow = [this.c.accent, this.c.fader];
    for (let i = 0; i < count; i++) {
      // the last head fades in/out with the fractional part for a smooth grow
      this.ctx.globalAlpha = i === count - 1 && frac > 0.02 ? frac : 1;
      const cx = Math.round(startX + i * spacing);
      const phase = i * 1.7;
      const bob = this.playing && Math.sin(this.t * 7 + phase) > 0.2 ? -1 : 0;
      const y = baseY + bob;
      const body = dark[i % 2];
      this.px(cx, y, body, 3, 2);          // head
      this.px(cx - 1, y + 2, body, 5, 2);  // shoulders
      if (i % 2 === 0) {                    // hands up, waving to the beat
        const a = Math.round(Math.sin(this.t * 8 + phase));
        this.px(cx - 1, y - 2 + a, glow[i % 2], 1, 2);
        this.px(cx + 3, y - 2 - a, glow[(i + 1) % 2], 1, 2);
      }
    }
    this.ctx.globalAlpha = 1;
  }
}

window.Mascot = Mascot;
