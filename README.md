<h1 align="center">lofi-code 🎧</h1>

<p align="center">
  <img width="258" height="245" alt="print dj" src="https://github.com/user-attachments/assets/ab660631-7a64-4ef8-bca2-eefc82df4065" />
</p>

**English** · [Português (Brasil)](README.pt-BR.md)

A pixel-art DJ mascot that floats on your screen playing **generative lofi that
reacts to your Claude Code session**. No playlists: the music is synthesized in
real time (Tone.js) and changes with whatever your agents are doing.

| Session state | Music | Mascot |
| --- | --- | --- |
| Idle | Chords + vinyl crackle only, closed filter | Sways slowly, blinks |
| Agent working | Drums, bass and groove kick in | Hand on headphone, in the flow |
| Subagents in parallel | Full hats, melody, open filter | Frantic *scratching* on both decks |
| Waiting for your permission | Everything muffled, no drums, suspension | Stops, looks at you, "!" speech bubble |
| Turn completed | Resolving arpeggio + filter opens | Hands in the air 🙌 |
| Tool error | Filter drops, low note | Wide eyes, sweat drop, fader on the floor |

## Running

```sh
pnpm install
pnpm start
```

The window shows up in the bottom-right corner: transparent, always on top,
draggable (hold and drag the mascot — the position is saved). Hover to reveal
the mute/close buttons.

> If the browser blocks autoplay, click the "click to start the sound" notice.

### Controls

- **Mouse scroll** over the mascot: volume (with on-screen indicator)
- **Drag** the mascot: moves the window (position persists across sessions)
- **♪** on hover: mute/unmute · **×**: close
- **System tray**: show/hide the DJ, mute, start with the system, quit.
  (On GNOME, tray icons require the AppIndicator extension.)

### Configuration

Everything is tunable in `~/.config/lofi-code/config.json` (Linux; on macOS
it lives in `~/Library/Application Support/lofi-code/`, on Windows in
`%APPDATA%`). The file is created/updated by the app itself (volume, mute and
window position are saved automatically), and accepts musical overrides:

```json
{
  "port": 8765,
  "volume": 0.7,
  "stateParams": {
    "working": { "bpm": 72, "vinyl": 0.004 },
    "busy": { "filter": 2000 }
  },
  "zenMoods": [
    { "prog": "dreamy", "bpm": 64, "filter": 700 }
  ]
}
```

- `stateParams`: any field of any state (`idle`, `working`, `busy`,
  `waiting`) — `bpm`, `filter` (cutoff in Hz), `kick`, `snare`, `hats`,
  `bass`, `melodyProb`, `vinyl`, `prog`. Anything left undefined uses the
  default.
- `zenMoods`: replaces the zen mood list (`prog` can be `chill`, `dreamy`,
  `nocturne` or `drive`).
- `skin`: mascot look — `"purple"` (default), `"green"`, `"pink"` or
  `"cat"` (orange DJ kitty, with ears and whiskers).
- `dailyKey`: toggles the **key of the day** (default `true`) — a
  transposition derived from the date, so each day plays in a different key
  (the current key shows up in the zen status, on hover). With
  `"dailyKey": false`, everything goes back to the original key (C).
- `transpose`: pins the key at N semitones above C, ignoring `dailyKey`
  (e.g. `3` = always Eb).
- `engine`: `"samples"` (default) uses the files in `renderer/samples/` for
  the Rhodes and drums if present; `"synth"` forces pure synthesis and skips
  loading samples entirely.
- `toolVoices`: per-tool sounds on `PreToolUse` (default `true`) — each
  `tool_name` gets its own subtle voice so you can hear the texture of the
  session (see the table below). `false` goes back to a single generic blip.
  Also toggleable live in the ⚙ settings panel (no restart).
- `port`: event server port (remember to change it in the hooks too).

When `toolVoices` is on, each tool maps to its own sound:

| `tool_name` | Sound |
| --- | --- |
| `Bash` | dry woodblock click |
| `Edit` / `Write` / `MultiEdit` / `NotebookEdit` | Rhodes stab (in the key of the day) |
| `Grep` / `Glob` | short hi-hat roll |
| `Read` / `LS` | soft tick |
| `WebFetch` / `WebSearch` | vinyl scratch |
| anything else (incl. `Task` / `Agent`) | soft tick |

Config changes require an app restart.

## Connecting to Claude Code

The app listens for events at `http://127.0.0.1:8765/event`. Claude Code hooks
send each event's JSON there — no data ever leaves your machine.

The hooks send **the bare minimum**: nothing from Claude Code's original
payload (which includes `cwd`, transcript paths and tool inputs) leaves the
hook process. Each hook uses `jq` to forward only the event name and the opaque
`session_id` (so two parallel sessions don't clobber each other's busy mode);
`PreToolUse` adds the `tool_name` and `PostToolUse` an `errored` boolean — `jq`
decides at the source, so the tool response is never sent.

