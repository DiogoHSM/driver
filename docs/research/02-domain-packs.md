# Research 2: domain packs and capability registry

Date: 2026-10-26. Source: research subagent (Opus), checked via the GitHub API and `anthropics/claude-plugins-official/.claude-plugin/marketplace.json` (315 plugins). "CLI?" means a native CLI exists and should be preferred over the MCP (zero context cost until it is called). Unverified items are marked.

## Four findings that change the plan

- **Local ElevenLabs MCP** (`elevenlabs/elevenlabs-mcp`) was archived in August 2026. Use the hosted MCP or the CLI.
- **`@railway/mcp-server`** was archived in May 2026. The MCP now ships inside the CLI as `railway mcp`.
- **XcodeBuildMCP** became `getsentry/MobileBuildMCP`. The old Homebrew tap still works.
- **Auth.js / next-auth** had its last push in July 2026, effectively in maintenance. Better Auth is the practical successor (handover not confirmed).

## A. Web build

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| Vercel CLI + `vercel` plugin (remote MCP at mcp.vercel.com) | CLI + plugin + MCP | github.com/vercel/vercel-plugin | NOASSERTION | OAuth / token | Freemium | **Yes** (`vercel`) | RECOMMEND: default frontend hosting |
| Supabase CLI + MCP (`?read_only=true&project_ref=`) | CLI + MCP + plugin | github.com/supabase/mcp | Apache-2.0 | OAuth | Freemium | Yes for migrations; MCP for SQL and advisors | RECOMMEND: database, auth and storage together |
| Railway (`railway mcp` in the CLI + `railway` plugin) | CLI + plugin | github.com/railwayapp/railway-skills | MIT | CLI login / OAuth | Pay per use | **Yes** | OPTIONAL: easier for backends/containers |
| Netlify (`@netlify/mcp` + `netlify-skills`) | MCP + plugin | github.com/netlify/netlify-mcp | not declared | OAuth / PAT | Freemium | **Yes** (`netlify`) | OPTIONAL: alternative to Vercel |
| Cloudflare (MCP with `search()`/`execute()` + plugin) | MCP + plugin | github.com/cloudflare/mcp-server-cloudflare | Apache-2.0 | OAuth / token | Freemium | **Yes** (`wrangler`) | OPTIONAL: edge, R2, DNS |
| Clerk (`clerk/skills`, mcp.clerk.com) | Skill + MCP | clerk.com/docs/guides/ai/overview | not declared | docs-only MCP | Freemium | `clerk init` | OPTIONAL: best ready-made auth UI |
| Supabase Auth | part of Supabase | | | | Free tier | | RECOMMEND when already on Supabase |
| Better Auth | Lib | github.com/better-auth/better-auth | MIT | | Free | | OPTIONAL: self-hosted auth |
| Auth.js / next-auth | Lib | github.com/nextauthjs/next-auth | ISC | | Free | | AVOID: maintenance mode |
| Resend (plugin, CLI, MCP) | Skill + CLI + MCP | github.com/resend/resend-skills · resend/resend-cli | MIT | API key | Freemium | **Yes** | RECOMMEND: best DX for email |
| Postmark MCP | MCP | github.com/ActiveCampaign/postmark-mcp | MIT | server token | Paid (trial) | No | OPTIONAL: deliverability, local-only MCP |
| Stripe (plugin, mcp.stripe.com) | Plugin + MCP | github.com/stripe/ai | MIT | OAuth / restricted key | Stripe fees | Yes (`stripe` for webhooks) | RECOMMEND: official, test mode first |

Also in the official marketplace: Auth0, WorkOS, Neon, Render, Firebase, Convex.

## B. Mobile build

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| Expo plugin `expo` + EAS CLI | Plugin + CLI | github.com/expo/skills | MIT | Expo login | Freemium | **Yes** (`eas`) | RECOMMEND: default React Native path |
| Expo MCP (mcp.expo.dev; local requires SDK 54+) | Remote MCP | docs.expo.dev/mcp | proprietary | OAuth | Free allowance (not verified) | EAS covers builds | OPTIONAL: simulator and DevTools |
| MobileBuildMCP (ex-XcodeBuildMCP, Sentry) | MCP + CLI | github.com/getsentry/MobileBuildMCP | MIT | none | Free | **Yes** | RECOMMEND: native iOS/macOS builds |
| mobile-next/mobile-mcp | MCP | github.com/mobile-next/mobile-mcp | Apache-2.0 | none | Free | No | RECOMMEND: iOS and Android device control |
| Dart/Flutter MCP (`dart mcp-server`, Dart 3.9+) | MCP | docs.flutter.dev/ai/mcp-server | BSD (not verified) | none | Free | Yes (`flutter`) | OPTIONAL: official, experimental |

The Claude Code desktop app already ships with iOS Simulator control built in.

