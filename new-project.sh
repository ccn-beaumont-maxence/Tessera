#!/bin/sh
# Creates a standalone game project that uses this engine as a git submodule (engine/).
# The project is its own git repo, so it can be pushed to a private remote.
# usage: ./new-project.sh <dir> [2d|3d]
set -eu

dir=${1:?usage: ./new-project.sh <dir> [2d|3d]}
kind=${2:-2d}
case $kind in 2d) example=platformer ;; 3d) example=arena ;; *) echo "kind must be 2d or 3d" >&2; exit 1 ;; esac
engine=$(cd "$(dirname "$0")" && pwd)
url=$(git -C "$engine" remote get-url origin)
[ -e "$dir" ] && { echo "$dir already exists" >&2; exit 1; }

mkdir -p "$dir/game"
cd "$dir"
git init -q
git submodule add -q "$url" engine
cp "$engine"/examples/$example/scene.yaml "$engine"/examples/$example/*.tess game/
[ $example = platformer ] && cp "$engine"/examples/platformer/hero.png game/

cat > package.json <<EOF
{
  "name": "$(basename "$dir")",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tess dev game/scene.yaml",
    "test": "tess test",
    "build": "tess build game/scene.yaml --out dist"
  },
  "devDependencies": {
    "@tessera/assets": "workspace:*",
    "@tessera/audio": "workspace:*",
    "@tessera/cli": "workspace:*",
    "@tessera/compiler": "workspace:*",
    "@tessera/core": "workspace:*",
    "@tessera/headless": "workspace:*",
    "@tessera/input": "workspace:*",
    "@tessera/mcp": "workspace:*",
    "@tessera/physics": "workspace:*",
    "@tessera/render": "workspace:*",
    "@tessera/scene": "workspace:*",
    "vitest": "^5.0.4"
  }
}
EOF

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - engine/packages/*
EOF

cat > vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import { tess } from './engine/packages/compiler/src/vite';

export default defineConfig({ plugins: [tess()], test: { include: ['game/**/*.test.ts'] } });
EOF

cat > game/game.test.ts <<'EOF'
import { readFileSync } from 'node:fs';
import { World } from '@tessera/core';
import { dump, runFrames } from '@tessera/headless';
import { sceneGame } from '@tessera/scene';
import { expect, it } from 'vitest';

it('runs 120 frames', async () => {
  const game = await sceneGame(`${import.meta.dirname}/scene.yaml`, {
    read: async (p) => readFileSync(p, 'utf8'),
    load: (p) => import(/* @vite-ignore */ p),
    url: (p) => p,
  });
  const w = new World({ seed: 1 });
  await game.setup(w);
  runFrames(w, 120);
  expect(dump(w)).toContain('Player');
});
EOF

cat > .mcp.json <<'EOF'
{
  "mcpServers": {
    "tessera": { "command": "node", "args": ["engine/packages/mcp/bin/tess-mcp.js", "game/scene.yaml"] }
  }
}
EOF

printf 'node_modules\ndist\n*.png\n!game/*.png\n' > .gitignore

cat > AGENTS.md <<'EOF'
# Game project (Tessera engine in `engine/`, git submodule)

A game = `game/scene.yaml` + gameplay in Tess (`game/*.tess`). Do not edit `engine/`.

1. Read `engine/docs/tess-spec.md` (language) and `engine/docs/scenes.md` (scenes) before writing.
2. More examples: `engine/examples/` (forest, dawnvale for bigger games).
3. Check every change without a browser:
   - `pnpm exec tess run game/scene.yaml --frames 120 --dump`
   - `pnpm exec tess run game/scene.yaml --frames 120 --screenshot out.png`
   - `pnpm test`
4. Running game: MCP server `tessera` (`.mcp.json`): state, inspect, set, step, input, screenshot, logs.
5. Errors are one line, `file:line: message`, with the fix to apply.
EOF
echo '@AGENTS.md' > CLAUDE.md

pnpm install --silent
pnpm exec tess run game/scene.yaml --frames 60 --dump > /dev/null
git add -A && git commit -qm "New Tessera game ($kind)"
echo "created $(pwd)"
