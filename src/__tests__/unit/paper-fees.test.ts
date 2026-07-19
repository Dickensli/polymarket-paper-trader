import { describe, expect, it } from 'vitest';
import { resolvePaperFeeRateBps } from '@/lib/paper-fees';

describe('paper fee model', () => {
  it('uses non-zero conservative venue defaults', () => {
    expect(resolvePaperFeeRateBps('kalshi', {}, {})).toBe(700);
    expect(resolvePaperFeeRateBps('polymarket_us', {}, {})).toBe(100);
  });

  it('accepts server environment overrides and only stricter strategy estimates', () => {
    expect(resolvePaperFeeRateBps('kalshi', { paper_fee_rate_bps: 20 }, {
      KALSHI_PAPER_FEE_RATE_BPS: '50',
    })).toBe(50);
    expect(resolvePaperFeeRateBps('kalshi', { paper_fee_rate_bps: 75 }, {
      KALSHI_PAPER_FEE_RATE_BPS: '50',
    })).toBe(75);
  });
});
