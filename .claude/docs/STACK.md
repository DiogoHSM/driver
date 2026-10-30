# Stack — DRIVER

## Linguagem e runtime
- TypeScript 5 (strict, ES2022, NodeNext): toda a lógica do plugin, da CLI e do mod.
- Node.js ≥ 20 (desenvolvido em 22): runtime da CLI e dos hooks. Risco aceito: hooks exigem `node` no PATH do usuário; a checagem de gate tem fallback em `jq` puro.

## Biblioteca e validação
- zod 4: schema do `plan.json`, fonte única de verdade dos tipos. `z.toJSONSchema` gera `schema/plan.v1.schema.json` para autocomplete em editores e ferramentas não TS.

## Build e testes
- tsup: bundle único ESM `dist/cli.js` com shebang, commitado (hooks não dependem de build). O mod é carregado como fonte pelo engine, sem bundle.
- vitest (`test/**/*.spec.ts`): código node e `src/shared` (golden SVG, layout, invariantes, concorrência em dois processos). `tsconfig.node.json`.
- `claude plugin test plugins/driver` (`mod/test/*.test.tsx`): hooks e desenho do mod nas superfícies terminal e desktop, com stand-ins do engine. `tsconfig.json` raiz estende `.claude-plugin/types/tsconfig.json` (gerado pelo engine no primeiro load; gitignored) com `types: []`, o que proíbe `node:*` em `src/shared`.
- npm workspaces: raiz privada com `plugins/*`.

## Plataforma
- Claude Code CLI ≥ 2.1.287: plugins, hooks (33 eventos), mods (API early access; rechecar `claude-code.d.ts` a cada release), `dependencies` semver em `plugin.json`, `claude plugin tag`.
- Mod: elementos `Box/Text/Button/Select/Input/Markdown` em todo lugar; `Svg` só Desktop, VS Code e mobile; `Raster` no terminal. Sem `fs.watch`: polling com `$.clock`. Sem Node nem DOM: escrita só via `$.process.run` da CLI. `claude-code.d.ts` fixado na 2.1.312.

## Ferramentas de linha de comando usadas pelos hooks
- `jq` 1.7: checagem de gate em uma expressão, fail closed se o arquivo for ilegível.
- `git`: resolução da raiz (`rev-parse --git-common-dir`) para escrever sempre no worktree principal.

## Ferramentas de desenvolvimento
- `claude plugin validate`: valida marketplace e manifestos.
- Linear (time Personal, projeto DRIVER): backlog. Planos em `.claude/plans/`.

## Decidido não usar
- Tasks nativas do Claude Code e arquivo de plan mode como storage (ADR-009).
- `zod-to-json-schema` (zod 4 já gera JSON Schema).
- Ferramentas de sessão não documentadas do app desktop para orquestração (ADR-006).
