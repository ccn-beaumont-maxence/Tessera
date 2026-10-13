import { World } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { addInput, axis, isDown, pointer, press, release, wasPressed, wasReleased } from './index';

const setup = () => {
  const w = new World();
  addInput(w, {
    jump: ['Space', 'PadA'],
    move: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], stick: 'PadLeft' },
  });
  return w;
};

describe('input', () => {
  it('tracks press edges per step', () => {
    const w = setup();
    press(w, 'jump');
    w.step();
    expect([isDown(w, 'jump'), wasPressed(w, 'jump')]).toEqual([true, true]);
    w.step();
    expect([isDown(w, 'jump'), wasPressed(w, 'jump')]).toEqual([true, false]);
    release(w, 'Space');
    w.step();
    expect([isDown(w, 'jump'), wasReleased(w, 'jump')]).toEqual([false, true]);
    w.step();
    expect(wasReleased(w, 'jump')).toBe(false);
  });

  it('combines keys into a normalized axis', () => {
    const w = setup();
    expect(axis(w, 'move')).toEqual({ x: 0, y: 0 });
    press(w, 'KeyD');
    press(w, 'KeyW');
    w.step();
    expect(axis(w, 'move').x).toBeCloseTo(Math.SQRT1_2);
    expect(axis(w, 'move').y).toBeCloseTo(Math.SQRT1_2);
    expect(isDown(w, 'move')).toBe(true);
    press(w, 'move');
    release(w, 'KeyW');
    w.step();
    expect(axis(w, 'move')).toEqual({ x: 1, y: 0 });
    expect(pointer(w)).toEqual({ x: 0, y: 0 });
  });

  it('explains mistakes', () => {
    const w = setup();
    expect(() => isDown(w, 'jmp')).toThrow('unknown action "jmp" (defined: jump, move)');
    expect(() => isDown(new World(), 'x')).toThrow('none; call addInput first');
    expect(() => addInput(new World(), { bad: 'Space' as never })).toThrow('action "bad" must be');
    const v = new World();
    addInput(v, { empty: [] });
    expect(() => press(v, 'empty')).toThrow('has no button');
  });
});
