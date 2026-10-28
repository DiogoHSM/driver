# Pesquisa 2: packs de domínio e registro de capacidades

Data: 2026-10-26. Fonte: subagent de pesquisa (Opus), verificação via GitHub API e `anthropics/claude-plugins-official/.claude-plugin/marketplace.json` (315 plugins). "CLI?" indica que existe CLI nativa e ela deve ser preferida ao MCP (custo zero de contexto até ser chamada). Itens não verificados estão marcados.

## Quatro achados que mudam o plano

- **ElevenLabs MCP local** (`elevenlabs/elevenlabs-mcp`) foi arquivado em agosto de 2026. Usar o MCP hospedado ou a CLI.
- **`@railway/mcp-server`** foi arquivado em maio de 2026. O MCP agora vem embutido na CLI como `railway mcp`.
- **XcodeBuildMCP** virou `getsentry/MobileBuildMCP`. O tap antigo do Homebrew ainda funciona.
- **Auth.js / next-auth** teve último push em julho de 2026, efetivamente em manutenção. Better Auth é o sucessor prático (handover não confirmado).

## A. Web build

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| Vercel CLI + plugin `vercel` (MCP remoto em mcp.vercel.com) | CLI + plugin + MCP | github.com/vercel/vercel-plugin | NOASSERTION | OAuth / token | Freemium | **Sim** (`vercel`) | RECOMENDAR: hosting frontend padrão |
| Supabase CLI + MCP (`?read_only=true&project_ref=`) | CLI + MCP + plugin | github.com/supabase/mcp | Apache-2.0 | OAuth | Freemium | Sim para migrations; MCP para SQL e advisors | RECOMENDAR: banco, auth e storage juntos |
| Railway (`railway mcp` na CLI + plugin `railway`) | CLI + plugin | github.com/railwayapp/railway-skills | MIT | login CLI / OAuth | Pago por uso | **Sim** | OPCIONAL: mais fácil para backends/containers |
| Netlify (`@netlify/mcp` + `netlify-skills`) | MCP + plugin | github.com/netlify/netlify-mcp | não declarada | OAuth / PAT | Freemium | **Sim** (`netlify`) | OPCIONAL: alternativa à Vercel |
| Cloudflare (MCP com `search()`/`execute()` + plugin) | MCP + plugin | github.com/cloudflare/mcp-server-cloudflare | Apache-2.0 | OAuth / token | Freemium | **Sim** (`wrangler`) | OPCIONAL: edge, R2, DNS |
| Clerk (`clerk/skills`, mcp.clerk.com) | Skill + MCP | clerk.com/docs/guides/ai/overview | não declarada | MCP só de docs | Freemium | `clerk init` | OPCIONAL: melhor UI de auth pronta |
| Supabase Auth | parte do Supabase | | | | Free tier | | RECOMENDAR quando já em Supabase |
| Better Auth | Lib | github.com/better-auth/better-auth | MIT | | Free | | OPCIONAL: auth self-hosted |
| Auth.js / next-auth | Lib | github.com/nextauthjs/next-auth | ISC | | Free | | EVITAR: modo manutenção |
| Resend (plugin, CLI, MCP) | Skill + CLI + MCP | github.com/resend/resend-skills · resend/resend-cli | MIT | API key | Freemium | **Sim** | RECOMENDAR: melhor DX para e-mail |
| Postmark MCP | MCP | github.com/ActiveCampaign/postmark-mcp | MIT | server token | Pago (trial) | Não | OPCIONAL: deliverability, MCP só local |
| Stripe (plugin, mcp.stripe.com) | Plugin + MCP | github.com/stripe/ai | MIT | OAuth / restricted key | Taxas Stripe | Sim (`stripe` para webhooks) | RECOMENDAR: oficial, test mode primeiro |

Também no marketplace oficial: Auth0, WorkOS, Neon, Render, Firebase, Convex.

