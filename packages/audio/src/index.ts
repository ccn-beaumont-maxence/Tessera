import { loadSound } from '@tessera/assets';
import { type Quat, quat, resource, type Vec3, vec3, type World } from '@tessera/core';

const LOG_SIZE = 32;

const AudioState = resource(
  'Audio',
  () => ({
    /** Bus volumes in [0,1]; `master` scales every other bus. */
    volumes: { master: 1, music: 1, sfx: 1 } as Record<string, number>,
    /** Last sounds requested, newest last (headless assertions). */
    log: [] as { frame: number; url: string; bus: string }[],
    music: null as { url: string; id: number } | null,
    /** Stop functions of sounds still playing (browser only), by id. */
    playing: new Map<number, () => void>(),
    nextId: 1,
    /** Camera pose that positional sounds are heard from (see setListener). */
    listener: { position: vec3(), rotation: quat() },
  }),
  { internal: true },
);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buses = new Map<string, GainNode>();

/** Shared AudioContext, created lazily in browsers; null headless. Resumes on first input. */
function context(): AudioContext | null {
  if (ctx || typeof AudioContext === 'undefined') return ctx;
  const c = new AudioContext();
  ctx = c;
  master = c.createGain();
  master.connect(c.destination);
  const resume = () => void c.resume();
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, resume, { once: true });
  return c;
}

function bus(world: World, name: string): GainNode | null {
  const c = context();
  if (!c || !master) return null;
  let g = buses.get(name);
  if (!g) {
    g = c.createGain();
    g.connect(master);
    buses.set(name, g);
  }
  const v = world.resource(AudioState).volumes;
  g.gain.value = v[name] ?? 1;
  master.gain.value = v.master ?? 1;
  return g;
}

export interface SoundOptions {
  volume?: number;
  /** Playback rate: 2 = an octave up and twice as fast. */
  pitch?: number;
  bus?: string;
  loop?: boolean;
  /** World position for a 3D (panned, distance-attenuated) sound; z is 0 for 2D points. */
  position?: { x: number; y: number; z?: number };
}

/** Plays a sound (no-op headless, but logged) and returns its id for stopSound. */
export function playSound(world: World, url: string, options: SoundOptions = {}): number {
  const { volume = 1, pitch = 1, bus: name = 'sfx', loop = false, position } = options;
  const s = world.resource(AudioState);
  const id = s.nextId++;
  s.log.push({ frame: world.frame, url, bus: name });
  if (s.log.length > LOG_SIZE) s.log.shift();
  const out = bus(world, name);
  const c = ctx;
  if (!out || !c) return id;
  let src: AudioBufferSourceNode | null = null;
  let stopped = false;
  s.playing.set(id, () => {
    stopped = true;
    src?.stop();
    s.playing.delete(id);
  });
  loadSound(url, c).then(
    (buffer) => {
      if (stopped) return;
      const gain = c.createGain();
      gain.gain.value = volume;
      gain.connect(out);
      src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = loop;
      src.playbackRate.value = pitch;
      if (position) {
        const panner = c.createPanner();
        panner.panningModel = 'HRTF';
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z ?? 0;
        src.connect(panner).connect(gain);
      } else {
        src.connect(gain);
      }
      src.onended = () => s.playing.delete(id);
      src.start();
    },
    (err: unknown) => console.error(`playSound: ${String(err)}`),
  );
  return id;
}

/** Stops a sound started by playSound (unknown or finished ids are ignored). */
export function stopSound(world: World, id: number): void {
  world.resource(AudioState).playing.get(id)?.();
}

const FORWARD = vec3(0, 0, -1);
const UP = vec3(0, 1, 0);
const fwd = vec3();
const up = vec3();

/** Places the listener (usually the camera) for positional sounds; forward is -Z. */
export function setListener(world: World, position: Vec3, rotation: Quat): void {
  const l = world.resource(AudioState).listener;
  vec3.copy(position, l.position);
  quat.copy(rotation, l.rotation);
  const L = ctx?.listener;
  if (!L?.positionX) return;
  L.positionX.value = position.x;
  L.positionY.value = position.y;
  L.positionZ.value = position.z;
  quat.rotate(rotation, FORWARD, fwd);
  quat.rotate(rotation, UP, up);
  L.forwardX.value = fwd.x;
  L.forwardY.value = fwd.y;
  L.forwardZ.value = fwd.z;
  L.upX.value = up.x;
  L.upY.value = up.y;
  L.upZ.value = up.z;
}

/** Loops `url` on the music bus, replacing the current track (same URL keeps playing, '' stops). */
export function playMusic(world: World, url: string, volume = 1): void {
  const s = world.resource(AudioState);
  if (s.music?.url === url) return;
  stopMusic(world);
  if (url) s.music = { url, id: playSound(world, url, { volume, bus: 'music', loop: true }) };
}

export function stopMusic(world: World): void {
  const s = world.resource(AudioState);
  if (s.music) stopSound(world, s.music.id);
  s.music = null;
}

/** Sets a bus volume (`master`, `music`, `sfx` or any custom bus name). */
export function setVolume(world: World, busName: string, volume: number): void {
  world.resource(AudioState).volumes[busName] = Math.min(Math.max(volume, 0), 1);
  bus(world, busName);
}

/** Recently requested sounds, oldest first. */
export const soundLog = (world: World) => world.resource(AudioState).log;

/** Listener pose last given to setListener. */
export const listener = (world: World) => world.resource(AudioState).listener;
