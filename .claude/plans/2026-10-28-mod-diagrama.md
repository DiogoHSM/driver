# Plano: mod do diagrama vivo do DRIVER (painel do grafo de plano)

## Contexto

O `plan.json` v1 está implementado e commitado (`6dfb08a`). O ADR-009 prevê um mod do core que espelha o arquivo e desenha o grafo ao lado do chat (SVG no Desktop/VS Code, Box/Text no terminal), registra tools para o modelo mudar estado sem escrever JSON e dá ao usuário um canal de aprovação de gate que o modelo não consegue invocar. A revisão adversarial do v1 deixou dois pontos que só o mod fecha: o canal de aprovação à prova de modelo (hoje é TTY, contornável com pseudoterminal) e o mapeamento `agent_id` → bloco para o owner.

Resultado esperado: painel funcional no Desktop e no terminal, tools `mcp__driver__*`, comandos `/driver`, claim de owner em `agent.spawn` (cobre também agentes de Workflow), testes com `claude plugin test` e vitest, ADR-011.

## Fatos da plataforma (levantados em `claude-code.d.ts` 2.1.312 e no reference do skill plugin-authoring)

- Mod = módulo `register(on)` listado em `hooks/hooks.json` sob `"modules"`. Sem DOM e sem Node: não importa zod nem `node:*`; importa arquivos TS do plugin sem dependências; imports só de tipo são livres.
- `Box/Text/Button/Select/Markdown/Input` em todas as superfícies; `Svg` (source ≤131.072 chars, `alt` obrigatório, `isInteractive` para `<title>` tooltips) só desktop/vscode/mobile; terminal tem `Raster`.
- `$.fs.read/write/list/exists/stat` (mtimeMs, `resolve:true` dá `realPath`); sem watch → `$.clock.every`. `$.process.run(argv, {cwd, env, stdin, timeoutMs})` sem shell; doc marca "CLI only": verificar no Desktop no primeiro load.
- `$.tool.register({isDeferred:false})` → `mcp__driver__<name>`, servido por `on('tool.call',{tool})`. `$.command.register` → `/driver`, servido por `on('command.run')` sem turno de modelo; **`e.origin.kind === 'composer'` só quando o usuário digitou**; `ui.press` também é iniciado pela pessoa. O modelo não produz nenhum dos dois.
- `on('agent.spawn')` vê `e.prompt`/`e.description` e `await next(e)` devolve `{ agentId }`; cobre subagents da tool Agent e agentes de Workflow (cujo prompt pode ser placeholder: fallback `currentPhase`).
- `$.plugin.root` é o diretório do plugin. Estado em `$.state` via `atom/read/update`, contrato em `types/index.d.ts`; render nunca escreve. `claude plugin test <dir>` roda `*.test.ts(x)`.
- Achado da revisão: `protectPlan` compara paths com regex sensível a caixa; em APFS `.Claude/Driver/plan.json` passa. Corrigir no node e no mod (realPath + comparação case-insensitive).

## Design

### 1. Layout de arquivos (em `plugins/driver`)

```
hooks/hooks.json          + "modules": ["../mod/index.tsx"]; os 3 hooks shell continuam
mod/index.tsx             register(): session.start, wiring
mod/state.ts              atoms tipados + poller (ensurePoller idempotente)
mod/cli.ts                runCli(args,{stdin}) → {ok,json,error}; descoberta do node (zsh -lc 'command -v node', cache em $.store, userConfig nodePath)
mod/pane.tsx              ui.render Pane: switch por superfície
mod/render-terminal.tsx   Box/Text
mod/tools.ts              set_block_state, plan_ops, plan_status
mod/hooks.ts              agent.spawn, classic.SubagentStop, tool.call guard
mod/approve.ts            ticket + /driver approve
mod/test/*.test.tsx       claude plugin test
src/shared/               SEM DEPENDÊNCIAS (nem zod, nem node:*, nem DOM)
  phases.ts               PHASES, BLOCK_STATUSES, phaseIndex, glifos/rótulos de status
  palette.ts              status → fill/stroke/text (mermaid.ts passa a importar daqui)
  plan-doc.ts             interface estrutural PlanDoc (só campos que leitores usam)
  view.ts                 project(plan) → PlanView; shapeCheck(raw)
  gate.ts                 gateVerdict(plan, promptText) (movido de src/hooks.ts)
  protect.ts              protectPlan + normalizeCommand (movido de src/hooks.ts)
  layout.ts               layout(view, opts) → coordenadas
  svg.ts                  toSvg(layout, view, opts) → string
  rows.ts                 modelo de linhas do terminal
types/index.d.ts          declare module 'claude-code' { interface PluginState { driver: {...} } }
```