## B. Mobile build

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| Expo plugin `expo` + EAS CLI | Plugin + CLI | github.com/expo/skills | MIT | login Expo | Freemium | **Sim** (`eas`) | RECOMENDAR: caminho padrão React Native |
| Expo MCP (mcp.expo.dev; local exige SDK 54+) | MCP remoto | docs.expo.dev/mcp | proprietário | OAuth | Franquia free (não verificado) | EAS cobre builds | OPCIONAL: simulador e DevTools |
| MobileBuildMCP (ex-XcodeBuildMCP, Sentry) | MCP + CLI | github.com/getsentry/MobileBuildMCP | MIT | nenhuma | Free | **Sim** | RECOMENDAR: builds nativos iOS/macOS |
| mobile-next/mobile-mcp | MCP | github.com/mobile-next/mobile-mcp | Apache-2.0 | nenhuma | Free | Não | RECOMENDAR: controle de device iOS e Android |
| Dart/Flutter MCP (`dart mcp-server`, Dart 3.9+) | MCP | docs.flutter.dev/ai/mcp-server | BSD (não verificado) | nenhuma | Free | Sim (`flutter`) | OPCIONAL: oficial, experimental |

O app desktop do Claude Code já traz controle do iOS Simulator embutido.

## C. Qualidade de design frontend

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| impeccable (autor: **Paul Bakaus**) | Skill/plugin | github.com/pbakaus/impeccable | Apache-2.0 | nenhuma | Free | `npx impeccable` | RECOMENDAR: melhor skill de design (89k★) |
| Anthropic `frontend-design` | Plugin | claude-plugins-official | Apache-2.0 | nenhuma | Free | | OPCIONAL: impeccable constrói sobre ele |
| shadcn MCP | MCP | ui.shadcn.com/docs/mcp | MIT | nenhuma | Free | **Sim** | OPCIONAL: CLI já cobre |
| Figma MCP (mcp.figma.com + plugin `figma`) | MCP + plugin | github.com/figma/mcp-server-guide | não declarada | OAuth | Seat pago; write-to-canvas free em beta | Não | RECOMENDAR quando o usuário tem Figma |
| Canva (plugin + MCP remoto) | Plugin + MCP | github.com/canva-sdks/canva-skills | Apache-2.0 | OAuth | Freemium | Não | OPCIONAL: gráficos de marketing |
| Pencil.dev | canvas IDE + MCP local | pencil.dev | proprietário | conta | Pago (não verificado) | Não | OPCIONAL: arquivos `.pen` no repo |
| Paper | canvas web + MCP | paper.design | proprietário | conta | Freemium (não verificado) | Não | OPCIONAL: gera HTML/CSS |
| Superdesign | Plugin | github.com/superdesigndev/superdesign-skill | MIT | conta | Freemium | | EVITAR: sobrepõe impeccable, parado desde ago/2026 |

Design system a partir de codebase existente: impeccable já cobre (gera `DESIGN.md` e tokens). Alternativa: `knowledge-work-plugins/design`.

## D. Vídeo / motion

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| **HyperFrames** (HeyGen; HTML → MP4 via Chrome headless + FFmpeg) | Skills + CLI + plugin | github.com/heygen-com/hyperframes | Apache-2.0 | nenhuma local; conta HeyGen para render cloud e stock | Free local | **Sim** | RECOMENDAR: agent-native, licença permissiva |
| Remotion skills (`remotion-dev/skills`) | Skills/plugin | remotion.dev/docs/ai/skills | Remotion License: empresas com 3+ pessoas pagam (de memória, não reverificado) | nenhuma | Free ou pago | Sim | OPCIONAL: maduro, licença limita empresas |
| Runway (`runway-api`) | Plugin/API | github.com/runwayml/skills | não declarada | API key | Pago | | OPCIONAL: footage generativo |

Remotion não está no marketplace oficial; HyperFrames está.

