import {
  component,
  type Entity,
  mut,
  resource,
  system,
  Transform2D,
  vec2,
  type World,
} from '@tessera/core';
import { axis, wasPressed } from '@tessera/input';
import { Collision, RigidBody, raycast } from '@tessera/physics';
import { Camera2D, Sprite } from '@tessera/render';

export const Player = component('Player', () => ({
  speed: 6,
  jump: 11,
  spawn: vec2(),
  grounded: false,
}));
export const Enemy = component('Enemy', () => ({
  speed: 2,
  range: 2,
  dir: 1,
  startX: 0,
  ready: false,
}));
export const Coin = component('Coin', () => ({ value: 1 }));
export const Goal = component('Goal', () => ({}));
export const Follow = component('Follow', () => ({ minY: 2.5 }));
export const Score = resource('Score', () => ({ coins: 0, stomps: 0, deaths: 0, won: false }));

const FALL_LIMIT = -10;

function respawn(w: World, e: Entity): void {
  const t = w.get(e, Transform2D);
  const body = w.get(e, RigidBody);
  const p = w.get(e, Player);
  if (!t || !body || !p) return;
  vec2.copy(p.spawn, t.position);
  body.velocity.x = 0;
  body.velocity.y = 0;
  w.resource(Score).deaths++;
}

export const PlayerMove = system(
  'PlayerMove',
  [mut(RigidBody), mut(Player), Transform2D, mut(Sprite)],
  (w, e, body, p, t, sprite) => {
    p.grounded = raycast(w, t.position, { x: 0, y: -1 }, 0.6, { exclude: e }) !== null;
    const x = axis(w, 'move').x;
    body.velocity.x = x * p.speed;
    if (x !== 0) sprite.flipX = x < 0;
    if (p.grounded && wasPressed(w, 'jump')) body.velocity.y = p.jump;
    if (t.position.y < FALL_LIMIT) respawn(w, e);
  },
  { reads: [Score], writes: [Transform2D, Score] },
);

export const EnemyPatrol = system(
  'EnemyPatrol',
  [mut(RigidBody), mut(Enemy), Transform2D],
  (_w, _e, body, en, t) => {
    if (!en.ready) {
      en.startX = t.position.x;
      en.ready = true;
    }
    if (t.position.x > en.startX + en.range) en.dir = -1;
    if (t.position.x < en.startX - en.range) en.dir = 1;
    body.velocity.x = en.dir * en.speed;
  },
);

export const Contacts = system(
  'Contacts',
  [Player, Transform2D, mut(RigidBody)],
  (w, e, p, t, body) => {
    const score = w.resource(Score);
    for (const c of w.events(Collision)) {
      if (!c.started) continue;
      const other = c.a === e ? c.b : c.b === e ? c.a : -1;
      if (other < 0 || !w.alive(other)) continue;
      const coin = w.get(other, Coin);
      if (coin) {
        score.coins += coin.value;
        w.destroy(other);
      } else if (w.has(other, Enemy)) {
        const enemyY = w.get(other, Transform2D)?.position.y ?? 0;
        if (t.position.y > enemyY + 0.4) {
          w.destroy(other);
          score.stomps++;
          body.velocity.y = p.jump * 0.7;
        } else {
          respawn(w, e);
        }
      } else if (w.has(other, Goal)) {
        score.won = true;
      }
    }
  },
  { writes: [Score], reads: [Coin, Enemy, Goal] },
);

export const CameraFollow = system(
  'CameraFollow',
  [mut(Transform2D), Follow, Camera2D],
  (w, _e, cam, f) => {
    w.each([Player, Transform2D], (_p, _player, t) => {
      cam.position.x = t.position.x;
      cam.position.y = Math.max(t.position.y, f.minY);
    });
  },
);
