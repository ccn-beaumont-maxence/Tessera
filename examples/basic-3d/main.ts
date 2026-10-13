import { color, component, type Game, mut, quat, system, Transform3D, vec3 } from '@tessera/core';
import { Camera3D, Light, Mesh } from '@tessera/render';

const Spin = component('Spin', () => ({ speed: 1 }));

const SpinAround = system('SpinAround', [mut(Transform3D), Spin], (w, _e, t, s) => {
  quat.fromEuler(w.time * s.speed * 0.5, w.time * s.speed, 0, t.rotation);
});

export default {
  dimension: '3d',
  setup(world) {
    const cam = world.spawn('Camera');
    world.add(cam, Transform3D, {
      position: vec3(0, 3, 7),
      rotation: quat.fromEuler(-0.35, 0, 0),
    });
    world.add(cam, Camera3D);

    const sun = world.spawn('Sun');
    world.add(sun, Transform3D, {
      rotation: quat.fromEuler(-0.9, 0.5, 0),
      position: vec3(0, 8, 0),
    });
    world.add(sun, Light, { intensity: 2.5 });
    world.add(world.spawn('Ambient'), Light, { kind: 'ambient', intensity: 0.4 });

    const ground = world.spawn('Ground');
    world.add(ground, Transform3D);
    world.add(ground, Mesh, { shape: 'plane', size: vec3(20, 1, 20), color: color.hex('#556b5d') });

    const cube = world.spawn('Cube');
    world.add(cube, Transform3D, { position: vec3(-1.5, 1, 0) });
    world.add(cube, Mesh, { color: color.hex('#e07a5f') });
    world.add(cube, Spin);

    const ball = world.spawn('Ball');
    world.add(ball, Transform3D, { position: vec3(1.5, 0.75, 0) });
    world.add(ball, Mesh, {
      shape: 'sphere',
      size: vec3(1.5, 1.5, 1.5),
      color: color.hex('#3d85c6'),
      metalness: 0.3,
      roughness: 0.3,
    });

    world.addSystem(SpinAround);
  },
} satisfies Game;
