import { describe, expect, it } from 'vitest';

import { resolvePolymarketUsOutcomePriceFromBbo } from '@/lib/polymarket-us';

describe('Polymarket US outcome-side pricing', () => {
  const bbo = {
    marketData: {
      bestBid: { value: '0.1770', currency: 'USD' },
      bestAsk: { value: '0.1790', currency: 'USD' },
      currentPx: { value: '0.1780', currency: 'USD' },
      longQuote: { value: '0.1790', currency: 'USD' },
      shortQuote: { value: '0.8230', currency: 'USD' },
    },
  };

  it('uses the long-side ask/bid for YES market orders', () => {
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'YES', 'BUY')).toBe(0.179);
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'YES', 'SELL')).toBe(0.177);
  });

  it('crosses the complementary side of the book for NO market orders', () => {
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'NO', 'BUY')).toBe(0.823);
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'NO', 'SELL')).toBe(0.821);
  });

  it('marks NO from the venue short quote instead of the YES current price', () => {
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'NO', 'MARK')).toBe(0.823);
  });

  it('does not invent an executable price when the relevant book side is absent', () => {
    expect(resolvePolymarketUsOutcomePriceFromBbo({ marketData: {} }, 'YES', 'BUY')).toBeNull();
    expect(resolvePolymarketUsOutcomePriceFromBbo({ marketData: {} }, 'NO', 'BUY')).toBeNull();
  });
});
