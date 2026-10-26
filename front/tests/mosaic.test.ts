import { describe, expect, it } from 'vitest';

import { buildMosaic } from '../src/app/features/diagram/mosaic';

const SIZE = 12;
const NEIGHBOUR_DISTANCE = Math.sqrt(3) * SIZE;

function countsByQuality(qualityIndexes: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const q of qualityIndexes) {
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return counts;
}

function isContiguous(
  cells: readonly { qualityIndex: number; cx: number; cy: number }[],
  qualityIndex: number,
): boolean {
  const own = cells.filter((c) => c.qualityIndex === qualityIndex);
  if (own.length <= 1) return true;

  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (let i = 0; i < own.length; i++) {
      if (seen.has(i)) continue;
      const dx = own[i].cx - own[current].cx;
      const dy = own[i].cy - own[current].cy;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(distance - NEIGHBOUR_DISTANCE) < 0.6) {
        seen.add(i);
        queue.push(i);
      }
    }
  }
  return seen.size === own.length;
}

describe('hex mosaic', () => {
  it('uses exactly one cell per weight unit', () => {
    const weights = Array(24).fill(20);
    const mosaic = buildMosaic(weights, { size: SIZE });

    expect(mosaic.cells).toHaveLength(480);
    expect(mosaic.labels).toHaveLength(24);

    const counts = countsByQuality(mosaic.cells.map((c) => c.qualityIndex));
    weights.forEach((weight, index) => {
      expect(counts.get(index), `quality ${index + 1}`).toBe(weight);
    });
  });

  it('keeps every quality region contiguous for a uniform profile', () => {
    const mosaic = buildMosaic(Array(24).fill(20), { size: SIZE });
    for (let i = 0; i < 24; i++) {
      expect(isContiguous(mosaic.cells, i), `quality ${i + 1}`).toBe(true);
    }
  });

  it('keeps every quality region contiguous for an uneven profile', () => {
    const weights = Array(24).fill(4);
    weights[0] = 180;
    weights[5] = 100;
    weights[7] = 80;
    weights[8] = 40;
    // 180 + 100 + 80 + 40 + 20 × 4 = 480
    expect(weights.reduce((a, b) => a + b, 0)).toBe(480);

    const mosaic = buildMosaic(weights, { size: SIZE });
    expect(mosaic.cells).toHaveLength(480);

    const counts = countsByQuality(mosaic.cells.map((c) => c.qualityIndex));
    weights.forEach((weight, index) => {
      expect(counts.get(index), `quality ${index + 1}`).toBe(weight);
    });

    for (let i = 0; i < 24; i++) {
      expect(isContiguous(mosaic.cells, i), `quality ${i + 1}`).toBe(true);
    }
  });

  it('keeps counts exact and regions contiguous for random profiles', () => {
    let seed = 987654321;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let sample = 0; sample < 12; sample++) {
      const weights = Array(24).fill(1);
      let extra = 480 - 24;
      while (extra > 0) {
        const index = Math.floor(random() * 24);
        const add = Math.min(extra, 1 + Math.floor(random() * 40));
        weights[index] += add;
        extra -= add;
      }

      const mosaic = buildMosaic(weights, { size: SIZE });
      const counts = countsByQuality(mosaic.cells.map((c) => c.qualityIndex));
      weights.forEach((weight, index) => {
        expect(counts.get(index), `sample ${sample}, quality ${index + 1}`).toBe(
          weight,
        );
      });
      for (let index = 0; index < 24; index++) {
        expect(
          isContiguous(mosaic.cells, index),
          `sample ${sample}, quality ${index + 1}`,
        ).toBe(true);
      }
    }
  });

  it('handles the most lopsided allowed profile', () => {
    const weights = Array(24).fill(1);
    weights[0] = 480 - 23;
    expect(weights.reduce((a, b) => a + b, 0)).toBe(480);

    const mosaic = buildMosaic(weights, { size: SIZE });
    const counts = countsByQuality(mosaic.cells.map((c) => c.qualityIndex));
    weights.forEach((weight, index) => {
      expect(counts.get(index), `quality ${index + 1}`).toBe(weight);
    });
    for (let index = 0; index < 24; index++) {
      expect(isContiguous(mosaic.cells, index), `quality ${index + 1}`).toBe(
        true,
      );
    }
  });

  it('handles an empty pool', () => {
    const mosaic = buildMosaic([]);
    expect(mosaic.cells).toHaveLength(0);
    expect(mosaic.labels).toHaveLength(0);
  });
});
