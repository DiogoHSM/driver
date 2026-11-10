# Plano: skills Discover e Route (B-005)

## Contexto

O `plan.json` v1 (`6dfb08a`), o mod do diagrama vivo (`77a61a1`) e o guard refeito (`358f67a`) estão commitados. O plano do próprio DRIVER em `.claude/driver/` está na fase Implement com B-005 "Skills Discover e Route" em andamento. Hoje o plugin tem CLI, tools `mcp__driver__*`, hooks e painel, mas nenhuma skill: quem usa o DRIVER precisa saber chamar `plan_ops` à mão. A pesquisa (`docs/research/skills-landscape.md`, seção 6) aponta Discover e Route como o ponto mais fraco do pipeline manual atual e o próximo passo depois do mod.

Resultado esperado: duas skills no core (`plugins/driver/skills/discover/`, `plugins/driver/skills/route/`) que conduzem a entrevista do Discover (uma pergunta por turno com `AskUserQuestion`, opções com recomendação, log de premissas em disco, não-objetivos, proporcionalidade do ADR-008) e a decomposição do Route (blocos com critério de aceite, dependências, risco, cobertura de requisitos, diagrama validado), escrevendo no plano só pelas tools do mod ou pela CLI. ADR-012 registra o formato e as decisões antes do código. Dogfooding em uma cópia de `examples/web-waitlist` e, depois, neste repositório.

## Fatos levantados (não reexplorar)

- Formato de skill: `skills/<nome>/SKILL.md` com frontmatter `name`, `description` (juntos ≤ 1.536 chars), opcionais `user-invocable`, `argument-hint`, `disable-model-invocation`, `allowed-tools`; corpo em markdown; arquivos de apoio ao lado (`${CLAUDE_SKILL_DIR}`). Sem `context: fork` (a entrevista precisa do histórico). Manifesto não precisa de chave `skills` (convenção de diretório). Precedente de `user-invocable: true` no plugin impeccable. Nome do slash para skill de plugin não verificado localmente (`/driver:discover` provável); confirmar no primeiro load.
- superpowers 7.0.0 instalado em `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/`: `brainstorming` (225 linhas, texto livre, uma pergunta por mensagem, spec em `docs/superpowers/specs/`), `writing-plans` (204 linhas, auto-revisão de 5 pontos: cobertura da spec, varredura de passos, consistência de tipos, foco de revisão, proporção). Nenhuma usa `AskUserQuestion`. `grilling` (mattpocock) e spec-kit não estão na máquina: só as notas em `docs/research/01-process-skills.md`.
- Escrita no plano: `mcp__driver__plan_ops` (1 a 25 ops; `block.add {title, phase, dependsOn?, requirements?, risk?, provider?}`, `req.add {title, kind functional|nonfunctional|constraint|non-goal, source user|assumed, ref?}`, `decision.add {title, reason?}`, `block.set {id, patch}`, `block.retire`, `req.retire`, `phase.advance`; `"$0"` referencia ids criados no lote), `mcp__driver__set_block_state`, `mcp__driver__plan_status`. Fallback: CLI `driver` via Bash. `block.add` cria `blocks/B-nnn.md` com seções vazias `## Spec`, `## Acceptance criteria`, `## Notes`, `## Handoff`; `req.add` via tool não cria `requirements/R-nnn.md` (a skill escreve). `discover/` nasce vazio no `init`. Protegidos só `plan.json`, `events.jsonl`, `log/*`, `.mod/*`.
- Pré-condições do reducer: `in_progress` exige deps `done` e fase ≤ `currentPhase`; `in_review` exige ≥ 1 artifact e `## Handoff` preenchido; `done` exige `verification.passes === true`; `blocked`/`needs_rework` exigem motivo; `phase.advance` para route exige gate route aprovado (só o usuário: `/driver approve route` no composer ou botão do painel; a primeira aprovação cria baseline 1 e D-nnn); `req.coverage` é aviso até release.
- Gate hook: em `discover` subagentes são permitidos; a partir de `route` só com gate route aprovado (Route roda depois da aprovação, então pode usar subagentes).
- Convenções dos exemplos: premissa = `req.add source:"assumed" ref:"discover/assumptions.md"`; não-objetivo = `kind:"non-goal"`; bloco de Discover com artifact `discover/interview.md`.
- Visão (4.1, 4.2, 5, 7, 11): entrevista em ≥ 3 iterações para projetos maiores (contexto e amplitude; requisitos e restrições; confirmação e não-objetivos), opção "não sei" em toda pergunta, log de premissas vira contrato, diagrama sempre presente no Route, bloco com entrada, saída, critério de aceite, dependências e risco, plano versionado (baseline), definition of done por bloco e fase, matriz de riscos; só dois gates humanos; identificação do domínio na primeira iteração "sem engenharia".
- Regras a compor: fronteira de decisões do grilling (perguntar toda decisão cujos pré-requisitos estão resolvidos; fatos são do agente via subagentes, decisões do usuário; termina quando a fronteira esvazia; recomendação tal que "sim" aceita); formato do spec-kit clarify (2 a 5 opções, `Recommended`, linha "por que importa", ranking impacto × incerteza, teto por rodada); compound-engineering (uma pergunta por turno, teste de decisões já tomadas contra o log). `AskUserQuestion`: 1 a 4 perguntas por chamada, 2 a 4 opções cada, opção "Other" automática.