## C. Frontend design quality

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| impeccable (author: **Paul Bakaus**) | Skill/plugin | github.com/pbakaus/impeccable | Apache-2.0 | none | Free | `npx impeccable` | RECOMMEND: best design skill (89k★) |
| Anthropic `frontend-design` | Plugin | claude-plugins-official | Apache-2.0 | none | Free | | OPTIONAL: impeccable builds on it |
| shadcn MCP | MCP | ui.shadcn.com/docs/mcp | MIT | none | Free | **Yes** | OPTIONAL: the CLI already covers it |
| Figma MCP (mcp.figma.com + `figma` plugin) | MCP + plugin | github.com/figma/mcp-server-guide | not declared | OAuth | Paid seat; write-to-canvas free in beta | No | RECOMMEND when the user has Figma |
| Canva (plugin + remote MCP) | Plugin + MCP | github.com/canva-sdks/canva-skills | Apache-2.0 | OAuth | Freemium | No | OPTIONAL: marketing graphics |
| Pencil.dev | canvas IDE + local MCP | pencil.dev | proprietary | account | Paid (not verified) | No | OPTIONAL: `.pen` files in the repo |
| Paper | web canvas + MCP | paper.design | proprietary | account | Freemium (not verified) | No | OPTIONAL: generates HTML/CSS |
| Superdesign | Plugin | github.com/superdesigndev/superdesign-skill | MIT | account | Freemium | | AVOID: overlaps impeccable, stalled since Aug 2026 |

Design system from an existing codebase: impeccable already covers it (generates `DESIGN.md` and tokens). Alternative: `knowledge-work-plugins/design`.

## D. Video / motion

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| **HyperFrames** (HeyGen; HTML → MP4 via headless Chrome + FFmpeg) | Skills + CLI + plugin | github.com/heygen-com/hyperframes | Apache-2.0 | none locally; HeyGen account for cloud render and stock | Free locally | **Yes** | RECOMMEND: agent-native, permissive license |
| Remotion skills (`remotion-dev/skills`) | Skills/plugin | remotion.dev/docs/ai/skills | Remotion License: companies with 3+ people pay (from memory, not rechecked) | none | Free or paid | Yes | OPTIONAL: mature, license limits companies |
| Runway (`runway-api`) | Plugin/API | github.com/runwayml/skills | not declared | API key | Paid | | OPTIONAL: generative footage |

Remotion is not in the official marketplace; HyperFrames is.

## E. Voice / audio

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| Hosted ElevenLabs MCP + `@elevenlabs/cli` + `elevenlabs/skills` | Remote MCP + CLI + skills | elevenlabs.io/docs/eleven-api/resources/agent-tooling | MIT (CLI and skills) | OAuth / API key | Freemium | **Yes** | RECOMMEND: premium narration |
| elevenlabs-mcp (local) | MCP | github.com/elevenlabs/elevenlabs-mcp | MIT | | | | AVOID: archived |
| edge-tts | CLI/Python | github.com/rany2/edge-tts | NOASSERTION | none | Free | **Yes** | OPTIONAL: unofficial Microsoft endpoint |
| Kokoro-82M | local model | github.com/hexgrad/kokoro | Apache-2.0 | none | Free | via wrappers | RECOMMEND: best free local quality; repo stalled since Aug 2025, model stable |
| Piper (OHF fork) | local CLI | github.com/OHF-Voice/piper1-gpl | GPL-3.0 | none | Free | **Yes** | OPTIONAL: fastest on CPU; GPL |
| OpenAI TTS / Google Cloud TTS | API | | proprietary | API key | Paid; Google has a free tier | via SDK | OPTIONAL: cheap cloud fallback |
| whisper.cpp | local CLI | github.com/ggml-org/whisper.cpp | MIT | none | Free | **Yes** | RECOMMEND: transcription, great on Apple Silicon |
| faster-whisper | Python | github.com/SYSTRAN/faster-whisper | MIT | none | Free | via wrapper | OPTIONAL: Linux/GPU |

The HyperFrames CLI also has its own `tts` and `transcribe`.

## F. Data analysis / finance

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| Google Workspace CLI `gws` (100+ skills, optional MCP) | CLI + skills | github.com/googleworkspace/cli | Apache-2.0 | OAuth (gcloud) | Free | **Yes** | RECOMMEND for Sheets; Google labels it "not officially supported" |
| Anthropic `xlsx` | Skill | github.com/anthropics/skills | source-available (not open source) | none | Free | | RECOMMEND for Excel; reference, do not vendor |
| DuckDB CLI + `duckdb-skills` | CLI + plugin | github.com/duckdb/duckdb-skills | MIT | none | Free | **Yes** | RECOMMEND: CSV/Parquet |
| Postgres via `psql` / Supabase MCP | CLI / MCP | | | connection string / OAuth | Free | **Yes** | RECOMMEND |
| BigQuery (`bq` + `bigquery-data-analytics`) | CLI + plugin | github.com/gemini-cli-extensions/bigquery-data-analytics | Apache-2.0 (not verified) | gcloud | Pay per use | **Yes** | OPTIONAL |
| Anthropic `financial-services` | Plugins | github.com/anthropics/financial-services | Apache-2.0 | optional vendors | Free | | OPTIONAL: professional modeling, not personal finance |
| `knowledge-work-plugins/data` and `/finance` | Plugins | github.com/anthropics/knowledge-work-plugins | Apache-2.0 | none | Free | | RECOMMEND: general analysis workflows |
| `dataviz` skill | Skill | built into Claude; not found in the public repo | | none | Free | | RECOMMEND for charts; plotly/matplotlib as libs, no MCP |

