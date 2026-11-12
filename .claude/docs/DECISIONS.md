# Decisões Arquiteturais · DRIVER

## [ADR-001] Plugin de Claude Code, não ferramenta standalone
**Data:** 2026-10-26
**Status:** Aceito

### Contexto
A ideia original era uma ferramenta de IA independente que generalizasse a execução de qualquer projeto (planilha a sistema complexo). A avaliação apontou complexidade excessiva: executores por domínio, modelo de permissões, dezenas de integrações e orquestração teriam que ser construídos do zero.

### Decisão
DRIVER é um plugin de Claude Code. O Claude Code é o harness: fornece executor, permissões, subagents, worktrees, hooks, checkpoints e UI. O plugin constrói só a camada de processo.

### Alternativas consideradas
- Ferramenta standalone sobre o Agent SDK: descartada pelo custo de reconstruir o que o Claude Code já dá.
- Apenas um conjunto de skills soltas: insuficiente, porque falta o grafo de estado e o diagrama.

### Consequências
Dependência total do ecossistema Claude Code. Diagrama vivo depende do app desktop (mod), com fallback em Mermaid para CLI.

---

## [ADR-002] O artefato central é o grafo do plano, não o diagrama
**Data:** 2026-10-26
**Status:** Aceito

### Contexto
O documento original tratava o diagrama como "sistema nervoso" do projeto. Diagramas gerados por LLM são instáveis e não versionáveis.

### Decisão
O artefato vivo é um grafo de blocos em arquivo (formato a definir), com estado por bloco, dependências, artefatos e requisitos ligados. O diagrama é uma renderização desse grafo. Hierarquia fase → épico → bloco para projetos grandes.

### Consequências
Resolve centenas de blocos (colapso hierárquico), exportação (serialização), versionamento (diff do grafo) e fallback CLI (Mermaid). Formato do grafo é a decisão de design mais importante do projeto e ainda está aberta.

---

## [ADR-003] Compor skills existentes: dependência pinada por padrão, vendorização como exceção
**Data:** 2026-10-26 (revisado no mesmo dia após pesquisa de infraestrutura)
**Status:** Aceito

### Contexto
superpowers, grill-me, impeccable, hyperframes e outros já cobrem boa parte do processo. Depender deles em runtime tem risco dos dois lados: o upstream pode mudar para pior, ou o DRIVER pode querer divergir. A pesquisa confirmou que plugins podem declarar `dependencies` em `plugin.json` com faixa semver (`^`, `~`, `=`), resolvidas contra tags git `<plugin>--v<versão>`, com instalação automática e detecção de conflito.

### Decisão
- Plugins que o DRIVER usa diretamente (superpowers, feature-dev, code-review oficiais) entram como **dependência declarada com versão pinada** (`=x.y.z` ou `~x.y`). Atualização é deliberada: o DRIVER só sobe a versão quando revisado.
- **Vendorização** (cópia com atribuição, versão e licença no cabeçalho) só para: skills soltas sem plugin publicado (ex.: `grilling` do Matt Pocock, 25 linhas, MIT) ou upstreams que não publicam tags de versão.
- Skills de domínio (impeccable, hyperframes, ElevenLabs...) nunca são vendorizadas nem dependências fixas; são sugeridas e instaladas sob demanda via registro de capacidades (ADR-004).
- Skills de documento da Anthropic (docx/pdf/pptx/xlsx) são source-available sem redistribuição: só referenciar.

### Alternativas consideradas
- Vendorizar tudo (decisão original): perde atualizações semanais do superpowers e acumula drift. Rejeitada após confirmar que pinning de versão resolve o risco de mudança indesejada.
- Dependência sem pinning: expõe o DRIVER a mudanças do upstream sem revisão.
- Reescrever tudo: repete trabalho bom.

### Consequências
O DRIVER precisa publicar suas próprias tags via `claude plugin tag`. Dependências cross-marketplace exigem `allowCrossMarketplaceDependenciesOn` no marketplace raiz. Se o superpowers não publicar tags no formato esperado, cai na exceção de vendorização.

---

## [ADR-004] Registro de capacidades por bloco, carregamento sob demanda
**Data:** 2026-10-26
**Status:** Aceito

### Contexto
Execução autônoma precisa de muitas integrações (Vercel, Supabase, Railway, Clerk, Resend, Google, ElevenLabs, Figma...). Dezenas de MCPs ligados simultaneamente degradam seleção de tool e consomem contexto.

### Decisão
Integrações são atributo do bloco, não do projeto. Um registro de capacidades mapeia capacidade → provedores → forma de acesso (CLI preferida, MCP quando não há CLI, API direta). Discover sugere provedores a quem não os conhece. Route registra o provedor por bloco e as credenciais necessárias. Implement carrega só o que o bloco precisa. Credenciais são requisito levantado no Discover.

### Consequências
Nada carregado por padrão. Modelo de permissão por tipo de ação (reversível executa, irreversível confirma, destrutiva em produção exige gate) precisa ser definido antes da execução autônoma.

---

## [ADR-005] Core + packs por domínio
**Data:** 2026-10-26
**Status:** Aceito

### Decisão
`driver` (core: fases, grafo, gates, mod, Evolve) + packs `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`. Cada pack contribui: perguntas de entrevista do domínio, entradas no registro de capacidades, validadores e checklist de release. O core não conhece provedores.

### Consequências
Evita a generalização excessiva da versão standalone. Packs podem evoluir independentemente.

---

## [ADR-006] Paralelismo: subagents e worktrees na v1; nested sessions na v2
**Data:** 2026-10-26
**Status:** Aceito

### Contexto
O app desktop expõe ferramentas para uma sessão iniciar e controlar outras. Nested sessions são caras e opacas para o orquestrador.

### Decisão
v1 usa subagents (model explícito, background, `isolation: worktree` quando blocos editam os mesmos arquivos) e o Workflow tool para lotes homogêneos sem gate humano. Nested sessions só na v2, para blocos longos e independentes que o usuário quer acompanhar separadamente, e só com protocolo de estado em arquivo que todas as sessões escrevem e o mod lê.

Restrições confirmadas na pesquisa:
- Workflow **não aceita input humano no meio da execução**. Gates ficam na conversa principal; um Workflow por lote de Implement ou Validate.
- As ferramentas de sessão do app desktop (`start_session` etc.) não são documentadas publicamente. A v2 usa o caminho documentado: `claude --bg` + cross-session messaging (`SendMessage`), que é texto puro, fila de 50 mensagens e nunca concede aprovação.
- Headless (`-p`, SDK, cloud): mod não desenha, só hooks funcionam. O plugin precisa degradar para esse modo.

---

## [ADR-007] Nome da quinta fase: Evolve
**Data:** 2026-10-26
**Status:** Aceito

### Contexto
Candidatos: Evolve, Examine, Evaluate.

### Decisão
Evolve. Examine e Evaluate significam "verificar", que já é o Validate. Evolve nomeia a parte inédita do método: decidir para onde voltar, registrar por quê e re-baselinear plano e grafo.

---

## [ADR-009] Grafo em `.claude/driver/plan.json`; mod renderiza; gates reforçados por hook
**Data:** 2026-10-26 (aceito em 2026-10-27 com o formato definido no ADR-010)
**Status:** Aceito