## Decisões de design (ADR-012, a escrever antes do código)

1. **Skills no core, uma por fase, formato nativo de skill de plugin.** `plugins/driver/skills/discover/SKILL.md` e `plugins/driver/skills/route/SKILL.md`, `user-invocable: true`, descrição que dispara pelo contexto ("começar um projeto ou feature com DRIVER" / "planejar depois do gate route"). Texto das skills em inglês; a entrevista acontece na língua do usuário.
2. **Entrevista com `AskUserQuestion`, uma pergunta por turno**, opções com `(Recommended)` primeiro e "por que importa" na descrição, opção "não sei" explícita quando couber (dispara pesquisa por subagente ou sugestão). Fronteira de decisões mantida em `discover/interview.md`; teste de decisões já tomadas contra `discover/assumptions.md` e os requisitos do plano.
3. **Proporcionalidade (fecha o ADR-008):** classe de tamanho decidida na primeira rodada (S: tarefa única / M: feature ou módulo / L: produto ou sistema), que fixa rodadas mínimas, teto de perguntas por rodada e faixa de blocos no Route. Mecanismo detalhado abaixo.
4. **Sem dependência do superpowers nesta rodada.** Discover tem estilo próprio (opções visuais, persistência em disco) e Route reaproveita a auto-revisão do `writing-plans` por cópia do checklist, não por chamada. A dependência pinada (ADR-003) fica para B-006 (Implement usa `subagent-driven-development`).
5. **Durante a entrevista, só arquivos; o plano recebe um lote no fim.** A árvore de decisões vai para `discover/interview.md` a cada resposta (sobrevive à compactação); requisitos, premissas, não-objetivos e a decisão de classe entram por `plan_ops` em um lote (≤ 25 ops por chamada) depois do "play it back" aceito. Motivo: nada é apagado no plano (ADR-010 item 7); requisitos adicionados cedo e mudados depois virariam ruído de `retire` com decisão. O painel mostra o bloco "Discovery interview" em andamento enquanto isso. Nunca `plan.json` direto, nunca gate, nunca apagar.
6. **Discover e Route têm um bloco próprio no plano** ("Discovery interview", fase discover; "Route plan", fase route, dependente do primeiro), com artifacts, Handoff e `verification.passes` marcado pelo modelo tendo o aceite do usuário como evidência (mesmo critério usado no dogfooding de B-002 a B-004).
7. **Convenções compartilhadas fora de `skills/`**, em `plugins/driver/references/driver-conventions.md`, para não serem varridas como skill; cada SKILL.md abre com "leia esse arquivo primeiro".

## Protocolo do Discover

**0. Início.** `plan_status`. Sem plano → `driver init <nome>` via Bash. Fase além de discover → modo *amend*: entrevista só o tópico do argumento, adiciona requisitos e avisa que o Route precisa replanejar. `discover/interview.md` existente → *resume*: lê a árvore, reporta "N resolvidas, fronteira: …" e continua, sem reperguntar nó resolvido. Cria ou reaproveita o bloco "Discovery interview" e o põe `in_progress`.