No maintained personal-finance skill was found. QuickBooks and NetSuite in the marketplace are business accounting. **Gap for `driver-finance`.**

## G. Social media / content

| Name | Type | URL | License | Auth | Cost | CLI? | Verdict |
|---|---|---|---|---|---|---|---|
| Postiz (`postiz` plugin = CLI, 28+ platforms) | CLI + plugin | github.com/gitroomhq/postiz-agent | agent: NOASSERTION; app: AGPL-3.0 | API key (hosted or self-host) | Freemium / self-host | **Yes** | RECOMMEND: widest coverage, in the official marketplace |
| Typefully `agent-skills` | Skills | github.com/typefully/agent-skills | MIT | API key | Paid | API | OPTIONAL: best for X/LinkedIn |
| Buffer MCP | MCP | buffer.com (official repo not found) | | OAuth | Freemium | No | OPTIONAL (not verified) |
| Nano Banana MCP (Gemini image) | MCP | github.com/zhongweili/nanobanana-mcp-server | MIT | Gemini API key | Paid | No | OPTIONAL: community |
| Canva / `knowledge-work-plugins/marketing` | Plugin | see above | Apache-2.0 | OAuth / none | Free | | RECOMMEND: calendar and drafts |

No strong "content calendar" skill was found. The closest is Anthropic's marketing plugin. **Gap for `driver-social`.**

## H. Documents / decks

| Name | Type | URL | License | Auth | Cost | Verdict |
|---|---|---|---|---|---|---|
| Anthropic `docx` / `pptx` / `pdf` / `xlsx` | Skills | github.com/anthropics/skills | source-available, no redistribution | none | Free | RECOMMEND: reference, do not vendor |
| Claude Artifacts (Slides / Docs) | built in | claude.ai | | Claude account | included | RECOMMEND for shareable decks |
| HyperFrames "interactive deck" | Skill | see D | Apache-2.0 | none | Free | OPTIONAL: animated decks |
| Marp / Slidev | CLI | marp.app / sli.dev | MIT | none | Free | OPTIONAL (not researched in depth) |

## Official marketplace and connector directory

**In `claude-plugins-official`:** vercel, supabase, railway, netlify-skills, cloudflare, stripe, resend, auth0, workos, neon, render, firebase, expo, figma, canva, superdesign, frontend-design, hyperframes, runway-api, postiz, duckdb-skills, bigquery-data-analytics, playwright, chrome-devtools-mcp, huggingface-skills, save-to-spotify.

**Outside it:** impeccable, Remotion, ElevenLabs, Clerk, shadcn, MobileBuildMCP, mobile-mcp, Typefully, `gws`.

**claude.ai connector directory:** Stripe, Figma, Canva and Notion confirmed by an Anthropic announcement. This session has Vercel, Supabase, Resend, ElevenLabs, HyperFrames, Linear, Slack and Google Workspace connected, which suggests they are in the directory. Full list not confirmed.

## Proposed default "ideal stack" (10)

1. **impeccable** for design quality.
2. **Vercel CLI + plugin** for deploy.
3. **Supabase CLI + MCP** (read-only, project-scoped) for database and auth.
4. **Stripe plugin** for payments, test mode first.
5. **Resend CLI/skills** for email.
6. **Expo skills + EAS CLI** for mobile, plus **MobileBuildMCP** for native iOS.
7. **HyperFrames** for video.
8. **Hosted ElevenLabs CLI/MCP** for paid voice; **Kokoro + whisper.cpp** as the free local option.
9. **DuckDB CLI + `gws` CLI** for data and Sheets.
10. **Postiz CLI** for social, plus Anthropic's **docx/pptx/xlsx/pdf** skills.

## Sources

- github.com/pbakaus/impeccable · github.com/heygen-com/hyperframes · remotion.dev/docs/ai/skills
- docs.expo.dev/mcp · github.com/getsentry/MobileBuildMCP · github.com/mobile-next/mobile-mcp · docs.flutter.dev/ai/mcp-server
- elevenlabs.io/docs/eleven-api/resources/agent-tooling · docs.railway.com/ai/mcp-server · docs.netlify.com/welcome/build-with-ai/netlify-mcp-server
- developers.cloudflare.com/agents/model-context-protocol · github.com/supabase/mcp · clerk.com/docs/guides/ai/overview · ui.shadcn.com/docs/mcp
- developers.figma.com/docs/figma-mcp-server/write-to-canvas · postmarkapp.com/lp/mcp · github.com/googleworkspace/cli
- buffer.com/resources/best-mcp-servers · banani.co/blog/paper-design-mcp-review · claude.com/blog/connectors-directory
- github.com/anthropics/claude-plugins-official
