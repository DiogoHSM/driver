# DRIVER

Plugin de Claude Code que impõe o método DRIVER (Discover · Route · Implement · Validate · Evolve · Release) a qualquer projeto, com plano em grafo de blocos e diagrama vivo.

## Estado
`plan.json` v1 implementado e commitado (ADR-010). Mod do diagrama vivo implementado e aprovado visualmente em 2026-10-29 (ADR-011): `src/shared`, CLI de apoio, `mod/` com SVG vertical no Desktop; tudo ainda sem commit. Pendências: PER-619 (falso positivo do guard). Depois: skills Discover e Route.

## Leia antes de tocar
- Guardrails (tabela "antes de tocar em X, leia Y"): `.claude/GUARDRAILS.md`
- Visão e status: `.claude/docs/PROJECT-SUMMARY.md`
- Decisões (ADRs): `.claude/docs/DECISIONS.md`
- Arquitetura e stack: `.claude/docs/ARCHITECTURE.md`, `.claude/docs/STACK.md`
- Plano em execução: `.claude/plans/2026-10-27-plan-json-v1.md`
- Síntese da pesquisa: `docs/research/skills-landscape.md` (relatórios brutos 01 a 03 na mesma pasta)
- Documento original da ideia: `docs/vision/definicao-inicial.md`

## Comandos
- `cd plugins/driver && npm test` (vitest, `*.spec.ts`) · `npm run typecheck` · `npm run build` (gera `dist/cli.js`, commitado)
- `claude plugin test plugins/driver` (testes do mod, `mod/test/*.test.tsx`) · `tsc -p plugins/driver` (typecheck do mod, após o engine gerar `.claude-plugin/types`)
- `claude plugin validate .` na raiz após mexer em manifestos ou no `hooks.json`
- Regra dura: `src/shared/` não importa nada fora de si (nem zod, nem `node:*`); o mod só importa de lá

## Convenções
- Português brasileiro nos docs. Código em inglês. Nomes de fases e de packs em inglês. Relatórios brutos de pesquisa podem ficar em inglês.
- Decisão de design nova → ADR em `DECISIONS.md` antes de implementar.
- Skills vendorizadas levam cabeçalho com origem, versão e licença (ADR-003).