**1. Classificação (rodada 1, única chamada com duas perguntas).** Q1 domínio: três opções inferidas do argumento mais "Não sei". Q2 tamanho por esforço: "Uma tarde", "Alguns dias", "Algumas semanas", "Meses ou um time". "Não sei" → inferir da descrição, registrar como premissa e dizer isso.

**2. Proporcionalidade (fecha o ADR-008).**

| Classe | Sinal | Rodadas | Perguntas/rodada | Blocos no Route |
|---|---|---|---|---|
| XS | uma tarde | 1 + play back | 3 | 2 a 4 |
| S | dias | 2 + play back | 4 | 4 a 8 |
| M | semanas | 3 + play back | 6 | 8 a 15 |
| L | meses | 3+ até a fronteira esvaziar | 8 | 15 a 30 |

Dinheiro, dados pessoais, produção, ações irreversíveis ou domínio regulado sobem a profundidade do Discover em uma classe (não o número de blocos). A classe vira `decision.add "Project size class: M"` no lote de saída. Reclassificação oferecida uma vez após a rodada 1.

**3. Temas por rodada.** 1: contexto e amplitude (objetivo, usuários, sinal de sucesso, ativos existentes, prazo, orçamento). 2: requisitos e restrições (features, NFRs, provedores e nomes de variáveis de credencial, ADR-004). 3: confirmação e não-objetivos (multiSelect de candidatos). Classes menores fundem temas.

**4. Laço da fronteira (uma pergunta por turno).** (1) Recalcular a fronteira: nós abertos cujos `dependsOn` estão resolvidos ou assumidos. (2) Teste de decisões já tomadas: se `assumptions.md`, uma resposta anterior ou o repositório já responde, marcar resolvido com referência; não perguntar. (3) Fato ou decisão? Fato (respondível por repo, docs ou web sem preferência do usuário) → subagente de leitura em background (sonnet), nó `researching`, entrevista continua; o achado vira fato resolvido ou recomendação. (4) Ranquear decisões por impacto × incerteza (impacto = nós destravados + custo de reverter; incerteza = sem default seguro). (5) Perguntar a de maior ranking com `AskUserQuestion`. (6) Registrar resposta, abrir nós filhos, anexar em `interview.md` na hora. (7) Fechar a rodada no teto ou com a fronteira do tema vazia.

**5. Forma da pergunta.** `header` ≤ 12 chars; 2 a 3 opções reais + "Não sei / decida por mim" (limite de 4); recomendada primeiro com sufixo "(Recommended)"; cada `description` diz a consequência; o texto termina com "Por que importa: …"; na língua do usuário.

**6. "Não sei" nunca bloqueia.** Tipo fato → pesquisar e reperguntar com o achado como recomendação. Preferência com default seguro → adotar e registrar `A-nn` (assumed). Alto impacto sem default → oferecer diagrama rápido (Mermaid no chat) ou adiar para a rodada 3.

**7. Checkpoint opcional (M e L).** Antes do play back: "Pre-mortem / Red team / Socrático / Pular (Recommended para S)". Nós novos entram na fronteira.

**8. Saída.** Play back no chat (objetivo, requisitos, premissas, não-objetivos, classe). `AskUserQuestion`: "Aceitar tudo (Recommended) / Mudar algo / Falta algo", em laço até aceitar. Um lote `plan_ops`: `req.add` para requisitos, premissas (`source:"assumed"`, `ref:"discover/assumptions.md"`) e não-objetivos (`kind:"non-goal"`) mais a decisão de classe (dividir em 25). Escrever `requirements/R-nnn.md` e preencher os ids R em `assumptions.md` e `non-goals.md`. Bloco Discovery: `addArtifacts` dos três arquivos, `## Handoff`, `in_review`, `verification {passes:true}`, `done`. Dizer: "Digite `/driver approve route` ou use Approve no painel." Encerrar o turno.

