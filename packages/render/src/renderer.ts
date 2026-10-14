import { loaded, loadModel, loadTexture } from '@tessera/assets';
import {
  type Color,
  compose2D,
  compose3D,
  type DeepReadonly,
  type Entity,
  PARTICLE_STRIDE,
  Particles,
  type Pose2D,
  type Pose3D,
  parentOf,
  particlesOf,
  type Quat,
  quat,
  Tilemap,
  type TilemapData,
  Transform2D,
  Transform3D,
  type Vec3,
  vec3,
  type World,
} from '@tessera/core';
import * as THREE from 'three';
import { Camera2D, Camera3D, Light, Mesh, Sprite, Text } from './components';

interface Prev {
  p: Vec3;
  q: Quat;
  /** 2D rotation. */
  a: number;
}
interface Node<T extends THREE.Object3D> {
  obj: T;
  key: string;
  stamp: number;
}
interface SpriteNode extends Node<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>> {
  /** Frame size in pixels once the image is loaded. */
  px: { w: number; h: number } | null;
}
interface TilemapNode extends Node<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>> {
  /** Inputs of the current geometry: rebuilt when one changes. */
  tiles: readonly string[];
  size: number;
  chars: string;
  columns: number;
  rows: number;
}

/** One quad per drawn tile, top-left corner at the origin, UVs picking spritesheet frames. */
function tileGeometry(t: DeepReadonly<TilemapData>): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const s = t.size;
  for (const [r, row] of t.tiles.entries()) {
    for (let c = 0; c < row.length; c++) {
      const f = t.chars.indexOf(row[c] as string);
      if (f < 0) continue;
      const fc = f % t.columns;
      const fr = Math.floor(f / t.columns) % t.rows;
      const u0 = fc / t.columns;
      const u1 = (fc + 1) / t.columns;
      const v0 = 1 - (fr + 1) / t.rows;
      const v1 = 1 - fr / t.rows;
      const i = pos.length / 3;
      pos.push(c * s, -(r + 1) * s, 0, (c + 1) * s, -(r + 1) * s, 0);
      pos.push((c + 1) * s, -r * s, 0, c * s, -r * s, 0);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      index.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

interface ParticleNode
  extends Node<THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>> {
  max: number;
}

interface TextNode extends Node<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>> {
  canvas: HTMLCanvasElement;
  align: string;
  /** Width / height of the drawn text block, and its line count. */
  aspect: number;
  lines: number;
}

/** Canvas pixels per text line. */
const LINE_PX = 64;

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/** Rasterizes white text (tinted by the material); returns width/height and line count. */
function drawText(canvas: HTMLCanvasElement, text: string, align: string) {
  const lines = text.split('\n');
  const font = `bold ${LINE_PX * 0.8}px sans-serif`;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = font;
  const w = Math.ceil(Math.max(1, ...lines.map((l) => ctx.measureText(l).width))) + 4;
  canvas.width = w;
  canvas.height = LINE_PX * lines.length;
  ctx.font = font; // resizing resets the context state
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  const x = align === 'left' ? 2 : align === 'right' ? w - 2 : w / 2;
  for (const [i, l] of lines.entries()) ctx.fillText(l, x, LINE_PX * (i + 0.5));
  return { aspect: w / canvas.height, lines: lines.length };
}

const UNIT: Record<string, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 32, 16),
  plane: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  capsule: () => new THREE.CapsuleGeometry(0.5, 1, 8, 16),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
};

const ORIGIN2 = Transform2D.create();

const setColor = (target: THREE.Color, c: Color) =>
  target.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);

