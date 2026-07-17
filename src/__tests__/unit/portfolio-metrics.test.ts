import { describe, expect, it } from 'vitest';

import { calculatePnLPercent } from '@/lib/portfolio-metrics';

describe('portfolio metrics', () => {
  it('calculates return against starting capital rather than current NAV', () => {
    expect(calculatePnLPercent(250, 1000)).toBe(25);
    expect(calculatePnLPercent(-250, 1000)).toBe(-25);
  });

  it('returns zero for invalid starting capital', () => {
    expect(calculatePnLPercent(10, 0)).toBe(0);
    expect(calculatePnLPercent(10, Number.NaN)).toBe(0);
  });
});
