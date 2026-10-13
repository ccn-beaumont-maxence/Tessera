import { describe, expect, it } from 'vitest';
import { invalidate, load, loaded } from './index';

describe('asset cache', () => {
  it('shares one load per key and waits for all', async () => {
    let calls = 0;
    const loader = async () => ++calls;
    const a = load('k', loader);
    expect(load('k', loader)).toBe(a);
    await loaded();
    expect(await a).toBe(1);
    invalidate('k');
    expect(await load('k', loader)).toBe(2);
    invalidate();
  });

  it('names the failing asset and retries later', async () => {
    await expect(load('bad.png', () => Promise.reject(new Error('404')))).rejects.toThrow(
      'asset "bad.png": 404',
    );
    await loaded();
    expect(await load('bad.png', async () => 'ok')).toBe('ok');
    await expect(load('worse', () => Promise.reject('nope'))).rejects.toThrow('nope');
  });
});
