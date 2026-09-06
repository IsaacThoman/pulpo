import { describe, expect, it } from 'vitest';
import morphs from '../../assets/loading/material-morphs.json';
import { loadingFrame, loadingPath, MORPH_INTERVAL_MS } from './expressiveLoading';

describe('Material loading geometry', () => {
  it('keeps every spring-interpolated curve inside the rotating viewport', () => {
    for (let elapsed = 0; elapsed < MORPH_INTERVAL_MS * morphs.length; elapsed += 16) {
      const { index, progress } = loadingFrame(elapsed);
      const [from, to] = morphs[index]!;
      expect(from!.length).toBe(to!.length);
      expect((from!.length - 2) % 6).toBe(0);
      const values = from!.map((value, i) => value + (to![i]! - value) * progress);
      for (let i = 2; i < values.length; i += 6) {
        for (let t = 0; t <= 1; t += 0.1) {
          const u = 1 - t;
          const x = u ** 3 * values[i - 2]! + 3 * u ** 2 * t * values[i]! + 3 * u * t ** 2 * values[i + 2]! + t ** 3 * values[i + 4]!;
          const y = u ** 3 * values[i - 1]! + 3 * u ** 2 * t * values[i + 1]! + 3 * u * t ** 2 * values[i + 3]! + t ** 3 * values[i + 5]!;
          // A point's radius bounds it for every possible rotation angle.
          expect(Math.hypot(x - 0.5, y - 0.5) * 0.74).toBeLessThan(0.5);
        }
      }
      expect(loadingPath(index, progress)).not.toMatch(/NaN|undefined|Infinity/);
      expect(values.at(-2)).toBeCloseTo(values[0]!, 4);
      expect(values.at(-1)).toBeCloseTo(values[1]!, 4);
    }
  });

  it('loops through all seven shapes without a rotation jump at the seam', () => {
    const duration = MORPH_INTERVAL_MS * morphs.length;
    expect(loadingFrame(duration).index).toBe(0);
    const before = loadingFrame(duration - 0.001).rotation;
    const after = loadingFrame(duration).rotation;
    expect((after - before + 360) % 360).toBeLessThan(0.01);
  });
});
