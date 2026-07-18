import { describe, expect, it } from 'vitest';

import {
  countUnpricedPositions,
  countSnapshotUnpricedPositions,
} from '@/worker/jobs/strategy-performance';

describe('strategy performance pricing quality', () => {
  it('counts stale open-position marks as unpriced', () => {
    const now = new Date('2026-07-17T22:00:00Z');
    const positions = [
      { updatedAt: new Date('2026-07-17T21:59:00Z'), currentPrice: '0.50' },
      { updatedAt: new Date('2026-07-17T21:40:00Z'), currentPrice: '0.00' },
    ];

    expect(countUnpricedPositions(positions, now)).toBe(1);
  });

  it('counts persisted snapshot pricing-quality markers', () => {
    expect(countSnapshotUnpricedPositions([
      { ticker: 'PRICED', pricing_status: 'priced' },
      { ticker: 'NO-BOOK', pricing_status: 'unpriced' },
    ])).toBe(1);
    expect(countSnapshotUnpricedPositions(null)).toBe(0);
  });
});
