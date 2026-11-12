# evolve/review.md (you write this one)

Path: `.claude/driver/evolve/review.md`. Read it first if it exists, then Write it. This is a user document: write it entirely in the user's language, headings included. Then show the same text in full as the final message of the turn, with no tool call after it. Keep it compact.

Structure:

1. **Cycle in numbers.** Blocks done, rework rounds, blocks and requirements added after baseline N, backlog items.
2. **Decisions taken by the Autopilot.** Every decision whose title starts with `Autopilot:`, first, one line each with the reason. Write "none" when there are none.
3. **Added after the baseline.** The blocks and requirements with the `+` mark: id, title, why it entered (decision id).
4. **Requirement coverage.** The criterion: each requirement has a passing test or was retired with a decision. A table, one row per requirement: id, evidence (block and test, or decision), status. Failures first.
5. **Backlog for the next cycle.** What `mcp__driver__backlog` returned.
6. **Risks left.** High-risk blocks that were not fully verified, assumptions still open, what the checkpoint found if one ran.
7. **Recommendation.** One of: ready for release; one more round, local; one more round, re-plan. One or two lines of reason.
8. **Your next step.** What to press or type, in order, ending with the line that starts the next phase.

## Worked example (Portuguese)

```
# Revisão do ciclo

**Em números.** 12 blocos concluídos, 1 rodada de retrabalho, 2 blocos e 1 requisito depois do baseline 1, 3 itens no backlog.

**Decisões do piloto automático.**
- D-007 Autopilot: calculadora compacta entra neste ciclo (cabe em um bloco e não invalida nenhum concluído).

**Depois do baseline.**
- B-021 Calculadora compacta (D-007)
- B-022 Teste da calculadora (D-007)
- R-009 Calcular o valor da dose

**Cobertura.** Todos os requisitos têm teste passando ou foram retirados com decisão.

| Requisito | Evidência | Estado |
|---|---|---|
| R-001 | B-006 teste de cadastro, passou | ok |
| R-009 | B-022 teste unitário, passou | ok |

**Backlog.** Modo escuro; exportar CSV; convite por link.

**Riscos que sobram.** Nenhum bloco de risco alto sem verificação.

**Recomendação.** Pronto para o release: o critério foi cumprido e nada está aberto atrás.

**Seu próximo passo.** Clique em Confirm baseline 2 no painel (ou digite /driver baseline), depois em Approve release gate (ou /driver approve release). Aprovar inicia o release.
```
