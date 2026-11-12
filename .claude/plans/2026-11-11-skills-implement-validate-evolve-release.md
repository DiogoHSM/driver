# Plano: B-006, skills Implement, Validate, Evolve e Release, com o ADR-016

## Contexto

Discover e Route têm skill; as quatro fases seguintes não. No segundo dogfooding (coffee-app) o Claude improvisou essas fases: o Validate reprovou blocos e virou blocos novos em implement sem marca, a fase atual deixou de dizer onde o trabalho estava, e o piloto automático desligou ao sair de Implement. O ADR-016 (aceito em 2026-11-11) fixa a regra: triagem em três níveis para toda mudança depois do gate, nenhum nível recomeça o ciclo sozinho, novo baseline sugerido no Evolve, piloto valendo no laço Validate e Implement.

Resultado esperado: um projeto vai do gate route até o release publicado conduzido por skills, com o painel mostrando o que entrou depois do baseline e para onde o trabalho voltou, e com toda resposta terminando no próximo passo.

Pré-requisito: B-005 fechado (falta a conferência visual do Diogo no app). As etapas 1 e 2 abaixo não dependem disso e podem começar antes.

## Decisões que este plano toma (rejeite aqui o que não quiser)

1. **Dividir o B-006 em três blocos** (nível 2 do próprio ADR-016: mesmo requisito R-001, só reparte o trabalho). Um bloco novo "Motor e painel do ADR-016" (etapas 1 e 2), do qual o B-006 passa a depender; o B-006 fica com Implement e Validate (etapa 3); um bloco novo "Skills Evolve e Release" (etapa 4) depende do B-006. Motivo: o B-006 inteiro não cabe em uma sessão e as etapas 1 e 2 são testáveis sozinhas.
2. **Superpowers como apoio opcional, não dependência dura.** Revê o ADR-003 só para o core (novo ADR-017): as skills do DRIVER trazem o protocolo completo em texto próprio e, se o plugin superpowers estiver instalado, invocam `test-driven-development`, `verification-before-completion` e `finishing-a-development-branch` pela tool Skill. Motivo: quem instala o DRIVER não deve ser obrigado a instalar outro plugin de outro marketplace, e a dependência entre marketplaces exige configuração extra do usuário.
3. **Marca "depois do baseline" derivada, sem campo novo no `plan.json`.** Um bloco ou requisito está depois do baseline quando seu id não aparece em nenhum `baselines[].added` ou `.reqAdded`. Planos existentes funcionam sem migração; `schemaVersion` continua 1.
4. **Pendências do próximo ciclo fora do `plan.json`**: arquivo `backlog.jsonl` na pasta do plano, escrito por uma tool silenciosa nova, com `backlog.md` gerado. Motivo: um requisito adiado dentro do plano exigiria mexer em cobertura, gate de release e rebaseline; fora do plano não revoga nada e vira entrada do próximo Discover (`amend`).
5. **Subagente em paralelo não escreve artefatos nem testes no plano.** Ele constrói, preenche o Handoff do próprio bloco (o mod já permite) e devolve um relatório; a sessão principal confere, registra artefatos e testes e fecha o bloco. Sem mudança de permissão no mod.
6. **Botão "Confirm baseline N" no painel**, pelo mesmo caminho da aprovação de gate (origem do usuário e ticket, ADR-011). Motivo: o rebaseline hoje exige terminal, o que trava o usuário comum no Evolve. Continua impossível para o modelo.
7. **Commit por bloco no projeto do usuário**: a skill Implement pergunta uma vez por projeto se deve commitar localmente cada bloco fechado e registra a resposta como decisão. Nunca faz push.

## Etapa 1: motor (`plugins/driver/src/`)

Tudo em `src/shared/` segue a regra dura de não importar nada de fora.

- `src/shared/plan-doc.ts`, `src/shared/view.ts`, `types/index.d.ts`: `PlanDoc` ganha `baselines?: {n, added, reqAdded}[]`. `BlockView` ganha `afterBaseline?: boolean` e `waitingOn?: string[]` (dependências não concluídas de um bloco `blocked`). `PlanView` ganha `reqsAfterBaseline: number` e `openBehind: Phase[]` (fases anteriores à atual com bloco ativo não concluído). `summarize` ganha `rework` (blocos em `needs_rework`) e `resumable` (blocos `blocked` cujas dependências já fecharam); `ready` não muda.
- `src/backlog.ts` (novo, no molde de `src/discover-log.ts`): acrescenta entrada `{id N-nn do ciclo, title, origin, decision, at}` em `backlog.jsonl` e regenera `backlog.md`. CLI: `driver backlog add|show` em `src/cli.ts`. A pasta já é protegida pelo guard só para os arquivos do plano; `backlog.*` entra na lista de "só pelas tools" das convenções.
- `src/cli.ts`: `rebaseline` aceita `--via-mod` com ticket, como `gate approve` já faz (`test/cli-mod.spec.ts` é o modelo).
- `src/validate.ts`: aviso novo `phases.openBehind` quando a fase atual é evolve ou release e há bloco ativo não concluído em implement ou validate (só aviso; o erro `gate.releaseIncomplete` continua sendo a barreira).
- `mod/hooks.ts` `claim()`: não desbloquear por spawn um bloco `blocked` com `waitingOn` não vazio (nega o spawn com o motivo).
- Guard: corrigir o falso positivo visto hoje (`status --block` dentro de um laço `for` foi lido como aprovação de gate) em `src/shared/protect.ts`, com caso em `test/protect.spec.ts`. Regra do GUARDRAILS: adicionar o caso de teste, não afrouxar.
- Testes: `view.spec.ts`, `validate.spec.ts`, `cli.spec.ts`, novo `backlog.spec.ts`, `protect.spec.ts`, `types.spec.ts`. Regerar `schema/plan.v1.schema.json` só se o schema mudar (não deve).

