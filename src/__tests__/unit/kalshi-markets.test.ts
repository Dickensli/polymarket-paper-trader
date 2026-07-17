import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getKalshiMarkets,
  getKalshiOutcomePriceFromMarket,
  normalizeKalshiOrderBook,
  resolveKalshiMarketDataBaseUrl,
} from '@/lib/kalshi';

describe('Kalshi market batch lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps live market data independent from demo official execution', () => {
    expect(resolveKalshiMarketDataBaseUrl({ KALSHI_USE_DEMO: 'true' }))
      .toBe('https://external-api.kalshi.com/trade-api/v2');
    expect(resolveKalshiMarketDataBaseUrl({ KALSHI_USE_DEMO: 'true', KALSHI_MARKET_DATA_ENV: 'demo' }))
      .toBe('https://demo-api.kalshi.co/trade-api/v2');
    expect(resolveKalshiMarketDataBaseUrl({ KALSHI_MARKET_DATA_BASE_URL: 'https://quotes.example/v2/' }))
      .toBe('https://quotes.example/v2');
  });

  it('normalizes Kalshi bid-only YES/NO ladders into an outcome order book', () => {
    const yesBook = normalizeKalshiOrderBook('KXTEST', 'YES', {
      orderbook_fp: {
        yes_dollars: [['0.45', '100'], ['0.40', '50']],
        no_dollars: [['0.48', '30'], ['0.42', '70']],
      },
    });

    expect(yesBook.bids).toEqual([
      { price: 0.45, size: 100 },
      { price: 0.4, size: 50 },
    ]);
    expect(yesBook.asks).toEqual([
      { price: 0.52, size: 30 },
      { price: 0.58, size: 70 },
    ]);

    const noBook = normalizeKalshiOrderBook('KXTEST', 'NO', {
      orderbook_fp: {
        yes_dollars: [['0.45', '100']],
        no_dollars: [['0.48', '30']],
      },
    });
    expect(noBook.bids).toEqual([{ price: 0.48, size: 30 }]);
    expect(noBook.asks).toEqual([{ price: 0.55, size: 100 }]);
  });

  it('does not invent sell liquidity by falling back from a missing bid to the ask', () => {
    expect(getKalshiOutcomePriceFromMarket({ yes_ask_dollars: '0.75' }, 'YES', 'SELL')).toBeNull();
    expect(getKalshiOutcomePriceFromMarket({ yes_bid_dollars: '0.70', yes_ask_dollars: '0.75' }, 'YES', 'SELL')).toBe(0.70);
  });

  it('uses the tickers filter instead of one request per market', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        markets: [
          { ticker: 'KXBTC15M-BATCH-ONE', title: 'BTC price up?' },
          { ticker: 'KXETH15M-BATCH-TWO', title: 'ETH price up?' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const markets = await getKalshiMarkets([
      'KXBTC15M-BATCH-ONE',
      'KXETH15M-BATCH-TWO',
      'KXBTC15M-BATCH-ONE',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe('/trade-api/v2/markets');
    expect(requestUrl.searchParams.get('tickers')).toBe('KXBTC15M-BATCH-ONE,KXETH15M-BATCH-TWO');
    expect(markets.get('KXBTC15M-BATCH-ONE')?.title).toBe('BTC price up?');
    expect(markets.get('KXETH15M-BATCH-TWO')?.title).toBe('ETH price up?');
  });

  it('chunks large lookups to keep request URLs bounded', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: URL) => {
      const tickers = new URL(String(input)).searchParams.get('tickers')?.split(',') ?? [];
      return {
        ok: true,
        json: async () => ({ markets: tickers.map((ticker) => ({ ticker, title: `Title ${ticker}` })) }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const tickers = Array.from({ length: 101 }, (_, index) => `KXBATCH-${index}`);

    const markets = await getKalshiMarkets(tickers);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(markets).toHaveLength(101);
  });

  it('retries transient batch failures before falling back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '0' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          markets: [{ ticker: 'KXRETRY-UNIQUE', title: 'Recovered market' }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const markets = await getKalshiMarkets(['KXRETRY-UNIQUE']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(markets.get('KXRETRY-UNIQUE')?.title).toBe('Recovered market');
  });
});
