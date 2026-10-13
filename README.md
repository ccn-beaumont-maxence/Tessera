# Tessera

Web 2D/3D game engine designed to be driven by AI agents: games are YAML scenes plus gameplay
code in **Tess** (C++-flavored, compiled to TypeScript) or TypeScript. See [PLAN.md](PLAN.md)
and the language spec in [docs/tess-spec.md](docs/tess-spec.md).

```sh
pnpm install
pnpm dev                                    # examples in the browser (YAML edits hot-reload)
pnpm exec tess run examples/platformer/scene.yaml --frames 120 --dump
pnpm exec tess run examples/arena/scene.yaml --frames 120 --screenshot out.png
pnpm exec tess build examples/arena/scene.yaml --out dist
pnpm test                                   # all tests, including TS/Tess parity
pnpm bench --oracle                         # validate the benchmark offline; `pnpm bench` needs ANTHROPIC_API_KEY
```

## MCP server

Lets an agent inspect and drive a running game (state, inspect, set, step, input, screenshot, logs):

```json
{ "mcpServers": { "tessera": { "command": "node", "args": ["packages/mcp/bin/tess-mcp.js", "examples/platformer/scene.yaml"] } } }
```

Add `--headed` to watch the game in a browser window.

## Editor

`packages/vscode-tess` is a VS Code extension with Tess syntax highlighting.
