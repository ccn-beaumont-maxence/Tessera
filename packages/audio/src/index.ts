import { loadSound } from '@tessera/assets';
import { resource, type World } from '@tessera/core';

const LOG_SIZE = 32;

const AudioState = resource(
  'Audio',
  () => ({
    /** Bus volumes in [0,1]; `master` scales every other bus. */
    volumes: { master: 1, music: 1, sfx: 1 } as Record<string, number>,
    /** Last sounds requested, newest last (headless assertions). */
    log: [] as { frame: number; url: string; bus: string }[],
    music: null as { url: string; stop(): void } | null,
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
  bus?: string;
  loop?: boolean;
}

/** Plays a one-shot sound (no-op headless, but logged). Returns a stop function. */
export function playSound(world: World, url: string, options: SoundOptions = {}): () => void {
  const { volume = 1, bus: name = 'sfx', loop = false } = options;
  const s = world.resource(AudioState);
  s.log.push({ frame: world.frame, url, bus: name });
  if (s.log.length > LOG_SIZE) s.log.shift();
  const out = bus(world, name);
  const c = ctx;
  if (!out || !c) return () => {};
  let src: AudioBufferSourceNode | null = null;
  let stopped = false;
  loadSound(url, c).then(
    (buffer) => {
      if (stopped) return;
      const gain = c.createGain();
      gain.gain.value = volume;
      gain.connect(out);
      src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = loop;
      src.connect(gain);
      src.start();
    },
    (err: unknown) => console.error(`playSound: ${String(err)}`),
  );
  return () => {
    stopped = true;
    src?.stop();
  };
}

/** Loops `url` on the music bus, replacing the current track (same URL keeps playing). */
export function playMusic(world: World, url: string, volume = 1): void {
  const s = world.resource(AudioState);
  if (s.music?.url === url) return;
  s.music?.stop();
  s.music = { url, stop: playSound(world, url, { volume, bus: 'music', loop: true }) };
}

export function stopMusic(world: World): void {
  const s = world.resource(AudioState);
  s.music?.stop();
  s.music = null;
}

/** Sets a bus volume (`master`, `music`, `sfx` or any custom bus name). */
export function setVolume(world: World, busName: string, volume: number): void {
  world.resource(AudioState).volumes[busName] = Math.min(Math.max(volume, 0), 1);
  bus(world, busName);
}

/** Recently requested sounds, oldest first. */
export const soundLog = (world: World) => world.resource(AudioState).log;
