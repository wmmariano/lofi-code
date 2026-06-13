# Protocolo do lofi-code

[English](PROTOCOL.md) · **Português (Brasil)**

O lofi-code não conhece o Claude Code: ele só escuta um endpoint HTTP local.
**Qualquer** agente, IDE, CI ou script que POSTar um JSON minúsculo faz o DJ
dançar. Este documento é a especificação completa pra integrar o que você
quiser.

## Transporte

| | |
| --- | --- |
| Endpoint | `POST http://127.0.0.1:8765/event` |
| Content-Type | `application/json` |
| Resposta | `200 ok` (corpo irrelevante — fire-and-forget) |
| Health check | `GET http://127.0.0.1:8765/health` → `ok` |

O servidor só escuta em `127.0.0.1` — nada entra ou sai da máquina. A porta é
configurável (`port` no config; veja o README).

Recomendação para quem envia: use timeout curto e engula falhas, pra nunca
atrasar o seu agente quando o app estiver fechado:

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

- `hook_event_name` (string, obrigatório) — qual evento aconteceu. Nomes
  desconhecidos são ignorados sem efeito colateral.
- `tool_name` (string, opcional) — só tem efeito em `PreToolUse`: os valores
  `Task` ou `Agent` contam +1 subagente ativo.
- `errored` (boolean, opcional) — só tem efeito em `PostToolUse`: `true`
  dispara o flourish de erro.

Campos extras são ignorados. Mande o mínimo.

## Eventos e efeitos

| `hook_event_name` | Significado | Efeito |
| --- | --- | --- |
| `SessionStart` | Sessão do agente começou | Sai do zen → groove de trabalho |
| `UserPromptSubmit` | Humano mandou uma tarefa | Groove de trabalho; cancela pose pendente |
| `PreToolUse` | Agente vai usar uma ferramenta | Blip percussivo; `tool_name: Task/Agent` → +1 subagente (modo busy) |
| `PostToolUse` | Ferramenta terminou | Mantém o groove; `errored: true` → flourish de erro |
| `Notification` | Agente esperando o humano | Modo abafado, mascote aponta pro terminal |
| `Stop` | Agente concluiu a tarefa | Arpejo de vitória → desmonta pro zen; zera subagentes |
| `SubagentStop` | Um subagente terminou | −1 subagente; em zero, volta do busy |
| `SessionEnd` | Sessão encerrou | Volta pro zen |

## Máquina de estados (o que você vai ouvir)

- **zen** — nenhum evento há 30s: só acordes + vinil, sem bateria.
- **working** — qualquer atividade recente: groove completo a ~74 BPM.
- **busy** — ≥1 subagente ativo: mais camadas, progressão menor, ~76 BPM.
- **waiting** — após `Notification`: tudo abafado até a próxima atividade.
- Vitória (`Stop`) e erro (`errored`) são momentos de ~2,5s por cima do
  groove, não estados.

Sem eventos novos, o app decai sozinho pro zen — você não precisa mandar
"keepalive".

## Receitas de integração

**Fim de build/testes (qualquer CI ou script):**

```sh
npm test && EV=Stop || EV='PostToolUse","errored":true'
curl -s -m 1 -X POST http://127.0.0.1:8765/event \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"$EV\"}" >/dev/null 2>&1 || true
```

**Celebrar todo commit (git hook)** — em `.git/hooks/post-commit`:

```sh
#!/bin/sh
curl -s -m 1 -X POST http://127.0.0.1:8765/event \
  -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"Stop"}' >/dev/null 2>&1 || true
```

**Outros agentes de código** (Codex CLI, Cursor, etc.): use o mecanismo de
hooks/notify da ferramenta pra disparar o curl acima nos momentos
equivalentes — começo de tarefa (`UserPromptSubmit`), uso de ferramenta
(`PreToolUse`), fim (`Stop`). O DJ não faz distinção de quem mandou.

**Claude Code**: bloco de hooks pronto no
[README](README.pt-BR.md#conectando-ao-claude-code).
