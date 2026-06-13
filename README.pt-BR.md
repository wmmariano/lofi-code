<h1 align="center">lofi-code 🎧</h1>

<p align="center">
  <img width="258" height="245" alt="print dj" src="https://github.com/user-attachments/assets/ab660631-7a64-4ef8-bca2-eefc82df4065" />
</p>

[English](README.md) · **Português (Brasil)**

Um mascote DJ em pixel art que flutua na sua tela tocando **lofi generativo que
reage à sua sessão do Claude Code**. Nada de playlist: a música é sintetizada
em tempo real (Tone.js) e muda conforme o que os agentes estão fazendo.

| Estado da sessão | Música | Mascote |
| --- | --- | --- |
| Parado | Só acordes + crepitar de vinil, filtro fechado | Balança devagar, pisca |
| Agente trabalhando | Entra bateria, baixo e groove | Mão no headphone, no flow |
| Subagentes em paralelo | Hats cheios, melodia, filtro aberto | *Scratch* frenético nos dois discos |
| Esperando sua permissão | Tudo abafado, sem bateria, suspensão | Para, olha pra você, balão de "!" |
| Turno concluído | Arpejo resolvendo + filtro abre | Mãos pro alto 🙌 |
| Erro em ferramenta | Filtro despenca, nota grave | Olhos arregalados, gota de suor, fader no chão |

## Rodando

```sh
pnpm install
pnpm start
```

A janela aparece no canto inferior direito: transparente, sempre por cima,
arrastável (segura e arrasta o mascote — a posição fica salva). Passe o mouse
pra ver os botões de mutar/fechar.

> Se o navegador bloquear o autoplay, clique no aviso "clique pra começar o som".

### Controles

- **Scroll do mouse** sobre o mascote: volume (com indicador na tela)
- **Arrastar** o mascote: move a janela (posição persiste entre sessões)
- **♪** no hover: muta/desmuta · **×**: fecha
- **Bandeja do sistema**: mostrar/esconder o DJ, mutar, iniciar com o
  sistema, sair. (No GNOME, ícones de bandeja precisam da extensão
  AppIndicator.)

### Configuração

Tudo é calibrável em `~/.config/lofi-code/config.json` (Linux; no macOS fica
em `~/Library/Application Support/lofi-code/`, no Windows em `%APPDATA%`).
O arquivo é criado/atualizado pelo próprio app (volume, mute e posição da
janela são salvos automaticamente), e aceita overrides musicais:

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

- `stateParams`: qualquer campo de qualquer estado (`idle`, `working`,
  `busy`, `waiting`) — `bpm`, `filter` (cutoff em Hz), `kick`, `snare`,
  `hats`, `bass`, `melodyProb`, `vinyl`, `prog`. O que não for definido usa
  o padrão.
- `zenMoods`: substitui a lista de moods do zen (`prog` pode ser `chill`,
  `dreamy`, `nocturne` ou `drive`).
- `skin`: visual do mascote — `"purple"` (padrão), `"green"`, `"pink"` ou
  `"cat"` (gatinha DJ laranja, com orelhas e bigodes).
- `dailyKey`: liga/desliga o **tom do dia** (padrão `true`) — uma
  transposição derivada da data, então cada dia soa numa tonalidade
  diferente (o tom atual aparece no status do zen, no hover). Com
  `"dailyKey": false`, tudo volta ao tom original (Dó).
- `transpose`: fixa a tonalidade em N semitons acima de Dó, ignorando o
  `dailyKey` (ex.: `3` = sempre Mib).
- `engine`: `"samples"` (padrão) usa os arquivos de `renderer/samples/` pro
  Rhodes e a bateria, se existirem; `"synth"` força a síntese pura e nem
  carrega os samples.
- `port`: porta do servidor de eventos (lembre de trocar nos hooks também).

Mudanças no config pedem restart do app.

## Conectando ao Claude Code

O app escuta eventos em `http://127.0.0.1:8765/event`. Os hooks do Claude Code
mandam o JSON de cada evento pra lá — nenhum dado sai da sua máquina.

Os hooks enviam **o mínimo possível**: nada do payload original do Claude Code
(que inclui `cwd`, caminhos de transcript e inputs de ferramentas) sai do
processo do hook. Seis eventos mandam um JSON fixo com só o nome do evento;
`PreToolUse` extrai apenas o `tool_name` e `PostToolUse` apenas um booleano
`errored` (via `jq`, que decide na origem — a resposta da ferramenta nunca é
enviada).