Toolchain: `schema.ts` reexporta `PHASES`/`BLOCK_STATUSES` de `shared/phases.ts` e monta `z.enum` em cima; `src/hooks.ts` (node) importa `gate.ts` e `protect.ts`, uma implementação só. Teste de tipo no vitest garante `PlanV1` compatível com `PlanDoc`. `tsconfig.json` atual vira `tsconfig.node.json`; novo `tsconfig.json` raiz estende `./.claude-plugin/types/tsconfig.json` (gerado pelo engine no primeiro load) com `include: mod, src/shared, types` e `types: []`, o que faz qualquer `node:` em `src/shared` falhar no typecheck. Testes vitest renomeados para `*.spec.ts` (o `claude plugin test` coleta `*.test.ts(x)`). tsup continua só para a CLI. Gitignore `.claude-plugin/types/` e `.claude/driver/.mod/`.

### 2. Novos comandos/ops da CLI exigidos pelo mod

| Comando | Função |
|---|---|
| `driver where --json` | `{root, driverDir, planExists}`; resolução de raiz em um lugar só |
| `driver apply --json` | lê `{ops[], expectedRevision?}` do stdin; aplica tudo sob um lock, valida uma vez, grava uma vez, um evento por op; ids anteriores referenciáveis como `"$0"` |
| `--expect-revision N` | flag global mapeada em `expectedRevision` do `mutate` |
| `block owner <id> <agentId> --from <prev>` | op `block.owner` (CAS: exige `in_progress` e `owner === from`), evento `owner` |
| `gate approve <g> --via-mod` | lê nonce do stdin; valida ticket (seção 8) |
| `status --json` | projeção compacta (já existe `status`; adicionar `--json`) |

### 3. Fluxo de dados

- `session.start`: `where`; registra tools e comandos; abre o painel só se `e.isInteractive && e.surface !== 'terminal' && planExists` (no terminal abre por `/driver`); `ensurePoller`.
- Poller: `$.clock.every(1000)` com painel aberto, `5000` fechado. Tick: `$.fs.stat` compara `(mtimeMs, size)`; só então lê, `JSON.parse`, `shapeCheck`, compara `revision`; grava em `$.state` só se mudou. Após cada escrita do mod, tick imediato. Hooks nunca usam cache: sempre leem fresco. `ensurePoller` é chamado de `session.start`, `command.run`, `ui.press`, `tool.call` e do primeiro `ui.render` (timers morrem no hot reload).
- `$.state.driver`: `paths`, `load` (`none|ok|invalid{issues}|error`), `view: PlanView` (~150 bytes/bloco: id, title, phase, status, owner, reason, deps, contagens de reqs/tests, verified, risk, retired, since), `ui` (focus, collapseDone, showRetired, selected, confirm), `detail`, `claims`.
- Estados do painel: sem plano → `Input` com nome da pasta + botão **Initialize** (`driver init`); plano inválido → erros do `validate --json` primeiro, última view boa esmaecida com banner "stale desde rev N"; headless → nunca `ui.open`, tools/hooks/comandos seguem funcionando.

### 4. Renderização SVG (desktop/vscode)