/** Mirrors ECS render components into a three.js scene, interpolating between fixed steps. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private readonly defaultLights = new THREE.Group();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly spriteGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly prev = new Map<Entity, Prev>();
  private readonly meshes = new Map<Entity, Node<THREE.Object3D>>();
  private readonly sprites = new Map<Entity, SpriteNode>();
  private readonly lights = new Map<Entity, Node<THREE.Light>>();
  private readonly texts = new Map<Entity, TextNode>();
  private readonly tilemaps = new Map<Entity, TilemapNode>();
  private readonly particles = new Map<Entity, ParticleNode>();
  private readonly dummy = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  /** Screen-space overlay (Text with `screen: true`), drawn after the scene. */
  private readonly hud = new THREE.Scene();
  private readonly hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  private stamp = 0;
  private readonly w2 = Transform2D.create();
  private readonly up2 = Transform2D.create();
  private readonly w3 = Transform3D.create();
  private readonly up3 = Transform3D.create();
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly world: World,
    canvas: HTMLCanvasElement,
    private readonly dimension: '2d' | '3d',
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(globalThis.devicePixelRatio ?? 1);
    this.gl.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0x1b1d26);
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(5, 10, 7);
    sun.castShadow = true;
    this.defaultLights.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1), sun);
    this.scene.add(this.defaultLights);
    this.perspective.position.set(0, 5, 10);
    this.perspective.lookAt(0, 0, 0);
  }

  /** Snapshot transforms; call right before each `world.step()` so render can interpolate. */
  capture(): void {
    this.world.each([Transform3D], (e, t) => {
      const s = this.prevOf(e);
      vec3.copy(t.position, s.p);
      quat.copy(t.rotation, s.q);
    });
    this.world.each([Transform2D], (e, t) => {
      const s = this.prevOf(e);
      s.p.x = t.position.x;
      s.p.y = t.position.y;
      s.a = t.rotation;
    });
    for (const e of this.prev.keys()) if (!this.world.alive(e)) this.prev.delete(e);
  }

  /** Resolves once every asset requested so far has loaded. */
  async ready(): Promise<void> {
    await loaded();
  }

  /** Draws the world; `alpha` in [0,1] blends from the last capture to the current state. */
  render(alpha = 1): void {
    this.stamp++;
    this.resize();
    this.syncMeshes(alpha);
    this.syncSprites(alpha);
    this.syncTilemaps(alpha);
    this.syncLights(alpha);
    this.syncTexts(alpha);
    const camera = this.camera(alpha);
    this.syncParticles(camera);
    this.gl.render(this.scene, camera);
    if (this.hud.children.length > 0) {
      this.gl.autoClear = false;
      this.gl.clearDepth();
      this.gl.render(this.hud, this.hudCamera);
      this.gl.autoClear = true;
    }
  }

  dispose(): void {
    this.gl.dispose();
  }

  private prevOf(e: Entity): Prev {
    let s = this.prev.get(e);
    if (!s) {
      s = { p: vec3(), q: quat(), a: 0 };
      this.prev.set(e, s);
    }
    return s;
  }

  /** `e`'s transform interpolated from the last capture, into `out`. */
  private local3(e: Entity, t: Pose3D, alpha: number, out: Pose3D): Pose3D {
    const s = alpha < 1 ? this.prev.get(e) : undefined;
    if (s) {
      vec3.lerp(s.p, t.position, alpha, out.position);
      quat.slerp(s.q, t.rotation, alpha, out.rotation);
    } else {
      vec3.copy(t.position, out.position);
      quat.copy(t.rotation, out.rotation);
    }
    vec3.copy(t.scale, out.scale);
    return out;
  }

  private local2(e: Entity, t: Pose2D, alpha: number, out: Pose2D): Pose2D {
    const s = alpha < 1 ? this.prev.get(e) : undefined;
    out.position.x = s ? s.p.x + (t.position.x - s.p.x) * alpha : t.position.x;
    out.position.y = s ? s.p.y + (t.position.y - s.p.y) * alpha : t.position.y;
    out.rotation = s ? s.a + (t.rotation - s.a) * alpha : t.rotation;
    out.scale.x = t.scale.x;
    out.scale.y = t.scale.y;
    return out;
  }

  /** Interpolated world pose (Parent chain applied); shared scratch, use before the next call. */
  private pose3(e: Entity, t: Pose3D, alpha: number): Pose3D {
    const out = this.local3(e, t, alpha, this.w3);
    for (let p = parentOf(this.world, e, Transform3D), d = 0; p && d < 64; d++) {
      const pt = this.world.get(p, Transform3D) as Pose3D;
      compose3D(this.local3(p, pt, alpha, this.up3), out, out);
      p = parentOf(this.world, p, Transform3D);
    }
    return out;
  }

  private pose2(e: Entity, t: Pose2D, alpha: number): Pose2D {
    const out = this.local2(e, t, alpha, this.w2);
    for (let p = parentOf(this.world, e, Transform2D), d = 0; p && d < 64; d++) {
      const pt = this.world.get(p, Transform2D) as Pose2D;
      compose2D(this.local2(p, pt, alpha, this.up2), out, out);
      p = parentOf(this.world, p, Transform2D);
    }
    return out;
  }

  private place3(e: Entity, t: Pose3D, alpha: number, o: THREE.Object3D): Pose3D {
    const w = this.pose3(e, t, alpha);
    o.position.set(w.position.x, w.position.y, w.position.z);
    o.quaternion.set(w.rotation.x, w.rotation.y, w.rotation.z, w.rotation.w);
    return w;
  }

  /** 2D pose; `layer` sets draw order (and a tiny z so equal layers still sort). */
  private place2(e: Entity, t: Pose2D, alpha: number, o: THREE.Object3D, layer: number): Pose2D {
    const w = this.pose2(e, t, alpha);
    o.position.set(w.position.x, w.position.y, layer * 0.01);
    o.rotation.set(0, 0, w.rotation);
    o.renderOrder = layer;
    return w;
  }

  private syncMeshes(alpha: number): void {
    this.world.each([Transform3D, Mesh], (e, t, m) => {
      let n = this.meshes.get(e);
      const key = m.model || m.shape;
      if (!n || n.key !== key) {
        if (n) this.drop(n);
        const obj = m.model
          ? this.model(m.model)
          : new THREE.Mesh(this.geometry(m.shape), new THREE.MeshStandardMaterial());
        obj.castShadow = obj.receiveShadow = true;
        this.scene.add(obj);
        n = { obj, key, stamp: 0 };
        this.meshes.set(e, n);
      }
      n.stamp = this.stamp;
      if (n.obj instanceof THREE.Mesh) {
        const mat = n.obj.material as THREE.MeshStandardMaterial;
        setColor(mat.color, m.color);
        mat.opacity = m.color.a;
        mat.transparent = m.color.a < 1;
        mat.roughness = m.roughness;
        mat.metalness = m.metalness;
      }
      const { scale } = this.place3(e, t, alpha, n.obj);
      n.obj.scale.set(scale.x * m.size.x, scale.y * m.size.y, scale.z * m.size.z);
    });
    this.sweep(this.meshes);
  }

  /** Group that receives a clone of the glTF scene once loaded. */
  private model(url: string): THREE.Group {
    const group = new THREE.Group();
    loadModel(url).then(
      (gltf) => {
        const scene = gltf.scene.clone(true);
        scene.traverse((o) => {
          o.castShadow = o.receiveShadow = true;
        });
        group.add(scene);
      },
      (err: unknown) => console.error(`Mesh.model: ${String(err)}`),
    );
    return group;
  }

  private syncSprites(alpha: number): void {
    this.world.each([Transform2D, Sprite], (e, t, s) => {
      let n = this.sprites.get(e);
      if (!n || n.key !== s.image) {
        if (n) this.drop(n);
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const obj = new THREE.Mesh(this.spriteGeometry, mat);
        this.scene.add(obj);
        const node: SpriteNode = { obj, key: s.image, stamp: 0, px: null };
        if (s.image) {
          obj.visible = false;
          loadTexture(s.image).then(
            (base) => {
              const tex = base.clone();
              tex.needsUpdate = true;
              mat.map = tex;
              mat.needsUpdate = true;
              const img = base.image as { width: number; height: number };
              node.px = { w: img.width, h: img.height };
              obj.visible = true;
            },
            (err: unknown) => console.error(`Sprite.image: ${String(err)}`),
          );
        }
        n = node;
        this.sprites.set(e, n);
      }
      n.stamp = this.stamp;
      const { obj, px } = n;
      setColor(obj.material.color, s.color);
      obj.material.opacity = s.color.a;
      let w = s.size.x;
      let h = s.size.y;
      const tex = obj.material.map;
      if (px && tex) {
        w = px.w / s.columns / s.pixelsPerUnit;
        h = px.h / s.rows / s.pixelsPerUnit;
        const col = s.frame % s.columns;
        const row = Math.floor(s.frame / s.columns) % s.rows;
        tex.repeat.set(1 / s.columns, 1 / s.rows);
        tex.offset.set(col / s.columns, 1 - (row + 1) / s.rows);
      }
      const { scale } = this.place2(e, t, alpha, obj, s.layer);
      obj.scale.set(w * scale.x * (s.flipX ? -1 : 1), h * scale.y, 1);
    });
    this.sweep(this.sprites);
  }

  private syncTilemaps(alpha: number): void {
    this.world.each([Transform2D, Tilemap], (e, t, m) => {
      let n = this.tilemaps.get(e);
      if (!n || n.key !== m.image) {
        if (n) this.drop(n);
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const obj = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        this.scene.add(obj);
        if (m.image) {
          obj.visible = false;
          loadTexture(m.image).then(
            (base) => {
              mat.map = base.clone();
              mat.map.needsUpdate = true;
              mat.needsUpdate = true;
              obj.visible = true;
            },
            (err: unknown) => console.error(`Tilemap.image: ${String(err)}`),
          );
        }
        n = { obj, key: m.image, stamp: 0, tiles: [], size: 0, chars: '', columns: 0, rows: 0 };
        this.tilemaps.set(e, n);
      }
      n.stamp = this.stamp;
      if (
        n.tiles !== m.tiles ||
        n.size !== m.size ||
        n.chars !== m.chars ||
        n.columns !== m.columns ||
        n.rows !== m.rows
      ) {
        n.obj.geometry.dispose();
        n.obj.geometry = tileGeometry(m);
        Object.assign(n, { tiles: m.tiles, size: m.size, chars: m.chars });
        Object.assign(n, { columns: m.columns, rows: m.rows });
      }
      setColor(n.obj.material.color, m.color);
      n.obj.material.opacity = m.color.a;
      const { scale } = this.place2(e, t, alpha, n.obj, m.layer);
      n.obj.scale.set(scale.x, scale.y, 1);
    });
    this.sweep(this.tilemaps);
  }

  /** Particles are camera-facing quads; size and color blend over their life. */
  private syncParticles(camera: THREE.Camera): void {
    this.world.each([Particles], (e, p) => {
      const pool = particlesOf(this.world, e);
      let n = this.particles.get(e);
      if (!n || n.max !== p.max) {
        if (n) this.drop(n);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
        const obj = new THREE.InstancedMesh(this.spriteGeometry, mat, p.max);
        obj.frustumCulled = false;
        this.scene.add(obj);
        n = { obj, key: '', stamp: 0, max: p.max };
        this.particles.set(e, n);
      }
      n.stamp = this.stamp;
      const { obj } = n;
      obj.count = pool?.count ?? 0;
      obj.material.opacity = p.color.a;
      const d = this.dummy;
      d.quaternion.copy(camera.quaternion);
      const data = pool?.data;
      for (let i = 0; data && i < obj.count; i++) {
        const o = i * PARTICLE_STRIDE;
        const k = Math.min((data[o + 6] as number) / p.lifetime, 1);
        d.position.set(data[o] as number, data[o + 1] as number, data[o + 2] as number);
        d.scale.setScalar(Math.max(p.size + (p.endSize - p.size) * k, 1e-4));
        d.updateMatrix();
        obj.setMatrixAt(i, d.matrix);
        const c = p.color;
        const f = p.endColor;
        this.tint.setRGB(
          c.r + (f.r - c.r) * k,
          c.g + (f.g - c.g) * k,
          c.b + (f.b - c.b) * k,
          THREE.SRGBColorSpace,
        );
        obj.setColorAt(i, this.tint);
      }
      obj.instanceMatrix.needsUpdate = true;
      if (obj.instanceColor) obj.instanceColor.needsUpdate = true;
    });
    this.sweep(this.particles);
  }

  private syncTexts(alpha: number): void {
    const { width, height } = this.gl.domElement;
    const aspect = width / Math.max(height, 1);
    this.world.each([Text], (e, t) => {
      let n = this.texts.get(e);
      if (!n) {
        const canvas = document.createElement('canvas');
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const obj = new THREE.Mesh(this.spriteGeometry, mat);
        n = { obj, key: '', stamp: 0, canvas, align: '', aspect: 1, lines: 1 };
        this.texts.set(e, n);
      }
      n.stamp = this.stamp;
      const { obj } = n;
      const parent = t.screen ? this.hud : this.scene;
      if (obj.parent !== parent) parent.add(obj);
      if (n.key !== t.text || n.align !== t.align) {
        Object.assign(n, drawText(n.canvas, t.text, t.align));
        n.key = t.text;
        n.align = t.align;
        // A resized canvas needs a new GPU texture: three.js cannot grow one in place.
        obj.material.map?.dispose();
        obj.material.map = canvasTexture(n.canvas);
      }
      setColor(obj.material.color, t.color);
      obj.material.opacity = t.color.a;
      // Screen text: [-1, 1] on both axes, size in tenths of the screen height.
      const k = t.screen ? 0.2 : 1;
      const h = t.size * n.lines * k;
      const w = h * n.aspect;
      const shift = (t.align === 'left' ? w : t.align === 'right' ? -w : 0) / 2;
      const t2 = this.world.get(e, Transform2D);
      const t3 = t.screen ? undefined : this.world.get(e, Transform3D);
      if (t3) {
        const { scale } = this.place3(e, t3, alpha, obj);
        obj.translateX(shift * scale.x);
        obj.scale.set(w * scale.x, h * scale.y, 1);
        return;
      }
      const { scale } = this.place2(e, t2 ?? ORIGIN2, alpha, obj, t.layer);
      const sx = scale.x;
      const sy = scale.y;
      const ax = t.screen ? 1 / aspect : 1;
      obj.translateX(shift * ax * sx);
      obj.scale.set(w * ax * sx, h * sy, 1);
    });
    this.sweep(this.texts);
  }

  private syncLights(alpha: number): void {
    let count = 0;
    this.world.each([Light], (e, l) => {
      count++;
      let n = this.lights.get(e);
      if (!n || n.key !== l.kind) {
        if (n) this.drop(n);
        const obj =
          l.kind === 'directional'
            ? new THREE.DirectionalLight()
            : l.kind === 'point'
              ? new THREE.PointLight()
              : new THREE.AmbientLight();
        if (obj instanceof THREE.DirectionalLight) {
          obj.castShadow = true;
          const cam = obj.shadow.camera;
          // ponytail: fixed 40 m shadow box around the origin; follow the camera if levels get big.
          cam.left = cam.bottom = -20;
          cam.right = cam.top = 20;
          this.scene.add(obj.target);
        }
        this.scene.add(obj);
        n = { obj, key: l.kind, stamp: 0 };
        this.lights.set(e, n);
      }
      n.stamp = this.stamp;
      setColor(n.obj.color, l.color);
      n.obj.intensity = l.intensity;
      const t = this.world.get(e, Transform3D);
      if (t) this.place3(e, t, alpha, n.obj);
      if (n.obj instanceof THREE.DirectionalLight) {
        const fwd = n.obj.target.position.set(0, 0, -1).applyQuaternion(n.obj.quaternion);
        fwd.add(n.obj.position);
      }
    });
    this.sweep(this.lights);
    this.defaultLights.visible = count === 0;
  }

  private camera(alpha: number): THREE.Camera {
    const { width, height } = this.gl.domElement;
    const aspect = width / Math.max(height, 1);
    if (this.dimension === '2d') {
      let half = 5;
      let x = 0;
      let y = 0;
      this.world.each([Transform2D, Camera2D], (e, t, c) => {
        half = c.height / 2;
        const { position } = this.pose2(e, t, alpha);
        x = position.x;
        y = position.y;
      });
      const o = this.ortho;
      o.left = -half * aspect;
      o.right = half * aspect;
      o.top = half;
      o.bottom = -half;
      o.position.set(x, y, 100);
      o.updateProjectionMatrix();
      return o;
    }
    const cam = this.perspective;
    this.world.each([Transform3D, Camera3D], (e, t, c) => {
      cam.fov = c.fov;
      cam.near = c.near;
      cam.far = c.far;
      this.place3(e, t, alpha, cam);
    });
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    return cam;
  }

  private resize(): void {
    const c = this.gl.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const size = this.gl.getSize(this.size);
    if (w > 0 && h > 0 && (size.x !== w || size.y !== h)) this.gl.setSize(w, h, false);
  }

  private geometry(shape: string): THREE.BufferGeometry {
    let g = this.geometries.get(shape);
    if (!g) {
      const make = UNIT[shape];
      if (!make)
        throw new Error(`Mesh: unknown shape "${shape}" (use ${Object.keys(UNIT).join(', ')})`);
      g = make();
      this.geometries.set(shape, g);
    }
    return g;
  }

  private sweep<T extends THREE.Object3D>(nodes: Map<Entity, Node<T>>): void {
    for (const [e, n] of nodes) {
      if (n.stamp === this.stamp) continue;
      this.drop(n);
      nodes.delete(e);
      if (!this.world.alive(e)) this.prev.delete(e);
    }
  }

  private drop(n: Node<THREE.Object3D>): void {
    n.obj.removeFromParent();
    if (n.obj instanceof THREE.DirectionalLight) n.obj.target.removeFromParent();
    if (n.obj instanceof THREE.Mesh) {
      if (
        n.obj.geometry !== this.spriteGeometry &&
        ![...this.geometries.values()].includes(n.obj.geometry)
      )
        n.obj.geometry.dispose();
      const mat = n.obj.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
  }
}
