# Decisões Arquiteturais — DRIVER

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

## [ADR-008] Proporcionalidade de cerimônia
**Data:** 2026-10-26
**Status:** Proposto

### Contexto
Mínimo de 3 rodadas de entrevista sem limite de duração afasta projetos pequenos (um deck, um script).

### Decisão
A profundidade do Discover e o número de blocos do Route escalam com tamanho e risco do projeto. Mecanismo exato a definir no design do Discover.
