# Landscape de skills, ferramentas e infraestrutura para o DRIVER

Data: 2026-10-26. Consolidação de três pesquisas paralelas (relatórios brutos em inglês nesta pasta):

- [01-process-skills.md](01-process-skills.md): skills de processo e metodologia
- [02-domain-packs.md](02-domain-packs.md): ferramentas por domínio para o registro de capacidades
- [03-plugin-infra.md](03-plugin-infra.md): o que o sistema de plugins do Claude Code permite hoje

Vereditos: **ADOTAR** (declarar como dependência de plugin ou vendorizar), **INSPIRAR** (reescrever a nossa versão emprestando a técnica), **IGNORAR**.

## 1. O que muda nas decisões já tomadas

Três achados pedem revisão de ADRs. Os ADRs já foram atualizados em `.claude/docs/DECISIONS.md`.

| Achado | Impacto |
|---|---|
| Plugins **podem declarar dependências** de outros plugins com faixa semver (`^`, `~`, `=`), resolvidas contra tags git `<plugin>--v<versão>`. Instalação automática, detecção de conflito, `claude plugin prune`. | ADR-003 revisado: dependência com versão pinada é a forma padrão. Vendorização só para skills soltas sem plugin (ex.: `grilling`, 25 linhas) ou quando o upstream não publica tags. |
| **Workflow não aceita input humano no meio da execução.** Gates precisam ficar na conversa principal. | ADR-006 confirmado e detalhado: um Workflow por lote de Implement/Validate, subagents para blocos isolados, gates fora do Workflow. |
| As ferramentas de sessão do app desktop (`start_session` etc.) **não são documentadas publicamente.** O caminho documentado é `claude --bg` + cross-session messaging (`SendMessage`). | ADR-006: nested sessions na v2 usam o caminho documentado, não as ferramentas internas do desktop. |

Dois achados confirmam decisões sem alteração: nenhum plugin existente desenha um grafo de plano vivo ao lado do chat (ADR-002 tem campo aberto), e nenhuma skill mantida cobre finanças pessoais ou calendário de conteúdo (packs `driver-finance` e `driver-social` precisam de trabalho original, ADR-005).

## 2. Skills de processo: tabela de vereditos

| Pacote | Licença | Última atividade | Fases | Veredito | Por quê |
|---|---|---|---|---|---|
| obra/superpowers | MIT | out/2026 | D, R, I, V, Rel | **ADOTAR** como dependência | Pipeline completo, modular, já instalado. Muda toda semana, então dependência pinada, não cópia. |
| mattpocock/skills (`grilling`) | MIT | out/2026 | D | **INSPIRAR** (ou vendorizar) | 25 linhas. Técnica de "fronteira" é o núcleo do Discover, mas o DRIVER precisa persistir a árvore em disco. |
| github/spec-kit | MIT | out/2026 | D, R, I, V | **INSPIRAR** | Formato do `clarify` (múltipla escolha com recomendação) e o `converge`. CLI Python pesada para embutir. |
| BMAD Method | MIT + marca registrada | out/2026 | D, R, I, V, E | **INSPIRAR** | Menu de métodos de elicitação. Depende de runtime Python próprio e a marca "BMAD" é protegida. |
| EveryInc/compound-engineering | MIT | out/2026 | D, R, I, V, **E**, Rel | **INSPIRAR** (talvez adotar `ce-compound`) | Melhor referência para o Evolve. AskUserQuestion como regra, teste de "decisões já tomadas", `mode:return-to-caller`. |
| anthropics/skills | Apache-2.0 por skill; docx/pdf/pptx/xlsx são source-available | out/2026 | nenhuma de processo | **IGNORAR** (exceto skill-creator) | Não há skills de processo. Skills de documento não podem ser redistribuídas. |
| anthropics/claude-plugins-official | Apache-2.0 | out/2026 | R, I, V | **ADOTAR** feature-dev e code-review | Agentes code-explorer, code-architect, code-reviewer; review multi-agente com confiança. |
| ralph / ralph-loop | MIT / Apache-2.0 | fev/2026 | I | **INSPIRAR** | `passes: true/false` por história como condição de parada do Implement. |
| ruflo (ex claude-flow) | MIT | out/2026 | I | **IGNORAR** | Swarm pesado demais para compor. Só o ruflo-console interessa como referência de mod. |
| claude-task-master | MIT + Commons Clause | abr/2026 | R | **IGNORAR** | Licença não é open source. Parado. |
| agent-os | MIT | out/2026 | D, R | **INSPIRAR** (leve) | Extração de padrões do codebase no Discover. |

### Técnicas a emprestar, por fase

