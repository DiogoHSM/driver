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
- Próximos: mod do diagrama, skills Discover e Route.

## Stakeholders
- Diogo Martins (autor, único usuário por enquanto)

## Links
- Repositório: local, `~/Developer/Github/driver` (sem remote ainda)
- Linear: projeto DRIVER (time Personal), https://linear.app/data4ward/project/driver-d7f69613b00d
- Documento original da ideia: ver histórico da sessão de 2026-10-26; versão do método em [DECISIONS.md](DECISIONS.md)
- Pesquisa: `docs/research/skills-landscape.md`