Colunas = swimlanes de fase, subcolunas por profundidade dentro da fase (gates ficam entre fases; layering global espalharia uma fase por várias colunas). `layout.ts` puro e determinístico:

Constantes: `NW=176 NH=44 CG=40 RG=10 LP=14 LG=28 M=12 HH=34 LEG=30 MAXR=12 MINW=92 PX_PER_COL=8`.

1. Conjunto visível: sem retirados (salvo `showRetired`), filtro de fase; `deps(b)` = `dependsOn` ∩ visíveis.
2. Profundidade local por fase: `d(b)=0` sem deps na fase, senão `1+max d(dep)`; DFS memoizada; ciclo descarta a aresta e marca `cyc`.
3. Quebra de coluna: grupo de profundidade com `n>MAXR` vira `ceil(n/MAXR)` colunas físicas; `S_p` colunas por fase.
4. Expansão de lanes (`focus:'auto'`): só `currentPhase` expandida; adiciona vizinhas enquanto `larguraNatural ≤ bodyColumns·PX_PER_COL·1.25`; `'all'` expande tudo; lane colapsada tem `MINW` com barra de status empilhada e contagens.
5. Geometria: `laneW_p = 2·LP + S_p·NW + (S_p−1)·CG` (ou `MINW`); `laneX_0 = M`; `laneX_{p+1} = laneX_p + laneW_p + LG`.
6. Ordem nas linhas: baricentro em uma passada (chave = média dos slots das deps já posicionadas; desempate por id); segunda passada para nós sem deps usando sucessores.
7. `x = laneX_p + LP + col·(NW+CG)`; `y = M + HH + slot·(NH+RG)`.
8. `H = M + HH + maxSlots·(NH+RG) + LEG + M`; `W = laneX_5 + laneW_5 + M`; `<svg viewBox="0 0 W H">`, `width` não definido (ajusta ao slot).

Arestas: bézier cúbica da borda direita da origem à esquerda do destino, `k = max(20,(x2−x1−NW)/2)`; aresta para trás (dep em fase posterior) faz laço por baixo, tracejada vermelha; para lane colapsada termina em stub na borda. Dep pendente: `#6b7280` 1.5; dep concluída: `#9ca3af` opacidade .5; arestas do bloco selecionado: `#2563eb` 2.

Nós: `<g class="n s-<status>">`, rect `rx=6`, linha 1 = id (mono 10px bold) + glifo de status à direita, linha 2 = título truncado em 25 chars (`…`). Glifos: `○ ● ■ ◐ ✓ ↺` (not_started, in_progress, blocked, in_review, done, needs_rework), traços 1/2.5 azul/2.5 vermelho/2 âmbar/1.5 verde/2.5 laranja tracejado. Cartões pastel opacos com texto `#111827` (legível em dark e light); lanes `rgba(127,127,127,.08)`. Badges: owner (pill com `main` ou 6 chars do agent id), `!` vermelho em blocked/needs_rework, `▲` risco alto, retirado com opacidade .35 e título riscado. `<title>` com id, título, status/desde/por, owner, deps, reqs, testes, motivo (XML-escaped). Gates: linha vertical no gap antes de `route` e de `release`, verde sólida + pill `✓ gate route · diogo` ou âmbar tracejada + pill `gate route · pending`. Fase atual: traço de destaque e cabeçalho em negrito; fases posteriores a .6. Legenda no rodapé. Um `<style>` com classes curtas, coordenadas inteiras, sem `style=` inline.

Orçamento: ~4k fixo + ~520/nó + ~75/aresta (60 blocos ≈ 42k; 200 ≈ 131k). Escada acima de 120k: (1) colapsar `done` por fase em um nó `✓ 37 done` com arestas mescladas (mesma função do toggle), (2) tooltips só na primeira linha, (3) renderizador terminal com aviso. Cache por `(revision, ui, bucket de bodyColumns)` em `Map` de módulo. `alt` = resumo textual (fase, contagens, gates).

### 5. Renderização terminal