### Contexto
Pesquisa de infraestrutura: Tasks nativas do Claude Code estão desligadas por padrão em modelos novos e têm campos e storage não documentados. O arquivo de plan mode é por sessão e sem formato documentado. Mods podem desenhar painel ao lado do chat (SVG só no Desktop e VS Code; Box/Text ou Raster no terminal), ler arquivos via `$.fs`, reagir a eventos e registrar tools que o modelo chama. `AskUserQuestion` pode ser auto-continuado por `askUserQuestionTimeout`.

### Decisão
- Fonte de verdade: `.claude/driver/plan.json`, de propriedade do DRIVER, com blocos, estados, arestas, requisitos ligados, provedor por bloco e flag `approved` por gate. Markdown por bloco para texto longo.
- O mod do core espelha o arquivo em `$.state` e desenha: SVG no Desktop/VS Code, layout Box/Text no terminal. Mermaid gerado em arquivo como fallback universal (CLI sem mod, headless, exportação).
- O mod registra `mcp__driver__set_block_state` para o modelo mudar estado sem escrever JSON na mão.
- Gates são reforçados por hook `PreToolUse` (ou guard de `tool.call` no mod) que recusa Agent/Workflow na fase seguinte enquanto o plano não registra `approved: true`. Prompt sozinho não é gate.

### Consequências
Mínimo de CLI 2.1.287. API de mods é early access: rechecar `claude-code.d.ts` a cada release. Nenhum mod existente faz isso; é a parte inédita do plugin.

---

## [ADR-010] Formato do `plan.json` v1: snapshot canônico, escritor único, ledger de eventos
**Data:** 2026-10-27
**Status:** Aceito
**Plano:** `.claude/plans/2026-10-27-plan-json-v1.md`

### Contexto
O ADR-009 fixou o arquivo, não o formato. Consumidores do arquivo: mod (polling via `$.fs`, desenha SVG ou Box/Text), hook `PreToolUse` em shell (precisa responder "gate aprovado?" com uma expressão `jq`), tool `mcp__driver__set_block_state`, exportador Mermaid, skills de fase. Fato decisivo: o arquivo fica no git, então cada worktree de subagent tem uma cópia desatualizada.

### Decisão
1. **Snapshot canônico em JSON**, não log de eventos como fonte: hook e mod precisam de uma leitura barata. `requirements` e `blocks` são objetos indexados por id (`R-001`, `B-001`) para lookup O(1) em `jq` e diffs estáveis.
2. **Dois contadores:** `revision` sobe em toda escrita (CAS e detecção de mudança pelo mod); `baseline` sobe só em re-baseline no Evolve (0 até o Gate 1).
3. **Estados do bloco** em snake_case: `not_started · in_progress · blocked · in_review · done · needs_rework`. Toda transição carimba `statusSince`, `statusBy` (`{kind: model|user|hook, id}`) e, em blocked/needs_rework, `statusReason`. `not_started → in_progress` grava `owner` e funciona como claim sob lock.
4. **Gates** em `gates.route` e `gates.release` (chave = fase liberada). Aprovação só por comando do usuário, nunca pelo modelo. Revogação automática pelo escritor: `release` cai em re-baseline, quando um bloco sai de `done`, quando a fase recua de evolve/release ou quando um requisito entra ou sai depois do Gate 1; `route` cai só quando a fase recua a discover. (Revisado em 2026-10-27: a versão inicial revogava `route` a cada mudança de requisito, o que tornava impossível adicionar requisito no Evolve sem voltar ao Discover. O Gate 1 aprova o entendimento; mudanças posteriores são assunto do re-baseline e do Gate 2.)
5. **Escritor único:** um núcleo TS (reducer puro + adaptador node) usado pela CLI `driver` e pelas tools do mod. Protocolo: raiz resolvida pelo worktree principal (`git rev-parse --git-common-dir`), lock por `mkdir .lock` (stale após 30 s, retry até 5 s), validar antes de gravar, `.tmp` + fsync + rename, serialização determinística, depois anexar evento em `events.jsonl`. Orquestrador é o escritor normal; subagents devolvem resultado estruturado.
6. **Ledger** `events.jsonl` commitado (`merge=union`), rotacionado para `log/REL-n.jsonl` a cada Release. `plan.json` guarda só o estado atual; histórico vive no ledger e no git.
7. **Nada é apagado:** blocos e requisitos removidos pelo Evolve ganham `retired: {at, decision, reason}` citando um `D-xxx`. Ids alocados só pelo escritor a partir de `nextId`, nunca reutilizados.
8. **Texto longo fora do JSON:** `blocks/<id>.md`, `requirements/<id>.md`, `decisions/<id>.md`; caminho implícito pelo id.
9. **Credenciais** só como nomes de variáveis de ambiente em `provider.credentials`; valores nunca entram no arquivo.
10. **Extensibilidade:** `ext` por pack (`ext['driver-web']`); campos reservados opcionais `estimate`, `parent`/`epics`, `impact`; leitores ignoram campos desconhecidos; `schemaVersion` só sobe em quebra.
11. **Hooks:** `PreToolUse` em `Agent|Task|Workflow` lê o marcador `DRIVER-BLOCK: B-xxx` do prompt (fallback `currentPhase`) e nega se o gate da fase não está aprovado; arquivo ausente → allow, ilegível → deny. `PreToolUse` em `Edit|Write|MultiEdit|Bash` nega escrita direta em `plan.json`/`events.jsonl` (inclusive redirecionamento, `sed -i`, `tee`, `mv`, `cp`, `rm` via Bash) e `gate approve` vindo do modelo. `SubagentStop` move para `blocked` o bloco `in_progress` cujo `owner` encerrou sem handoff. Hooks procuram o plano primeiro no worktree principal, depois no `cwd`.
12. **Guardas adicionais no reducer:** bloco não inicia em fase posterior a `currentPhase`; `release` só aprova com `route` aprovado; `release.add` exige gate `release`; `needs_rework` limpa `verification`; `in_review` exige seção `## Handoff` preenchida em `blocks/<id>.md` (checagem do store, `--force` para usuário). A invariante `phases.currentValid` (bloco iniciado em fase posterior à atual) é aviso, não erro, para permitir `phase back` com blocos já concluídos. Cobertura de requisitos (`req.coverage`) é aviso até a fase validate e erro a partir dela, para que requisitos possam entrar no Implement e no Evolve antes de ganharem bloco.
13. **CLI:** `--root <dir>` ou `DRIVER_ROOT` sobrepõem a resolução via git (necessário para exemplos dentro de outro repositório). Raiz = worktree principal via `git worktree list --porcelain`, depois `--show-toplevel`, depois `cwd`. Ator padrão `model:main`; `DRIVER_ACTOR` ou `--actor kind:id` para mudar.
14. **Ações exclusivas do usuário exigem terminal interativo** (revisão adversarial de 2026-10-27): `gate approve`, `rebaseline` e `--force` abrem `/dev/tty` e pedem `yes` digitado; sem tty (caso da ferramenta Bash do modelo) a CLI recusa. `--actor user:x` sozinho não concede nada. O hook de proteção ainda nega, após normalizar aspas e expansões, comandos Bash que invoquem essas ações ou as embrulhem em `script`/`expect`/`unbuffer`. Limite conhecido, demonstrado na revisão: um script gravado em arquivo e executado sob pseudoterminal (`script`, `expect`, `pty.spawn`) derrota a confirmação; por isso o hook nega qualquer uso desses wrappers no Bash, não só junto de `driver`. Isso eleva a barra, não a fecha; o canal à prova de modelo é o comando do mod (`$.command.register`) na v2. Pendência registrada: o orquestrador só conhece o `agent_id` de um subagent depois de criá-lo, então `--owner` cobre o caso quando o id é passado no claim; mapeamento via `SubagentStart` fica para a fase do mod.
15. **Decisões registradas no plano:** `decisions` (opcional, `D-xxx` → título, data, motivo, ator), criadas por `decision add`, por `gate approve route` e por `rebaseline`. Retirar bloco ou requisito exige citar uma decisão existente (`ref.decision`).

