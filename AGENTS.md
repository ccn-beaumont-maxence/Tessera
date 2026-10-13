# Tessera

Moteur de jeu web 2D/3D conçu pour être utilisé par des agents d'IA (Claude Code, Cursor,
Codex). Un jeu = une scène YAML + du gameplay en **Tess** (syntaxe proche du C++, compilé en
TypeScript) ou en TypeScript. Objectif : peu de tokens par jeu, réussite au premier essai.

## Écrire ou modifier un jeu

1. Lire `docs/tess-spec.md` (langage) et `docs/scenes.md` (format des scènes) avant d'écrire.
2. Partir d'un exemple : `examples/platformer` (2D) ou `examples/arena` (3D), chacun
   `scene.yaml` + `game.tess`. Découper par fonctionnalité avec `using "./enemy.tess";`
   (voir `examples/platformer/enemy.tess`).
3. Vérifier sans navigateur, à chaque modification :
   - `pnpm exec tess run <scene.yaml> --frames 120 --dump` : état final, une ligne par entité ;
   - `pnpm exec tess run <scene.yaml> --frames 120 --screenshot out.png` : image à regarder ;
   - `pnpm exec tess test` : tests Vitest du projet (`.tess` supporté).
4. Les erreurs sont sur une ligne, au format `fichier:ligne: message`, avec la correction à faire.
5. Pour un jeu en cours d'exécution, utiliser le serveur MCP `tessera` (ci-dessous).

Tests headless d'un jeu : `loadExample` (`examples/load.ts`), `runFrames`, `dump`, `find`,
`assertComponent` (`@tessera/headless`), `press`/`release` (`@tessera/input`). Voir
`examples/platformer/platformer.test.ts`.

## Serveur MCP

`node packages/mcp/bin/tess-mcp.js [scene.yaml] [--headed]` lance le jeu dans Chromium.
Outils : `open` (choisir le jeu), `state`, `inspect`, `set`, `step`, `run`, `input`,
`screenshot`, `logs`, `reload`. Le jeu se met en pause sur une erreur d'exécution.
Déjà configuré pour Claude Code (`.mcp.json`) et Cursor (`.cursor/mcp.json`). Pour Codex,
dans `~/.codex/config.toml` :

```toml
[mcp_servers.tessera]
command = "node"
args = ["packages/mcp/bin/tess-mcp.js"]
```

## Développer le moteur

Stack : TypeScript strict, monorepo pnpm, three.js, Rapier (`@dimforge/rapier2d-compat`,
`rapier3d-compat`), Vitest, Vite, Playwright.

Commandes : `pnpm install`, `pnpm test`, `pnpm -F <package> test`, `pnpm typecheck`,
`pnpm lint`, `pnpm dev` (exemples dans le navigateur, YAML rechargé à chaud).

Règles :
- Lire `PLAN.md` avant toute tâche, travailler phase par phase, cocher les cases au fur et à mesure.
- Pas de `any`. Pas de nouvelle dépendance sans justification dans le commit.
- Tout le runtime fonctionne en headless (Node, sans DOM) ; le rendu est un plugin optionnel.
- Simulation déterministe : pas de temps fixe, jamais de `Math.random()` (RNG à graine du monde).
- Aucune allocation dans les boucles chaudes (systèmes, rendu, physique).
- Messages d'erreur : une ligne, actionnable, avec fichier:ligne si possible.
- `docs/tess-spec.md` est la source de vérité du langage et reste sous ~2000 tokens.
- API publiques courtes et cohérentes : un concept = un seul nom.
- Conventions spatiales : Y vers le haut en 2D et 3D, 1 unité = 1 mètre, repère main droite,
  l'avant est -Z en 3D (convention three.js).
