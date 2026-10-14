import { World } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import {
  listener,
  playMusic,
  playSound,
  setListener,
  setVolume,
  soundLog,
  stopMusic,
  stopSound,
} from './index';

describe('audio (headless)', () => {
  it('logs requests and keeps bus volumes', () => {
    const w = new World();
    stopSound(w, playSound(w, 'coin.wav'));
    playMusic(w, 'theme.ogg');
    playMusic(w, 'theme.ogg');
    stopMusic(w);
    setVolume(w, 'sfx', 2);
    for (let i = 0; i < 40; i++) playSound(w, `s${i}.wav`, { bus: 'ui' });
    const log = soundLog(w);
    expect(log).toHaveLength(32);
    expect(log.at(-1)).toEqual({ frame: 0, url: 's39.wav', bus: 'ui' });
    expect(playSound(w, 'a.wav', { pitch: 2, position: { x: 1, y: 2 } })).toBe(43);
    playMusic(w, '');
    setListener(w, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(listener(w).position).toEqual({ x: 1, y: 2, z: 3 });
  });
});
