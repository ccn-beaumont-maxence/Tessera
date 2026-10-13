import { World } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { playMusic, playSound, setVolume, soundLog, stopMusic } from './index';

describe('audio (headless)', () => {
  it('logs requests and keeps bus volumes', () => {
    const w = new World();
    playSound(w, 'coin.wav')();
    playMusic(w, 'theme.ogg');
    playMusic(w, 'theme.ogg');
    stopMusic(w);
    setVolume(w, 'sfx', 2);
    for (let i = 0; i < 40; i++) playSound(w, `s${i}.wav`, { bus: 'ui' });
    const log = soundLog(w);
    expect(log).toHaveLength(32);
    expect(log.at(-1)).toEqual({ frame: 0, url: 's39.wav', bus: 'ui' });
  });
});