**Discover**
- Fronteira de decisões (grilling): cada rodada pergunta todas as decisões cujos pré-requisitos já estão resolvidos. Fatos são do agente (subagents não bloqueantes); decisões são do usuário. Pronto quando a fronteira esvazia.
- Formato de pergunta (spec-kit `clarify`): 2 a 5 opções com `Recomendado:` em destaque, campo "por que importa", "sim" aceita a recomendação. Máximo de perguntas por rodada ranqueadas por impacto × incerteza.
- Uma pergunta por turno via AskUserQuestion (compound engineering). É isso que preserva a experiência visual de escolhas que o Diogo gosta. Nota: o brainstorming do superpowers usa texto livre, não AskUserQuestion.
- Teste de "decisões já tomadas" (compound engineering): nunca reperguntar o que já está no log de premissas.
- Constituição (spec-kit): princípios fixos que todas as fases seguintes respeitam.

**Route**
- writing-plans do superpowers como dependência, com o auto-review de 4 pontos (cobertura da spec, varredura de passos, consistência de tipos, foco de revisão).
- `converge` do spec-kit: comparar codebase contra plano e anexar só o que falta, sem editar o plano original. Útil no re-baseline do Evolve.

**Implement**
- subagent-driven-development do superpowers como dependência.
- Ledger que sobrevive a compactação (superpowers): "confie no ledger e no `git log`, não na memória".
- `passes: true/false` por bloco (ralph) como condição objetiva de conclusão.

**Validate**
- Iron Law do superpowers (IDENTIFY, RUN, READ, VERIFY) com tabela de racionalizações proibidas.
- code-review oficial com confidence scoring.

**Evolve**
- `ce-compound`: um aprendizado por rodada em `solutions/<categoria>/`.
- Menu de elicitação (BMAD): pre-mortem, red team, socrático, como checkpoint reutilizável antes do Gate 2.
- `mode:return-to-caller`: skill chama skill e recebe resultado estruturado. É o gancho de composição que o DRIVER precisa.

**Release**
- finishing-a-development-branch do superpowers (merge / push+PR / manter / descartar).

## 3. Registro de capacidades: stack ideal padrão

Dez entradas que o DRIVER sugere por padrão. CLI sempre preferida quando existe (custo zero de contexto até ser chamada). Tabelas completas por domínio em [02-domain-packs.md](02-domain-packs.md).

| # | Capacidade | Provedor padrão | Acesso | Alternativa |
|---|---|---|---|---|
| 1 | Qualidade de design | impeccable (Paul Bakaus, Apache-2.0, 89k★) | skill + `npx impeccable` | frontend-design oficial |
| 2 | Deploy web | Vercel | CLI + plugin oficial | Netlify, Cloudflare, Railway |
| 3 | Banco + auth + storage | Supabase | CLI para migrations; MCP read-only e project-scoped para SQL | Neon, Better Auth, Clerk |
| 4 | Pagamentos | Stripe | plugin oficial, test mode primeiro | |
| 5 | E-mail transacional | Resend | CLI + skills (MIT) | Postmark |
| 6 | Mobile | Expo + EAS CLI; MobileBuildMCP para iOS nativo | CLI | mobile-mcp para controle de device |
| 7 | Vídeo | HyperFrames (HeyGen, Apache-2.0) | CLI + skills | Remotion (licença paga para empresas 3+) |
| 8 | Voz | ElevenLabs CLI / MCP hospedado | CLI | Kokoro (free local) + whisper.cpp (transcrição) |
| 9 | Dados e planilhas | DuckDB CLI + `gws` (Google Workspace CLI) | CLI | xlsx skill da Anthropic (só referenciar) |
| 10 | Social | Postiz | CLI (28+ plataformas) | Typefully |

### Mudanças recentes que invalidam suposições comuns

- ElevenLabs MCP local foi arquivado (ago/2026). Usar MCP hospedado ou CLI.
- `@railway/mcp-server` foi arquivado (mai/2026). MCP agora vem na CLI: `railway mcp`.
- XcodeBuildMCP virou `getsentry/MobileBuildMCP`.
- Auth.js / next-auth em manutenção desde jul/2026. Better Auth é o sucessor prático.
- Superdesign parado desde ago/2026 e sobrepõe impeccable. Evitar.

### Lacunas que exigem trabalho original

- **Finanças pessoais:** nenhuma skill mantida. `financial-services` da Anthropic é modelagem profissional. `knowledge-work-plugins/finance` é genérico. O `driver-finance` será em grande parte original.
- **Calendário de conteúdo:** nenhuma skill forte. `knowledge-work-plugins/marketing` é o mais próximo. O `driver-social` idem.
- **Grafo de plano vivo:** nenhum mod existente. O mais próximo é o ruflo-console (cockpit de swarm) e o project-artifact oficial (página HTML estática via Artifact). O mod do DRIVER é inédito.

### Licenças que impedem vendorização

