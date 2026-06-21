// =============================================================================
// Unit Tests: Polymarket API Client — Normalization & Error Handling
// =============================================================================
//
// Tests the pure normalization functions and the fetchJson error-path
// behavior by mocking global fetch. Validates that the JSON-inside-JSON
// parsing quirk from the Gamma API is handled correctly, and that
// network/timeout errors produce structured PolymarketApiError instances.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMarkets,
  getMarket,
  getMidpoint,
  getSpread,
  getLastTradePrice,
  getOrderBook,
  getPriceHistory,
  PolymarketApiError,
} from '@/lib/polymarket';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper to create a mock Response
// ---------------------------------------------------------------------------

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Market normalization (JSON-inside-JSON handling)
// ---------------------------------------------------------------------------

describe('getMarkets — normalization', () => {
  it('correctly parses JSON-encoded clobTokenIds, outcomes, outcomePrices', async () => {
    const rawMarket = {
      id: 'market-1',
      question: 'Will X happen?',
      conditionId: 'cond-1',
      slug: 'will-x-happen',
      clobTokenIds: '["token-yes","token-no"]',
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.65","0.35"]',
      lastTradePrice: 0.65,
      bestBid: 0.64,
      bestAsk: 0.66,
      spread: 0.02,
      volume24hr: 50000,
      liquidityClob: 25000,
      liquidity: null,
      image: 'https://example.com/img.png',
      icon: null,
      description: 'A test market',
      category: 'politics',
      closed: false,
      active: true,
      archived: false,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    mockFetch.mockResolvedValue(mockResponse([{ id: 'event-1', title: 'Event 1', category: 'politics', tags: [], markets: [rawMarket] }]));

    const markets = await getMarkets({ limit: 1 });
    expect(markets).toHaveLength(1);

    const m = markets[0];
    expect(m.tokenIds).toEqual(['token-yes', 'token-no']);
    expect(m.outcomes).toEqual(['Yes', 'No']);
    expect(m.outcomePrices).toEqual([0.65, 0.35]);
    expect(m.question).toBe('Will X happen?');
    expect(m.closed).toBe(false);
    expect(m.liquidity).toBe(25000); // prefers liquidityClob over liquidity
  });

  it('handles malformed JSON in clobTokenIds gracefully', async () => {
    const rawMarket = {
      id: 'market-bad',
      question: 'Bad data',
      conditionId: 'cond-bad',
      slug: 'bad-data',
      clobTokenIds: 'not-valid-json',
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.5","0.5"]',
      closed: false,
      active: true,
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce(mockResponse(rawMarket));
    const market = await getMarket('market-bad');

    expect(market.tokenIds).toEqual([]); // fallback
  });

  it('handles empty outcomePrices string', async () => {
    const rawMarket = {
      id: 'market-empty',
      question: 'Empty prices',
      conditionId: 'c',
      slug: 's',
      clobTokenIds: '[]',
      outcomes: '[]',
      outcomePrices: '',
      closed: false,
      active: true,
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce(mockResponse(rawMarket));
    const market = await getMarket('market-empty');
    expect(market.outcomePrices).toEqual([]); // fallback
  });

  it('converts non-numeric price strings to 0', async () => {
    const rawMarket = {
      id: 'market-nan',
      question: 'NaN prices',
      conditionId: 'c',
      slug: 's',
      clobTokenIds: '[]',
      outcomes: '["Yes","No"]',
      outcomePrices: '["abc","def"]',
      closed: false,
      active: true,
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce(mockResponse(rawMarket));
    const market = await getMarket('market-nan');
    expect(market.outcomePrices).toEqual([0, 0]);
  });

  it('returns empty array when API returns non-array', async () => {
    mockFetch.mockResolvedValue(mockResponse({ error: 'bad' }));
    const markets = await getMarkets();
    expect(markets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getMarket (single market)
// ---------------------------------------------------------------------------

describe('getMarket', () => {
  it('fetches and normalizes a single market', async () => {
    const raw = {
      id: 'single-1',
      question: 'Single market?',
      conditionId: 'c1',
      slug: 'single',
      clobTokenIds: '["t1","t2"]',
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.8","0.2"]',
      closed: false,
      active: true,
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(raw));

    const market = await getMarket('single-1');
    expect(market.id).toBe('single-1');
    expect(market.outcomePrices).toEqual([0.8, 0.2]);
  });

  it('URL-encodes the market ID', async () => {
    const raw = {
      id: 'with/special chars',
      question: 'Encoded?',
      conditionId: 'c',
      slug: 's',
      clobTokenIds: '[]',
      outcomes: '[]',
      outcomePrices: '[]',
      closed: false,
      active: true,
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(raw));
    await getMarket('with/special chars');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('with%2Fspecial%20chars');
  });
});

// ---------------------------------------------------------------------------
// CLOB API pricing functions
// ---------------------------------------------------------------------------

describe('getMidpoint', () => {
  it('parses string midpoint to number', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ mid: '0.55' }));
    const result = await getMidpoint('token-abc');
    expect(result).toBe(0.55);
  });

  it('returns 0 for non-numeric midpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ mid: 'N/A' }));
    const result = await getMidpoint('token-abc');
    expect(result).toBe(0);
  });
});

describe('getSpread', () => {
  it('parses string spread to number', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ spread: '0.02' }));
    const result = await getSpread('token-abc');
    expect(result).toBe(0.02);
  });
});

