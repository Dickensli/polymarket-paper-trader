import { describe, expect, it } from 'vitest';

import {
  normalizePolymarketUsOutcomeOrderBook,
  resolvePolymarketUsOutcomePriceFromBbo,
} from '@/lib/polymarket-us';

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

  it('marks open positions at their executable liquidation bid', () => {
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'YES', 'MARK')).toBe(0.177);
    expect(resolvePolymarketUsOutcomePriceFromBbo(bbo, 'NO', 'MARK')).toBe(0.821);
  });

  it('does not invent an executable price when the relevant book side is absent', () => {
    expect(resolvePolymarketUsOutcomePriceFromBbo({ marketData: {} }, 'YES', 'BUY')).toBeNull();
    expect(resolvePolymarketUsOutcomePriceFromBbo({ marketData: {} }, 'NO', 'BUY')).toBeNull();
  });

  it('normalizes the YES book into outcome-aware executable depth', () => {
    const rawBook = {
      marketData: {
        bids: [
          { px: { value: '0.20', currency: 'USD' }, qty: '100' },
          { px: { value: '0.18', currency: 'USD' }, qty: '200' },
        ],
        offers: [
          { px: { value: '0.30', currency: 'USD' }, qty: '50' },
          { px: { value: '0.35', currency: 'USD' }, qty: '75' },
        ],
      },
    };

    expect(normalizePolymarketUsOutcomeOrderBook('slug', 'YES', rawBook)).toMatchObject({
      bids: [{ price: 0.2, size: 100 }, { price: 0.18, size: 200 }],
      asks: [{ price: 0.3, size: 50 }, { price: 0.35, size: 75 }],
    });
    expect(normalizePolymarketUsOutcomeOrderBook('slug', 'NO', rawBook)).toMatchObject({
      bids: [{ price: 0.7, size: 50 }, { price: 0.65, size: 75 }],
      asks: [{ price: 0.8, size: 100 }, { price: 0.82, size: 200 }],
    });
  });
});
