import { component, mut, system } from './world';

/**
 * Counts `time` up to `duration` seconds. `done` turns true on the step it elapses: it then
 * stops (restart: time = 0, done = false), or with `repeat` starts over and `done` lasts one
 * step. With `destroy` the entity is destroyed instead.
 */
export const Timer = component('Timer', () => ({
  duration: 1,
  time: 0,
  repeat: false,
  destroy: false,
  done: false,
}));

/** Advances every Timer; scenes run it right after Input. */
export const Timers = system('Timers', [mut(Timer)], (w, e, t) => {
  if (t.done && !t.repeat) return;
  t.done = false;
  t.time += w.dt;
  // Epsilon: 72 steps of 1/60 must reach 1.2 despite float rounding.
  if (t.time < t.duration - 1e-9) return;
  t.done = true;
  if (t.destroy) w.destroy(e);
  else if (t.repeat) t.time -= t.duration;
});

const EASE: Record<string, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => t * (2 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outBounce: (t) => {
    const n = 7.5625;
    if (t < 1 / 2.75) return n * t * t;
    if (t < 2 / 2.75) return n * (t - 1.5 / 2.75) ** 2 + 0.75;
    if (t < 2.5 / 2.75) return n * (t - 2.25 / 2.75) ** 2 + 0.9375;
    return n * (t - 2.625 / 2.75) ** 2 + 0.984375;
  },
};

/** Easing curve over t in [0, 1] (clamped): linear, in, out, inOut, outBack, outBounce. */
export function ease(kind: string, t: number): number {
  const f = EASE[kind];
  if (!f) throw new Error(`ease: unknown kind "${kind}" (use ${Object.keys(EASE).join(', ')})`);
  return f(t <= 0 ? 0 : t >= 1 ? 1 : t);
}
