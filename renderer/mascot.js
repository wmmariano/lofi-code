/* Pixel-art DJ mascot, drawn procedurally on canvas (no image assets).
 * Everything is drawn on a virtual pixel grid scaled up with crisp edges.
 */

const P = 4; // size of one virtual pixel on screen

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
  constructor(canvas, skinName = 'purple') {
    const preset = SKINS[skinName] || SKINS.purple;
    const { cat, ...colors } = preset;
    this.cat = !!cat;
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
    // coffee-break cycle during long zen: stretch+yawn, then sip
    this.breakIn = 40 + Math.random() * 40; // seconds of idle until a break
    this.breakPhase = null;                 // null | 'stretch' | 'sip'
    this.breakT = 0;
    this.notes = [];         // floating ♪ particles
    this.last = performance.now();
    requestAnimationFrame((ts) => this._frame(ts));
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

  beat(n) {
    this.beatNum = n;
    this.bob = 1;
    if (this.playing && this.state !== 'waiting' && n % 2 === 0) {
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
    this._drawDeskFront();
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
    // floor shadow
    ctx.fillStyle = this.c.shadow;
    ctx.beginPath();
    ctx.ellipse(34 * P, 60 * P, 26 * P, 3 * P, 0, 0, Math.PI * 2);
    ctx.fill();
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
    this.circle(cx, cy, 7, this.c.disc);
    this.ring(cx, cy, 5, this.c.discGroove);
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
    // little logo on the front
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
}

window.Mascot = Mascot;
