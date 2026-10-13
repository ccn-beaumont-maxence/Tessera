import { type Game, World } from '@tessera/core';
import { Renderer } from './renderer';

export interface StartOptions {
  canvas: HTMLCanvasElement;
  seed?: number;
  /** Simulate exactly this many steps, render once, and stop (screenshots, tests). */
  frames?: number;
}

export interface Running {
  world: World;
  renderer: Renderer;
  /** Resolves after the first frame is drawn with all textures loaded. */
  ready: Promise<void>;
  /** While paused the simulation only advances through `step`. */
  paused: boolean;
  /** Advances exactly `n` fixed steps and redraws (works while paused). */
  step(n?: number): void;
  stop(): void;
}

const MAX_STEPS_PER_FRAME = 5;

/** Runs `game` at a fixed 60 Hz step with interpolated rendering. */
export async function start(game: Game, options: StartOptions): Promise<Running> {
  const world = new World({ seed: options.seed ?? 1 });
  await game.setup(world);
  const renderer = new Renderer(world, options.canvas, game.dimension);
  let raf = 0;
  const running: Running = {
    world,
    renderer,
    ready: Promise.resolve(),
    paused: options.frames !== undefined,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        renderer.capture();
        world.step();
      }
      renderer.render();
    },
    stop: () => cancelAnimationFrame(raf),
  };

  if (options.frames !== undefined) {
    for (let i = 0; i < options.frames; i++) world.step();
    renderer.render();
    running.ready = renderer.ready().then(() => renderer.render());
    return running;
  }

  let last = performance.now();
  let acc = 0;
  const tick = (now: number) => {
    acc += (now - last) / 1000;
    last = now;
    let steps = 0;
    if (running.paused) acc = 0;
    try {
      while (acc >= world.dt && steps < MAX_STEPS_PER_FRAME) {
        renderer.capture();
        world.step();
        acc -= world.dt;
        steps++;
      }
    } catch (err) {
      // Pause on the failing frame so the state can be inspected (tess mcp, devtools).
      running.paused = true;
      console.error(err);
    }
    // Drop backlog after a stall instead of spiralling.
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    renderer.render(acc / world.dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  renderer.render();
  running.ready = renderer.ready();
  return running;
}
