# DRIVER

Plugin de Claude Code que impõe o método DRIVER (Discover · Route · Implement · Validate · Evolve · Release) a qualquer projeto, com plano em grafo de blocos e diagrama vivo.

## Estado
`plan.json` v1 implementado e commitado (ADR-010). Mod do diagrama vivo implementado e aprovado visualmente em 2026-10-29 (ADR-011): `src/shared`, CLI de apoio, `mod/` com SVG vertical no Desktop (commit `77a61a1`). Guard `protectCommand` refeito com scanner de shell (PER-619, commit `358f67a`). Skills `discover` e `route` escritas (ADR-012, PER-620, B-005 do plano em `.claude/driver/`): `plugins/driver/skills/`, `plugins/driver/references/driver-conventions.md`, `test/skills.spec.ts`; commit `6110754`. Depois do primeiro dogfooding, ADR-013 (PER-669): entrevista por interesse, resumo como mensagem final, tools silenciosas `discover_log`, `block_doc`, `req_doc`, guard reforçado para `sed`/`perl`/`ruby`. Segundo dogfooding em 2026-11-11 no app Desktop (projeto coffee-app): Discover e Route aprovados; dele saíram ADR-014 (linha "Next" no painel, botão principal Approve, Continue ou Start que aciona o Claude, `mod/next.ts`) e ADR-015 (regra de próximo passo no system prompt e piloto automático opcional no Implement, `mod/autopilot.ts`), além da raiz do plano resolvida de novo quando a sessão muda de pasta. Em 2026-11-12: ADR-016 (triagem em três níveis de mudança depois do gate, marca de posterior ao baseline, fase reaberta, backlog do próximo ciclo, botão `Confirm baseline`) e ADR-017 (superpowers opcional); B-005 e B-013 concluídos; skills `implement`, `validate`, `evolve` e `release` escritas e revisadas (B-006, B-014, PER-670), com `plugins/driver/references/triage.md`. Pendente: conferência manual das seis skills de ponta a ponta no app. Depois: B-007, B-008 e B-009.

## Leia antes de tocar
- Guardrails (tabela "antes de tocar em X, leia Y"): `.claude/GUARDRAILS.md`
- Visão e status: `.claude/docs/PROJECT-SUMMARY.md`
- Decisões (ADRs): `.claude/docs/DECISIONS.md`
- Arquitetura e stack: `.claude/docs/ARCHITECTURE.md`, `.claude/docs/STACK.md`
- Planos: `.claude/plans/2026-10-27-plan-json-v1.md` (plan.json), `.claude/plans/2026-10-30-skills-discover-route.md` (skills), `.claude/plans/2026-11-11-skills-implement-validate-evolve-release.md` (quatro skills e ADR-016)
- Convenções que as skills seguem: `plugins/driver/references/driver-conventions.md` e `plugins/driver/references/triage.md`
- Síntese da pesquisa: `docs/research/skills-landscape.md` (relatórios brutos 01 a 03 na mesma pasta)
- Documento original da ideia: `docs/vision/definicao-inicial.md`

## Comandos
- `cd plugins/driver && npm test` (vitest, `*.spec.ts`) · `npm run typecheck` · `npm run build` (gera `dist/cli.js`, commitado)
- `claude plugin test plugins/driver` (testes do mod, `mod/test/*.test.tsx`) · `tsc -p plugins/driver` (typecheck do mod, após o engine gerar `.claude-plugin/types`)
- `claude plugin validate .` na raiz após mexer em manifestos, no `hooks.json` ou em `skills/*/SKILL.md`
- Regra dura: `src/shared/` não importa nada fora de si (nem zod, nem `node:*`); o mod só importa de lá

## Convenções
- Português brasileiro nos docs. Código em inglês. Nomes de fases e de packs em inglês. Relatórios brutos de pesquisa podem ficar em inglês.
- Decisão de design nova → ADR em `DECISIONS.md` antes de implementar.
- Skills vendorizadas levam cabeçalho com origem, versão e licença (ADR-003).