### Alternativas consideradas
- Log de eventos como fonte de verdade, snapshot derivado: cada consumidor teria que dobrar o log; o hook em `jq` ficaria caro. Rejeitada.
- Arestas em lista separada `edges[]`: redundante com `dependsOn` na v1; outras relações entram como campo novo.
- Ids por hash (evita colisão em merge humano): perde legibilidade; `driver renumber` repara colisões.
- Tasks nativas do Claude Code como storage: desligadas por padrão em modelos novos, campos não documentados (ver ADR-009).

### Consequências
Hooks exigem `node` no PATH (a checagem de gate tem fallback em `jq` puro). Branches de worktree nunca tocam `plan.json`, então merge de volta não conflita. Capacidades de `$.fs` (create exclusivo, rename, stat) precisam ser confirmadas antes do mod; fallback é `$.process.spawn` da CLI.

---

## [ADR-011] Mod do diagrama vivo: painel no core, aprovação por origem do usuário + ticket, claim de owner em `agent.spawn`
**Data:** 2026-10-28
**Status:** Aceito
**Plano:** `.claude/plans/2026-10-28-mod-diagrama.md` · **Design:** `docs/research/05-mod-design.md`

### Contexto
O ADR-009 previu o mod; o v1 do `plan.json` deixou duas lacunas que só ele fecha: o canal de aprovação de gate à prova de modelo (a confirmação por TTY cai diante de pseudoterminal) e o mapeamento `agent_id` → bloco. Fatos da API de mods (2.1.312): o módulo não tem Node nem DOM (não importa zod nem `node:*`); `command.run` carrega `e.origin`, e só o Enter do usuário é `composer`; `ui.press` também é iniciado pela pessoa; `agent.spawn` vê o prompt e devolve `agentId`, inclusive para agentes de Workflow; `$.process.run` aceita `stdin`.

### Decisão
1. **Mod dentro do plugin core** (`plugins/driver/mod/`), listado em `hooks/hooks.json` sob `modules`, convivendo com os hooks shell (que seguem valendo em headless).
2. **Código compartilhado sem dependências em `src/shared/`** (fases, paleta, projeção `PlanView`, veredito de gate, regras de proteção, layout, SVG, linhas do terminal). O código node (schema zod, hooks shell, mermaid) importa de lá; o mod também. Um `tsconfig.json` raiz com `types: []` impede `node:*` em `src/shared`. Testes vitest passam a `*.spec.ts`; `*.test.tsx` fica para `claude plugin test`.
3. **Renderização:** no Desktop e no VS Code, SVG **vertical**: fases como faixas empilhadas, cartões de 56 px com texto de 13 px, arestas ortogonais, gates como linha com pílula entre as faixas. O desenho é feito na largura do painel em pixels (`bodyColumns × 9` menos 16 de margem; o 8 original deixava um nono do painel vazio no Desktop, medido em 2026-11-11) e passado ao elemento `Svg` com `width`/`height` explícitos e `isInteractive` (hover, `<title>` como tooltip), então nunca é reescalado: um painel estreito rola em vez de encolher. Paleta igual à do Mermaid com texto fixo escuro em cartões opacos (legível em dark e light), glifos de status para daltonismo, orçamento de 131k chars com escada de degradação (colapsar `done` por fase, tooltips curtos, cair para o quadro de cartões). Como cliques dentro do SVG não chegam ao plugin, a seleção de bloco é um `Select` na barra (ou um `Input` com o id acima de 64 blocos desenhados). Mobile: quadro de cartões nativo (`Box`/`Button`). Terminal: uma linha por bloco, botão por linha, foco automático na fase atual. O layout horizontal em swimlanes continua em `src/shared/layout.ts` para exportação.
4. **Escrita sempre pela CLI** via `$.process.run(['node', dist/cli.js, ...])`; novos comandos: `where`, `apply --json` (atômico, uma revisão para várias ops), `--expect-revision`, `block owner` (CAS), `status --json`. Leitura por `$.fs` com polling de 1 s (5 s com painel fechado) e detecção por `mtime`/`size`/`revision`.
5. **Tools para o modelo** (`mcp__driver__set_block_state`, `plan_ops`, `plan_status`), não deferidas, com erros estruturados do reducer; nunca expõem `gate approve`, `rebaseline`, `--force` nem `not_started`.
6. **Canal de aprovação à prova de modelo:** `/driver approve <gate>` só com `e.origin.kind === 'composer'` (ou botão do painel via `ui.press`); o mod grava um ticket one-shot `{gate, revision, sha256(nonce), exp 15 s}` em `.claude/driver/.mod/` e chama `gate approve --via-mod` com o nonce por **stdin**; a CLI apaga o ticket antes de validar, exige `plan.revision` igual ao visto pelo usuário e compara o hash em tempo constante. O modelo não produz `command.run` composer nem `ui.press`; `gate approve`, `via-mod` e escrita em `.claude/driver/` são negados no Bash por tokens (não por frase), e o guard só vale onde existe plano. Força do canal = força da proteção do próprio `plan.json`, que a revisão de 2026-10-28 mostrou ser contornável por script em arquivo e cadeias de `cd`: portanto o canal **eleva a barra e é auditável** (toda aprovação registra `approvedVia: tty|mod` e, no mod, o hash do ticket; o mod alerta qualquer gate que vire aprovado sem ter sido emitido pela sessão, com banner vermelho quando `approvedVia` falta ou o ticket é desconhecido), não é à prova de modelo. Risco aceito explicitamente: interpretadores inline (`node -e`, `python -c`) com strings concatenadas não são bloqueados, porque negá-los em todo projeto com plano geraria falsos positivos demais; a defesa é a evidência de adulteração, não a prevenção. Rejeitados: nonce em arquivo puro (legível), token em env ou `$.store` (visível por `ps eww` e `cat`).
7. **Claim de owner em `agent.spawn`:** o mod lê `DRIVER-BLOCK: B-xxx` do prompt, aplica o mesmo veredito de gate do hook shell (fecha a lacuna de agentes de Workflow), e após `next` registra `in_progress --owner <agentId>` ou transfere com `block owner --from main`. `classic.SubagentStop` só redesenha (o hook shell faz o orphan). Guard `tool.call` do mod repete `protectPlan` com `realPath` e comparação case-insensitive (corrige bypass `.Claude/Driver` em APFS, também no node).

