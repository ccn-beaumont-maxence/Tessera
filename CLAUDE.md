# Tessera

Moteur de jeu web 2D/3D conçu pour être utilisé par des agents d'IA.

Langage de gameplay : Tess (syntaxe proche du C++, transpilé en TypeScript).

Objectif central : minimiser les tokens nécessaires pour implémenter un jeu,

tout en maximisant le taux de réussite au premier essai.

## Stack

- TypeScript strict, monorepo pnpm workspaces

- Rendu : three.js. Physique : Rapier (@dimforge/rapier2d-compat et rapier3d-compat)

- Tests : Vitest. Serveur de dev : Vite. Captures d'écran : Playwright

## Commandes

- `pnpm install`

- `pnpm test` : tous les tests

- `pnpm -F <package> test` : tests d'un seul package

- `pnpm typecheck` et `pnpm lint`

- `pnpm dev` : lance les exemples dans le navigateur

## Règles

- Lire [PLAN.md](http://PLAN.md) avant toute tâche. Travailler phase par phase, et ne pas

  commencer une phase tant que les critères d'acceptation de la précédente

  ne passent pas. Cocher les cases de [PLAN.md](http://PLAN.md) au fur et à mesure.

- Pas de `any`. Pas de nouvelle dépendance sans justification dans le commit.

- Tout le runtime doit fonctionner en headless (Node, sans DOM).

  Le rendu est un plugin optionnel.

- Simulation déterministe : pas de temps fixe, jamais de `Math.random()`

  direct (utiliser le RNG à graine du monde).

- Aucune allocation dans les boucles chaudes (systèmes, rendu, physique).

- Messages d'erreur : une ligne, actionnable, avec fichier:ligne si possible.

- `docs/[tess-spec.md](http://tess-spec.md)` est la source de vérité du langage et doit rester

  sous ~2000 tokens.

- API publiques courtes et cohérentes : un concept = un seul nom.

- Conventions spatiales : Y vers le haut en 2D comme en 3D, 1 unité = 1 mètre,

  repère main droite, l'avant est -Z en 3D (convention three.js).