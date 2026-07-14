import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPolymarketUsOutcomePrice, getPolymarketUsClient } from '@/lib/polymarket-us';

vi.mock('polymarket-us', () => {
  const mockBbo = vi.fn();
  const mockBook = vi.fn();
  class MockPolymarketUS {
    markets = {
      bbo: mockBbo,
      book: mockBook,
      retrieveBySlug: vi.fn(),
      list: vi.fn(),
      settlement: vi.fn(),
    };
  }
  return {
    PolymarketUS: MockPolymarketUS,
  };
});

describe('Polymarket US price helpers', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = getPolymarketUsClient();
    vi.clearAllMocks();
  });

  describe('getPolymarketUsOutcomePrice', () => {
    it('returns the correct price for YES outcome on BUY side (bestAsk)', async () => {
      mockClient.markets.bbo.mockResolvedValue({
        marketData: {
          marketSlug: 'test-market',
          bestAsk: { value: '0.1940', currency: 'USD' },
          bestBid: { value: '0.1930', currency: 'USD' },
          shortQuote: { value: '0.8070', currency: 'USD' },
        }
      });

      const price = await getPolymarketUsOutcomePrice('test-market', 'YES', 'BUY');
      expect(price).toBe(0.194);
    });

    it('returns the correct price for YES outcome on SELL side (bestBid)', async () => {
      mockClient.markets.bbo.mockResolvedValue({
        marketData: {
          marketSlug: 'test-market',
          bestAsk: { value: '0.1940', currency: 'USD' },
          bestBid: { value: '0.1930', currency: 'USD' },
          shortQuote: { value: '0.8070', currency: 'USD' },
        }
      });

      const price = await getPolymarketUsOutcomePrice('test-market', 'YES', 'SELL');
      expect(price).toBe(0.193);
    });

    it('returns the correct price for NO outcome on BUY side (shortQuote)', async () => {
      mockClient.markets.bbo.mockResolvedValue({
        marketData: {
          marketSlug: 'test-market',
          bestAsk: { value: '0.1940', currency: 'USD' },
          bestBid: { value: '0.1930', currency: 'USD' },
          shortQuote: { value: '0.8070', currency: 'USD' },
        }
      });

      const price = await getPolymarketUsOutcomePrice('test-market', 'NO', 'BUY');
      expect(price).toBe(0.807);
    });

    it('returns the correct price for NO outcome on SELL side (1 - bestAsk)', async () => {
      mockClient.markets.bbo.mockResolvedValue({
        marketData: {
          marketSlug: 'test-market',
          bestAsk: { value: '0.1940', currency: 'USD' },
          bestBid: { value: '0.1930', currency: 'USD' },
          shortQuote: { value: '0.8070', currency: 'USD' },
        }
      });

      const price = await getPolymarketUsOutcomePrice('test-market', 'NO', 'SELL');
      expect(price).toBe(0.806); // 1 - 0.194
    });

    it('falls back to 1 - bestBid for NO outcome on BUY side if shortQuote is missing', async () => {
      mockClient.markets.bbo.mockResolvedValue({
        marketData: {
          marketSlug: 'test-market',
          bestAsk: { value: '0.1940', currency: 'USD' },
          bestBid: { value: '0.1930', currency: 'USD' },
        }
      });

      const price = await getPolymarketUsOutcomePrice('test-market', 'NO', 'BUY');
      expect(price).toBe(0.807); // 1 - 0.193
    });
  });
});