Edit `~/.claude/settings.json` and add the `hooks` block below (if the file
already has a `hooks` key, merge the entries into it):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name:\"SessionStart\", session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name:\"UserPromptSubmit\", session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name, tool_name, session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name, errored: (((.tool_response? | objects | .is_error?) // false) == true), session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name:\"Notification\", session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name:\"Stop\", session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name:\"SubagentStop\", session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name:\"SessionEnd\", session_id}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ]
  }
}
```

After saving, **restart your Claude Code sessions** for the hooks to take
effect.

Notes:

- Payloads sent, in full: `{"hook_event_name":"...","session_id":"..."}` for
  the six basic events; PreToolUse adds `"tool_name":"..."` and PostToolUse adds
  `"errored":true|false`. The `session_id` is an opaque UUID — nothing else
  crosses the port, and the destination is `127.0.0.1`, local.
- All hooks now require `jq` (`sudo apt install jq` / `brew install jq`) to
  read `session_id` from the hook's stdin. Without `jq` you can drop the `jq -c
  '...' |` prefix and use `curl ... -d '{"hook_event_name":"SessionStart"}'`
  instead: everything still works, but all sessions collapse into one shared
  bucket (the pre-multi-session behavior).
- The `matcher: "*"` in `PreToolUse`/`PostToolUse` means "any tool"; the
  other events take no matcher.
- The `-m 1` caps curl at 1s and the `|| true` swallows failures: if the app
  is closed, **nothing breaks or slows Claude down**.

### What the app does with each event

| `hook_event_name` | Effect in the app |
| --- | --- |
| `SessionStart` | Wakes from zen → work groove |
| `UserPromptSubmit` | Work groove (cancels pending victory/error pose) |
| `PreToolUse` | Per-tool blip (voiced by `tool_name`, see `toolVoices`); if `tool_name` is `Task` or `Agent`, also counts +1 subagent → busy mode |
| `PostToolUse` | Keeps the groove; if the response indicates an error, error flourish |
| `Notification` | "Waiting for you" mode: everything muffled, mascot points at the terminal |
| `Stop` | Victory arpeggio, hands in the air, then winds down to zen |
| `SubagentStop` | Counts −1 subagent; with no subagents, drops from busy back to working |
| `SessionEnd` | Back to zen |

Any other `hook_event_name` (or `tool_name`) is simply ignored — sending
extra events has no side effects.

### Works with any agent

lofi-code has no idea what Claude Code is: anything that POSTs
`{"hook_event_name": "..."}` to `localhost:8765` makes the DJ dance — Codex
CLI, Cursor, your CI, a git hook celebrating commits. The full protocol
specification, with integration recipes, lives in [PROTOCOL.md](PROTOCOL.md).

### Testing without the agent

```sh
curl -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"UserPromptSubmit"}'

curl -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"PreToolUse","tool_name":"Task"}'

curl -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"Stop"}'
```

And `curl http://127.0.0.1:8765/health` answers `ok` if the app is up.

## How it works

- `main.js` — transparent/frameless Electron window + local HTTP server that
  forwards hook events to the renderer.
- `renderer/audio.js` — generative lofi engine: Fmaj7→Em7→Dm7→Cmaj7 at
  74 BPM with swing, FM Rhodes with tape wobble, synthesized boom-bap drums,
  vinyl noise. States swap layers and filter cutoff with crossfades.
- `renderer/mascot.js` — the DJ drawn pixel by pixel on canvas (zero assets),
  with per-state poses, spinning decks and musical notes floating on the beat.
- `renderer/app.js` — state machine that translates hook events into
  musical/visual state.

## Platforms

Electron runs on Linux, macOS and Windows. On Linux with Wayland, transparency
depends on the compositor (GNOME/KDE work; others may show a black background
— run with `XDG_SESSION_TYPE=x11` as a fallback).

### Sampled instruments (optional)

Out of the box the music is fully synthesized. For a warmer, "playlist lofi"
sound you can swap the Rhodes chords and the kick/snare for real **CC0**
samples from [freesound.org](https://freesound.org):

```sh
FREESOUND_API_KEY=your-key pnpm fetch-samples
```

Get a free key at <https://freesound.org/apiv2/apply/>. The script downloads
the most-downloaded CC0 sounds for each role into `renderer/samples/`,
verifies them and writes `renderer/samples/CREDITS.md` with attribution. The
samples are **not** committed — without them (or without a key) the app simply
falls back to synthesis, so a bare clone always works. Restart the app after
fetching.

Drop your own pitch-named files into `renderer/samples/rhodes/` (e.g.
`E2.ogg`, `G3.ogg`) for a truer multisample — the engine repitches from
however many it finds.

## Roadmap

### Smarter reactivity

- [ ] **The set that builds** — instead of static per-state loops, develop an
  arc: the longer you stay in flow, the more layers come in (a counter-melody
  at ~5 min, a pad at ~10), then a breakdown when you go idle. Drives off the
  existing `lastActivity` clock.
- [ ] **Streak system** — a run of clean `PostToolUse` calls makes the track
  more confident (filter opens, hats build); an `errored` breaks the combo
  with a pronounced needle-skip. All derivable from the `errored` flag.
- [ ] **Commit flourish** — a special musical moment when a `git commit`
  happens. Detectable without leaking anything: a `PreToolUse` matcher for
  Bash + `jq` sending only an `is_commit` boolean.

### Visuals & ambience

- [ ] **Day/night cycle + time-of-day mood** — the booth lighting and the zen
  mood follow the clock: brighter in the morning, drifting to `nocturne` late
  at night. Pairs with the existing key of the day.
- [ ] **Easter eggs** — Konami code swaps the skin; a commit message with an
  emoji triggers a special hit; a "boss mode" hotkey minimizes everything to
  just vinyl.

### Beyond the desktop

- [ ] **Package with electron-builder** — AppImage/deb, dmg and exe to
  install without cloning the repo.
- [ ] **Session recap / "Coding Wrapped"** — on `SessionEnd`, a pixel-art
  card: duration, tool count, longest error-free streak, "in flow for X min",
  the key that played. Exportable as an image — shares itself.
- [ ] **Record the set** — each session's music is deterministic (engine +
  key of the day + your events), so a `MediaRecorder` on the master can dump
  a unique track per session: the sound of your Tuesday coding.
