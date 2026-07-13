import { describe, expect, it } from 'vitest';
import { inferPositionPlatform, positionBelongsToPlatform } from '@/lib/position-platform';

describe('inferPositionPlatform', () => {
  it('lets canonical Kalshi identifiers override a legacy polymarket value', () => {
    const legacyPosition = {
      platform: 'polymarket' as const,
      tokenId: 'kalshi:KXFED-26JUL-T3.75:YES',
      marketId: 'KXFED-26JUL-T3.75',
    };

    expect(inferPositionPlatform(legacyPosition)).toBe('kalshi');
    expect(positionBelongsToPlatform(legacyPosition, 'kalshi')).toBe(true);
    expect(positionBelongsToPlatform(legacyPosition, 'polymarket')).toBe(false);
  });

  it('recognizes legacy Kalshi token formats and KX tickers', () => {
    expect(inferPositionPlatform({ tokenId: 'KXGDP-26JUL30-T2.0:YES' })).toBe('kalshi');
    expect(inferPositionPlatform({ marketId: 'KXRAMPBREX-40-RAMP' })).toBe('kalshi');
  });

  it('preserves correctly stored platforms for non-Kalshi positions', () => {
    expect(inferPositionPlatform({ platform: 'polymarket', tokenId: 'poly-token' })).toBe('polymarket');
    expect(inferPositionPlatform({ platform: 'polymarket_us', tokenId: 'us-token' })).toBe('polymarket_us');
  });
});
