# Definição Inicial do Projeto (documento original, 2026-10-26)

> Documento de origem, escrito antes da decisão de virar plugin (ver `.claude/docs/DECISIONS.md`, ADR-001). Mantido como registro histórico. Partes substituídas por ADRs estão marcadas.

Nome (candidatos): Sixfold · Loopcraft · AnyForge
Status: Definição inicial, pré-automação
Método: DRIVER: Discover · Route · Implement · Validate · Evolve · Release

---

## 1. Visão

Uma ferramenta de IA que generaliza a execução de qualquer projeto aplicando um processo estruturado, rastreável e iterativo. O mesmo harness deve entregar desde uma planilha financeira ou um deck de slides até um sistema complexo com autenticação, banco de dados, workers, backend, frontend e app mobile.

A ferramenta não é um chat. É um orquestrador de processo: entrevista, planeja, constrói, valida, evolui e publica, com estado visível em todas as fases e capacidade de retornar a qualquer fase anterior a qualquer momento.

*(Substituído por ADR-001: DRIVER é um plugin de Claude Code, não ferramenta standalone.)*

## 2. Princípio central

O diagrama é o sistema nervoso do projeto. Não é um slide descartável. É um artefato vivo que:

- mostra as fases e os blocos em fluxo visual;
- acompanha todas as fases seguintes;
- exibe ordem, status, saídas e dependências;
- indica "você está aqui";
- mostra setas de loop-back (Validate → Implement, Evolve → Route, etc.);
- é clicável: cada bloco abre detalhes, artefatos, dependências e status;
- é exportável como documentação do projeto.

*(Refinado por ADR-002: o artefato é o grafo; o diagrama é renderização.)*

## 3. Método DRIVER

| Letra | Fase | Essência |
|---|---|---|
| D | Discover | Entender |
| R | Route | Planejar |
| I | Implement | Construir/executar |
| V | Validate | Verificar/testar |
| E | Evolve | Iterar/aperfeiçoar |
| R | Release | Publicar/expor |

O ciclo Evolve → Implement e Evolve → Route pode ocorrer quantas vezes forem necessárias antes do Release.

## 4. Fases

### 4.1 Discover
Propósito: entender o problema, o contexto e os requisitos.

Atividades:
- Entrevista estruturada em formulário, com no mínimo 3 iterações de perguntas: (1) contexto e amplitude; (2) requisitos específicos e restrições; (3) confirmação + não-objetivos explícitos. *(Ver ADR-008 sobre proporcionalidade.)*
- A entrevista pode ser longa. Não há limite de duração.
- Opção "não sei" em qualquer pergunta, que dispara sugestão ou pesquisa em vez de travar a entrevista.
- A ferramenta pode desenhar diagramas ou montar protótipos visuais rápidos para ajudar o usuário a decidir requisitos.
- Log de premissas: tudo que a ferramenta assumiu quando o usuário não especificou. Vira contrato e evita retrabalho.

Artefatos: formulário de entrevista (versionado), log de premissas, lista de não-objetivos, protótipos visuais anexados como requisitos versionados, diagramas auxiliares.

Critério de saída: perguntas críticas respondidas + premissas aceitas.
Gate humano: aprovação explícita antes de avançar para Route.

### 4.2 Route
Propósito: planejar o caminho completo, visual e verificável.

Atividades:
- Sempre apresentar um diagrama de fluxo/processo.
- Quebrar as fases em blocos num fluxo visual. Cada bloco contém: entrada, saída, critério de aceite, dependências, risco.
- Versionamento do plano (plan v1, v2…). Mudanças pós-aprovação geram diff visível.
- Definition of done por bloco e por fase.

Artefatos: diagrama de fluxo (artefato vivo), plano versionado, critérios de aceite por bloco, matriz de riscos.

Critério de saída: plano aprovado com diagrama validado.
Gate humano: aprovação explícita antes de avançar para Implement. *(Revisto na seção 5: apenas dois gates obrigatórios.)*

### 4.3 Implement
Propósito: construir/executar o que foi planejado.

Atividades:
- Executar bloco a bloco, mantendo rastreabilidade com o plano e com o Discover.
- Se fizer sentido, montar design system ou protótipo visual como parte da implementação.
- Checkpoints incrementais para permitir rollback.
- Paridade de ambientes (dev / staging / prod) desde o início, quando aplicável.
- O diagrama é atualizado em tempo real: cada bloco muda de estado conforme avança.

