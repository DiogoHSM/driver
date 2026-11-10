# DRIVER

## O que é
Plugin de Claude Code que impõe um processo estruturado, rastreável e iterativo a qualquer projeto: Discover · Route · Implement · Validate · Evolve · Release. O plano é um grafo de blocos com estado, renderizado como diagrama vivo ao lado do chat. O plugin compõe skills existentes (superpowers, impeccable, hyperframes etc.) em vez de reinventá-las, e sugere a "stack ideal" de ferramentas por domínio para quem não a conhece.

## Objetivos
- Formalizar o pipeline manual já em uso (/iniciar, /planejar, /executar, /gerenciar, /auditar, /encerrar) como método reutilizável.
- Grafo de plano com estado por bloco como artefato central; diagrama como renderização (mod no app desktop, Mermaid como fallback na CLI).
- Dois gates humanos apenas: Discover→Route e Evolve→Release.
- Registro de capacidades por domínio: sugerir e carregar ferramentas por bloco, nunca tudo de uma vez.
- Packs por domínio: `driver` (core) + `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`.

## Fases (resumo)
| Fase | Essência | Compõe a partir de |
|---|---|---|
| Discover | Entender | brainstorming + entrevista estilo grill-me + log de premissas |
| Route | Planejar | writing-plans + grafo do plano + diagrama |
| Implement | Construir | subagent-driven-development + worktrees + packs de domínio |
| Validate | Verificar | verification-before-completion + code-review + testes por camada |
| Evolve | Iterar | controlador de loop-back com log de decisão e análise de impacto (inédito) |
| Release | Publicar | finishing-a-development-branch + checklist + rollback |

## Status
- 2026-10-26: definição inicial; pesquisa de landscape concluída (`docs/research/skills-landscape.md`).
- 2026-10-27: formato do `plan.json` v1 decidido (ADR-010) e implementado em `plugins/driver`: schema zod + JSON Schema, validador, reducer e máquina de estados, store com lock e ledger, CLI `driver`, hooks de gate e proteção, exportador Mermaid, dois exemplos (`examples/`). Revisão adversarial em `docs/research/04-review-plan-json-v1.md`. Plano em `.claude/plans/2026-10-27-plan-json-v1.md`; issue PER-611. Nada commitado ainda.
- 2026-10-28: commit inicial `6dfb08a`. Mod do diagrama vivo implementado (ADR-011, issue PER-618): `src/shared` sem deps, CLI de apoio, `mod/` (pane SVG/terminal, tools `mcp__driver__*`, `/driver`, hooks `agent.spawn`), 563 testes vitest + 29 no `claude plugin test`; revisão adversarial em `docs/research/06-review-mod.md`. Dogfooding iniciado: plano do próprio DRIVER em `.claude/driver/` (fase discover, gate route pendente). Mod carregado no Desktop desta sessão: tools `mcp__driver__*` operando (escrita via `$.process.run` confirmada). Pendente: checagem visual do painel, `/driver approve route` pelo Diogo e commit.
- 2026-10-29: painel refeito após três tentativas ilegíveis ou pobres (SVG horizontal sem escala, lista de texto, quadro de cartões): SVG vertical dimensionado em pixels com `isInteractive`, barra de uma linha com `Select` de bloco, detalhe nativo; mobile mantém o quadro de cartões. ADR-011 item 3 atualizado. Checagem visual no Desktop aprovada pelo Diogo; dogfooding do painel começa. 606 testes vitest + 44 no `claude plugin test`. Commit `77a61a1`. Em seguida, PER-619: o guard `protectCommand` ganhou um scanner de shell (aspas, comentários, aritmética, `${}`, `$'…'`) e passou a tratar corpo de heredoc como stdin do comando que o abre; quebra de linha fora de aspas separa comandos (brecha antiga fechada). Quatro revisões opus; 335 testes de guard. Commit `358f67a`. Plano do próprio DRIVER avançado no painel: Discover e Route concluídas, B-003 e B-004 entregues, B-005 em andamento.
- 2026-10-30: skills `discover` e `route` escritas (ADR-012, ADR-008 fechado com a tabela de proporcionalidade, issue PER-620, plano em `.claude/plans/2026-10-30-skills-discover-route.md`, design bruto em `docs/research/07-skills-design.md`): `plugins/driver/skills/{discover,route}/` com templates e `references/driver-conventions.md`; `test/skills.spec.ts`. Slash confirmado no load: `/driver:discover`, `/driver:route`. Topo do painel reorganizado em duas linhas (Show/Hide done, Show/Hide retired, "Open" bloco) e gates em frase inteira. Guard: script de `sed -i`/`perl -pi` deixou de ser lido como glob (falso positivo em `.*`). Revisão adversarial opus das skills: 16 achados aplicados (ver ADR-012, consequências). Pendente: dogfooding em cópia de `examples/web-waitlist`, B-005 → done, commit.
- Próximos: B-006 skills Implement, Validate, Evolve e Release (superpowers pinado, ADR-003).

## Stakeholders
- Diogo Martins (autor, único usuário por enquanto)

## Links
- Repositório: local, `~/Developer/Github/driver` (sem remote ainda)
- Linear: projeto DRIVER (time Personal), https://linear.app/data4ward/project/driver-d7f69613b00d
- Documento original da ideia: ver histórico da sessão de 2026-10-26; versão do método em [DECISIONS.md](DECISIONS.md)
- Pesquisa: `docs/research/skills-landscape.md`
