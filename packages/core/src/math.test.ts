import { describe, expect, it } from 'vitest';
import { color, mat4, quat, vec2, vec3 } from './math';

const close = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b)) expect((a as Record<string, number>)[k]).toBeCloseTo(v);
};

describe('vec2', () => {
  it('does arithmetic', () => {
    expect(vec2()).toEqual({ x: 0, y: 0 });
    expect(vec2.add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(vec2.sub(vec2(1, 2), vec2(3, 4))).toEqual({ x: -2, y: -2 });
    expect(vec2.scale(vec2(1, 2), 2)).toEqual({ x: 2, y: 4 });
    expect(vec2.lerp(vec2(0, 0), vec2(2, 4), 0.5)).toEqual({ x: 1, y: 2 });
    expect(vec2.copy(vec2(1, 2))).toEqual({ x: 1, y: 2 });
    expect(vec2.dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(vec2.len(vec2(3, 4))).toBe(5);
    expect(vec2.dist(vec2(1, 1), vec2(4, 5))).toBe(5);
    expect(vec2.normalize(vec2(3, 4))).toEqual({ x: 0.6, y: 0.8 });
    expect(vec2.normalize(vec2())).toEqual({ x: 0, y: 0 });
  });

  it('writes into out without allocating, even when aliased', () => {
    const a = vec2(1, 2);
    expect(vec2.add(a, a, a)).toBe(a);
    expect(a).toEqual({ x: 2, y: 4 });
  });
});

describe('vec3', () => {
  it('does arithmetic', () => {
    expect(vec3.add(vec3(1, 2, 3), vec3(1, 1, 1))).toEqual({ x: 2, y: 3, z: 4 });
    expect(vec3.sub(vec3(1, 2, 3), vec3(1, 1, 1))).toEqual({ x: 0, y: 1, z: 2 });
    expect(vec3.scale(vec3(1, 2, 3), 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(vec3.lerp(vec3(), vec3(2, 4, 6), 0.5)).toEqual({ x: 1, y: 2, z: 3 });
    expect(vec3.copy(vec3(1, 2, 3))).toEqual({ x: 1, y: 2, z: 3 });
    expect(vec3.dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
    expect(vec3.len(vec3(2, 3, 6))).toBe(7);
    expect(vec3.dist(vec3(), vec3(2, 3, 6))).toBe(7);
    close(vec3.normalize(vec3(0, 0, 5)), { x: 0, y: 0, z: 1 });
    expect(vec3.normalize(vec3())).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('crosses with right-handed axes, alias-safe', () => {
    const x = vec3(1, 0, 0);
    expect(vec3.cross(x, vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    expect(vec3.cross(x, vec3(0, 1, 0), x)).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('quat', () => {
  it('rotates vectors', () => {
    const q = quat.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    // Yaw +90° turns forward (-Z) to -X.
    close(quat.rotate(q, vec3(0, 0, -1)), { x: -1, y: 0, z: 0 });
    close(quat.fromEuler(0, Math.PI / 2, 0), q);
  });

  it('multiplies, conjugates, normalizes', () => {
    const a = quat.fromAxisAngle(vec3(0, 0, 1), Math.PI / 4);
    const twice = quat.multiply(a, a);
    close(twice, quat.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2));
    close(quat.multiply(a, quat.conjugate(a)), quat());
    close(quat.normalize(quat(0, 0, 0, 2)), quat());
    expect(quat.normalize(quat(0, 0, 0, 0))).toEqual(quat());
    expect(quat.copy(a)).toEqual(a);
    close(quat.multiply(a, a, a), twice);
  });

  it('slerps along the short path', () => {
    const a = quat();
    const b = quat.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    close(quat.slerp(a, b, 0.5), quat.fromAxisAngle(vec3(0, 1, 0), Math.PI / 4));
    const negB = quat(-b.x, -b.y, -b.z, -b.w);
    close(quat.slerp(a, negB, 0.5), quat.fromAxisAngle(vec3(0, 1, 0), Math.PI / 4));
    close(quat.slerp(a, a, 0.3), a);
  });
});

describe('mat4', () => {
  it('composes and transforms points', () => {
    const m = mat4.compose(
      vec3(1, 2, 3),
      quat.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
      vec3(2, 2, 2),
    );
    close(mat4.transformPoint(m, vec3(0, 0, -1)), { x: -1, y: 2, z: 3 });
  });

  it('multiplies, alias-safe', () => {
    const t = mat4.compose(vec3(1, 0, 0), quat(), vec3(1, 1, 1));
    const s = mat4.compose(vec3(), quat(), vec3(2, 2, 2));
    // Scale then translate.
    const ts = mat4.multiply(t, s);
    close(mat4.transformPoint(ts, vec3(1, 1, 1)), { x: 3, y: 2, z: 2 });
    expect(mat4.multiply(t, s, t)).toEqual(ts);
    expect(mat4.multiply(mat4(), ts)).toEqual(ts);
  });
});

describe('color', () => {
  it('parses hex and lerps', () => {
    expect(color()).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(color.hex('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(color.hex(0x0000ff)).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    expect(() => color.hex('nope')).toThrow('invalid hex color');
    expect(color.lerp(color(0, 0, 0, 0), color(1, 1, 1, 1), 0.5)).toEqual(
      color(0.5, 0.5, 0.5, 0.5),
    );
  });
});
