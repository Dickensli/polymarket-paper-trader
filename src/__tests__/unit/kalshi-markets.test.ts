import { afterEach, describe, expect, it, vi } from 'vitest';

import { getKalshiMarkets } from '@/lib/kalshi';

describe('Kalshi market batch lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