### Consequências
Revisão adversarial (`docs/research/06-review-mod.md`) exigiu: guards por basename e por token independentes de diretório, escopo do guard restrito a projetos com plano, gate também para agentes retomados (`SendMessage`), ticket com janela de 20 s e registro `via`/`ticket` no evento. Dependência de `node` no PATH do app GUI (descoberta via `zsh -lc`, cache em `$.store`, `userConfig nodePath`; degradação documentada). API de mods early access: `claude-code.d.ts` 2.1.312 fixado, rechecar por release. Checklist de primeiro load no plano.

Iteração visual (2026-10-29): o primeiro SVG (swimlanes horizontais, fonte de 10 px, sem `width`) saiu ilegível no Desktop, que o desenhou no tamanho intrínseco reduzido; uma lista de texto e um quadro de cartões nativos foram testados e rejeitados como pobres demais. A causa era escala, não formato: o item 3 passou a descrever o SVG vertical dimensionado em pixels. HTML/webview e Mermaid não existem no painel de mods; se o SVG ainda não bastar, a alternativa é uma página local servida pela CLI e aberta no browser do Desktop, fora do mod e sem o botão de aprovação.

Refinamento do guard (2026-10-29, PER-619): o `protectCommand` tratava qualquer linha de heredoc como comando e negava código com `(` e `$` (um regex em um teste, por exemplo) com a mensagem de ação user-only. Semântica adotada, igual à do bash: o corpo de um heredoc é a stdin do comando que o abre, não uma sequência de comandos; é julgado por esse comando. Shell na linha (`bash <<EOF`, `cat <<EOF | sh`) → corpo recursado como comandos; `xargs` sobre a CLI → corpo vira argumentos; interpretador (`python3 -`, `node -`) com corpo que cita arquivo protegido ou após `cd` no diretório do plano → negado com mensagem própria (`MSG_SCRIPT`, a mesma regra de `python -c`); corpo sem aspas no delimitador → cada `$( … )` e crase é recursado, porque o shell os expande. `<<` entre aspas ou após `#` não abre heredoc; `"$( … )"` reabre contexto de comando (idioma do `git commit -m "$(cat <<'EOF'`). Ao mesmo tempo o normalizador passou a tratar quebra de linha como `;` (antes colapsava em espaço, e `echo hi` seguido de `driver gate approve route` em outra linha passava), parênteses de agrupamento são descartados (`(driver rebaseline)` é julgado como `driver rebaseline`) e um nome de comando vindo de substituição ou variável é negado com `MSG_SUBST`. Duas revisões (a primeira, adversarial, foi interrompida por classificador de segurança; a segunda auditou a classificação contra bash 3.2 e zsh 5.9) acrescentaram: comentário só após separador não escapado, `${ … }`, `$[ … ]` e `$'…'` no scanner, heredoc aberto em linha continuada ou lido pela linha seguinte a um `|`, terminador `EOF)` dentro de `$( … )`, `patch`/`git apply` com corpo que cita arquivo protegido, contexto de `cd` herdado pelo corpo recursado, `$( … )` em posição de argumento julgado como comando, wrappers com opções (`sudo -E`, `nice -n`, `timeout`), `case`/funções/keywords descartados e nomes comparados sem caixa. Separadores (`|`, `;`, `&`) dentro de aspas, `[[ ]]`, `(( ))` e `${ }` deixaram de partir o comando (eram a origem de falsos positivos antigos como `grep -E 'a|(b)$'`); em troca, o código passado a `bash -c`/`eval` é julgado recursivamente como os comandos que contém. Uma string entre aspas só é julgada como comandos quando há na linha um executor de código conhecido (shells, `eval`, `source`, `su`, `watch`, `find`, `xargs`, `ssh`, `npx`/`npm`/`pnpm`/`yarn`, `tmux`, `make`, `docker`, ajustes `git -c alias.*=!`/`core.sshCommand=` etc.): é uma lista de bloqueio por natureza, e um executor fora dela (`git config alias.x '!…'` seguido de `git x`, `osascript`/`perl` com `system(…)`) passa. Custo aceito: `eval "$(…)"` e `bash -c "$X"` são negados (código opaco vindo de expansão); um script inline que cita `plan.json` é negado mesmo quando só lê; uma mensagem de commit com `;` é negada se a mesma linha contém a palavra `bash` (`brew install bash && git commit -m "a; …"`); `driver 'gate approve' route` passa porque o bash entrega um argv só e a CLI não divide argumentos. Fora do alcance, registrado: função definida em linha anterior e chamada com heredoc, `bash <<< $'…\x20…'`, `exec {fd}<<EOF` do zsh, código escrito em arquivo e executado depois. Ajuste de 2026-10-30: o script de um editor in-place (`sed -i`, `perl -pi`, `ruby -i`; o valor de `-e`/`-f` ou o primeiro operando) não é caminho e sai do julgamento de alvo; antes, um `s/.*/x/` aplicado a um arquivo em `.claude/` era lido como glob capaz de cobrir `.mod` e negado.

---

## [ADR-012] Skills de fase: Discover e Route como skills nativas do core, entrevista por opções, escrita só pelas tools
**Data:** 2026-10-30
**Status:** Aceito

### Contexto
Com CLI, tools `mcp__driver__*`, hooks e painel prontos, quem usa o DRIVER ainda precisa saber chamar `plan_ops` à mão. A pesquisa (`docs/research/skills-landscape.md`, seções 2 e 6) aponta Discover e Route como o elo mais fraco do pipeline manual e indica o que compor: fronteira de decisões do grilling, formato de pergunta do spec-kit `clarify`, uma pergunta por turno com `AskUserQuestion` (compound-engineering), auto-revisão do `writing-plans`. `grilling` e spec-kit não estão instalados; superpowers 7.0.0 está, mas `brainstorming` usa texto livre e `writing-plans` escreve um plano em markdown, não blocos no grafo. Design bruto em `docs/research/07-skills-design.md`; plano em `.claude/plans/2026-10-30-skills-discover-route.md`.