**9. Depois do gate.** No turno seguinte, `plan_status`: aprovado → `phase.advance` e invocar a skill `route`. Recusado → perguntar o que está errado, bloco Discovery `done → needs_rework` (motivo) → `in_progress`, reabrir os nós afetados, repetir o passo 8.

### Artefatos do Discover (em `.claude/driver/`)
- `discover/interview.md`: frontmatter `class`, `domain`, `round`, `language`, `status open|closed`; `## Decision tree` (tabela `Q-nn | pergunta | dependsOn | kind fact|decision | status open|researching|settled|assumed|deferred | answer | source user|research|assumed`); `## Rounds` (pergunta, opções mostradas, resposta, timestamp).
- `discover/assumptions.md`: `## A-nn <afirmação>` com `Why assumed`, `Source node Q-nn`, `Accepted yes|pending`, `Requirement R-nnn`.
- `discover/non-goals.md`: `- N-nn <afirmação> (motivo) -> R-nnn`.
- `requirements/R-nnn.md`: frontmatter `id`, `title`, `kind`, `source`; seções `## Statement`, `## Acceptance signal` (observável, testável), `## Origin` (Q-nn ou A-nn), `## Notes`.

## Protocolo do Route

1. `plan_status`. Gate route não aprovado → parar e avisar. Fase ainda discover → `phase.advance`. Criar ou reaproveitar "Route plan" (fase route, depende do bloco Discovery), `in_progress`.
2. Entradas: `plan.json` (só leitura), docs R, arquivos do discover, classe. Brownfield: opcionalmente um agente `feature-dev:code-explorer`.
3. Regras de decomposição: **implement**: um entregável por bloco que um agente termina em uma sessão (≈ um PR), com saída observável; **validate**: ≥ 1 bloco por grupo de requisitos, camadas conforme o domínio, aceite contra os docs R e não só contra o plano; **evolve**: exatamente um bloco "Evolve review"; **release**: um bloco com checklist. `dependsOn` só para dependência real de artefato (maximizar paralelismo); raízes de implement dependem do bloco Route. Todo requisito que não é não-objetivo liga a ≥ 1 bloco implement e ≥ 1 validate; não-objetivos a nenhum. Risco `high` para ação irreversível, dinheiro, dados pessoais, tecnologia nova ou bloco apoiado em premissa assumida; `medium` para integração externa; senão `low`. `provider {capability, provider, access, credentials[]}` quando houver capacidade externa. Dentro da faixa da classe; exceder exige motivo declarado.
4. Lotes: `block.add` com `"$n"` em `dependsOn`, ≤ 25 ops por chamada; acima disso, o primeiro lote cria as raízes e os seguintes usam ids reais. Depois, Write em cada `blocks/B-nnn.md`.
5. Auto-revisão (adaptada do writing-plans): (a) cobertura de requisitos; (b) varredura de blocos: saída, critério de aceite e tamanho de uma sessão; (c) sanidade de dependências: sem ciclo, sem aresta falsa; (d) foco de revisão: blocos `high` têm par de validate e mitigação; (e) proporção contra a faixa da classe. Depois `driver validate`: zero avisos `req.coverage`.
6. Diagrama validado: apontar o painel, `driver export mermaid`, colar o Mermaid no chat para quem está na CLI. `AskUserQuestion`: "Está certo (Recommended) / Ajustar blocos / Ajustar ordem / Repartir", em laço até "Está certo".
7. Fim: bloco Route com `addArtifacts` [`route/risks.md`, `exports/plan.mmd`] e Handoff, `in_review`, verification, `done`; `phase.advance` para implement; reportar os blocos prontos.
8. Modo replan (para o Evolve, depois): nunca editar bloco `done`; adicionar novos; `block.retire` dos superados citando `decision.add`; rebaseline é do usuário.

### Artefatos do Route
- `blocks/B-nnn.md`: `## Spec` (propósito e escopo), `## Acceptance criteria` (checklist testável = definition of done), `## Notes` (`Input:`, `Output:`, `Risk: nível, porquê, mitigação`, `Provider:`), `## Handoff` vazio.
- `route/risks.md`: matriz `bloco | risco | probabilidade L/M/H | impacto L/M/H | mitigação | bloco dono` e definition of done por fase.