Cabeçalho por fase `▸ IMPLEMENT 5/9 done ● current` (fases dobradas em uma linha); linhas de gate `── gate route ✓ diogo 10-21 ──` / `── gate release ✗ pending · /driver approve release ──` (amarelo). Cada bloco é `Button plain key=B-xxx`: `{indent}{glifo} B-004 {título…} {owner} ← B-003,B-007 +2` (só deps pendentes; indent 2×profundidade, máx 3). `room = viewport.rows − 4`; foco `auto` expande só a fase atual; excesso faz janela ao redor da seleção com `↑ 4 more` / `↓ 9 more`.

### 6. Interação

Botões com hotkeys: `1-6` fase, `a` todas, `d` ocultar concluídos, `r` retirados, `e` exportar Mermaid, `g` aprovar gate pendente (só quando a próxima fase exige), `x` fechar detalhe, `i` init. Seleção: botão por linha no terminal; `Select` dos blocos visíveis abaixo do SVG no desktop/vscode (presses no SVG não chegam ao plugin). Detalhe: handler relê `plan.json` e `blocks/<id>.md` (6k chars) e grava `detail`; mostra campos e `Markdown` do doc; poller atualiza quando `revision` muda. Aprovar em dois passos: botão → `ui.confirm` → "Aprovar gate route na revisão 42 (baseline 1)?" com **Approve** (`y`, primary) e **Cancel** (`n`); `ui.press` é iniciado pela pessoa. Exportar: roda `export mermaid`, mostra caminho e oferece **Copy** (`$.ui.copy`).

### 7. Tools para o modelo (`isDeferred:false`)

Erros: saída 1/2 → `{deny: "DRIVER refused: <stderr .error>"}` com a razão do reducer; falha de spawn/timeout 15 s → `{deny: "DRIVER CLI unavailable: …; fallback: driver via Bash"}`; sucesso → texto curto `ok rev 43; created B-012`. Sempre `--actor model:${agentId ?? 'main'}`, `--root`, `--json`, `--expect-revision` quando dado.

- `set_block_state {block:^B-\d{3,}$, status: in_progress|blocked|in_review|done|needs_rework, reason?, owner?, expectedRevision?}` → `block status`. Nunca expõe `not_started` nem `--force`; pré-checa `reason` em blocked/needs_rework.
- `plan_ops {ops: Op[] (1..25), expectedRevision?}` com `block.add`, `block.set`, `req.add`, `decision.add`, `block.retire|req.retire`, `phase.advance`; `"$0"`/`"$1"` referenciam ids criados; vai por stdin a `driver apply --json`; atômico.
- `plan_status {scope?: summary|phase|block, phase?, block?}`: só leitura, servido pelo mod a partir de projeção fresca, sem spawn; devolve fase, gates, contagens, **ready** (not_started com deps done até a fase atual), em andamento com owners, bloqueados com motivo; `block` devolve o registro e 1,5k do doc.

Descrições das tools dizem por que preferir ao Bash (schema no prompt, sem quoting, erros estruturados, ator automático, atomicidade, menos tokens, painel atualiza). Skills de fase dirão "use `mcp__driver__*` quando listadas; CLI é fallback".

### 8. Hooks do mod

- `agent.spawn` (guard, `.catch` fail-closed): leitura fresca (sem plano → `next`; ilegível → deny); marcador `DRIVER-BLOCK:\s*(B-\d+)` em `prompt`, depois `description`, fallback `currentPhase`; `gateVerdict` (mesma função do hook node; fecha a lacuna dos agentes de Workflow); contenção: bloco `in_progress` com owner ≠ main/este orquestrador e `$.agent.list()` mostra o owner rodando → deny; `r = await next(e)`; sem `agentId` → sem claim; claim: `not_started|needs_rework|blocked` → `block status … in_progress --owner <agentId>`; `in_progress` por `main`/vazio/agente não rodando → `block owner <id> <agentId> --from <atual>`; `done|in_review` → nada. Registra `claims[agentId]`; falha após spawn → `$.ui.toast` + `$.session.append` avisando o orquestrador.
- `classic.SubagentStop`: `await next(e)` (o hook shell faz o orphan; não disputar o lock), remove `claims`, tick, toast se virou `blocked`.
- `tool.call` em `Write|Edit|MultiEdit|Bash`: chama `shared/protect.ts::protectPlan` (mesma função do node) com passo extra para file tools: `$.fs.stat(dir,{resolve:true}).realPath` + comparação case-insensitive com `driverDir`. Justificativa: o hook shell falha aberto sem `node` no PATH do app GUI, e só o mod resolve symlinks/case. Aplicar a mesma correção de realPath/case no `src/hooks.ts`. `PROTECTED_FILE` passa a cobrir `.claude/driver/.mod/`.