describe('getLastTradePrice', () => {
  it('returns price and side', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ price: '0.72', side: 'BUY' }),
    );
    const result = await getLastTradePrice('token-abc');
    expect(result).toEqual({ price: 0.72, side: 'BUY' });
  });

  it('handles missing side field', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ price: '0.5' }));
    const result = await getLastTradePrice('token-abc');
    expect(result.side).toBe('UNKNOWN');
  });
});

describe('getOrderBook', () => {
  it('normalizes bids and asks from string to number', async () => {
    const raw = {
      market: 'mkt-1',
      asset_id: 'asset-1',
      hash: 'h1',
      timestamp: '2026-01-01T00:00:00Z',
      bids: [
        { price: '0.50', size: '100' },
        { price: '0.49', size: '200' },
      ],
      asks: [{ price: '0.52', size: '50' }],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(raw));

    const book = await getOrderBook('token-1');
    expect(book.bids).toEqual([
      { price: 0.5, size: 100 },
      { price: 0.49, size: 200 },
    ]);
    expect(book.asks).toEqual([{ price: 0.52, size: 50 }]);
  });

  it('handles empty order book', async () => {
    const raw = {
      market: 'mkt-2',
      asset_id: 'a2',
      hash: 'h2',
      timestamp: '',
      bids: [],
      asks: [],
    };
    mockFetch.mockResolvedValueOnce(mockResponse(raw));

    const book = await getOrderBook('token-2');
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
  });

  it('handles missing bids/asks arrays', async () => {
    const raw = {
      market: 'mkt-3',
      asset_id: 'a3',
      hash: 'h3',
      timestamp: '',
    };
    mockFetch.mockResolvedValueOnce(mockResponse(raw));

    const book = await getOrderBook('token-3');
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
  });
});

describe('getPriceHistory', () => {
  it('returns normalized price points', async () => {
    const raw = [
      { t: 1700000000, p: 0.5 },
      { t: 1700003600, p: 0.55 },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(raw));

    const history = await getPriceHistory('cond-1');
    expect(history).toEqual([
      { timestamp: 1700000000, price: 0.5 },
      { timestamp: 1700003600, price: 0.55 },
    ]);
  });

  it('returns empty array for non-array response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'not found' }));
    const history = await getPriceHistory('cond-bad');
    expect(history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('API error handling', () => {
  it('throws PolymarketApiError on HTTP 404', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Not found' }, 404),
    );

    await expect(getMarket('nonexistent')).rejects.toThrow(
      PolymarketApiError,
    );
    await expect(getMarket('nonexistent')).rejects.toThrow(
      PolymarketApiError,
    );
  });

  it('throws PolymarketApiError on HTTP 500', async () => {
    mockFetch.mockResolvedValue(
      mockResponse('Internal Server Error', 500),
    );

    try {
      await getMarkets();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketApiError);
      expect((err as PolymarketApiError).statusCode).toBe(500);
    }
  });

  it('throws PolymarketApiError on network failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      await getMarkets();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketApiError);
      expect((err as PolymarketApiError).statusCode).toBeNull();
      expect((err as PolymarketApiError).message).toContain('Network error');
    }
  });

  it('throws PolymarketApiError on timeout (AbortError)', async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new DOMException('Aborted', 'AbortError'), {}),
    );

    try {
      await getMarkets();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketApiError);
      expect((err as PolymarketApiError).message).toContain('timed out');
    }
  });
});