### Decisão
1. **Uma skill por fase, no core, no formato nativo de skill de plugin:** `plugins/driver/skills/discover/SKILL.md` e `plugins/driver/skills/route/SKILL.md`, `user-invocable: true`, invocação pelo modelo permitida (Discover invoca Route depois do gate), sem `context: fork` (a entrevista precisa do histórico). Texto das skills em inglês; a conversa acontece na língua do usuário. Convenções compartilhadas em `plugins/driver/references/driver-conventions.md`, fora de `skills/`.
2. **Entrevista por opções, uma pergunta por turno:** `AskUserQuestion` com 2 a 3 opções reais mais "Não sei / decida por mim", recomendada primeiro com sufixo `(Recommended)`, consequência na descrição e "Por que importa" no texto. Fronteira de decisões (grilling) persistida em `discover/interview.md` a cada resposta; fatos são apurados por subagentes de leitura em background, decisões são do usuário; teste de decisões já tomadas contra `discover/assumptions.md`, respostas anteriores e o repositório. "Não sei" nunca bloqueia: pesquisa, default seguro registrado como premissa `A-nn`, ou adiamento.
3. **Proporcionalidade** pelo mecanismo do ADR-008 (abaixo), decidido na primeira rodada por esforço estimado e registrado como decisão `D-nnn`.
4. **Sem dependência do superpowers nesta rodada.** Discover tem estilo próprio; Route copia o checklist de auto-revisão do `writing-plans` (cobertura, varredura, dependências, foco de revisão, proporção). A dependência pinada do ADR-003 fica para B-006, onde Implement usa `subagent-driven-development`.
5. **Durante a entrevista só arquivos; o plano recebe um lote no fim.** Requisitos, premissas (`source: assumed`, `ref: discover/assumptions.md`), não-objetivos (`kind: non-goal`) e a decisão de classe entram por `plan_ops` depois do play back aceito, em lotes de até 25 ops. Motivo: nada é apagado (ADR-010 item 7). A skill escreve `requirements/R-nnn.md`, `discover/*.md`, `blocks/B-nnn.md` e `route/risks.md` com Write/Edit; `plan.json`, `events.jsonl`, `log/` e `.mod/` continuam fora do alcance; gate, rebaseline e `--force` continuam do usuário.
6. **Cada skill tem um bloco no plano** ("Discovery interview" em discover, "Route plan" em route dependente do primeiro), com artifacts (caminhos relativos à raiz do projeto, como `.claude/driver/discover/interview.md`), Handoff e `verification.passes` marcado pelo modelo tendo o aceite explícito do usuário como evidência. Route termina com `phase.advance` para implement; não há gate humano entre Route e Implement (visão, seção 5). Bloco `done` nunca é reaberto: amend (Discover depois do gate) e replan (Route) criam blocos novos ("Discovery amend: <tópico>", "Route replan: <motivo>"); a única exceção é o retrabalho do Discovery antes do gate, pelo caminho `done → needs_rework → in_progress`. O lote de saída é idempotente: os ids criados ficam registrados em `interview.md` e uma reentrada só acrescenta o que falta.
7. **Route decompõe em blocos de implement, validate, evolve e release** com saída observável, critério de aceite como definition of done, `dependsOn` só para dependência real, cobertura de todo requisito por ≥ 1 implement e ≥ 1 validate, risco por regra fixa, `provider` quando há capacidade externa, matriz de riscos em `route/risks.md`, diagrama validado pelo usuário (painel e `export mermaid`) e `driver validate` sem aviso `req.coverage`.

### Consequências
Rejeitados: `brainstorming` do superpowers como Discover (texto livre, sem persistência, sem opções visuais); `req.add` incremental durante a entrevista (ruído de retire); gate humano no fim do Route (só dois gates). Riscos aceitos: classe L pode passar de 30 turnos (mitigação: teto por rodada e arquivos à prova de compactação); o painel não mostra requisitos até o fim da entrevista; `verification.passes` do modelo nos blocos das skills. Confirmado no primeiro load (2026-10-30): slash `/driver:discover` e `/driver:route`; `allowed-tools` com `Bash(driver *)` aceito pelo `claude plugin validate`. Revisão adversarial opus da mesma data: 7 correções obrigatórias (busca de bloco por título via `plan_status scope: phase`, lote de saída idempotente, interview fechada antes do gate volta ao passo do gate, amend/replan sem reabrir bloco `done`, `kind` das premissas, faixa de blocos só implement e validate, texto do gate `route` nas convenções) e 9 melhorias aplicadas (reclassificação ao fim da rodada 1 com flags no frontmatter, "nunca reperguntar sem informação nova", premissas viram `Accepted: yes` no aceite, aviso de que aprovar o gate não inicia turno do modelo, docs de bloco só com Edit, artifacts relativos à raiz e `exports/plan.mmd` fora dos artifacts por ser gitignored, heredoc entre aspas no fallback da CLI, tabela de transições nas convenções, subagentes de pesquisa do tipo `Explore`).

---

## [ADR-013] Entrevista por interesse: núcleo de produto, áreas por escolha, resumo como mensagem final, registro silencioso
**Data:** 2026-11-10
**Status:** Aceito (revisa o ADR-008 e os itens 2 e 5 do ADR-012)

### Contexto
Primeiro dogfooding das skills (cópia de `examples/web-waitlist`, classe S). O protocolo funcionou, mas o Diogo apontou quatro problemas: (1) entrevista longa demais para o tamanho, porque "dados pessoais" (um campo de e-mail) subiu a profundidade para classe M e o teto por rodada virou meta; (2) perguntas técnicas de baixo impacto feitas a quem pode não querer decidi-las, sem que decisões relevantes possam ser tomadas às escondidas; (3) o resumo de aceite não apareceu: texto escrito antes de uma chamada de ferramenta é condensado no terminal, e a pergunta "o resumo acima está correto?" ficou sem resumo; (4) cada resposta gerava um diff de `interview.md` na tela, e as edições por `sed` esbarravam no guard.

### Decisão
1. **Núcleo de produto, sempre perguntado.** Depois da classificação (domínio e tamanho), a entrevista pergunta só o que apenas o usuário sabe: objetivo e sinal de sucesso, público, capacidades indispensáveis, o que fica de fora. Orçamento total do núcleo, contado em perguntas e não em rodadas: XS 2, S 4, M 6, L 8. É teto, não meta: nó com default seguro vira premissa sem pergunta.
2. **Áreas técnicas por escolha.** Depois do núcleo, uma pergunta de múltipla escolha: "Em quais áreas você quer decidir os detalhes?", com 2 a 4 áreas derivadas do domínio (para web: infraestrutura e hospedagem, dados e privacidade, design e conteúdo, métricas). Área marcada: até 3 perguntas. Área não marcada: o modelo decide e registra cada decisão como premissa `A-nn` com a escolha e o motivo em uma linha. XS pula a pergunta de áreas (tudo decidido pelo modelo e mostrado no resumo).
3. **Exceção de sempre perguntar.** Decisão cara de reverter, que gasta dinheiro, que coleta dado sensível (pagamento, saúde, documentos, menores) ou que age em produção é perguntada mesmo com a área pulada. Substitui a subida de classe do ADR-008: um e-mail de contato não é gatilho.
4. **Progresso e saída antecipada.** Toda pergunta traz o progresso ("3 de ~6"). A partir da terceira pergunta depois da classificação, uma das opções é "Já basta, resuma": os nós abertos viram premissas com o default recomendado. Checkpoint (pre-mortem, red team, socrático) só para classe M e L.
5. **Resumo como mensagem final do turno.** O resumo é texto corrido na língua do usuário, sem chamada de ferramenta depois dele no mesmo turno: objetivo, o que será construído, o que o usuário decidiu, o que o modelo decidiu por ele (com motivo), o que fica de fora, perguntas em aberto. Termina pedindo "aceito" ou o que mudar; o usuário também pode perguntar o porquê de uma decisão ou abrir uma área pulada. O mesmo texto é gravado em `.claude/driver/discover/summary.md`. O aceite vem na mensagem seguinte do usuário; só então roda o lote de saída.
6. **Registro silencioso pela tool `mcp__driver__discover_log`.** Fonte de verdade da entrevista passa a ser `.claude/driver/discover/interview.jsonl` (append-only, escrito só pela CLI). A tool chama `driver discover log` (JSON na stdin) e a CLI regenera `interview.md`, `assumptions.md` e `non-goals.md` a partir do log; o modelo não edita mais esses três arquivos. Sem argumentos de escrita a tool devolve o estado (meta, nós, não-objetivos, fronteira) para retomada. Contrato:
   - entrada `{ meta?, nodes?, nonGoals? }`, todos opcionais;
   - `meta`: `goal`, `class` (XS|S|M|L), `domain`, `language`, `stage` (core|areas|summary|closed), `areas` (lista oferecida), `chosenAreas`, `reclassified` (bool), `checkpoint` (none|pre-mortem|red-team|socratic|skipped), `batchApplied` (string); chaves ausentes ficam como estão;
   - `nodes[]`: `id` (`Q-nn`; ausente cria o próximo), `question`, `area` (core ou nome da área), `dependsOn[]`, `kind` (fact|decision), `status` (open|researching|settled|assumed|deferred), `answer`, `source` (user|research|assumed), `options[]` (mostradas), `why` (motivo, obrigatório quando `status` é assumed), `requirement` (`R-nnn`, preenchido depois do lote); atualização é por `id`, campo ausente fica como está; um nó que passa a `assumed` ganha `A-nn` automático;
   - `nonGoals[]`: `id` (`N-nn`; ausente cria), `statement`, `reason`, `requirement`;
   - saída: ids criados, contagens por status e a fronteira (nós abertos cujos `dependsOn` estão resolvidos ou assumidos).
