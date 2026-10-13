// Value types are plain objects. Every op takes an optional `out`: pass one in hot loops
// to avoid allocation; `out` may alias an input.

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}
/** Column-major 4x4 matrix (three.js layout). */
export type Mat4 = number[];

const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const vec2 = Object.assign(v2, {
  copy: (a: Vec2, out = v2()) => set2(out, a.x, a.y),
  add: (a: Vec2, b: Vec2, out = v2()) => set2(out, a.x + b.x, a.y + b.y),
  sub: (a: Vec2, b: Vec2, out = v2()) => set2(out, a.x - b.x, a.y - b.y),
  scale: (a: Vec2, s: number, out = v2()) => set2(out, a.x * s, a.y * s),
  lerp: (a: Vec2, b: Vec2, t: number, out = v2()) =>
    set2(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
  dot: (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y,
  len: (a: Vec2) => Math.hypot(a.x, a.y),
  dist: (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y),
  normalize: (a: Vec2, out = v2()) => {
    const l = Math.hypot(a.x, a.y);
    return l > 0 ? set2(out, a.x / l, a.y / l) : set2(out, 0, 0);
  },
});

function set2(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vec3 = Object.assign(v3, {
  copy: (a: Vec3, out = v3()) => set3(out, a.x, a.y, a.z),
  add: (a: Vec3, b: Vec3, out = v3()) => set3(out, a.x + b.x, a.y + b.y, a.z + b.z),
  sub: (a: Vec3, b: Vec3, out = v3()) => set3(out, a.x - b.x, a.y - b.y, a.z - b.z),
  scale: (a: Vec3, s: number, out = v3()) => set3(out, a.x * s, a.y * s, a.z * s),
  lerp: (a: Vec3, b: Vec3, t: number, out = v3()) =>
    set3(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
  cross: (a: Vec3, b: Vec3, out = v3()) =>
    set3(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x),
  dot: (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z,
  len: (a: Vec3) => Math.hypot(a.x, a.y, a.z),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  normalize: (a: Vec3, out = v3()) => {
    const l = Math.hypot(a.x, a.y, a.z);
    return l > 0 ? set3(out, a.x / l, a.y / l, a.z / l) : set3(out, 0, 0, 0);
  },
});

function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

const q = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });
export const quat = Object.assign(q, {
  copy: (a: Quat, out = q()) => setQ(out, a.x, a.y, a.z, a.w),
  fromAxisAngle: (axis: Vec3, rad: number, out = q()) => {
    const s = Math.sin(rad / 2);
    return setQ(out, axis.x * s, axis.y * s, axis.z * s, Math.cos(rad / 2));
  },
  /** Euler angles in radians, XYZ order (three.js default). */
  fromEuler: (x: number, y: number, z: number, out = q()) => {
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);
    return setQ(
      out,
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    );
  },
  multiply: (a: Quat, b: Quat, out = q()) =>
    setQ(
      out,
      a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
      a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
      a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
      a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    ),
  conjugate: (a: Quat, out = q()) => setQ(out, -a.x, -a.y, -a.z, a.w),
  normalize: (a: Quat, out = q()) => {
    const l = Math.hypot(a.x, a.y, a.z, a.w);
    return l > 0 ? setQ(out, a.x / l, a.y / l, a.z / l, a.w / l) : setQ(out, 0, 0, 0, 1);
  },
  /** Rotates vector `v` by unit quaternion `a`. */
  rotate: (a: Quat, v: Vec3, out = v3()) => {
    const tx = 2 * (a.y * v.z - a.z * v.y);
    const ty = 2 * (a.z * v.x - a.x * v.z);
    const tz = 2 * (a.x * v.y - a.y * v.x);
    return set3(
      out,
      v.x + a.w * tx + a.y * tz - a.z * ty,
      v.y + a.w * ty + a.z * tx - a.x * tz,
      v.z + a.w * tz + a.x * ty - a.y * tx,
    );
  },
  slerp: (a: Quat, b: Quat, t: number, out = q()) => {
    let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    const sign = cos < 0 ? -1 : 1;
    cos *= sign;
    let wa = 1 - t;
    let wb = t * sign;
    if (cos < 0.9995) {
      const theta = Math.acos(cos);
      const sin = Math.sin(theta);
      wa = Math.sin((1 - t) * theta) / sin;
      wb = (Math.sin(t * theta) / sin) * sign;
    }
    return quat.normalize(
      setQ(out, a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb, a.w * wa + b.w * wb),
      out,
    );
  },
});

function setQ(out: Quat, x: number, y: number, z: number, w: number): Quat {
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

const m4 = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const mat4 = Object.assign(m4, {
  multiply: (a: Mat4, b: Mat4, out = m4()) => {
    // Computed into a scratch matrix so `out` may alias `a` or `b`.
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
        scratch[c * 4 + r] = s;
      }
    }
    for (let i = 0; i < 16; i++) out[i] = scratch[i] as number;
    return out;
  },
  compose: (pos: Vec3, rot: Quat, scl: Vec3, out = m4()) => {
    const { x, y, z, w } = rot;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    out[0] = (1 - (yy + zz)) * scl.x;
    out[1] = (xy + wz) * scl.x;
    out[2] = (xz - wy) * scl.x;
    out[3] = 0;
    out[4] = (xy - wz) * scl.y;
    out[5] = (1 - (xx + zz)) * scl.y;
    out[6] = (yz + wx) * scl.y;
    out[7] = 0;
    out[8] = (xz + wy) * scl.z;
    out[9] = (yz - wx) * scl.z;
    out[10] = (1 - (xx + yy)) * scl.z;
    out[11] = 0;
    out[12] = pos.x;
    out[13] = pos.y;
    out[14] = pos.z;
    out[15] = 1;
    return out;
  },
  transformPoint: (m: Mat4, p: Vec3, out = v3()) => {
    const { x, y, z } = p;
    return set3(
      out,
      (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
      (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
      (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
    );
  },
});
const scratch = m4();

const c = (r = 1, g = 1, b = 1, a = 1): Color => ({ r, g, b, a });
export const color = Object.assign(c, {
  /** `color.hex('#ff8800')` or `color.hex(0xff8800)`; channels in 0..1. */
  hex: (hex: string | number, out = c()) => {
    const n = typeof hex === 'number' ? hex : Number.parseInt(hex.replace('#', ''), 16);
    if (!Number.isFinite(n)) throw new Error(`color.hex: invalid hex color "${hex}"`);
    out.r = ((n >> 16) & 255) / 255;
    out.g = ((n >> 8) & 255) / 255;
    out.b = (n & 255) / 255;
    out.a = 1;
    return out;
  },
  lerp: (a: Color, b: Color, t: number, out = c()) => {
    out.r = a.r + (b.r - a.r) * t;
    out.g = a.g + (b.g - a.g) * t;
    out.b = a.b + (b.b - a.b) * t;
    out.a = a.a + (b.a - a.a) * t;
    return out;
  },
});