### 9. Comandos: um registro `driver` com parsing de argumentos

- `/driver` | `/driver status`: `ui.open({id:'driver', title:'DRIVER', columns:72})` + texto de status.
- `/driver export`: `export mermaid`, devolve caminho e bloco ```mermaid.
- `/driver init <nome>`.
- `/driver approve <route|release>`: (1) exige `e.origin.kind === 'composer'`, senão responde "a aprovação precisa ser digitada por você" (o botão do painel é o caminho universal); (2) lê o plano, `R = revision`; (3) `nonce` = 32 bytes de `crypto.getRandomValues` em hex; (4) `$.fs.write(<driverDir>/.mod/ticket.json, {gate, revision:R, sha256(nonce), exp: now+15s})`; (5) `runCli(['gate','approve',gate,'--via-mod'], {stdin: nonce})` com `--actor user:<git user.name>`; (6) a CLI lê e **apaga** o ticket primeiro (one-shot), checa `exp`, `gate`, `plan.revision === R`, compara `sha256(stdin)` com `timingSafeEqual`, aplica `gate.approve` como ator user; (7) resposta + `context: ["User approved gate route via /driver at rev R"]`.

Por que o modelo não forja: não produz `command.run` composer nem `ui.press`; `gate approve` via Bash já é negado; burlar com script em arquivo exige escrever em `.claude/driver/.mod/`, que Write/Edit e verbos de escrita no Bash negam; ler o ticket não ajuda (é hash); nonce vai por stdin (env aparece em `ps eww`, argv em `ps`). O canal fica tão forte quanto a proteção do próprio `plan.json`, melhor que o TTY. Rejeitados: nonce em arquivo puro (legível, corrida), token em env + `$.store` (visível).

### 10. Testes

- vitest (`*.spec.ts`): golden SVG do fixture web-waitlist; sem sobreposição de nós; arestas não-retrógradas com `x2 > x1`; saída estável sob embaralhamento de chaves; `apply` atômico; `--via-mod` (expirado, hash errado, revisão errada, replay); `block owner` CAS; `where`; teste de tipo `PlanV1` ⊂ `PlanDoc`.
- `claude plugin test` (`mod/test/*.test.tsx`), loop `['terminal','desktop']`, stand-ins de `fs.*`, `process.run` (grava argv/stdin), `command.register`, `tool.register`, `ui.open`, `agent.spawn`, clock mockado: terminal mostra `B-004`, glifo `●`, cabeçalho `IMPLEMENT`, `gate route ✓`, press abre detalhe; desktop tem `Svg` com `alt`, `B-004`, `<title>`, tamanho < 120k; plano de 200 blocos sob orçamento com `✓ … done`; sem plano → **Initialize** → argv `init`; plano inválido desenha issues; `set_block_state` argv; saída 1 → deny com mensagem; `plan_ops` stdin com `$0`; `plan_status` sem `process.run`; `agent.spawn` nega com gate fechado, reivindica com `--owner a1`, transfere com `--from main`; `/driver approve` origem plugin → recusado sem escrita, composer → ticket gravado e nonce só no stdin; `tool.call` Write em `.Claude/Driver/plan.json` → deny.
- Não testado: pintura real, tooltips no sandbox, dark mode, PATH do node no Desktop, contenção real de lock, hot reload.

## Execução

1. Linear: issue "Mod do diagrama vivo" no projeto DRIVER; copiar este plano para `.claude/plans/2026-10-28-mod-diagrama.md`; salvar o design bruto do agente em `docs/research/05-mod-design.md` (inglês).
2. Eu: ADR-011 (mod no core, canal de aprovação por origem composer + ticket, claim via `agent.spawn`, `src/shared` sem deps) antes do código.
3. Subagent **sonnet** (node): extrair `src/shared/*`; `schema.ts`/`mermaid.ts`/`hooks.ts` passam a importar de lá; correção realPath/case em `hooks.ts`; CLI: `where`, `apply`, `--expect-revision`, `block owner`, `gate approve --via-mod`, `status --json`; renomear vitest para `*.spec.ts`; `tsconfig.node.json`; testes vitest novos. Checks: `npm test`, typecheck, build, `claude plugin validate .`, exemplos com `--replay`.
4. Subagent **sonnet** (mod): `mod/*`, `types/index.d.ts`, `hooks.json` com `modules`, `tsconfig.json` raiz, `mod/test/*.test.tsx`; `claude plugin validate`, `claude plugin test`.
5. Eu: primeiro load no Desktop com `CLAUDE_CODE_PLUGIN_DIRS=.../plugins/driver` (e `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`) sobre `examples/web-waitlist`; checklist da seção Riscos; `tsc -p plugins/driver` após o engine gerar `.claude-plugin/types`.
6. Subagent **opus**: revisão adversarial: forjar aprovação (ticket, origem, script em arquivo), bypass do claim, SVG inválido/oversize, estado corrompido, regressões nos hooks shell.
7. Docs: ARCHITECTURE (mod deixa de ser futuro), STACK, GUARDRAILS (`mod/**`, `src/shared/**`), PROJECT-SUMMARY, CLAUDE.md. Commit só com pedido.

## Verificação

```bash
cd plugins/driver && npm test && npm run typecheck && npm run build
claude plugin validate .                 # raiz
claude plugin test plugins/driver
tsc -p plugins/driver                    # após o primeiro load
# Desktop: pane abre em examples/web-waitlist; /driver approve release recusa (gate route ok, release pendente até blocos done); botão Approve funciona; set_block_state via tool redesenha em ≤1 s
```

## Riscos e checagens do primeiro load

1. `$.process.run(['node',…])` pode falhar com o PATH do app GUI: descobrir node via `zsh -lc`, cachear em `$.store`, `userConfig nodePath`. Degradação: tools devolvem ao modelo o comando a rodar via Bash; `/driver approve` cai no TTY.
2. Qual `e.origin.kind` um `/driver approve` digitado no Desktop carrega; se não for `composer`, manter recusa e usar o botão do painel. Nunca ampliar para `sdk` às cegas.
3. `crypto.getRandomValues`/`crypto.subtle` existem no ambiente do mod? Fallback: `openssl rand -hex 32` e a CLI faz o hash.
4. SVG largo escala ou rola? Pane rola SVG alto? `<title>` aparece? `PX_PER_COL=8` e 6,4 px/char estão certos?
5. `session.start` refaz após hot reload? Render pode iniciar timer?
6. `claude plugin validate` aceita `hooks` + `modules` no mesmo `hooks.json`? Módulo pode importar `../src/shared/*.ts`? Engine não sobrescreve `tsconfig.json` raiz?
7. `claude plugin test` ignora `*.spec.ts` e `node_modules`?
8. Ordem do `PreToolUse` shell vs `agent.spawn`; `agentId` presente para agentes locais de Workflow?
9. Lock compartilhado entre escritas do mod e do Bash (retry 5 s): timeout do `process.run` em 15 s; `LockTimeoutError` vira deny retentável.
10. API de mods é early access: fixar `claude-code.d.ts` 2.1.312 e rechecar a cada release.