7. **Route segue o mesmo padrão** (acrescentado no mesmo dia, depois de o Diogo rodar o Route no terminal): a confirmação do plano deixa de ser pergunta de ferramenta sobre um diagrama que o terminal não mostra. O turno termina com a lista de blocos por fase (id, título, dependências, risco, o que roda em paralelo), contagem contra a faixa, caminho crítico e blocos de risco alto, na língua do usuário, gravada também em `.claude/driver/route/summary.md`; a confirmação vem na mensagem seguinte. Os documentos de bloco são preenchidos pela tool `mcp__driver__block_doc` (`driver block doc`, JSON na stdin: `{blocks:[{id, spec?, acceptance?[], notes?, handoff?}]}`, 1 a 30 por chamada), que reescreve só as seções nomeadas, preserva frontmatter e título, recusa bloco `done` ou aposentado e não mexe em `plan.json`. As skills não usam mais Write, Edit, `sed` ou redirecionamento em `blocks/` nem nos arquivos gerados de `discover/`.
8. **Guard.** `sed -i`, `perl -pi` e `ruby -i` depois de um `cd` para dentro da pasta do plano só são negados quando o operando é protegido, é glob ou não existe (antes, qualquer edição in-place ali era negada, inclusive de `discover/interview.md`). Exceção inesperada no guard continua negando a chamada, mas o caso que a provocou vira teste. Mudança no guard passa por revisão adversarial (GUARDRAILS).

9. **Ajustes da revisão adversarial (mesmo dia).** Orçamentos por classe, todos tetos: núcleo XS 2, S 4, M 6, L 8; perguntas de área no total XS 0, S 3, M 6, L 9 (no máximo 3 por área); "sempre perguntar" no máximo 2, fora dos orçamentos e válido para toda classe, por lista fechada (gasta dinheiro; coleta dado de pagamento, saúde, documento ou de menores; apaga dado sem volta; cria compromisso legal). Hospedar, escolher banco e campo de e-mail não são gatilhos. O aceite é gravado (`meta.accepted`) antes do lote de saída, que primeiro lê os requisitos já no plano e só acrescenta o que falta. Só viram requisito decisões que o produto precisa cumprir (classificação e escolha de áreas ficam no registro). Arquivos de requisito passam pela tool `mcp__driver__req_doc`. Corpo de seção não pode conter título de nível 1 ou 2 fora de bloco de código, e o reducer exige exatamente um `## Handoff`. O mod recusa escrita vinda de subagente, exceto estado e documento do bloco de que ele é owner. Os dois resumos (`discover/summary.md`, `route/summary.md`) são documentos do usuário, na língua dele, títulos incluídos.
10. **Guard, segunda rodada.** Além do item 8: script de `sed` com `w` perto de arquivo protegido ou com `e` é negado, com ou sem `-i`; código de `perl`/`ruby` em qualquer cluster de flags conta como script inline, e edição in-place deles dentro da pasta do plano continua negada; script colado na flag, `-I` do sed BSD, `--in-place=SUF` e `-l N` são reconhecidos; chaves, sequências `{a..b}` e alternância do zsh contam como expansão; `cd` que alcança a pasta do plano por `..`, `pushd` ou variável conta como estar nela; `log/*` relativo é protegido ali.

### Consequências
A profundidade da entrevista passa a depender do interesse do usuário, não só do tamanho: quem não é técnico responde o núcleo e revisa o resumo; quem quer decidir infra marca a área. A classe continua fixando a faixa de blocos do Route. Custos: mais decisões tomadas pelo modelo (mitigação: nenhuma fica fora do resumo e a exceção do item 3); o aceite custa um turno a mais; `interview.jsonl` é mais um arquivo e a CLI ganha um renderizador de markdown. `interview.jsonl` não entra na lista de arquivos protegidos pelo guard nesta rodada (a skill proíbe editá-lo; proteger é decisão futura se o dogfooding mostrar edição manual). Rejeitado: manter rodadas com tetos menores (não resolve "quem decide o quê"); pôr o resumo no campo de pergunta da ferramenta (limite de tamanho, sem formatação).

---

## [ADR-014] Próximo passo sempre visível: o painel diz o que fazer e o botão principal aciona o Claude

**Data:** 2026-11-11 · **Status:** Aceito · **Issue:** PER-669 (segundo dogfooding)

**Contexto.** No segundo dogfooding (projeto novo, app Desktop) o Discover e o Route correram bem, mas a passagem entre eles deixou o usuário perdido: aprovar o gate e clicar em "Advance to route" mudou a fase no plano e nada mais aconteceu, porque o painel só escreve no plano e não aciona o modelo. Além disso o painel oferecia "Advance to implement" com a fase route sem nenhum bloco, e "Advance to validate" com implement em 0 de 12.

**Decisão.**
1. O painel mostra sempre uma linha "Next: ..." com o próximo passo, derivada só da `PlanView` (função pura `nextStep`). Nenhum estado do plano fica sem próximo passo visível, salvo release concluída.
2. O botão principal tem três formas, nesta ordem:
   - **Approve `<gate>` gate** quando o método pede um gate e ele não está aprovado (regra do ADR-011, inalterada, com as duas confirmações e o ticket). Aprovado o gate, o mod avança a fase e aciona o Claude, sem segundo clique.
   - **Continue `<fase>`** quando a fase atual não tem blocos ou tem bloco ativo não concluído. Não escreve no plano; só aciona o Claude.
   - **Start `<próxima fase>`** quando todos os blocos ativos da fase atual estão concluídos e a próxima não depende de gate pendente. Avança a fase e aciona o Claude.
   O botão "Advance to ..." deixa de existir: avançar com a fase incompleta continua possível pela tool `plan_ops` e pela CLI (o reducer não muda), mas o painel não oferece.
