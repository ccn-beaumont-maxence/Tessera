import { quat, vec2, vec3 } from './math';
import { component } from './world';

/** 2D transform: Y up, rotation in radians (counter-clockwise), 1 unit = 1 m. */
export const Transform2D = component('Transform2D', () => ({
  position: vec2(),
  rotation: 0,
  scale: vec2(1, 1),
}));

/** 3D transform: Y up, right-handed, forward is -Z. */
export const Transform3D = component('Transform3D', () => ({
  position: vec3(),
  rotation: quat(),
  scale: vec3(1, 1, 1),
}));
