import { resource, type Vec2, vec2, type World } from '@tessera/core';

/**
 * Button action: list of buttons, e.g. `jump: [Space, KeyW, PadA]`.
 * Axis action: `move: { left: [KeyA], right: [KeyD], up: [KeyW], down: [KeyS], stick: PadLeft }`.
 * Buttons are KeyboardEvent.code names, MouseLeft/MouseRight/MouseMiddle (touch = MouseLeft),
 * or PadA/PadB/PadX/PadY/PadLB/PadRB/PadLT/PadRT/PadBack/PadStart/PadUp/PadDown/PadLeft/PadRight.
 */
export type Bindings = Record<string, string[] | AxisBinding>;
export interface AxisBinding {
  left?: string[];
  right?: string[];
  up?: string[];
  down?: string[];
  stick?: 'PadLeft' | 'PadRight';
}

const InputState = resource(
  'Input',
  () => ({
    bindings: {} as Bindings,
    /** Raw buttons currently held (written by DOM listeners or `press`). */
    buttons: new Set<string>(),
    sticks: { PadLeft: vec2(), PadRight: vec2() },
    /** Pointer in normalized device coordinates: (-1,-1) bottom-left, (1,1) top-right. */
    pointer: vec2(),
    /** Viewport width / height (pointer NDC to world); 16:9 headless. */
    aspect: 16 / 9,
    down: new Set<string>(),
    prev: new Set<string>(),
    axes: new Map<string, Vec2>(),
  }),
  { internal: true },
);

const PAD_BUTTONS = [
  'PadA',
  'PadB',
  'PadX',
  'PadY',
  'PadLB',
  'PadRB',
  'PadLT',
  'PadRT',
  'PadBack',
  'PadStart',
  '',
  '',
  'PadUp',
  'PadDown',
  'PadLeft',
  'PadRight',
];
const MOUSE = ['MouseLeft', 'MouseMiddle', 'MouseRight'];
const DEADZONE = 0.2;

/** Declares actions and schedules the `Input` system (add it before gameplay systems). */
export function addInput(world: World, bindings: Bindings): void {
  for (const [name, b] of Object.entries(bindings)) {
    if (!Array.isArray(b) && (typeof b !== 'object' || b === null)) {
      throw new Error(
        `input: action "${name}" must be a list of buttons or {left,right,up,down,stick}`,
      );
    }
  }
  const s = world.resource(InputState);
  s.bindings = bindings;
  world.addSystem({ name: 'Input', reads: [], writes: [InputState], run: update });
  if (typeof window !== 'undefined' && !attached.has(s)) attach(world);
  attached.add(s);
}

/** Input states already listening to the DOM (a scene change calls addInput again). */
const attached = new WeakSet<object>();

function update(world: World): void {
  const s = world.resource(InputState);
  pollGamepad(s);
  const prev = s.prev;
  s.prev = s.down;
  s.down = prev;
  s.down.clear();
  const any = (list: string[] | undefined) => list?.some((b) => s.buttons.has(b)) ?? false;
  for (const [name, b] of Object.entries(s.bindings)) {
    if (Array.isArray(b)) {
      if (any(b)) s.down.add(name);
      continue;
    }
    let a = s.axes.get(name);
    if (!a) {
      a = vec2();
      s.axes.set(name, a);
    }
    a.x = (any(b.right) ? 1 : 0) - (any(b.left) ? 1 : 0);
    a.y = (any(b.up) ? 1 : 0) - (any(b.down) ? 1 : 0);
    if (b.stick && a.x === 0 && a.y === 0) vec2.copy(s.sticks[b.stick], a);
    const len = vec2.len(a);
    if (len > 1) vec2.scale(a, 1 / len, a);
    if (len > 0) s.down.add(name);
  }
}

function action(world: World, name: string) {
  const s = world.resource(InputState);
  if (!(name in s.bindings)) {
    const known = Object.keys(s.bindings).join(', ') || 'none; call addInput first';
    throw new Error(`input: unknown action "${name}" (defined: ${known})`);
  }
  return s;
}

/** True while the action is held (axis actions: while non-zero). */
export const isDown = (world: World, name: string): boolean => action(world, name).down.has(name);

/** True only on the step the action went down. */
export function wasPressed(world: World, name: string): boolean {
  const s = action(world, name);
  return s.down.has(name) && !s.prev.has(name);
}

/** True only on the step the action was let go. */
export function wasReleased(world: World, name: string): boolean {
  const s = action(world, name);
  return !s.down.has(name) && s.prev.has(name);
}

const ZERO: Readonly<Vec2> = Object.freeze(vec2());

/** Axis action value, length <= 1, y up. Read-only. */
export function axis(world: World, name: string): Readonly<Vec2> {
  return action(world, name).axes.get(name) ?? ZERO;
}

/** Pointer position in normalized device coordinates. Read-only. */
export const pointer = (world: World): Readonly<Vec2> => world.resource(InputState).pointer;

/** Viewport width / height. */
export const aspect = (world: World): number => world.resource(InputState).aspect;

/** Holds a raw button, or the first button bound to an action (headless tests, replays). */
export function press(world: World, buttonOrAction: string): void {
  world.resource(InputState).buttons.add(firstButton(world, buttonOrAction));
}

export function release(world: World, buttonOrAction: string): void {
  world.resource(InputState).buttons.delete(firstButton(world, buttonOrAction));
}

function firstButton(world: World, name: string): string {
  const b = world.resource(InputState).bindings[name];
  if (!b) return name;
  const first = Array.isArray(b) ? b[0] : (b.right ?? b.up ?? b.left ?? b.down)?.[0];
  if (!first) throw new Error(`input: action "${name}" has no button to press`);
  return first;
}

type State = ReturnType<typeof InputState.create>;

function pollGamepad(s: State): void {
  const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
  const pad = pads?.find((p) => p);
  if (!pad) return;
  pad.buttons.forEach((b, i) => {
    const name = PAD_BUTTONS[i];
    if (!name) return;
    if (b.pressed) s.buttons.add(name);
    else s.buttons.delete(name);
  });
  const stick = (out: Vec2, ix: number) => {
    const x = pad.axes[ix] ?? 0;
    const y = -(pad.axes[ix + 1] ?? 0);
    const dead = Math.hypot(x, y) < DEADZONE;
    out.x = dead ? 0 : x;
    out.y = dead ? 0 : y;
  };
  stick(s.sticks.PadLeft, 0);
  stick(s.sticks.PadRight, 2);
}

function attach(world: World): void {
  const s = world.resource(InputState);
  const bound = () => {
    const set = new Set<string>();
    for (const b of Object.values(s.bindings)) {
      for (const list of Array.isArray(b) ? [b] : [b.left, b.right, b.up, b.down]) {
        for (const k of list ?? []) set.add(k);
      }
    }
    return set;
  };
  window.addEventListener('keydown', (e) => {
    if (bound().has(e.code)) e.preventDefault();
    s.buttons.add(e.code);
  });
  window.addEventListener('keyup', (e) => s.buttons.delete(e.code));
  window.addEventListener('pointerdown', (e) => s.buttons.add(MOUSE[e.button] ?? 'MouseLeft'));
  window.addEventListener('pointerup', (e) => s.buttons.delete(MOUSE[e.button] ?? 'MouseLeft'));
  window.addEventListener('pointermove', (e) => {
    s.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    s.pointer.y = 1 - (e.clientY / window.innerHeight) * 2;
  });
  const resize = () => {
    s.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  };
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => s.buttons.clear());
}