3. "Acionar o Claude" é `$.prompt.submit` com um texto curto e fixo que nomeia a fase e a skill (`driver:discover`, `driver:route`); para fases ainda sem skill, o texto pede `plan_status`, a lista dos blocos prontos com recomendação e motivo, e a pergunta de qual começar. O envio é um turno próprio, entra na fila se a sessão estiver ocupada e chega ao modelo com origem `plugin`.
4. `/driver approve <gate>` digitado faz o mesmo que o botão: aprova, avança e aciona.
5. O prompt enviado pelo mod nunca aprova nada: aprovação continua exigindo origem `composer` ou `ui.press` mais ticket. Um prompt de origem `plugin` é só um pedido de trabalho, igual a uma mensagem do usuário, e passa pelos mesmos hooks de gate.

**Alternativas descartadas.** Só preencher o campo de mensagem com `/driver:route` (minha proposta inicial): ainda exige saber que falta um Enter, e o usuário pediu que aprovar leve adiante. Disparar sem clique ao detectar gate aprovado no polling: gastaria turno por aprovação feita em outro terminal ou sessão.

**Consequências.** Quem aprova um gate aceita gastar o turno seguinte; isso fica dito no texto da confirmação ("Approve and start ..."). As skills de fase devem terminar toda mensagem final com o próximo passo do usuário (já era regra do ADR-013 para Discover e Route; vale para as de B-006).

## [ADR-015] Próximo passo em toda resposta e piloto automático opcional no Implement

**Data:** 2026-11-11 · **Status:** Aceito · **Issue:** PER-669 (segundo dogfooding)

**Contexto.** No Implement do coffee-app o Claude fechou um bloco, fez o commit pedido e encerrou a resposta sem dizer o que vinha depois. O autor sabe que basta pedir para continuar; um usuário comum fica parado. O pedido foi: sempre haver uma dica, uma pergunta, ou uma opção de ligar o automático e deixar o Claude decidir tudo até o fim da implementação.

**Decisão.**
1. **Regra permanente no prompt.** Em projeto com plano, o mod acrescenta uma seção ao system prompt (`prompt.compose`, id `driver:next-step`, escopo `session`): toda resposta final da sessão principal termina com o próximo passo do usuário, como pergunta com opções ou como a ação exata a tomar; depois de uma tarefa lateral (commit, dúvida) a resposta volta ao plano, lista os blocos prontos e recomenda um com o motivo. Vale em qualquer fase e não depende de skill.
2. **Piloto automático**, desligado por padrão, ligado pelo usuário no painel (botão "Autopilot") ou por `/driver auto on|off`. Só age na fase implement. Ligado, a cada fim de turno da sessão principal o mod lê o plano e, havendo trabalho, envia o próximo pedido por `$.prompt.submit`. O texto do pedido manda o Claude escolher o bloco, decidir sozinho o que tem padrão seguro, registrar escolhas não óbvias com `decision.add` e não fazer perguntas.
3. **O piloto para sozinho** (desliga e avisa no painel e por toast) quando: todos os blocos de implement estão concluídos; não há bloco pronto nem em andamento (o que resta está bloqueado); o turno foi interrompido pelo usuário, recusado ou morreu por erro; o plano não mudou de revisão em dois turnos automáticos seguidos; ou passou de 60 turnos automáticos numa ativação.
4. **O que o piloto nunca decide.** A lista fechada de "sempre perguntar" do ADR-013 (gastar dinheiro, dado de pagamento, saúde, documento ou de menores, apagar sem volta, compromisso legal), mais publicar ou enviar para fora (push, deploy, loja) e credencial ausente. Nesses casos o Claude marca o bloco como `blocked` com o motivo e segue para outro bloco pronto; sem outro, o piloto para pelo item 3. Gates continuam humanos: o piloto não aprova, e nem poderia (ADR-011).
5. O estado do piloto vive em `$.state` (sessão), não no plano: fechar a sessão desliga.

**Alternativas descartadas.** Hook de fim de turno que só cobra o próximo passo quando falta: exigiria julgar o texto da resposta. Piloto cobrindo validate e evolve: essas fases ainda não têm skill e o Evolve decide escopo; fica para depois de B-006.

**Consequências.** O piloto gasta turnos sem pedir; os cinco freios do item 3 limitam o custo, e o de "plano sem mudança" pega laço improdutivo. Decisões tomadas no automático ficam em `decisions/` para revisão no Evolve.

## [ADR-016] Mudança depois do gate: triagem em três níveis, baseline sugerido no Evolve, piloto no laço Validate e Implement

**Data:** 2026-11-11 · **Status:** Aceito, implementação em B-006 · **Issue:** PER-669 (segundo dogfooding)

**Contexto.** No coffee-app o Validate reprovou três blocos e o usuário trouxe feedback de uso no iPhone. Sem skill de Validate nem de Evolve, o Claude criou quatro blocos novos em implement (decisões D-004 e D-005) com a fase em validate. O motor aceitou: o plano aprovado no gate cresceu sem marca nem aviso, a fase atual deixou de dizer onde o trabalho está, os blocos de validação ficaram em andamento à espera de correção. O usuário perguntou se aquilo já não era Evolve e um novo ciclo, e fixou o limite: uma alteração qualquer não pode recomeçar o ciclo; o DRIVER avalia, sugere e sempre oferece o próximo passo, inclusive seguir decidindo sozinho.

**Decisão.**
1. **Triagem de toda mudança que aparece depois do gate route**, feita pelo Claude antes de mexer no plano:
   - **Nível 1, correção.** Algo falhou contra um critério de aceite que já existe. O bloco de origem vai para `needs_rework` com o relatório como motivo e volta a ser trabalhado. Não se cria bloco novo e não se pergunta.
   - **Nível 2, ajuste.** Trabalho novo que serve a um requisito já aprovado e não muda o que outros blocos entregam. Entra como bloco novo, com `decision.add`, aviso de uma linha ao usuário, e o trabalho segue sem pergunta, com ou sem piloto.
   - **Nível 3, mudança de escopo.** Requisito novo ou alterado, toque em não-objetivo, item da lista de "sempre perguntar" (ADR-013), ou invalidação de bloco já concluído. O Claude avalia o impacto (blocos afetados, tamanho estimado) e pergunta com três saídas, uma recomendada: entrar neste ciclo; ficar para o próximo ciclo (pendência registrada, o release atual não espera); replanejar agora (volta a Route, só quando a estrutura do plano muda).
2. **Nenhum nível recomeça o ciclo sozinho.** Rebaseline deixa de ser pré-condição para trabalhar: os blocos e requisitos que entraram depois do baseline vigente ficam marcados no plano e no painel. Na revisão do Evolve o DRIVER mostra a diferença para o baseline e sugere confirmar o próximo, de uma vez. O ato continua só do usuário (ADR-010, ADR-011).
3. **A fase atual acompanha o trabalho.** Enquanto houver retrabalho ou ajuste em implement com a fase em validate, o painel mostra o laço (Validate de volta a Implement) em vez de deixar validate como única fase ativa; o bloco de validação que espera correção não fica em andamento, fica `blocked` com o bloco que o segura como motivo.
4. **Próximo passo na triagem.** A resposta que comunica a triagem termina com as duas formas de seguir: um item por vez com pergunta, ou seguir sozinho até fechar (piloto automático).
5. **Piloto automático no laço.** Revê o item 2 do ADR-015: o piloto vale em implement e validate e no vai e volta entre as duas. Ligado, decide os níveis 1 e 2; no nível 3 adota a saída recomendada e registra a decisão, exceto no que ele nunca decide (ADR-015 item 4), em que para. Os freios do ADR-015 item 3 valem iguais; "tudo concluído" passa a ser implement e validate concluídos.