## E. Voz / áudio

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| ElevenLabs MCP hospedado + `@elevenlabs/cli` + `elevenlabs/skills` | MCP remoto + CLI + skills | elevenlabs.io/docs/eleven-api/resources/agent-tooling | MIT (CLI e skills) | OAuth / API key | Freemium | **Sim** | RECOMENDAR: narração premium |
| elevenlabs-mcp (local) | MCP | github.com/elevenlabs/elevenlabs-mcp | MIT | | | | EVITAR: arquivado |
| edge-tts | CLI/Python | github.com/rany2/edge-tts | NOASSERTION | nenhuma | Free | **Sim** | OPCIONAL: endpoint não oficial da Microsoft |
| Kokoro-82M | modelo local | github.com/hexgrad/kokoro | Apache-2.0 | nenhuma | Free | via wrappers | RECOMENDAR: melhor qualidade free local; repo parado desde ago/2025, modelo estável |
| Piper (fork OHF) | CLI local | github.com/OHF-Voice/piper1-gpl | GPL-3.0 | nenhuma | Free | **Sim** | OPCIONAL: mais rápido em CPU; GPL |
| OpenAI TTS / Google Cloud TTS | API | | proprietário | API key | Pago; Google tem free tier | via SDK | OPCIONAL: fallback cloud barato |
| whisper.cpp | CLI local | github.com/ggml-org/whisper.cpp | MIT | nenhuma | Free | **Sim** | RECOMENDAR: transcrição, ótimo em Apple Silicon |
| faster-whisper | Python | github.com/SYSTRAN/faster-whisper | MIT | nenhuma | Free | via wrapper | OPCIONAL: Linux/GPU |

A CLI do HyperFrames também tem `tts` e `transcribe` próprios.

## F. Análise de dados / finanças

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| Google Workspace CLI `gws` (100+ skills, MCP opcional) | CLI + skills | github.com/googleworkspace/cli | Apache-2.0 | OAuth (gcloud) | Free | **Sim** | RECOMENDAR para Sheets; Google rotula "não oficialmente suportado" |
| Anthropic `xlsx` | Skill | github.com/anthropics/skills | source-available (não open source) | nenhuma | Free | | RECOMENDAR para Excel; referenciar, não vendorizar |
| DuckDB CLI + `duckdb-skills` | CLI + plugin | github.com/duckdb/duckdb-skills | MIT | nenhuma | Free | **Sim** | RECOMENDAR: CSV/Parquet |
| Postgres via `psql` / Supabase MCP | CLI / MCP | | | connection string / OAuth | Free | **Sim** | RECOMENDAR |
| BigQuery (`bq` + `bigquery-data-analytics`) | CLI + plugin | github.com/gemini-cli-extensions/bigquery-data-analytics | Apache-2.0 (não verificado) | gcloud | Pago por uso | **Sim** | OPCIONAL |
| Anthropic `financial-services` | Plugins | github.com/anthropics/financial-services | Apache-2.0 | vendors opcionais | Free | | OPCIONAL: modelagem profissional, não finanças pessoais |
| `knowledge-work-plugins/data` e `/finance` | Plugins | github.com/anthropics/knowledge-work-plugins | Apache-2.0 | nenhuma | Free | | RECOMENDAR: workflows gerais de análise |
| `dataviz` skill | Skill | embutida no Claude; não encontrada no repo público | | nenhuma | Free | | RECOMENDAR para gráficos; plotly/matplotlib como libs, sem MCP |

Nenhuma skill de finanças pessoais mantida foi encontrada. QuickBooks e NetSuite no marketplace são contabilidade empresarial. **Lacuna para o `driver-finance`.**

## G. Social media / conteúdo

| Nome | Tipo | URL | Licença | Auth | Custo | CLI? | Veredito |
|---|---|---|---|---|---|---|---|
| Postiz (plugin `postiz` = CLI, 28+ plataformas) | CLI + plugin | github.com/gitroomhq/postiz-agent | agent: NOASSERTION; app: AGPL-3.0 | API key (hospedado ou self-host) | Freemium / self-host | **Sim** | RECOMENDAR: maior cobertura, no marketplace oficial |
| Typefully `agent-skills` | Skills | github.com/typefully/agent-skills | MIT | API key | Pago | API | OPCIONAL: melhor para X/LinkedIn |
| Buffer MCP | MCP | buffer.com (repo oficial não encontrado) | | OAuth | Freemium | Não | OPCIONAL (não verificado) |
| Nano Banana MCP (imagem Gemini) | MCP | github.com/zhongweili/nanobanana-mcp-server | MIT | Gemini API key | Pago | Não | OPCIONAL: comunidade |
| Canva / `knowledge-work-plugins/marketing` | Plugin | ver acima | Apache-2.0 | OAuth / nenhuma | Free | | RECOMENDAR: calendário e drafts |

