import { color, component, type Game, mut, system, Transform2D, vec2 } from '@tessera/core';
import { Camera2D, Sprite, SpriteAnimate, SpriteAnimation } from '@tessera/render';

const Patrol = component('Patrol', () => ({ speed: 2, range: 3 }));

const PatrolMove = system(
  'PatrolMove',
  [mut(Transform2D), mut(Sprite), Patrol],
  (w, _e, t, s, p) => {
    t.position.x = Math.sin((w.time * p.speed) / p.range) * p.range;
    s.flipX = Math.cos((w.time * p.speed) / p.range) < 0;
  },
);

export default {
  dimension: '2d',
  setup(world) {
    const cam = world.spawn('Camera');
    world.add(cam, Transform2D, { position: vec2(0, 2) });
    world.add(cam, Camera2D, { height: 8 });

    const ground = world.spawn('Ground');
    world.add(ground, Transform2D, { position: vec2(0, -0.5) });
    world.add(ground, Sprite, { size: vec2(20, 1), color: color.hex('#3a7d44') });

    const sky = world.spawn('Sun');
    world.add(sky, Transform2D, { position: vec2(4, 4.5) });
    world.add(sky, Sprite, { size: vec2(1.2, 1.2), color: color.hex('#ffd166'), layer: -1 });

    const hero = world.spawn('Hero');
    world.add(hero, Transform2D, { position: vec2(0, 0.8), scale: vec2(1, 1) });
    world.add(hero, Sprite, {
      image: new URL('./assets/hero.png', import.meta.url).href,
      pixelsPerUnit: 10,
      columns: 4,
      layer: 1,
    });
    world.add(hero, SpriteAnimation, { frames: [0, 1, 2, 1], fps: 6 });
    world.add(hero, Patrol);

    world.addSystem(PatrolMove, SpriteAnimate);
  },
} satisfies Game;