## Etapa 2: mod (`plugins/driver/mod/`, desenho em `src/shared/svg.ts` e `layout.ts`)

- **Marca no cartão**: glifo `+` no canto inferior direito, na mesma fila do `!` e do `▲` (`nodeVertical`, contando em `badges`), linha no tooltip, entrada na legenda; o mesmo em `rows.ts`, `render-board.tsx` e `render-terminal.tsx`. Cabeçalho: `baseline 1 · +4 since` quando houver.
- **Laço**: faixa de fase listada em `openBehind` recebe o rótulo `↺ reopened` e a moldura de fase atual; uma seta tracejada na margem direita liga a fase atual a ela (reaproveita o desenho de aresta `backward`, classe `.eb`).
- **`mod/next.ts`**: `SKILLS` passa a nomear `driver:implement`, `driver:validate`, `driver:evolve`, `driver:release`. `primaryAction` olha `openBehind` antes de oferecer `Start <próxima>`: havendo trabalho atrás, o botão é `Continue implement` e a linha Next diz o que falta e por quê. Em evolve com gate release pendente e itens depois do baseline, a linha Next sugere confirmar o baseline antes de aprovar.
- **`mod/autopilot.ts`**: veredito e texto por fase (implement e validate), "tudo concluído" = as duas fases concluídas, `AUTOPILOT_RULE` com a triagem (decide níveis 1 e 2; no nível 3 adota a saída recomendada e registra, exceto a lista do ADR-015 item 4). Botão e frases do painel (`pane.tsx:235, 275, 293`) e de `command.ts` deixam de dizer só Implement.
- **Tool nova** `mcp__driver__backlog` em `mod/tools.ts` (padrão dos seis existentes; recusada para subagente).
- **Botão `Confirm baseline N`** em `pane.tsx`, visível na fase evolve quando há itens depois do baseline; confirmação em duas etapas igual à do gate; `mod/approve.ts` ganha `rebaselineViaMod`.
- Testes: `pane.test.tsx`, `autopilot.test.tsx`, `tools.test.tsx`, `hooks.test.tsx`; snapshots de `svg.spec.ts`, `layout.spec.ts`, `rows.spec.ts`.

## Etapa 3: skills Implement e Validate (`plugins/driver/skills/`)

Formato igual ao de Discover e Route: frontmatter completo, primeira linha mandando ler `references/driver-conventions.md`, passos numerados, tabela "Red flags", texto em inglês, conversa na língua do usuário, nenhuma fala antes de chamada de ferramenta, mensagem final com o próximo passo.

**`implement/SKILL.md`** (`argument-hint: "[B-nnn | parallel]"`)
1. `plan_status`; lista blocos prontos, em retrabalho e retomáveis; recomenda um (risco alto ou caminho crítico primeiro) e diz por quê. Dois ou mais independentes: oferece paralelo.
2. Lê `blocks/B-nnn.md`, os `requirements/R-nnn.md` ligados e o `provider`; credencial ausente (só nome de variável) marca `blocked`.
3. `in_progress`; constrói; teste primeiro quando for código (invoca `superpowers:test-driven-development` se existir, senão segue o resumo embutido).
4. Verificação pela regra identificar, rodar, ler, conferir contra cada critério de aceite; registra `addArtifacts` e `addTests`; Handoff por `block_doc`; `in_review`, `verification`, `done`. Commit local conforme a decisão 7.
5. Paralelo: um subagente por bloco, `model` explícito, marcador `DRIVER-BLOCK: B-nnn` no prompt, `isolation: worktree` quando o projeto é git e os blocos podem tocar os mesmos arquivos; a principal integra um por vez e fecha os blocos (decisão 5).
6. Mudança que aparece no meio: triagem do ADR-016 (arquivo de apoio `references/triage.md`, compartilhado com Validate e Evolve).
7. Fim da fase: `phase.advance` para validate e passo seguinte (`Start validate` ou, com piloto, segue direto).

