import { loaded, loadModel, loadTexture } from '@tessera/assets';
import {
  type Color,
  type Entity,
  type Quat,
  quat,
  Transform2D,
  Transform3D,
  type Vec3,
  vec3,
  type World,
} from '@tessera/core';
import * as THREE from 'three';
import { Camera2D, Camera3D, Light, Mesh, Sprite } from './components';

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

const UNIT: Record<string, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 32, 16),
  plane: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  capsule: () => new THREE.CapsuleGeometry(0.5, 1, 8, 16),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
};

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
  private stamp = 0;
  private readonly p = vec3();
  private readonly q = quat();
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
    this.syncLights(alpha);
    this.gl.render(this.scene, this.camera(alpha));
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

  private place3(
    e: Entity,
    t: { position: Vec3; rotation: Quat },
    alpha: number,
    o: THREE.Object3D,
  ) {
    const s = alpha < 1 ? this.prev.get(e) : undefined;
    const p = s ? vec3.lerp(s.p, t.position, alpha, this.p) : t.position;
    const q = s ? quat.slerp(s.q, t.rotation, alpha, this.q) : t.rotation;
    o.position.set(p.x, p.y, p.z);
    o.quaternion.set(q.x, q.y, q.z, q.w);
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
      this.place3(e, t, alpha, n.obj);
      n.obj.scale.set(t.scale.x * m.size.x, t.scale.y * m.size.y, t.scale.z * m.size.z);
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
      const prev = alpha < 1 ? this.prev.get(e) : undefined;
      const x = prev ? prev.p.x + (t.position.x - prev.p.x) * alpha : t.position.x;
      const y = prev ? prev.p.y + (t.position.y - prev.p.y) * alpha : t.position.y;
      const a = prev ? prev.a + (t.rotation - prev.a) * alpha : t.rotation;
      obj.position.set(x, y, s.layer * 0.01);
      obj.rotation.set(0, 0, a);
      obj.renderOrder = s.layer;
      obj.scale.set(w * t.scale.x * (s.flipX ? -1 : 1), h * t.scale.y, 1);
    });
    this.sweep(this.sprites);
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
        const s = alpha < 1 ? this.prev.get(e) : undefined;
        x = s ? s.p.x + (t.position.x - s.p.x) * alpha : t.position.x;
        y = s ? s.p.y + (t.position.y - s.p.y) * alpha : t.position.y;
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
      const mat = n.obj.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
  }
}