Edite `~/.claude/settings.json` e adicione o bloco `hooks` abaixo (se o arquivo
já tiver uma chave `hooks`, mescle as entradas dentro dela):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' -d '{\"hook_event_name\":\"SessionStart\"}' </dev/null >/dev/null 2>&1 || true" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' -d '{\"hook_event_name\":\"UserPromptSubmit\"}' </dev/null >/dev/null 2>&1 || true" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name, tool_name}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "jq -c '{hook_event_name, errored: (((.tool_response? | objects | .is_error?) // false) == true)}' | curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' -d '{\"hook_event_name\":\"Notification\"}' </dev/null >/dev/null 2>&1 || true" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' -d '{\"hook_event_name\":\"Stop\"}' </dev/null >/dev/null 2>&1 || true" }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' -d '{\"hook_event_name\":\"SubagentStop\"}' </dev/null >/dev/null 2>&1 || true" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' -d '{\"hook_event_name\":\"SessionEnd\"}' </dev/null >/dev/null 2>&1 || true" }] }
    ]
  }
}
```

Depois de salvar, **reinicie as sessões do Claude Code** pra os hooks valerem.

Notas:

- Payloads enviados, na íntegra: `{"hook_event_name":"..."}` nos seis eventos
  fixos; `{"hook_event_name":"PreToolUse","tool_name":"..."}` no PreToolUse;
  `{"hook_event_name":"PostToolUse","errored":true|false}` no PostToolUse.
  Nada mais cruza a porta — e o destino é `127.0.0.1`, local.
- `PreToolUse`/`PostToolUse` precisam de `jq` instalado (`sudo apt install jq`
  / `brew install jq`). Sem jq, esses dois eventos podem ser omitidos: você
  perde o blip por ferramenta, o modo busy e a detecção de erro, mas o resto
  funciona.
- O `matcher: "*"` em `PreToolUse`/`PostToolUse` significa "qualquer
  ferramenta"; os demais eventos não usam matcher.
- O `-m 1` limita o curl a 1s e o `|| true` engole falhas: se o app estiver
  fechado, **nada quebra nem atrasa o Claude**.

### O que o app faz com cada evento

| `hook_event_name` | Efeito no app |
| --- | --- |
| `SessionStart` | Acorda do zen → groove de trabalho |
| `UserPromptSubmit` | Groove de trabalho (cancela pose de vitória/erro pendente) |
| `PreToolUse` | Blip percussivo; se `tool_name` for `Task` ou `Agent`, conta +1 subagente → modo busy |
| `PostToolUse` | Mantém o groove; se a resposta indicar erro, flourish de erro |
| `Notification` | Modo "esperando você": tudo abafado, mascote aponta pro terminal |
| `Stop` | Arpejo de vitória, mãos pro alto, e em seguida desmonta pro zen |
| `SubagentStop` | Conta −1 subagente; sem subagentes, volta do busy pro working |
| `SessionEnd` | Volta pro zen |

Qualquer outro `hook_event_name` (ou `tool_name`) é simplesmente ignorado —
mandar eventos a mais não tem efeito colateral.

### Funciona com qualquer agente

O lofi-code não sabe o que é Claude Code: qualquer coisa que POSTar
`{"hook_event_name": "..."}` em `localhost:8765` faz o DJ dançar — Codex CLI,
Cursor, seu CI, um git hook celebrando commits. A especificação completa do
protocolo, com receitas de integração, está em
[PROTOCOL.pt-BR.md](PROTOCOL.pt-BR.md).

### Testando sem o agente

```sh
curl -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"UserPromptSubmit"}'

curl -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"PreToolUse","tool_name":"Task"}'

curl -X POST http://127.0.0.1:8765/event -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"Stop"}'
```

E `curl http://127.0.0.1:8765/health` responde `ok` se o app estiver no ar.

## Como funciona

- `main.js` — janela Electron transparente/frameless + servidor HTTP local que
  encaminha os eventos dos hooks pro renderer.