**`validate/SKILL.md`** (`argument-hint: "[B-nnn | recheck]"`)
1. Para cada bloco de validação pronto: `in_progress`, roda as camadas que o tipo de projeto pede, e o aceite contra os documentos R, não só contra o plano.
2. Relatório em `validate/B-nnn.md` (template em `validate/templates/report.md`), `addTests` no bloco de validação.
3. Falha: triagem. Nível 1 leva o bloco de origem a `needs_rework` com o relatório como motivo e o bloco de validação a `blocked` ("waiting on B-nnn"); níveis 2 e 3 conforme o ADR-016, com a tool de backlog para "próximo ciclo".
4. A mensagem de triagem termina oferecendo item a item ou piloto automático.
5. `recheck`: retoma os blocos `resumable` e roda só o que o retrabalho tocou.
6. Tudo validado e nada aberto atrás: `phase.advance` para evolve.

## Etapa 4: skills Evolve e Release

**`evolve/SKILL.md`** (`argument-hint: "[review | round <motivo>]"`), dona do bloco "Evolve review":
1. Junta: itens depois do baseline, decisões desde o baseline (as do piloto em destaque), backlog, `driver validate` (cobertura), e o critério da visão: todo requisito com teste passando ou retirado com decisão.
2. Checkpoint opcional por classe (pre-mortem, red team), como no Discover.
3. Escreve `evolve/review.md` na língua do usuário (template) e o apresenta como mensagem final com recomendação: pronto para release, mais uma rodada (ajuste local em implement ou `driver:route replan`), e confirmar o baseline N+1 no botão do painel.
4. Um aprendizado por rodada em `evolve/learnings.md`.
5. Nunca aprova o gate: diz o que apertar e encerra o turno. A aprovação já inicia `driver:release` (ADR-014).

**`release/SKILL.md`** (`argument-hint: "[version]"`), dona do bloco de release:
1. Checklist genérico do core (packs acrescentam depois, ADR-005): plano de rollback, documentação, observabilidade quando couber, pendências de credencial.
2. Destino do código: manter local, merge, ou push e PR. Publicar para fora sempre pergunta, mesmo com piloto.
3. `driver release add` pelo Bash, artefatos, Handoff, bloco `done`.
4. Fecha com o backlog: havendo pendências, o próximo passo é `/driver:discover amend`.

## Etapa 5: documentação e fechamento

- `references/driver-conventions.md`: intro e seção 1 com as quatro skills e os caminhos novos (`validate/`, `evolve/`, `backlog.*`); linha 110 passa a permitir `done` para `needs_rework` no nível 1; tool `backlog` na seção 2.
- `test/skills.spec.ts`: exigir as seis skills.
- ADR-017 (superpowers opcional) e adendo ao ADR-016 (botão de baseline, backlog fora do plano) em `DECISIONS.md` antes do código de cada um.
- `ARCHITECTURE.md`, `PROJECT-SUMMARY.md`, `CLAUDE.md`, linha de skills do `GUARDRAILS.md` (ADR-006, 014, 015, 016, 017).
- Linear: issue nova no projeto DRIVER para o B-006; plano copiado para `.claude/plans/2026-11-11-skills-implement-validate-evolve-release.md`.
- Commit só com pedido.

## Execução

| Etapa | Quem | Modelo |
|---|---|---|
| ADRs, divisão dos blocos no plano, convenções | sessão principal | |
| 1 motor | subagente | sonnet |
| 2 mod | subagente, depois da 1 | sonnet |
| 3 e 4 skills (dois subagentes em paralelo, depois da 2) | subagentes | sonnet |
| Revisão adversarial das quatro skills e da triagem | subagente | opus |
| 5 docs e fechamento | sessão principal | |

## Verificação

```bash
npm --prefix plugins/driver test
npm --prefix plugins/driver run typecheck
~/.local/bin/claude plugin test plugins/driver
~/.local/bin/claude plugin validate .
```

Manual, no app, depois de recarregar o plugin:
1. **Reprodução do coffee-app** em cópia de `examples/web-waitlist`: levar a validate, forçar uma falha de aceite. Esperado: bloco de origem em retrabalho, bloco de validação bloqueado com "waiting on", faixa implement com `↺ reopened`, botão `Continue implement`, nenhum bloco novo.
2. Pedir um ajuste que serve a requisito existente: bloco novo com `+`, uma linha de aviso, sem pergunta.
3. Pedir algo fora do escopo: pergunta com as três saídas; escolher "próximo ciclo" e conferir `backlog.md`.
4. Piloto ligado em validate: atravessa o laço e para sozinho com implement e validate concluídos.
5. Evolve: `review.md` lista os itens `+`, o botão `Confirm baseline 2` funciona só por clique meu, e o modelo é recusado ao tentar.
6. Aprovar release: `driver:release` começa sozinho e termina apontando o backlog.
7. No coffee-app real: abrir o painel e conferir que B-021 a B-024 aparecem com `+` sem nenhuma migração.