**Alternativas descartadas.** Parar e exigir novo ciclo a cada bloco criado depois do gate: transforma ajuste pequeno em cerimônia, e o usuário recusou. Bloquear `block.add` depois do gate sem rebaseline: mesma rigidez, imposta pelo motor. Perguntar também no nível 2: uma parada a mais por ajuste, sem decisão real do usuário em jogo. Deixar como está: o gate route perde o sentido quando o plano cresce sem marca.

**Consequências.** A classificação entre nível 2 e 3 é julgamento do modelo; a marca "depois do baseline" e a revisão no Evolve são o que torna um erro de classificação visível. Pede do motor: marca de origem por bloco e requisito em relação ao baseline, lista de pendências do próximo ciclo, e a regra de fase do item 3. Pede do mod: marca no cartão, laço no painel, piloto em duas fases. As skills de Validate e Evolve (B-006) carregam a triagem.

**Adendo (2026-11-11, plano do B-006).**
1. **A marca "depois do baseline" é derivada**, sem campo novo no `plan.json`: um bloco ou requisito está depois do baseline quando seu id não aparece em nenhum `baselines[].added` ou `.reqAdded`. Planos existentes funcionam sem migração e `schemaVersion` continua 1. Limite conhecido: se o gate route for revogado e aprovado de novo, o que foi criado no intervalo aparece como posterior.
   **Correção da revisão adversarial (mesma data).** O baseline 1 nasce na aprovação do gate route, antes de o Route criar os blocos; derivado só dali, todo bloco do plano sairia marcado. O baseline 1 passa a **fechar no fim do Route**: no `phase.advance` de route para implement, o reducer acrescenta ao baseline 1 os blocos e requisitos ativos ainda fora dele e grava `closedAt` na entrada (campo opcional; `baselines[]` é objeto frouxo, sem mudança de versão). É o plano que o usuário confirmou no passo 6 do Route. Sem `closedAt`, a view não marca nada. Planos que já passaram do Route são fechados uma vez, na próxima escrita, pela op interna `baseline.close`, calculada do ledger (o que foi criado antes da mudança de fase para implement); sem ledger, fecha com tudo o que existe.
2. **As pendências do próximo ciclo ficam fora do `plan.json`**, em `backlog.jsonl` na pasta do plano, escritas pela tool silenciosa `mcp__driver__backlog`, com `backlog.md` gerado. Um requisito adiado dentro do plano obrigaria a mexer em cobertura, gate de release e rebaseline; fora dele nada é revogado e a lista vira entrada do próximo Discover (`amend`).
3. **O novo baseline pode ser confirmado no painel**, botão `Confirm baseline N`, pelo mesmo caminho da aprovação de gate do ADR-011 (origem do usuário e ticket). O terminal continua valendo. Para o modelo segue impossível. A entrada do baseline guarda `via` e `ticket`, e o painel aplica a ela a mesma detecção de forja dos gates (alerta quando o baseline muda sem ticket emitido por ele).
4. **A espera de um bloco de validação é derivada**: bloco `blocked` com dependência não concluída. A view expõe de quem ele espera e quando pode ser retomado; um spawn de subagente não desbloqueia bloco nessa situação.

## [ADR-017] Superpowers como apoio opcional das skills do core

**Data:** 2026-11-11 · **Status:** Aceito · **Revê:** ADR-003 (só para o core) e ADR-012 item 4

**Contexto.** O ADR-003 previa superpowers como dependência pinada, e o ADR-012 adiou o pin para o B-006, onde Implement usaria `subagent-driven-development`. Dependência entre marketplaces exige que o usuário libere `allowCrossMarketplaceDependenciesOn`, e quem instala o DRIVER passaria a ser obrigado a instalar outro plugin. O público que o dogfooding mostrou é o usuário comum, para quem cada passo extra de instalação pesa.

**Decisão.**
1. As skills do core trazem o protocolo completo em texto próprio: teste primeiro, verificação por evidência (identificar, rodar, ler, conferir), destino do código no release.
2. Se o plugin superpowers estiver instalado, a skill invoca a equivalente pela tool Skill (`test-driven-development`, `verification-before-completion`, `finishing-a-development-branch`) e segue o resultado; se não estiver, segue o próprio texto. Nenhuma versão é pinada no manifesto.
3. O ADR-003 continua valendo para packs e para skills vendorizadas: cabeçalho com origem, versão e licença.

**Alternativas descartadas.** Dependência dura pinada: instalação mais pesada e quebra quando o upstream muda de versão maior. Vendorizar as skills do superpowers: o plugin é publicado e versionado, o ADR-003 reserva a cópia para quem não é.

**Consequências.** O texto próprio precisa ser mantido; em troca o DRIVER funciona sozinho. O comportamento varia um pouco conforme o superpowers esteja ou não instalado, o que o dogfooding deve cobrir nos dois casos.

## [ADR-008] Proporcionalidade de cerimônia
**Data:** 2026-10-26 (fechado em 2026-10-30 pelo ADR-012)
**Status:** Aceito

### Contexto
Mínimo de 3 rodadas de entrevista sem limite de duração afasta projetos pequenos (um deck, um script).

### Decisão
A profundidade do Discover e o número de blocos do Route escalam com uma classe de tamanho decidida na primeira rodada da entrevista, pelo esforço estimado pelo usuário:

| Classe | Sinal | Rodadas | Perguntas por rodada | Blocos no Route |
|---|---|---|---|---|
| XS | uma tarde | 1 + play back | 3 | 2 a 4 |
| S | alguns dias | 2 + play back | 4 | 4 a 8 |
| M | algumas semanas | 3 + play back | 6 | 8 a 15 |
| L | meses ou um time | 3 ou mais, até a fronteira esvaziar | 8 | 15 a 30 |

Dinheiro, dados pessoais, produção, ações irreversíveis ou domínio regulado sobem a profundidade do Discover em uma classe, sem mudar a faixa de blocos. A classe é registrada como decisão no plano; o usuário pode reclassificar uma vez, ao fim da primeira rodada; exceder a faixa de blocos exige motivo declarado.

**Revisão de 2026-11-10 (ADR-013):** as colunas "Rodadas" e "Perguntas por rodada" e a subida de classe por risco deixam de valer. A classe fixa o orçamento do núcleo da entrevista (XS 2, S 4, M 6, L 8 perguntas no total) e a faixa de blocos; a profundidade técnica vem das áreas que o usuário escolhe.

A faixa de blocos conta só blocos de implement e validate. Os blocos fixos de cada plano ("Discovery interview", "Route plan", "Evolve review" e o bloco de release) são sobrecarga constante e não contam; sem isso XS não caberia em 2 a 4 (revisão de 2026-10-30). XS também dispensa a pergunta de reclassificação e a pergunta de não-objetivos: ambos entram no play back.