Artefatos: implementação por bloco, design system / protótipo visual (quando aplicável), checkpoints de rollback, configuração de ambientes.

Critério de saída: blocos implementados com estado rastreável.
Loop permitido: voltar para Route ou Discover se a implementação revelar que o plano ou o entendimento estão errados.

### 4.4 Validate
Propósito: verificar se o que foi construído atende ao que foi entendido e planejado.

Atividades:
- Testes em camadas: unidade, integração, e2e, visual, performance, segurança (adaptado ao tipo de projeto).
- Teste de aceite contra os requisitos originais do Discover, não apenas contra o plano.
- O diagrama mostra status de teste por bloco.

Artefatos: relatórios de teste por camada, status de validação por bloco, evidências (logs, screenshots, resultados).

Critério de saída: blocos validados ou identificação clara do que precisa evoluir.
Loop permitido: retorno direto para Implement ou Route.

### 4.5 Evolve
Propósito: iterar e aperfeiçoar antes de expor.

Atividades:
- Log de decisão: por que voltou? O que mudou?
- Análise de impacto: se volta para Route, quais blocos downstream são afetados?
- Re-baseline: atualizar plano + diagrama após a evolução.
- Pode retornar para Implement (ajuste local) ou Route (mudança estrutural). Quantas vezes forem necessárias.

Artefatos: log de decisões, análise de impacto, plano e diagrama re-baselineados.

Critério de saída: projeto pronto para Release.
Gate humano: aprovação explícita antes de avançar para Release.

### 4.6 Release
Propósito: publicar/expor.

Atividades: checklist de release, plano de rollback, observabilidade configurada, documentação e handoff.

Artefatos: registro de release, plano de rollback, documentação, painel de observabilidade.

Critério de saída: projeto publicado e monitorado.

## 5. Gates humanos

| Gate | Transição | Motivo |
|---|---|---|
| Gate 1 | Discover → Route | Custo de errar o entendimento é alto |
| Gate 2 | Evolve → Release | Custo de expor algo imaturo é alto |

O resto pode ser automático.

## 6. Máquina de estados por bloco

Não iniciado · Em andamento · Bloqueado (com motivo visível) · Em revisão · Concluído · Precisa retrabalho. O diagrama é a view ao vivo desse estado.

## 7. Rastreabilidade

```
Requisito (Discover) → Bloco do plano (Route) → Implementação (Implement)
                     → Teste (Validate) → Release (Release)
```

## 8. Preocupações transversais

Memória de contexto entre fases · paralelismo visível no diagrama · bloqueios visíveis com motivo · dashboard multi-projeto · log de premissas e decisões persistente · versionamento de plano, requisitos e artefatos.

## 9. Generalização por domínio

*(Substituído por ADR-005: core + packs `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`.)*

Exemplos originais: sistema complexo (web + mobile), planilha financeira, deck de slides, automação/processo genérico.

## 10. Modelo de automação (visão de futuro)

1. Entrevistar o usuário e adaptar perguntas ao domínio.
2. Gerar o diagrama automaticamente a partir do Discover.
3. Planejar blocos com entradas, saídas, critérios e dependências.
4. Executar cada bloco com rastreabilidade.
5. Validar com testes apropriados ao domínio.
6. Iterar com log de decisão e análise de impacto.
7. Publicar com checklist, rollback e observabilidade.

## 11. Perguntas em aberto (com respostas da avaliação de 2026-10-26)

- Identificar o domínio na primeira iteração: pergunta direta ou classificação da primeira resposta livre. Não vale engenharia.
- Nível mínimo de detalhe por bloco para automação confiável: em aberto, depende do formato do grafo.
- "Bem avaliado" no Evolve: todos os requisitos do Discover têm teste passando ou foram explicitamente retirados com decisão registrada.
- Centenas de blocos: hierarquia fase → épico → bloco, colapsável (ADR-002).
- Versionamento de artefatos entre fases: em aberto.
- Priorização no dashboard multi-projeto: blocos bloqueados e gates pendentes primeiro.

## 12. Nomes candidatos

Sixfold · Loopcraft · AnyForge. Alertas: "Sixfold" já é marca em logística; "DRIVER" é genérico para busca, mas funciona como nome do método. Decisão em aberto.
