/* Generative lofi engine (Tone.js).
 *
 * Continuous music, never one-shot SFX: state changes morph the same
 * groove (tempo, filter cutoff, chord progression, drum density, vinyl
 * level) so transitions feel like a DJ riding the mixer.
 */

// design rule: states change COLOR (chords, layers, brightness), never
// URGENCY — tempo stays in a narrow cozy band so the music never rushes you
const STATE_PARAMS = {
  // calm: just chords floating on vinyl crackle, no drums at all
  idle:    { bpm: 70, filter: 900,  kick: 'none',  snare: false, hats: false,   bass: false, melodyProb: 0,    vinyl: 0.005,  prog: 'chill' },
  // head-nod groove while the agent works
  working: { bpm: 74, filter: 1800, kick: 'basic', snare: true,  hats: 'basic', bass: true,  melodyProb: 0.07, vinyl: 0.0025, prog: 'chill' },
  // several subagents: more layers and a warmer minor color, same calm pulse
  busy:    { bpm: 76, filter: 2400, kick: 'full',  snare: true,  hats: 'full',  bass: true,  melodyProb: 0.12, vinyl: 0.001,  prog: 'drive' },
  // waiting for the user: muffled suspension, no drums, crackle up front
  waiting: { bpm: 68, filter: 450,  kick: 'none',  snare: false, hats: false,   bass: true,  melodyProb: 0,    vinyl: 0.007,  prog: 'chill' },
};

// zen comes in flavors: rotates every return to idle, and drifts on its own
// if you stay idle long enough
const ZEN_MOODS = [
  { prog: 'chill',    bpm: 70, filter: 900 },
  { prog: 'dreamy',   bpm: 66, filter: 700 },
  { prog: 'nocturne', bpm: 73, filter: 1100 },
];
const ZEN_DRIFT_BARS = 16; // ~1 min per mood when idling

// upgrade = more intensity -> deserves a drum fill on the way in
const STATE_RANK = { waiting: 0, idle: 1, working: 2, busy: 3 };

// base level for sampled drums (dB), with per-hit velocity added on top as
// gainToDb. tuned by ear against the synth kick (-8) / snare (-16).
const KICK_DB = -6;
const SNARE_DB = -10;

const PROGRESSIONS = {
  // Fmaj7 → Em7 → Dm7 → Cmaj7: the classic descending lofi loop
  chill: [
    { chord: ['F2', 'A3', 'C4', 'E4'], root: 'F1' },
    { chord: ['E2', 'G3', 'B3', 'D4'], root: 'E1' },
    { chord: ['D2', 'F3', 'A3', 'C4'], root: 'D1' },
    { chord: ['C3', 'E3', 'G3', 'B3'], root: 'C1' },
  ],
  // Am7 → Cmaj7 → Fmaj7 → G7: minor color but zero tension chords —
  // "more happening", not "something's wrong"
  drive: [
    { chord: ['A2', 'C4', 'E4', 'G4'], root: 'A1' },
    { chord: ['C3', 'E3', 'G3', 'B3'], root: 'C1' },
    { chord: ['F2', 'A3', 'C4', 'E4'], root: 'F1' },
    { chord: ['G2', 'B3', 'D4', 'F4'], root: 'G1' },
  ],
  // Cmaj7 → Am7 → Fmaj7 → G7: warm and floaty, slower zen flavor
  dreamy: [
    { chord: ['C3', 'E3', 'G3', 'B3'], root: 'C1' },
    { chord: ['A2', 'C4', 'E4', 'G4'], root: 'A1' },
    { chord: ['F2', 'A3', 'C4', 'E4'], root: 'F1' },
    { chord: ['G2', 'B3', 'D4', 'F4'], root: 'G1' },
  ],
  // Am7 → Dm7 → Em7 → Am7: minor and introspective, late-night zen flavor
  nocturne: [
    { chord: ['A2', 'C4', 'E4', 'G4'], root: 'A1' },
    { chord: ['D2', 'F3', 'A3', 'C4'], root: 'D1' },
    { chord: ['E2', 'G3', 'B3', 'D4'], root: 'E1' },
    { chord: ['A2', 'C4', 'E4', 'G4'], root: 'A1' },
  ],
};