Skills de documento da Anthropic (docx/pdf/pptx/xlsx): source-available, sem redistribuição. Referenciar, nunca copiar. claude-task-master: Commons Clause. BMAD: código MIT mas nome protegido.

## 4. Infraestrutura: o que o plugin pode fazer hoje

CLI instalada: 2.1.305. Mods exigem ≥ 2.1.287.

| Pergunta | Resposta | Fonte |
|---|---|---|
| Um plugin pode conter mod + skills + agents + hooks + workflows + MCP? | Sim, tudo junto. | confirmado |
| Dependência entre plugins com versão? | Sim, semver contra tags `<plugin>--v<versão>`. | confirmado |
| Mod pode desenhar painel ao lado do chat? | Sim. Elementos: Box, Text, Button, Select, Markdown em todos os surfaces. **SVG só no Desktop e VS Code.** Terminal usa Box/Text ou Raster. Não é HTML nem webview. | confirmado |
| Mod recebe estado como? | `$.state` reativo (reseta em `/clear`), `$.store` persistente, eventos (`tool.call`, `classic.SubagentStop`, `classic.TaskCompleted`...), `$.fs` para ler arquivo. Sem `fs.watch`: poll com `$.clock` ou reagir a `tool.call` de Write/Edit. | confirmado |
| Mod expõe tool para o modelo chamar? | Sim, `$.tool.register` → `mcp__driver__<nome>`. | confirmado |
| Workflow aceita aprovação humana no meio? | **Não.** Um workflow por etapa; gate na conversa principal. | confirmado |
| Gate via AskUserQuestion é confiável? | Parcial: `askUserQuestionTimeout` pode auto-continuar. Reforçar com hook `PreToolUse` ou guard de `tool.call` no mod que recusa Agent/Workflow até `approved: true` no plano. | inferido |
| Skill chama skill? | Sem mecanismo direto. "Invoque a skill X" no corpo é o padrão prático. `context: fork` + `agent` roda a skill em subagent sem histórico. | confirmado |
| Tasks nativas com dependências servem como grafo? | Não como fonte de verdade: desligadas por padrão em modelos novos, campos e storage não documentados. Hooks `TaskCreated`/`TaskCompleted` existem. | confirmado / não encontrado |
| Nested sessions do desktop? | Ferramentas não documentadas. Caminho documentado: `claude --bg` + `SendMessage` cross-session (texto puro, fila de 50, nunca concede aprovação). | confirmado |

### Matriz de orquestração

| Necessidade | Usar |
|---|---|
| Um bloco focado, resultado volta ao contexto | Subagent (model explícito, background) |
| Muitos blocos semelhantes, fan-out fixo, sem gate humano | Workflow (um por etapa) |
| Blocos paralelos que editam os mesmos arquivos | Subagent com `isolation: worktree` ou `claude -w` |
| Streams longos e independentes que o usuário quer acompanhar | `claude --bg` + SendMessage (v2) |
| Headless (`-p`, SDK, cloud) | Subagent ou Workflow; mod não desenha, só hooks |

## 5. Implicações para a arquitetura do DRIVER

1. **Grafo canônico em `.claude/driver/plan.json`**, de propriedade do DRIVER. Blocos, estados, arestas, requisitos ligados, provedor por bloco, flag `approved` por gate. Markdown por bloco quando precisar de texto longo. `$.state` do mod é só view.
2. **Mod como painel do grafo**, dentro do plugin core. SVG no Desktop/VS Code, layout Box/Text no terminal, Mermaid em arquivo como fallback universal. Tool registrada `mcp__driver__set_block_state` para o modelo atualizar estado sem escrever JSON na mão.
3. **Gates reforçados por hook**, não só por prompt. `PreToolUse` recusa Agent/Workflow na fase seguinte enquanto o plano não tem `approved: true`.
4. **superpowers, feature-dev e code-review como dependências pinadas.** `grilling` vendorizado (25 linhas, MIT). Nada das skills de documento da Anthropic copiado.
5. **Discover com AskUserQuestion uma pergunta por turno**, fronteira de decisões, opções com recomendação, log de premissas em disco e teste de decisões já tomadas.
6. **Evolve inspirado em `ce-compound`**: um aprendizado por rodada, análise de impacto downstream no grafo, re-baseline via lógica de `converge`.
7. **Packs como plugins separados no mesmo marketplace**, dependendo do core. `driver-finance` e `driver-social` terão mais trabalho original que os outros.
8. **Mínimo de CLI 2.1.287** declarado. API de mods é early access; rechecar `claude-code.d.ts` a cada release.

## 6. Próximo passo recomendado

Formato do grafo de plano (`plan.json`). É a decisão de design da qual todo o resto depende: mod, hooks de gate, rastreabilidade, packs. Depois dele: Discover e Route, que são onde o pipeline manual atual é mais fraco.
