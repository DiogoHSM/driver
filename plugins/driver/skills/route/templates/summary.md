# route/summary.md (you write this one)

If `.claude/driver/route/summary.md` exists, Read it first, then Write it. Then show the same text in full as the final message of the turn, with no tool call after it. This is a user document: write it entirely in the user's language, headings included. Keep it compact.

Structure:

1. One line: the list below is the plan, and the DRIVER pane shows the same graph when it is open.
2. Blocks grouped by phase: id, title, depends on, risk. Mark blocks that can run in parallel.
3. Block count against the class range (implement and validate blocks only).
4. The critical path.
5. High-risk blocks with their mitigation in a few words.
6. Closing line: reply "ok" to confirm, or say what to change (blocks, order, split).

## Worked example (Portuguese)

```
# Plano de blocos

A lista abaixo é o plano; o painel do DRIVER mostra o mesmo grafo quando está aberto.

**Implement**
- B-003 Tabela waitlist (depende de: B-002) | risco baixo | paralelo com B-004
- B-004 API de cadastro (depende de: B-003) | risco médio
- B-005 Página inicial (depende de: B-002) | risco baixo | paralelo com B-003

**Validate**
- B-006 Testes da API (depende de: B-004) | risco baixo
- B-007 Revisão visual da página (depende de: B-005) | risco baixo

**Blocos:** 5 de implement e validate, dentro da faixa de 4 a 8 da classe S.
**Caminho crítico:** B-002, B-003, B-004, B-006.
**Risco alto:** nenhum.

Responda "ok" para confirmar, ou diga o que mudar (blocos, ordem, divisão).
```
