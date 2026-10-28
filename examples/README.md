# DRIVER examples

Two mini projects whose `.claude/driver/` directories were produced by the real CLI, not written by hand.

- `web-waitlist`: 7 blocks (Supabase, Resend, Vercel), phase `implement`, gate `route` approved, baseline 1.
- `video-explainer`: 5 blocks (HyperFrames, ElevenLabs), phase `route`, gate `route` approved.

Each folder has a `generate.sh` with the exact `driver` commands and fixed `--now` timestamps, so output is deterministic.
Rebuild first (`npm run build` in `plugins/driver`), then run `bash examples/<name>/generate.sh`.
`--root` makes the CLI treat the example folder as the project instead of the enclosing git repo.
The Mermaid diagram is committed at `<name>/docs/plan.mmd` because `exports/` is gitignored by `driver init`.
Check an example with `node plugins/driver/dist/cli.js validate --replay examples/<name>`.
