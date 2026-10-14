import { color, component, mut, system, vec2, vec3 } from '@tessera/core';

/**
 * Primitive 3D shape sized in meters (sphere/capsule/cylinder use size.x as diameter),
 * or a glTF `model` URL (size then scales the model; color/roughness/metalness are ignored).
 */
export const Mesh = component('Mesh', () => ({
  shape: 'box' as 'box' | 'sphere' | 'plane' | 'capsule' | 'cylinder',
  size: vec3(1, 1, 1),
  color: color(),
  roughness: 0.8,
  metalness: 0,
  model: '',
}));

/** Lights shine along the entity's forward (-Z) when directional. */
export const Light = component('Light', () => ({
  kind: 'directional' as 'directional' | 'point' | 'ambient',
  color: color(),
  intensity: 1,
}));

export const Camera3D = component('Camera3D', () => ({ fov: 60, near: 0.1, far: 1000 }));

/** Orthographic camera; `height` is the visible world height in meters. */
export const Camera2D = component('Camera2D', () => ({ height: 10 }));

/**
 * 2D sprite. With `image`, its size is the frame size in pixels / pixelsPerUnit;
 * without, it draws a `size` quad tinted by `color`. Higher `layer` draws on top.
 */
export const Sprite = component('Sprite', () => ({
  image: '',
  size: vec2(1, 1),
  color: color(),
  pixelsPerUnit: 100,
  layer: 0,
  columns: 1,
  rows: 1,
  frame: 0,
  flipX: false,
}));

/**
 * Text, `size` = line height. In the world it uses Transform2D or Transform3D (facing +Z).
 * `screen: true` draws it over everything: Transform2D position in [-1, 1] (y up, corners at
 * ±1), size in tenths of the screen height. Lines split on `\n`.
 */
export const Text = component('Text', () => ({
  text: '',
  size: 0.5,
  color: color(),
  align: 'center' as 'left' | 'center' | 'right',
  layer: 0,
  screen: false,
}));

/** Plays spritesheet frames (indices, row-major from top-left) at `fps`. */
export const SpriteAnimation = component('SpriteAnimation', () => ({
  frames: [0] as number[],
  fps: 10,
  loop: true,
  time: 0,
}));

export const SpriteAnimate = system(
  'SpriteAnimate',
  [mut(Sprite), mut(SpriteAnimation)],
  (w, _e, sprite, anim) => {
    anim.time += w.dt;
    const n = anim.frames.length;
    const i = Math.floor(anim.time * anim.fps);
    sprite.frame = anim.frames[anim.loop ? i % n : Math.min(i, n - 1)] ?? 0;
  },
);

/**
 * Plays an animation clip of the entity's glTF `Mesh.model` ('' = its first clip), posed from
 * `time` (advanced by the simulation, so it stays deterministic and inspectable).
 */
export const Animator = component('Animator', () => ({
  clip: '',
  speed: 1,
  loop: true,
  time: 0,
}));

export const Animate = system('Animate', [mut(Animator)], (w, _e, a) => {
  a.time += w.dt * a.speed;
});
