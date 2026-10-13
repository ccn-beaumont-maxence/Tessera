# Tessera benchmark: TypeScript vs Tess

> **Oracle run**: reference solutions were applied instead of model answers. It validates the tasks and checks; it measures no model. Token counts need API credentials.

Reproduce: `pnpm bench` (needs `ANTHROPIC_API_KEY`); `pnpm bench --oracle` validates offline.

## Source size (tokens via the Anthropic token counting API)

| Game | TypeScript tokens | Tess tokens | TypeScript chars | Tess chars |
| --- | --- | --- | --- | --- |
| platformer | n/a | n/a | 3187 | 2260 |
| arena | n/a | n/a | 3911 | 3003 |
| context doc | n/a | n/a | | |

## Feature tasks (first-try success)

| Task | TypeScript pass | Tess pass | TypeScript in/out tokens | Tess in/out tokens |
| --- | --- | --- | --- | --- |
| double-jump | 100% | 100% | 0 / 0 | 0 / 0 |
| jump-count | 100% | 100% | 0 / 0 | 0 / 0 |
| combo | 100% | 100% | 0 / 0 | 0 / 0 |
| invulnerable | 100% | 100% | 0 / 0 | 0 / 0 |
| **all** | 100% | 100% | 0 / 0 | 0 / 0 |