- `renderer/audio.js` — engine de lofi generativo: Fmaj7→Em7→Dm7→Cmaj7 a
  74 BPM com swing, Rhodes FM com wobble de fita, bateria boom-bap sintetizada,
  ruído de vinil. Estados trocam camadas e cutoff do filtro com crossfade.
- `renderer/mascot.js` — o DJ desenhado pixel a pixel em canvas (zero assets),
  com poses por estado, discos girando e notas musicais flutuando no beat.
- `renderer/app.js` — máquina de estados que traduz eventos de hook em
  estado musical/visual.

## Plataformas

Electron roda em Linux, macOS e Windows. No Linux com Wayland a transparência
depende do compositor (GNOME/KDE funcionam; em outros pode aparecer fundo
preto — rode com `XDG_SESSION_TYPE=x11` como fallback).

### Instrumentos com samples (opcional)

Por padrão a música é toda sintetizada. Para um som mais quente, de "lofi de
playlist", dá pra trocar os acordes do Rhodes e o kick/snare por samples
reais **CC0** do [freesound.org](https://freesound.org):

```sh
FREESOUND_API_KEY=sua-chave pnpm fetch-samples
```

Pegue uma chave grátis em <https://freesound.org/apiv2/apply/>. O script baixa
os sons CC0 mais baixados de cada papel para `renderer/samples/`, verifica e
gera `renderer/samples/CREDITS.md` com a atribuição. Os samples **não** são
commitados — sem eles (ou sem a chave) o app cai pra síntese, então um clone
puro sempre funciona. Reinicie o app depois de baixar.

Solte seus próprios arquivos nomeados por nota em `renderer/samples/rhodes/`
(ex.: `E2.ogg`, `G3.ogg`) pra um multisample de verdade — a engine repitcha a
partir de quantos encontrar.

## Roadmap

### Reatividade mais esperta

- [ ] **Instrumentos por ferramenta** — ouvir a textura da sessão: mapear cada
  `tool_name` pro seu próprio som (`Bash` uma perc seca, `Edit`/`Write` um
  stab de Rhodes, `Grep`/`Glob` um roll de hi-hat, `Read` um tick suave,
  `WebFetch` um scratch de vinil). O hook já manda `tool_name` — zero dado
  novo.
- [ ] **O set que se constrói** — em vez de loops estáticos por estado, um
  arco: quanto mais tempo em flow, mais camadas entram (uma contra-melodia
  aos ~5 min, um pad aos ~10) e tudo cai num breakdown quando você fica idle.
  Usa o relógio de `lastActivity` que já existe.
- [ ] **Sistema de streak** — uma sequência de `PostToolUse` sem erro deixa a
  track mais confiante (filtro abre, hats incrementam); um `errored` quebra o
  combo com um needle-skip marcante. Tudo derivável do flag `errored`.
- [ ] **Multi-sessão** — com dois Claude Code abertos, os eventos hoje se
  misturam (um `Stop` de uma sessão derruba o busy da outra). Rastrear por
  `session_id` (um UUID, continua mínimo) e o estado global vira a soma das
  sessões. Quase obrigatório pra quem roda agentes em paralelo.
- [ ] **Flourish de commit** — momento musical especial quando um
  `git commit` acontece. Detectável sem vazar nada: matcher de `PreToolUse`
  pra Bash + `jq` mandando só um booleano `is_commit`.

### Visual & clima

- [ ] **Ciclo dia-noite + mood por horário** — a iluminação da booth e o mood
  do zen acompanham o relógio: mais claro de manhã, indo pro `nocturne` na
  madrugada. Combina com o tom do dia que já existe.
- [ ] **Easter eggs** — Konami code troca a skin; mensagem de commit com emoji
  dispara um som especial; um atalho de "boss mode" minimiza tudo pra só
  vinil.

### Pra fora do desktop

- [ ] **Empacotar com electron-builder** — AppImage/deb, dmg e exe pra
  instalar sem clonar o repo.
- [ ] **Recap da sessão / "Coding Wrapped"** — no `SessionEnd`, um cartão
  pixel-art: duração, nº de ferramentas, maior streak sem erro, "no flow por
  X min", o tom que tocou. Exportável como imagem — se divulga sozinho.
- [ ] **Gravar o set** — a música de cada sessão é determinística (engine +
  tom do dia + seus eventos), então um `MediaRecorder` no master pode dumpar
  uma track única por sessão: o som da sua terça-feira codando.
