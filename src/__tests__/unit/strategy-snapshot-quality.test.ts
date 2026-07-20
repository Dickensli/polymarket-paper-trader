import { describe, expect, it } from 'vitest';
import {
  calculateVerifiedMaxDrawdownPct,
  portfolioSnapshotHasUnpricedPositions,
} from '@/lib/strategy-snapshot-quality';

describe('strategy snapshot quality', () => {
  it('detects local and official unpriced position shapes', () => {
    expect(portfolioSnapshotHasUnpricedPositions([
      { shares: 3, currentPrice: 0, pricingStatus: 'unpriced' },
    ])).toBe(true);
    expect(portfolioSnapshotHasUnpricedPositions([
      { position_fp: '39.00', pricing_status: 'unpriced' },
    ])).toBe(true);
    expect(portfolioSnapshotHasUnpricedPositions([
      { position_fp: { value: '-102.00' }, pricing_status: 'unpriced' },
    ])).toBe(true);
    expect(portfolioSnapshotHasUnpricedPositions([
      { shares: 3, currentPrice: 0.5, pricingStatus: 'priced' },
    ])).toBe(false);
  });

  it('excludes transient unpriced NAV collapses from drawdown', () => {
    const snapshots = [
      { capturedAt: new Date('2026-07-17T20:00:00Z'), totalValue: 11_090.75, positions: [{ shares: 3, currentPrice: 0.98, pricingStatus: 'priced' }] },
      { capturedAt: new Date('2026-07-17T20:05:00Z'), totalValue: 9_130.75, positions: [{ shares: 3, currentPrice: 0, pricingStatus: 'unpriced' }] },
      { capturedAt: new Date('2026-07-17T23:05:00Z'), totalValue: 11_130.75, positions: [{ shares: 3, currentPrice: 1, pricingStatus: 'priced' }] },
    ];
    expect(calculateVerifiedMaxDrawdownPct(snapshots, 10_000)).toBe(0);
  });

  it('keeps genuine priced drawdowns', () => {
    const snapshots = [
      { capturedAt: new Date('2026-07-17T20:00:00Z'), totalValue: 11_000, positions: [] },
      { capturedAt: new Date('2026-07-17T20:05:00Z'), totalValue: 9_900, positions: [] },
    ];
    expect(calculateVerifiedMaxDrawdownPct(snapshots, 10_000)).toBeCloseTo(0.10);
  });

  it('ignores snapshots before the latest performance baseline', () => {
    const snapshots = [
      { capturedAt: new Date('2026-07-16T20:00:00Z'), totalValue: 5_000, positions: [] },
      { capturedAt: new Date('2026-07-17T20:00:00Z'), totalValue: 10_500, positions: [] },
      { capturedAt: new Date('2026-07-17T21:00:00Z'), totalValue: 10_000, positions: [] },
    ];
    expect(calculateVerifiedMaxDrawdownPct(
      snapshots,
      10_000,
      new Date('2026-07-17T00:00:00Z'),
    )).toBeCloseTo(0.5 / 10.5);
  });
});
