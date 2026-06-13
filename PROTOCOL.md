# lofi-code protocol

**English** · [Português (Brasil)](PROTOCOL.pt-BR.md)

lofi-code knows nothing about Claude Code: it just listens on a local HTTP
endpoint. **Anything** — agent, IDE, CI or script — that POSTs a tiny JSON
makes the DJ dance. This document is the full specification for integrating
whatever you want.

## Transport

| | |
| --- | --- |
| Endpoint | `POST http://127.0.0.1:8765/event` |
| Content-Type | `application/json` |
| Response | `200 ok` (body irrelevant — fire-and-forget) |
| Health check | `GET http://127.0.0.1:8765/health` → `ok` |

The server only listens on `127.0.0.1` — nothing enters or leaves the machine.
The port is configurable (`port` in the config; see the README).

Recommendation for senders: use a short timeout and swallow failures, so your
agent is never slowed down when the app is closed:

```sh
curl -s -m 1 -X POST http://127.0.0.1:8765/event \
  -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"Stop"}' >/dev/null 2>&1 || true
```

## Payload

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Task",
  "errored": false
}
```

- `hook_event_name` (string, required) — which event happened. Unknown names
  are ignored with no side effects.
- `tool_name` (string, optional) — only has an effect on `PreToolUse`: the
  values `Task` or `Agent` count +1 active subagent.
- `errored` (boolean, optional) — only has an effect on `PostToolUse`: `true`
  triggers the error flourish.

Extra fields are ignored. Send the minimum.

## Events and effects

| `hook_event_name` | Meaning | Effect |
| --- | --- | --- |
| `SessionStart` | Agent session started | Leaves zen → work groove |
| `UserPromptSubmit` | Human sent a task | Work groove; cancels pending pose |
| `PreToolUse` | Agent is about to use a tool | Percussive blip; `tool_name: Task/Agent` → +1 subagent (busy mode) |
| `PostToolUse` | Tool finished | Keeps the groove; `errored: true` → error flourish |
| `Notification` | Agent waiting on the human | Muffled mode, mascot points at the terminal |
| `Stop` | Agent finished the task | Victory arpeggio → winds down to zen; resets subagents |
| `SubagentStop` | One subagent finished | −1 subagent; at zero, drops out of busy |
| `SessionEnd` | Session ended | Back to zen |

## State machine (what you'll hear)

- **zen** — no events for 30s: chords + vinyl only, no drums.
- **working** — any recent activity: full groove at ~74 BPM.
- **busy** — ≥1 active subagent: more layers, minor progression, ~76 BPM.
- **waiting** — after `Notification`: everything muffled until the next
  activity.
- Victory (`Stop`) and error (`errored`) are ~2.5s moments on top of the
  groove, not states.

With no new events, the app decays back to zen on its own — you don't need to
send any "keepalive".

## Integration recipes

**End of build/tests (any CI or script):**

```sh
npm test && EV=Stop || EV='PostToolUse","errored":true'
curl -s -m 1 -X POST http://127.0.0.1:8765/event \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"$EV\"}" >/dev/null 2>&1 || true
```

**Celebrate every commit (git hook)** — in `.git/hooks/post-commit`:

```sh
#!/bin/sh
curl -s -m 1 -X POST http://127.0.0.1:8765/event \
  -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"Stop"}' >/dev/null 2>&1 || true
```

**Other coding agents** (Codex CLI, Cursor, etc.): use the tool's hook/notify
mechanism to fire the curl above at the equivalent moments — task start
(`UserPromptSubmit`), tool use (`PreToolUse`), finish (`Stop`). The DJ doesn't
care who sent it.

**Claude Code**: ready-made hooks block in the
[README](README.md#connecting-to-claude-code).
