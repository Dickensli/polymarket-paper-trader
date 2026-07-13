import { describe, expect, it } from 'vitest';
import { calculateNoFlowMwrPct, calculatePeriodReturnPct, chainTwrPct } from '@/lib/performance-returns';

describe('performance returns', () => {
  it('removes an aggregated external flow from period return', () => {
    expect(calculatePeriodReturnPct(100, 115, 10)).toBeCloseTo(5);
  });

  it('chain-links time-weighted returns', () => {
    expect(chainTwrPct(10, -5)).toBeCloseTo(4.5);
  });

  it('annualizes the no-flow money-weighted return', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date(start.getTime() + 365.25 * 24 * 60 * 60 * 1000);
    expect(calculateNoFlowMwrPct(100, 110, start, end)).toBeCloseTo(10);
  });

  it('does not annualize less than 30 days of history', () => {
    expect(calculateNoFlowMwrPct(100, 101, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-15T00:00:00Z'))).toBeNull();
  });
});
