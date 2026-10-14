import {
  component,
  mut,
  quat,
  resource,
  type System,
  system,
  Transform3D,
  vec3,
} from '@tessera/core';
import { axis, isDown, wasPressed } from '@tessera/input';
import { Collision, RigidBody } from '@tessera/physics';
import { Text } from '@tessera/render';
import { loadScene, spawnPrefab } from '@tessera/scene';

export const Player = component('Player', () => ({
  speed: 6,
  facing: vec3(0, 0, -1),
  fireRate: 0.25,
  cooldown: 0,
}));
export const Enemy = component('Enemy', () => ({ speed: 2.5, hp: 2 }));
export const Bullet = component('Bullet', () => ({ speed: 16 }));
export const Hud = component('Hud', () => ({}));
export const Game = resource('Game', () => ({ lives: 3, kills: 0, over: false }));
export const Spawner = resource('Spawner', () => ({
  interval: 2,
  timer: 1,
  radius: 9,
  minInterval: 0.6,
}));

const UP = vec3(0, 1, 0);

export const PlayerMove = system(
  'PlayerMove',
  [mut(RigidBody), mut(Player), mut(Transform3D)],
  (w, _e, body, p, t) => {
    const a = axis(w, 'move');
    const speed = w.resource(Game).over ? 0 : p.speed;
    body.velocity.x = a.x * speed;
    body.velocity.z = -a.y * speed;
    if (a.x !== 0 || a.y !== 0) vec3.normalize(vec3(a.x, 0, -a.y), p.facing);
    quat.fromAxisAngle(UP, Math.atan2(-p.facing.x, -p.facing.z), t.rotation);
  },
  { reads: [Game] },
);

/** Fires at the nearest enemy (auto-aim), or straight ahead when there is none. */
export const Shoot = system(
  'Shoot',
  [mut(Player), Transform3D],
  (w, _e, p, t) => {
    p.cooldown = Math.max(p.cooldown - w.dt, 0);
    if (w.resource(Game).over || !isDown(w, 'fire') || p.cooldown > 0) return;
    p.cooldown = p.fireRate;
    let dx = p.facing.x;
    let dz = p.facing.z;
    let best = Infinity;
    w.each([Enemy, Transform3D], (_en, _enemy, et) => {
      const ex = et.position.x - t.position.x;
      const ez = et.position.z - t.position.z;
      const d = Math.hypot(ex, ez);
      if (d > 0 && d < best) {
        best = d;
        dx = ex / d;
        dz = ez / d;
      }
    });
    spawnPrefab(w, 'Bullet', {
      Transform3D: { position: [t.position.x + dx * 0.8, 0.6, t.position.z + dz * 0.8] },
      RigidBody: { velocity: [dx * 16, 0, dz * 16] },
    });
  },
  { reads: [Game, Enemy] },
);

export const EnemyChase = system(
  'EnemyChase',
  [mut(RigidBody), Enemy, Transform3D],
  (w, _e, body, en, t) => {
    w.each([Player, Transform3D], (_p, _player, target) => {
      const dx = target.position.x - t.position.x;
      const dz = target.position.z - t.position.z;
      const len = Math.hypot(dx, dz) || 1;
      body.velocity.x = (dx / len) * en.speed;
      body.velocity.z = (dz / len) * en.speed;
    });
  },
);

export const SpawnEnemies = system(
  'SpawnEnemies',
  [Player],
  (w) => {
    const s = w.resource(Spawner);
    if (w.resource(Game).over) return;
    s.timer -= w.dt;
    if (s.timer > 0) return;
    s.timer = s.interval;
    s.interval = Math.max(s.minInterval, s.interval * 0.95);
    const angle = w.rng.range(0, Math.PI * 2);
    spawnPrefab(w, 'Enemy', {
      Transform3D: { position: [Math.cos(angle) * s.radius, 0.6, Math.sin(angle) * s.radius] },
    });
  },
  { writes: [Spawner], reads: [Game] },
);

export const Hits = system(
  'Hits',
  [mut(Enemy)],
  (w, e, en) => {
    const game = w.resource(Game);
    for (const c of w.events(Collision)) {
      if (!c.started) continue;
      const other = c.a === e ? c.b : c.b === e ? c.a : -1;
      if (other < 0 || !w.alive(other) || !w.alive(e)) continue;
      if (w.has(other, Bullet)) {
        w.destroy(other);
        en.hp--;
        if (en.hp <= 0) {
          const t = w.get(e, Transform3D);
          if (t)
            spawnPrefab(w, 'Boom', {
              Transform3D: { position: [t.position.x, t.position.y, t.position.z] },
            });
          w.destroy(e);
          game.kills++;
        }
      } else if (w.has(other, Player)) {
        w.destroy(e);
        game.lives = Math.max(game.lives - 1, 0);
        game.over = game.lives === 0;
      }
    }
  },
  { writes: [Game], reads: [Bullet, Player] },
);

export const ShowScore = system(
  'ShowScore',
  [mut(Text), Hud],
  (w, _e, t) => {
    const g = w.resource(Game);
    t.text = `Lives ${g.lives}  Kills ${g.kills}${g.over ? '\nGame over' : ''}`;
  },
  { reads: [Game] },
);

export const Restart: System = {
  name: 'Restart',
  reads: [Game],
  writes: [],
  run: (w) => {
    if (w.resource(Game).over && wasPressed(w, 'fire')) loadScene(w, 'scene.yaml');
  },
};