Nenhuma skill forte de "content calendar" encontrada. A mais próxima é o plugin de marketing da Anthropic. **Lacuna para o `driver-social`.**

## H. Documentos / decks

| Nome | Tipo | URL | Licença | Auth | Custo | Veredito |
|---|---|---|---|---|---|---|
| Anthropic `docx` / `pptx` / `pdf` / `xlsx` | Skills | github.com/anthropics/skills | source-available, sem redistribuição | nenhuma | Free | RECOMENDAR: referenciar, não vendorizar |
| Claude Artifacts (Slides / Docs) | embutido | claude.ai | | conta Claude | incluído | RECOMENDAR para decks compartilháveis |
| HyperFrames "interactive deck" | Skill | ver D | Apache-2.0 | nenhuma | Free | OPCIONAL: decks animados |
| Marp / Slidev | CLI | marp.app / sli.dev | MIT | nenhuma | Free | OPCIONAL (não pesquisado a fundo) |

## Marketplace oficial e diretório de conectores

**Em `claude-plugins-official`:** vercel, supabase, railway, netlify-skills, cloudflare, stripe, resend, auth0, workos, neon, render, firebase, expo, figma, canva, superdesign, frontend-design, hyperframes, runway-api, postiz, duckdb-skills, bigquery-data-analytics, playwright, chrome-devtools-mcp, huggingface-skills, save-to-spotify.

**Fora dele:** impeccable, Remotion, ElevenLabs, Clerk, shadcn, MobileBuildMCP, mobile-mcp, Typefully, `gws`.

**Diretório de conectores do claude.ai:** Stripe, Figma, Canva e Notion confirmados por anúncio da Anthropic. Esta sessão tem Vercel, Supabase, Resend, ElevenLabs, HyperFrames, Linear, Slack e Google Workspace conectados, o que sugere presença no diretório. Lista completa não confirmada.

## "Stack ideal" padrão proposta (10)

1. **impeccable** para qualidade de design.
2. **Vercel CLI + plugin** para deploy.
3. **Supabase CLI + MCP** (read-only, project-scoped) para banco e auth.
4. **Stripe plugin** para pagamentos, test mode primeiro.
5. **Resend CLI/skills** para e-mail.
6. **Expo skills + EAS CLI** para mobile, mais **MobileBuildMCP** para iOS nativo.
7. **HyperFrames** para vídeo.
8. **ElevenLabs CLI/MCP hospedado** para voz paga; **Kokoro + whisper.cpp** como opção free local.
9. **DuckDB CLI + `gws` CLI** para dados e Sheets.
10. **Postiz CLI** para social, mais skills **docx/pptx/xlsx/pdf** da Anthropic.

## Fontes

- github.com/pbakaus/impeccable · github.com/heygen-com/hyperframes · remotion.dev/docs/ai/skills
- docs.expo.dev/mcp · github.com/getsentry/MobileBuildMCP · github.com/mobile-next/mobile-mcp · docs.flutter.dev/ai/mcp-server
- elevenlabs.io/docs/eleven-api/resources/agent-tooling · docs.railway.com/ai/mcp-server · docs.netlify.com/welcome/build-with-ai/netlify-mcp-server
- developers.cloudflare.com/agents/model-context-protocol · github.com/supabase/mcp · clerk.com/docs/guides/ai/overview · ui.shadcn.com/docs/mcp
- developers.figma.com/docs/figma-mcp-server/write-to-canvas · postmarkapp.com/lp/mcp · github.com/googleworkspace/cli
- buffer.com/resources/best-mcp-servers · banani.co/blog/paper-design-mcp-review · claude.com/blog/connectors-directory
- github.com/anthropics/claude-plugins-official
