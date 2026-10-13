/** Feature requests given to the model, with a reference solution per language (`--oracle`). */
export interface Task {
  id: string;
  game: 'platformer' | 'arena';
  prompt: string;
  /** [find, replace] edits that turn the reference game into a correct solution. */
  oracle: { ts: [string, string][]; tess: [string, string][] };
}

export const TASKS: Task[] = [
  {
    id: 'double-jump',
    game: 'platformer',
    prompt:
      'Add a double jump: while airborne the player may jump once more (same jump velocity). The extra jump comes back when the player is grounded again.',
    oracle: {
      ts: [
        ['  grounded: false,\n}));', '  grounded: false,\n  airJumps: 0,\n}));'],
        [
          "    if (p.grounded && wasPressed(w, 'jump')) body.velocity.y = p.jump;",
          "    if (p.grounded) p.airJumps = 1;\n    if (wasPressed(w, 'jump') && (p.grounded || p.airJumps > 0)) {\n      if (!p.grounded) p.airJumps--;\n      body.velocity.y = p.jump;\n    }",
        ],
      ],
      tess: [
        ['vec2 spawn; bool grounded; }', 'vec2 spawn; bool grounded; int airJumps; }'],
        [
          '    if (p.grounded && pressed("jump")) body.velocity.y = p.jump;',
          '    if (p.grounded) p.airJumps = 1;\n    if (pressed("jump") && (p.grounded || p.airJumps > 0)) {\n        if (!p.grounded) p.airJumps--;\n        body.velocity.y = p.jump;\n    }',
        ],
      ],
    },
  },
  {
    id: 'jump-count',
    game: 'platformer',
    prompt: 'Count the jumps the player performs in a new int field `jumps` of the Score resource.',
    oracle: {
      ts: [
        [
          "export const Score = resource('Score', () => ({ coins: 0,",
          "export const Score = resource('Score', () => ({ jumps: 0, coins: 0,",
        ],
        [
          "    if (p.grounded && wasPressed(w, 'jump')) body.velocity.y = p.jump;",
          "    if (p.grounded && wasPressed(w, 'jump')) {\n      body.velocity.y = p.jump;\n      w.resource(Score).jumps++;\n    }",
        ],
      ],
      tess: [
        ['resource Score { int coins;', 'resource Score { int jumps; int coins;'],
        [
          '    if (p.grounded && pressed("jump")) body.velocity.y = p.jump;',
          '    if (p.grounded && pressed("jump")) {\n        body.velocity.y = p.jump;\n        score.jumps++;\n    }',
        ],
      ],
    },
  },
  {
    id: 'combo',
    game: 'arena',
    prompt:
      'Add int fields `combo` and `bestCombo` to the Game resource. Each enemy kill increments combo; losing a life resets combo to 0; bestCombo keeps the highest combo reached.',
    oracle: {
      ts: [
        [
          '({ lives: 3, kills: 0, over: false })',
          '({ lives: 3, kills: 0, over: false, combo: 0, bestCombo: 0 })',
        ],
        [
          '          game.kills++;',
          '          game.kills++;\n          game.combo++;\n          game.bestCombo = Math.max(game.bestCombo, game.combo);',
        ],
        [
          '        game.lives = Math.max(game.lives - 1, 0);',
          '        game.lives = Math.max(game.lives - 1, 0);\n        game.combo = 0;',
        ],
      ],
      tess: [
        [
          'resource Game { int lives = 3; int kills; bool over; }',
          'resource Game { int lives = 3; int kills; bool over; int combo; int bestCombo; }',
        ],
        [
          '                game.kills++;',
          '                game.kills++;\n                game.combo++;\n                game.bestCombo = max(game.bestCombo, game.combo);',
        ],
        [
          '            game.lives = max(game.lives - 1, 0);',
          '            game.lives = max(game.lives - 1, 0);\n            game.combo = 0;',
        ],
      ],
    },
  },
  {
    id: 'invulnerable',
    game: 'arena',
    prompt:
      'After losing a life the player is invulnerable for 1 second (60 frames): enemies touching the player during that time are still destroyed but cost no life.',
    oracle: {
      ts: [
        [
          '({ lives: 3, kills: 0, over: false })',
          '({ lives: 3, kills: 0, over: false, lastHit: -1000 })',
        ],
        [
          '        w.destroy(e);\n        game.lives = Math.max(game.lives - 1, 0);\n        game.over = game.lives === 0;',
          '        w.destroy(e);\n        if (w.frame - game.lastHit >= 60) {\n          game.lastHit = w.frame;\n          game.lives = Math.max(game.lives - 1, 0);\n          game.over = game.lives === 0;\n        }',
        ],
      ],
      tess: [
        [
          'resource Game { int lives = 3; int kills; bool over; }',
          'resource Game { int lives = 3; int kills; bool over; int lastHit = -1000; }',
        ],
        [
          '            destroy(e);\n            game.lives = max(game.lives - 1, 0);\n            game.over = game.lives == 0;',
          '            destroy(e);\n            if (frame - game.lastHit >= 60) {\n                game.lastHit = frame;\n                game.lives = max(game.lives - 1, 0);\n                game.over = game.lives == 0;\n            }',
        ],
      ],
    },
  },
];