## Layout de arquivos

```
plugins/driver/skills/
  discover/SKILL.md            protocolo da entrevista (≈ 200 linhas)
  discover/question-format.md  formato das perguntas e exemplos (apoio, lido sob demanda)
  discover/templates/          interview.md, assumptions.md, non-goals.md, requirement.md
  route/SKILL.md               decomposição, auto-revisão, diagrama
  route/templates/block.md     Spec / Acceptance criteria / Notes preenchidos
  route/templates/risks.md
plugins/driver/references/driver-conventions.md   tools, formatos, pré-condições, regras duras, idioma
plugins/driver/test/skills.spec.ts
.claude/docs/DECISIONS.md    ADR-012 (skills de fase) e ADR-008 → Aceito com o mecanismo acima
```

Frontmatter: `name` igual à pasta, `description` que dispara pelo contexto, `user-invocable: true`, `argument-hint` (`"[ideia em uma linha | amend <tópico>]"` / `"[replan <motivo>]"`), `disable-model-invocation: false` (Discover precisa invocar Route depois do gate), sem `context: fork`; `allowed-tools` restrito a `AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Bash(driver *), mcp__driver__*` (se o engine aceitar o padrão; senão omitir).

## Pontos em aberto para o Diogo

- Classe L pode passar de 30 turnos de entrevista; o teto por rodada e os arquivos à prova de compactação são a mitigação. Aceitável?
- Lote no fim (decisão 5) deixa o painel sem requisitos durante a entrevista. A alternativa é `req.add` incremental com ruído de retire. Recomendo o lote.
- `verification.passes` marcado pelo modelo nos blocos Discovery e Route (decisão 6). A alternativa é exigir o usuário, o que trava o fluxo em dois pontos a mais.
- Nome do slash (`/driver:discover`) e `allowed-tools` com `Bash(driver *)` são confirmados no primeiro load.

## Execução

1. Linear: issue "Skills Discover e Route" no projeto DRIVER (PER-6xx); plano copiado para `.claude/plans/2026-10-30-skills-discover-route.md`; design bruto do agente em `docs/research/07-skills-design.md`.
2. Eu: ADR-012 em `DECISIONS.md` e ADR-008 fechado.
3. Subagent **sonnet**: `skills/_shared/conventions.md`, `skills/discover/*`, `skills/route/*`, `test/skills.spec.ts`; `claude plugin validate .`; `npm test`.
4. Eu: primeiro load (hot reload do mod já cobre o plugin); conferir o nome do slash; dogfooding em cópia de `examples/web-waitlist` (ver Verificação).
5. Subagent **opus**: revisão adversarial das skills (perguntas que violam o teto, caminhos em que a skill tenta aprovar gate ou escrever `plan.json`, re-entrada, usuário que responde "não sei" em tudo, projeto S que recebe cerimônia de L).
6. Docs: ARCHITECTURE (skills deixam de ser futuro), PROJECT-SUMMARY, CLAUDE.md, GUARDRAILS (`skills/**` → ADR-012). B-005 → in_review → done no plano. Commit só com pedido.

## Verificação

```bash
claude plugin validate .
npm --prefix plugins/driver test            # inclui test/skills.spec.ts
```

`test/skills.spec.ts`: frontmatter parseia, `name` igual à pasta, `description` < 1.024 chars, todo caminho `${CLAUDE_SKILL_DIR}` resolve, todo `mcp__driver__*` e toda op citada existem em `mod/tools.ts`, sem `context: fork`, sem travessão.

Dogfooding manual (cópia limpa de `examples/web-waitlist` sem `.claude/driver`): `/driver:discover "waitlist landing page"` → classe S, 2 rodadas, ao menos um "Não sei" registrado como `A-nn`, os três arquivos do discover, docs R em número igual aos requisitos do plano (com ≥ 1 não-objetivo), bloco Discovery `done`. Aprovar no painel → Route começa sozinho, 4 a 8 blocos, `driver validate` limpo, `route/risks.md`, `exports/plan.mmd`, fase implement. Rodar `/driver:discover` de novo → mensagem de amend, nenhuma pergunta repetida. Depois, usar neste repositório em B-005.
