# Plan de développement de Tessera

## Architecture (monorepo pnpm)

    packages/
      core/       ECS, maths, scheduler, temps, événements, RNG
      headless/   exécution sans rendu, dump d'état, helpers de test
      render/     adaptateur three.js (2D et 3D)
      physics/    adaptateur Rapier (2D et 3D)
      input/      actions abstraites (clavier, souris, manette, tactile)
      audio/      Web Audio API
      assets/     chargement glTF, textures, spritesheets, sons
      scene/      format de scène texte (YAML), prefabs, rechargement à chaud
      compiler/   compilateur Tess vers TypeScript
      cli/        commande `tess`
      mcp/        serveur MCP exposant un jeu en cours d'exécution
    examples/     jeux de démonstration
    benchmarks/   comparaison TypeScript contre Tess
    docs/         spécification et documentation

## Décisions de conception

- ECS à ensembles creux (sparse sets), composants = objets simples.
  Simplicité et lisibilité d'abord, optimisation ensuite.
- Chaque scène déclare `dimension: 2d` ou `dimension: 3d`.
  Composants distincts Transform2D et Transform3D. Le backend de physique
  et la caméra par défaut dépendent de la dimension.
- 2D : caméra orthographique, sprites avec `pixelsPerUnit`, ordre par calque.
- Pas fixe de 60 Hz pour la logique et la physique, rendu interpolé.
- Tout est texte : scènes, prefabs, matériaux, configuration des entrées.

## Phase 0 : Fondations
- [x] Monorepo pnpm, TypeScript strict, Vitest, linter, Vite
- [x] CI GitHub Actions : typecheck, lint, tests
Acceptation : `pnpm test` et `pnpm typecheck` passent sur un dépôt propre.

## Phase 1 : Noyau
- [x] Maths : vec2, vec3, quat, mat4, color, avec variantes sans allocation
      (`out` en paramètre)
- [x] ECS : entités, composants, requêtes, ajout et retrait en cours de frame
- [x] Systèmes déclarant leurs accès en lecture et en écriture
- [x] Scheduler : ordre explicite et détection des conflits d'écriture
      (ordre = ordre d'ajout ; écritures vérifiées par le typage `mut()`)
- [x] Ressources globales, événements, RNG à graine
Acceptation : couverture de tests > 90 % sur core, aucune dépendance au DOM.

## Phase 2 : Mode headless et outils de test
- [x] `runFrames(world, n)` avec pas fixe
- [x] Dump compact de l'état, une ligne par entité, par exemple :
      `#12 Player Transform2D{pos:(3,1.5)} Health{value:80}`
- [x] Helpers d'assertion pour Vitest
Acceptation : un test simule 300 frames et vérifie un état final, deux
exécutions avec la même graine produisent un dump identique.

## Phase 3 : Rendu
- [x] Synchronisation ECS vers le graphe de scène three.js
- [x] 3D : Mesh, Camera3D, lumières, matériaux de base
- [x] 2D : Sprite, Camera2D, calques, animations de spritesheet
- [x] Capture d'écran à une frame donnée via Playwright
Acceptation : un exemple 2D et un exemple 3D s'affichent, et
`tess run <scene> --frames 120 --screenshot out.png` produit une image.

## Phase 4 : Physique
- [x] Rapier 2D et 3D derrière une API commune
- [x] RigidBody, Collider, événements de collision et de déclencheur
- [x] Raycasts, requêtes de forme
Acceptation : tests headless de chute, de collision et de raycast, en 2D
et en 3D, déterministes.

## Phase 5 : Entrées, audio, assets, scènes
- [ ] Entrées par actions nommées (`jump`, `move`) définies en YAML
- [ ] Audio : sons ponctuels, musique, volume par bus
- [ ] Assets : glTF, textures, spritesheets, sons, avec cache
- [ ] Scènes et prefabs en YAML, rechargement à chaud via Vite
Acceptation : une scène complète est définie sans une ligne de code de
câblage, et modifier le YAML met le jeu à jour sans recharger la page.

## Phase 6 : Jeux de référence en TypeScript
- [ ] Platformer 2D (déplacement, saut, ennemis, pièces, score)
- [ ] Arène 3D (déplacement, tir, ennemis avec IA simple, vies)
Acceptation : les deux jeux sont jouables et testés en headless.
Ils serviront de référence pour le benchmark de la phase 9.

## Phase 7 : Le langage Tess
- [ ] Rédiger `docs/tess-spec.md` (moins de ~2000 tokens), à faire valider
      avant d'écrire le compilateur
- [ ] Lexer et parser écrits à la main (descente récursive) pour avoir
      des messages d'erreur précis
- [ ] Vérification de types
- [ ] Génération de TypeScript avec source maps
- [ ] Types valeur (vec2, vec3, quat, color) et opérateurs surchargés,
      compilés sans allocation
- [ ] Mots-clés `component`, `system`, `resource`, `event`.
      Dans un système, `&` signifie accès en écriture
- [ ] Diagnostics pour les réflexes C++ : `->`, `#include`, `std::`,
      pointeurs, headers, avec un message court indiquant l'équivalent Tess

Syntaxe cible :

    component Health { float value = 100; }
    component Velocity { vec3 linear; }

    system Movement(Transform3D& t, Velocity v) {
        t.position += v.linear * dt;
    }

    system Death(Entity e, Health h) {
        if (h.value <= 0) destroy(e);
    }

Acceptation : les deux jeux de référence sont réécrits en Tess, se comportent
de façon identique (mêmes dumps headless), et toute erreur pointe vers le
fichier `.tess` d'origine.

## Phase 8 : Outillage pour agents
- [ ] CLI : `tess dev`, `tess build`, `tess test`,
      `tess run <scene> --frames N --dump --screenshot`
- [ ] Serveur MCP : lister les entités, lire et modifier un composant,
      avancer de N frames, capturer l'écran
- [ ] Coloration syntaxique VS Code (grammaire TextMate)
Acceptation : un agent peut diagnostiquer un bug sur un jeu en cours
d'exécution uniquement via le MCP.

## Phase 9 : Benchmark
- [ ] Compter les tokens des jeux de référence en TypeScript et en Tess
      (API de comptage de tokens d'Anthropic)
- [ ] Faire implémenter par un agent une même liste de fonctionnalités
      dans chaque version, mesurer les tokens consommés et le taux de
      réussite au premier essai
- [ ] Rapport dans `benchmarks/RESULTS.md`
Acceptation : résultats reproductibles avec un seul script.
