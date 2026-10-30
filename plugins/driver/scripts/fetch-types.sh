#!/usr/bin/env bash
# Best effort: lay the engine's mod typings where `tsc -p .` expects them. The engine overwrites
# them at the first load of the plugin; this is for fresh clones and CI without a session.
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC=$(ls -d /private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | tail -1 || true)
if [ -z "$SRC" ]; then
  echo "types:fetch: no bundled plugin-authoring typings found; load the plugin once in Claude Code instead" >&2
  exit 0
fi
mkdir -p "$HERE/.claude-plugin/types/claude-code"
cp "$SRC" "$HERE/.claude-plugin/types/claude-code/index.d.ts"
cat > "$HERE/.claude-plugin/types/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": ["./claude-code"]
}
JSON
echo "types:fetch: copied $SRC"