const PENTATONIC = ['A4', 'C5', 'D5', 'E5', 'G5', 'A5'];

// each tool_name gets its own voice on PreToolUse, so the session has texture:
// you can hear *what* the agent is doing, not just *that* it's doing something.
// anything not listed falls back to the soft 'tick' (the original blip).
const TOOL_VOICES = {
  Bash: 'perc',
  Edit: 'stab', Write: 'stab', MultiEdit: 'stab', NotebookEdit: 'stab',
  Grep: 'hat', Glob: 'hat',
  Read: 'tick', LS: 'tick',
  WebFetch: 'scratch', WebSearch: 'scratch',
};
// per-voice throttle (s) so a storm of one tool can't machine-gun, while
// different tools can still sound close together
const VOICE_THROTTLE = { perc: 0.3, hat: 0.3, tick: 0.35, stab: 0.5, scratch: 0.5 };

class LofiEngine {
  constructor(config = {}) {
    // user config (per-state) is merged over the defaults, so any field in
    // STATE_PARAMS can be tuned from the config file without touching code
    this.stateParams = {};
    for (const [name, defaults] of Object.entries(STATE_PARAMS)) {
      this.stateParams[name] = { ...defaults, ...(config.stateParams?.[name] || {}) };
    }
    this.zenMoods = Array.isArray(config.zenMoods) && config.zenMoods.length
      ? config.zenMoods
      : ZEN_MOODS;
    this.volume = Math.min(Math.max(config.volume ?? 0.9, 0), 1);
    this.muted = !!config.muted;
    this.toolVoices = config.toolVoices !== false; // per-tool sounds, on by default

    // key of the day: a transposition derived from the date, so every day
    // has its own color and the loops never wear out. dailyKey: false goes
    // back to the original default key (C); config.transpose pins any key
    const dateStr = new Date().toISOString().slice(0, 10);
    let h = 0;
    for (const ch of dateStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const dailyKey = config.dailyKey !== false; // on unless explicitly off
    const semis = Number.isInteger(config.transpose)
      ? config.transpose
      : dailyKey ? h % 12 : 0;
    this.transpose = ((semis % 12) + 12) % 12;
    this.keyName = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'][this.transpose];
    if (this.transpose > 6) this.transpose -= 12; // fold down: keeps the register cozy

    const T = (note) => Tone.Frequency(note).transpose(this.transpose).toNote();
    this.progressions = {};
    for (const [name, bars] of Object.entries(PROGRESSIONS)) {
      this.progressions[name] = bars.map((b) => ({ chord: b.chord.map(T), root: T(b.root) }));
    }
    this.pentatonic = PENTATONIC.map(T);
    this.tickNotes = ['E5', 'G5', 'A5'].map(T);
    this.successArp = ['C5', 'E5', 'G5', 'B5'].map(T);
    this.errorNote = T('E1');

    this.params = this.stateParams.idle;
    this.state = 'idle';
    this.started = false;
    this.barIndex = 0;
    this.busyLevel = 0;
    this.lastVoiceAt = {}; // per-voice last-played time, for throttling tool blips
    this.zenIndex = 0;
    this.idleBars = 0;
    this.beatCallbacks = [];

    // kick off sample loading now (during the autoplay/click wait); start()
    // awaits this with a cap so a bare clone never delays first sound
    this._samplesPromise = this._loadSamples(config);
  }

  onBeat(cb) {
    this.beatCallbacks.push(cb);
  }

  // pull sample bytes over IPC and decode them to AudioBuffers. returns null
  // (whole engine stays synth) on opt-out / missing preload / no files, and
  // nulls just the layers whose files are absent or fail to decode.
  async _loadSamples(config) {
    if (config.engine === 'synth' || !window.lofi?.loadSamples) return null;
    let files;
    try {
      files = await window.lofi.loadSamples();
    } catch {
      return null;
    }
    if (!files || !Object.keys(files).length) return null;

    // decoding works on a suspended context, so this can run before Tone.start()
    const ctx = Tone.getContext().rawContext;
    const out = { rhodes: {}, kick: null, snare: null };
    for (const [rel, bytes] of Object.entries(files)) {
      try {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        // bytes may be a view into a shared pool: slice to its exact range,
        // and decodeAudioData detaches the buffer, so hand it a fresh copy
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const buf = await ctx.decodeAudioData(ab);
        if (rel.startsWith('rhodes/')) {
          const note = this._noteFromFilename(rel);
          if (note) out.rhodes[note] = buf;
        } else if (/(^|\/)kick\.(wav|ogg)$/i.test(rel)) {
          out.kick = buf;
        } else if (/(^|\/)snare\.(wav|ogg)$/i.test(rel)) {
          out.snare = buf;
        }
      } catch {
        // undecodable file: skip it, that layer falls back to synth
      }
    }
    return out;
  }

  // 'rhodes/Cs3.ogg' -> 'C#3' (filenames use 's' for sharp; '#'/'b' also ok)
  _noteFromFilename(rel) {
    const base = rel.split('/').pop().replace(/\.(wav|ogg)$/i, '');
    const m = base.match(/^([A-Ga-g])(s|#|b)?(-?\d)$/);
    if (!m) return null;
    const acc = m[2] === 's' || m[2] === '#' ? '#' : m[2] === 'b' ? 'b' : '';
    return m[1].toUpperCase() + acc + m[3];
  }

  async start() {
    if (this.started) return;
    await Tone.start();
    // local read + decode is tens of ms (cheaper than the reverb IR we await
    // below), but cap it so a hung/huge load can't stall first sound
    const samples = await Promise.race([
      this._samplesPromise.catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 3000)),
    ]);
    this._build(samples);
    // the convolution reverb generates its impulse response async;
    // starting the transport before it's ready can leave key layers silent
    await this.reverb.ready;
    const transport = Tone.getTransport();
    transport.bpm.value = this.params.bpm;
    transport.swing = 0.55;
    transport.swingSubdivision = '8n';
    transport.start();
    this.started = true;
  }

  _build(samples) {
    // master chain: lowpass "mixer filter" -> compressor -> volume gain -> out
    this.masterGain = new Tone.Gain(this.muted ? 0 : this.volume).toDestination();
    this.compressor = new Tone.Compressor(-18, 3).connect(this.masterGain);
    this.masterFilter = new Tone.Filter(this.params.filter, 'lowpass').connect(this.compressor);

    // visual tap: post-mix, pre-volume so the mascot keeps reacting even when
    // muted or quiet. read each frame by the renderer via audioData().
    // fft -> bass (deck pulse) + level (transient notes); waveform -> scope.
    this.analyser = new Tone.Analyser('fft', 64);
    this.analyser.smoothing = 0.6;
    this.compressor.connect(this.analyser);
    this.scope = new Tone.Analyser('waveform', 128);
    this.compressor.connect(this.scope);

    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(this.masterFilter);

    // tape wobble on the keys
    this.wobble = new Tone.Vibrato(0.7, 0.06).connect(this.reverb);

    // keys: a sampled Rhodes if any pitch loaded, else the FM synth. the
    // Sampler repitches from the nearest sample, so the chordLoop and the
    // key-of-the-day transposition work unchanged with any number of samples.
    const rhodes = samples && samples.rhodes && Object.keys(samples.rhodes).length
      ? samples.rhodes
      : null;
    if (rhodes) {
      this.keys = new Tone.Sampler({
        urls: rhodes,
        attack: 0.005,
        release: 1.2,
        curve: 'exponential',
        volume: -10,
      }).connect(this.wobble);
    } else {
      this.keys = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2.5,
        modulationIndex: 4,
        oscillator: { type: 'sine' },
        modulation: { type: 'triangle' },
        envelope: { attack: 0.015, decay: 0.4, sustain: 0.5, release: 2.0 },
        modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 1.0 },
        volume: -14,
      }).connect(this.wobble);
    }

    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.6 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2 },
      volume: -10,
    }).connect(this.masterFilter);

    this.lead = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.8 },
      volume: -20,
    });
    this.leadDelay = new Tone.PingPongDelay('8n.', 0.35);
    this.leadDelay.wet.value = 0.3;
    this.lead.chain(this.leadDelay, this.reverb);

    // soft high "blip" for tool-call ticks, shares the lead's delay space.
    // also the Read/fallback tool voice.
    this.tick = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
      volume: -20,
    }).connect(this.leadDelay);

    // --- per-tool voices: dedicated one-shot instruments, ALWAYS triggered
    // via Tone.now() and NEVER shared with the transport loops (mixing now()
    // with the transport's lookahead on one source throws "time must be >= last
    // scheduled time" — see the fill-snare note below). all kept subtle so the
    // texture sits under the groove. ---

    // Bash -> dry woodblock-ish click; bypasses the master lowpass (like hats)
    this.toolPerc = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0 },
      volume: -14,
    }).connect(this.compressor);

    // Edit/Write -> short Rhodes-voiced FM stab, in the key of the day; rides
    // the same tape wobble + reverb as the chords
    this.toolStab = new Tone.FMSynth({
      harmonicity: 2.5,
      modulationIndex: 4,
      oscillator: { type: 'sine' },
      modulation: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.25, sustain: 0, release: 0.3 },
      volume: -16,
    }).connect(this.wobble);

    // Grep/Glob -> crisp hi-hat roll; its own NoiseSynth+highpass, separate
    // from the transport-driven hatSynth
    this.toolHat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
      volume: -22,
    });
    this.toolHatFilter = new Tone.Filter(9000, 'highpass');
    this.toolHat.chain(this.toolHatFilter, this.compressor);

    // WebFetch/WebSearch -> vinyl scratch: a pink-noise burst through a bandpass
    // whose cutoff we sweep on each hit to mimic the turntable friction
    this.toolScratch = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0 },
      volume: -16,
    });
    this.toolScratchFilter = new Tone.Filter(800, 'bandpass');
    this.toolScratchFilter.Q.value = 3;
    this.toolScratch.chain(this.toolScratchFilter, this.compressor);

    // kick: sampled boom-bap one-shot if present, else the membrane synth
    if (samples && samples.kick) {
      this.kickPlayer = new Tone.Player(samples.kick).connect(this.masterFilter);
      this.kickPlayer.fadeOut = 0.01; // no click if a hit gets cut short
    } else {
      this.kickSynth = new Tone.MembraneSynth({
        pitchDecay: 0.06,
        octaves: 6,
        envelope: { attack: 0.001, decay: 0.35, sustain: 0 },
        volume: -8,
      }).connect(this.masterFilter);
    }

    // snare stays behind the 1800 Hz bandpass either way: keeps the muffled
    // lofi character and lets the flourish/error filter dips color it
    this.snareFilter = new Tone.Filter(1800, 'bandpass').connect(this.masterFilter);
    if (samples && samples.snare) {
      this.snarePlayer = new Tone.Player(samples.snare).connect(this.snareFilter);
      this.snarePlayer.fadeOut = 0.01;
    } else {
      this.snareSynth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
        volume: -16,
      }).connect(this.snareFilter);
    }

    // one-shots get their own instrument: mixing Tone.now() scheduling with
    // the transport's lookahead on the same source throws "time must be
    // greater than or equal to the last scheduled time". the sampled fill
    // shares the snare's AudioBuffer but needs a separate Player instance.
    if (samples && samples.snare) {
      this.fillSnarePlayer = new Tone.Player(samples.snare).connect(this.snareFilter);
      this.fillSnarePlayer.fadeOut = 0.01;
    } else {
      this.fillSnare = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
        volume: -16,
      }).connect(this.snareFilter);
    }

    // surfaced for LOFI_DEBUG devtools: which layers got real samples
    this.layerModes = {
      keys: rhodes ? 'sample' : 'synth',
      kick: this.kickPlayer ? 'sample' : 'synth',
      snare: this.snarePlayer ? 'sample' : 'synth',
    };
    console.info('lofi-code audio layers:', JSON.stringify(this.layerModes));
    this.flourishLead = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.8 },
      volume: -20,
    });
    this.flourishLead.connect(this.leadDelay);
    this.flourishBass = new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.6 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2 },
      volume: -10,
    }).connect(this.masterFilter);

    this.hatSynth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
      volume: -27,
    });
    this.hatFilter = new Tone.Filter(8000, 'highpass');
    // hats bypass the master lowpass so they stay crisp but quiet
    this.hatSynth.chain(this.hatFilter, this.compressor);

    // vinyl bed: filtered noise whose level breathes with the state
    this.vinylNoise = new Tone.Noise('pink');
    this.vinylFilter = new Tone.Filter(3500, 'bandpass');
    this.vinylGain = new Tone.Gain(this.params.vinyl);
    this.vinylNoise.chain(this.vinylFilter, this.vinylGain, this.masterGain);
    this.vinylNoise.start();

    this.popSynth = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.001, decay: 0.012, sustain: 0 },
      volume: -18,
    }).connect(this.masterGain);

    const transport = Tone.getTransport();

    // one chord per bar, progression chosen by state
    this.chordLoop = new Tone.Loop((time) => {
      const prog = this.progressions[this.params.prog];
      const step = prog[this.barIndex % prog.length];
      this.keys.triggerAttackRelease(step.chord, '1m', time, 0.7);
      this.barIndex++;
      // long zen sessions drift between moods on their own
      if (this.state === 'idle' && ++this.idleBars >= ZEN_DRIFT_BARS) {
        this.idleBars = 0;
        this._nextZenMood();
      }
    }, '1m').start(0);

    // bass: root on 1, pickup on the "and" of 3; busy adds an octave jump on 2
    this.bassLoop = new Tone.Loop((time) => {
      if (!this.params.bass) return;
      const prog = this.progressions[this.params.prog];
      const step = prog[this.barIndex % prog.length];
      this.bass.triggerAttackRelease(step.root, '4n', time, 0.9);
      this.bass.triggerAttackRelease(step.root, '8n', time + Tone.Time('2n.').toSeconds(), 0.6);
    }, '1m').start(0);

    // 16-step drum machine; which hits fire depends on current params
    this.drumStep = 0;
    transport.scheduleRepeat((time) => {
      const s = this.drumStep % 16;
      this.drumStep++;
      const p = this.params;

      const kickSteps = { none: [], basic: [0, 8], full: [0, 8, 10] }[p.kick] || [];
      if (kickSteps.includes(s)) {
        this._playKick(time, s === 10 ? 0.55 : 0.85);
      }

      if (p.snare && (s === 4 || s === 12)) {
        this._playSnare(time, 0.6);
      }

      // hats: lazy offbeat ticks, never a 16th-note wall — steady velocities,
      // because random jitter reads as nervousness
      if (p.hats === 'basic' && s % 4 === 2) {
        this.hatSynth.triggerAttackRelease('32n', time, 0.4);
      } else if (p.hats === 'full' && s % 2 === 0) {
        this.hatSynth.triggerAttackRelease('32n', time, s % 4 === 2 ? 0.45 : 0.3);
      }

      // melody gets a touch denser as subagents join, but stays sparse
      const melodyProb = Math.min(p.melodyProb + this.busyLevel * 0.02, 0.2);
      if (melodyProb > 0 && s % 2 === 0 && Math.random() < melodyProb) {
        const note = this.pentatonic[Math.floor(Math.random() * this.pentatonic.length)];
        this.lead.triggerAttackRelease(note, '8n', time, 0.5);
      }

      // vinyl pop, rarely
      if (Math.random() < 0.04) this.popSynth.triggerAttackRelease('32n', time);
    }, '16n');

    // beat tick for the mascot's head-bob
    this.beatCount = 0;
    transport.scheduleRepeat((time) => {
      const beat = this.beatCount++;
      Tone.getDraw().schedule(() => {
        this.beatCallbacks.forEach((cb) => cb(beat));
      }, time);
    }, '4n');
  }

  setState(name) {
    if (!this.stateParams[name] || name === this.state) return;
    const upgrade = STATE_RANK[name] > STATE_RANK[this.state];
    this.state = name;
    if (name === 'idle') {
      // every return to zen lands on a different flavor
      this.idleBars = 0;
      this.zenIndex = (this.zenIndex + 1) % this.zenMoods.length;
      this.params = { ...this.stateParams.idle, ...this.zenMoods[this.zenIndex] };
    } else {
      this.params = this.stateParams[name];
    }
    if (!this.started) return;
    // long ramps: changes should be noticed a few seconds later, not felt
    // as a cut
    this.masterFilter.frequency.rampTo(this.params.filter, 2.5);
    this.vinylGain.gain.rampTo(this.params.vinyl, 3.0);
    Tone.getTransport().bpm.rampTo(this._targetBpm(), 4.0);
    if (upgrade && this.params.snare) this._drumFill();
  }

  _nextZenMood() {
    this.zenIndex = (this.zenIndex + 1) % this.zenMoods.length;
    this.params = { ...this.stateParams.idle, ...this.zenMoods[this.zenIndex] };
    this.masterFilter.frequency.rampTo(this.params.filter, 4);
    Tone.getTransport().bpm.rampTo(this.params.bpm, 6);
  }

  // subagents add melodic density (handled in the drum loop), never tempo —
  // speeding up with workload is exactly what makes music stressful
  setBusyLevel(n) {
    this.busyLevel = Math.max(0, n);
  }

  _targetBpm() {
    return this.params.bpm;
  }

  // two soft ghost snares easing the groove in — a nudge, not an alarm
  _drumFill() {
    const now = Tone.now();
    const sixteenth = Tone.Time('16n').toSeconds();
    this._playFillSnare(now, 0.2);
    this._playFillSnare(now + 2 * sixteenth, 0.3);
  }

  // drum trigger helpers: a sampled Player (velocity -> dB on its volume) or
  // the synth fallback. sampled hits on the transport have monotonic times,
  // satisfying the per-Player strictly-increasing start constraint.
  _playKick(time, vel) {
    if (this.kickPlayer) {
      this.kickPlayer.volume.setValueAtTime(KICK_DB + Tone.gainToDb(vel), time);
      this.kickPlayer.start(time);
    } else {
      this.kickSynth.triggerAttackRelease('C1', '8n', time, vel);
    }
  }

  _playSnare(time, vel) {
    if (this.snarePlayer) {
      this.snarePlayer.volume.setValueAtTime(SNARE_DB + Tone.gainToDb(vel), time);
      this.snarePlayer.start(time);
    } else {
      this.snareSynth.triggerAttackRelease('16n', time, vel);
    }
  }

  _playFillSnare(time, vel) {
    if (this.fillSnarePlayer) {
      this.fillSnarePlayer.volume.setValueAtTime(SNARE_DB + Tone.gainToDb(vel), time);
      this.fillSnarePlayer.start(time);
    } else {
      this.fillSnare.triggerAttackRelease('16n', time, vel);
    }
  }

  // per-tool blip: you can *hear* what the agent is doing, not just that it is.
  // each tool_name maps to its own voice (TOOL_VOICES); unknown tools and the
  // toolVoices=false opt-out both fall back to the soft tick. throttled per
  // voice so a storm of one tool can't turn into morse code.
  toolTick(toolName) {
    if (!this.started || this.state === 'waiting') return;
    const voice = this.toolVoices ? TOOL_VOICES[toolName] || 'tick' : 'tick';
    const now = Tone.now();
    if (now - (this.lastVoiceAt[voice] || 0) < VOICE_THROTTLE[voice]) return;
    this.lastVoiceAt[voice] = now;
    switch (voice) {
      case 'perc':    this._voicePerc(now); break;
      case 'stab':    this._voiceStab(now); break;
      case 'hat':     this._voiceHatRoll(now); break;
      case 'scratch': this._voiceScratch(now); break;
      default:        this._voiceTick(now);
    }
  }

  // mid register on purpose: high blips read as notifications
  _voiceTick(now) {
    const note = this.tickNotes[Math.floor(Math.random() * this.tickNotes.length)];
    this.tick.triggerAttackRelease(note, '16n', now, 0.25);
  }

  _voicePerc(now) {
    this.toolPerc.triggerAttackRelease('C3', '32n', now, 0.5);
  }

  _voiceStab(now) {
    const note = this.pentatonic[Math.floor(Math.random() * this.pentatonic.length)];
    this.toolStab.triggerAttackRelease(note, '16n', now, 0.3);
  }

  // three quick hits, easing off in velocity -> a short roll, not a wall
  _voiceHatRoll(now) {
    const s = Tone.Time('32n').toSeconds();
    [0.45, 0.3, 0.2].forEach((vel, i) => {
      this.toolHat.triggerAttackRelease('32n', now + i * s, vel);
    });
  }

  _voiceScratch(now) {
    // sweep the bandpass down then back up across the noise burst
    this.toolScratchFilter.frequency.cancelScheduledValues(now);
    this.toolScratchFilter.frequency.setValueAtTime(1600, now);
    this.toolScratchFilter.frequency.linearRampToValueAtTime(500, now + 0.09);
    this.toolScratchFilter.frequency.linearRampToValueAtTime(1400, now + 0.18);
    this.toolScratch.triggerAttackRelease('16n', now, 0.6);
  }

  // quick resolving arpeggio + filter opens up: "tests passed" feeling
  flourishSuccess() {
    if (!this.started) return;
    const now = Tone.now();
    this.successArp.forEach((n, i) => {
      this.flourishLead.triggerAttackRelease(n, '8n', now + i * 0.09, 0.6);
    });
    this.masterFilter.frequency.rampTo(5000, 0.3);
    this.masterFilter.frequency.rampTo(this.params.filter, 2.0, now + 0.5);
  }

  // muffle everything for a moment: "something broke" feeling
  flourishError() {
    if (!this.started) return;
    const now = Tone.now();
    this.flourishBass.triggerAttackRelease(this.errorNote, '2n', now, 0.7);
    this.masterFilter.frequency.rampTo(320, 0.15);
    this.masterFilter.frequency.rampTo(this.params.filter, 2.5, now + 0.8);
  }

  // per-frame audio snapshot for the mascot: overall level + bass energy
  // (both normalized 0..1) and the raw time-domain wave for the scope.
  // null until built.
  audioData() {
    if (!this.started || !this.analyser) return null;
    const fft = this.analyser.getValue(); // Float32Array, dB (−Infinity = silent)
    const n = fft.length;
    const norm = (db) => (isFinite(db) ? Math.max(0, Math.min(1, (db + 100) / 80)) : 0);

    let bass = 0;
    const bassBins = Math.max(1, Math.floor(n * 0.12)); // lowest ~12% of bins
    for (let i = 0; i < bassBins; i++) bass += norm(fft[i]);
    bass /= bassBins;

    let level = 0;
    for (let i = 0; i < n; i++) level += norm(fft[i]);
    level /= n;

    // time-domain wave (−1..1) for the oscilloscope; raw, no per-frame smoothing
    const wave = this.scope.getValue();
    return { level, bass, wave };
  }

  // live snapshot for the status line; bpm reads the transport, so ramps
  // show up gliding in real time
  info() {
    return {
      bpm: this.started ? Math.round(Tone.getTransport().bpm.value) : this.params.bpm,
      prog: this.params.prog,
      key: this.keyName,
    };
  }

  // live toggle: just gates the per-tool dispatch in toolTick(), so it takes
  // effect immediately without rebuilding the engine
  setToolVoices(on) {
    this.toolVoices = on !== false;
  }

  setVolume(v) {
    this.volume = Math.min(Math.max(v, 0), 1);
    if (this.started && !this.muted) {
      this.masterGain.gain.rampTo(this.volume, 0.1);
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (!this.started) return;
    this.masterGain.gain.rampTo(this.muted ? 0 : this.volume, 0.2);
  }
}

window.LofiEngine = LofiEngine;
