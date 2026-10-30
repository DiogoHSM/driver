# Guardrails — DRIVER

> **Sempre carregado.** Este arquivo é o único contrato de *lazy loading* do projeto: diz a Claude quais docs ler antes de tocar em cada área. Docs não listados aqui só são lidos quando Claude os abrir explicitamente.

**Última revisão**: 2026-10-27 (pós-revisão adversarial)

---

## Antes de editar

Use esta tabela como checklist. Antes de modificar um arquivo que se encaixe numa categoria, **leia o(s) doc(s) correspondente(s)**.

**Se o doc não existir ainda**: leia `~/.claude/templates/docs/<NOME>.md`, crie `.claude/docs/<NOME>.md` com conhecimento real do projeto e só depois prossiga.

| Ao tocar em… | Leia antes | Por quê |
|---|---|---|
| `plugins/driver/src/schema.ts`, `schema/plan.v1.schema.json`, fixtures | `DECISIONS.md` (ADR-010), `.claude/plans/2026-10-27-plan-json-v1.md` | o formato é contrato com mod, hooks, skills e packs; mudança de forma exige ADR e, se quebrar, `schemaVersion` novo |
| `src/state-machine.ts`, `src/reducer.ts` | `DECISIONS.md` (ADR-010 itens 3 e 4) | transições e revogação de gates são regras de método, não detalhe de código |
| `src/store.ts`, qualquer escrita em `.claude/driver/` | `DECISIONS.md` (ADR-010 item 5), `ARCHITECTURE.md` | escritor único, lock, raiz no worktree principal |
| `hooks/**` | `docs/research/03-plugin-infra.md` §3, `DECISIONS.md` (ADR-009, ADR-010 item 11) | gate por hook é a única garantia real; aprovação nunca pode vir do modelo |
| `plugins/driver/mod/**`, `types/index.d.ts` | `DECISIONS.md` (ADR-011), `docs/research/05-mod-design.md`, `docs/research/03-plugin-infra.md` §2 | sem Node/DOM no mod; só importar `src/shared`; render nunca escreve estado; aprovação só por origem `composer`/`ui.press` + ticket |
| `plugins/driver/src/shared/**` | `DECISIONS.md` (ADR-011 item 2) | sem dependências (nem zod, nem `node:*`): o mod importa daqui; mudança de layout/SVG tem golden test |
| `skills/**` | `docs/research/skills-landscape.md` §2, `DECISIONS.md` (ADR-003, ADR-008) | compor skills pinadas, não reescrever; proporcionalidade de cerimônia |
| `plugins/driver-*/` (packs) | `DECISIONS.md` (ADR-004, ADR-005), `docs/research/02-domain-packs.md` | core não conhece provedores; dados do pack em `ext` |
| `.claude-plugin/*.json`, `package.json` | `STACK.md`, `DECISIONS.md` (ADR-003) | versões pinadas; `claude plugin validate` após editar |
| Decisão arquitetural nova | `DECISIONS.md` (ler + adicionar ADR) | convenção do projeto: ADR antes do código |
| Escopo/objetivos | `PROJECT-SUMMARY.md` | alinhamento |

---

## Regras fixas do projeto

- Nunca aprovar gate (`gates.route`, `gates.release`), fazer `rebaseline` ou usar `--force` por código chamado pelo modelo. Essas ações exigem `yes` digitado em terminal interativo (ADR-010 item 14); não criar bypass por flag ou env var.
- Nunca afrouxar o hook `protect-plan` para "facilitar" um teste: se um comando legítimo é negado, adicionar caso de teste e ajustar a regra com o revisor.
- Nunca editar `plan.json` à mão nem por `Write/Edit`; sempre pela CLI ou tool.
- Nunca apagar bloco ou requisito; marcar `retired` citando `D-xxx`.
- Nunca gravar valores de credencial no plano; só nomes de variáveis.
- Documentação em PT-BR; código, nomes de fase e de pack em inglês.
- Sem commit sem o usuário pedir. Nunca `--no-verify`.

---

## Antes de executar ações destrutivas ou irreversíveis

- [ ] Se envolve branch protegida ou remoto, o usuário autorizou esta operação específica.
- [ ] Se envolve `rm -rf` fora de `node_modules`/`dist`, confirmar.

Ainda não há cloud, banco ou deploy neste projeto.

---

## Atualização contínua

- A cada doc criado/removido em `.claude/docs/`: atualize a tabela acima.
- Nova área de risco: adicione uma linha. Mantenha curto.
