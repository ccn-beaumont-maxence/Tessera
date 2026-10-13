import { component, mut, resource, system, Transform2D } from '@tessera/core';
import { axis, wasPressed } from '@tessera/input';
import { Collision, RigidBody, raycast } from '@tessera/physics';

export const Player = component('Player', () => ({ speed: 5, jump: 8 }));
export const Coin = component('Coin', () => ({ value: 1 }));
export const Score = resource('Score', () => ({ value: 0 }));

export const PlayerControl = system('PlayerControl', [mut(RigidBody), Player], (w, e, body, p) => {
  body.velocity.x = axis(w, 'move').x * p.speed;
  const t = w.get(e, Transform2D);
  const grounded = t && raycast(w, t.position, { x: 0, y: -1 }, 0.55, { exclude: e });
  if (grounded && wasPressed(w, 'jump')) body.velocity.y = p.jump;
});

export const Collect = system(
  'Collect',
  [Player],
  (w, e) => {
    for (const c of w.events(Collision)) {
      const coin = c.a === e ? c.b : c.b === e ? c.a : -1;
      const value = w.get(coin, Coin)?.value;
      if (!c.started || value === undefined) continue;
      w.resource(Score).value += value;
      w.destroy(coin);
    }
  },
  { reads: [Coin], writes: [Score] },
);
