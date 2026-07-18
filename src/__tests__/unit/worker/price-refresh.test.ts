import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPriceRefresh } from '@/worker/jobs/price-refresh';
import * as dbLib from '@/lib/db';
import * as polymarketLib from '@/lib/polymarket';
import * as kalshiLib from '@/lib/kalshi';
import * as polymarketUsLib from '@/lib/polymarket-us';
import { Redis } from '@upstash/redis';

vi.mock('@/lib/db');
vi.mock('@/lib/polymarket');
vi.mock('@/lib/kalshi');
vi.mock('@/lib/polymarket-us');
vi.mock('@upstash/redis');

describe('Price Refresh Job', () => {
  let mockDb: {
    query: { positions: { findMany: ReturnType<typeof vi.fn> } };
    update: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockDb = {
      query: {
        positions: {
          findMany: vi.fn()
        }
      },
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([])
    };

    vi.spyOn(dbLib, 'getDb').mockReturnValue(
      mockDb as unknown as ReturnType<typeof dbLib.getDb>,
    );
    vi.spyOn(Redis, 'fromEnv').mockImplementation(() => {
      throw new Error('No redis in test env');
    });
  });

  it('does nothing if there are no open positions', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([]);
    const count = await runPriceRefresh();
    expect(count).toBe(0);
    expect(polymarketLib.getMidpoint).not.toHaveBeenCalled();
  });

  it('fetches prices and updates db for Polymarket positions uniquely', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: '1', tokenId: 'tokenA', outcome: 'YES' },
      { id: '2', tokenId: 'tokenB', outcome: 'NO' },
      { id: '3', tokenId: 'tokenA', outcome: 'YES' }, // Duplicate token
    ]);

    vi.spyOn(polymarketLib, 'getMidpoint').mockImplementation(async (tokenId) => {
      if (tokenId === 'tokenA') return 0.65;
      if (tokenId === 'tokenB') return 0.35;
      return 0;
    });

    const count = await runPriceRefresh();
    
    // We expect exactly 2 unique tokens processed
    expect(count).toBe(2);
    expect(polymarketLib.getMidpoint).toHaveBeenCalledTimes(2);
    expect(polymarketLib.getMidpoint).toHaveBeenCalledWith('tokenA');
    expect(polymarketLib.getMidpoint).toHaveBeenCalledWith('tokenB');
    
    // DB update should be called twice
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('fetches prices via Kalshi public API for KX-prefixed tickers', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: '1', tokenId: 'KXBTC15M-26JUL091115-15:NO', outcome: 'NO', shares: '10' },
      { id: '2', tokenId: 'kalshi:KXBTCD-26JUL0914-T62999.99:YES', outcome: 'YES', shares: '10' },
      { id: '3', tokenId: 'polyTokenA', outcome: 'YES' }, // Polymarket position
    ]);

    vi.spyOn(polymarketLib, 'getMidpoint').mockResolvedValue(0.50);
    vi.spyOn(kalshiLib, 'getKalshiOrderBook').mockImplementation(async (ticker, outcome) => ({
      market: ticker,
      assetId: `kalshi:${ticker}:${outcome}`,
      timestamp: new Date().toISOString(),
      bids: [{ price: outcome === 'NO' ? 0.25 : 0.60, size: 10 }],
      asks: [],
    }));

    const count = await runPriceRefresh();
    
    // 1 Polymarket token + 2 Kalshi tickers
    expect(count).toBe(3);

    // Polymarket called once
    expect(polymarketLib.getMidpoint).toHaveBeenCalledTimes(1);
    expect(polymarketLib.getMidpoint).toHaveBeenCalledWith('polyTokenA');

    // Kalshi called twice (one per unique ticker:outcome)
    expect(kalshiLib.getKalshiOrderBook).toHaveBeenCalledTimes(2);
    expect(kalshiLib.getKalshiOrderBook).toHaveBeenCalledWith('KXBTC15M-26JUL091115-15', 'NO');
    expect(kalshiLib.getKalshiOrderBook).toHaveBeenCalledWith('KXBTCD-26JUL0914-T62999.99', 'YES');

    // 3 DB updates total (1 Polymarket + 2 Kalshi)
    expect(mockDb.update).toHaveBeenCalledTimes(3);
  });

  it('refreshes Polymarket US positions from the US venue with the stored outcome', async () => {
    vi.spyOn(polymarketUsLib, 'parsePolymarketUsTokenId').mockImplementation((tokenId) => {
      const match = /^polymarket_us:(.+):(YES|NO)$/.exec(tokenId);
      return match ? { slug: match[1], outcome: match[2] as 'YES' | 'NO' } : null;
    });
    mockDb.query.positions.findMany.mockResolvedValue([
      {
        id: 'us-1',
        platform: 'polymarket_us',
        tokenId: 'polymarket_us:house-midterms:NO',
        outcome: 'NO',
        shares: '10',
      },
      {
        id: 'us-2',
        platform: 'polymarket_us',
        tokenId: 'polymarket_us:house-midterms:YES',
        outcome: 'YES',
        shares: '10',
      },
    ]);
    vi.spyOn(polymarketUsLib, 'getPolymarketUsOutcomeOrderBook').mockImplementation(async (slug, outcome) => ({
      market: slug,
      assetId: `${slug}:${outcome}`,
      timestamp: new Date().toISOString(),
      bids: [{ price: outcome === 'NO' ? 0.82 : 0.18, size: 10 }],
      asks: [],
    }));

    const count = await runPriceRefresh();

    expect(count).toBe(2);
    expect(polymarketUsLib.getPolymarketUsOutcomeOrderBook).toHaveBeenCalledWith(
      'house-midterms',
      'NO',
    );
    expect(polymarketLib.getMidpoint).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('marks a position at zero when full displayed sell depth is insufficient', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: 'us-thin', platform: 'polymarket_us', tokenId: 'polymarket_us:thin:YES', outcome: 'YES', shares: '10' },
    ]);
    vi.spyOn(polymarketUsLib, 'parsePolymarketUsTokenId').mockReturnValue({ slug: 'thin', outcome: 'YES' });
    vi.spyOn(polymarketUsLib, 'getPolymarketUsOutcomeOrderBook').mockResolvedValue({
      market: 'thin', assetId: 'thin:YES', timestamp: new Date().toISOString(),
      bids: [{ price: 0.4, size: 2 }], asks: [],
    });

    await runPriceRefresh();

    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ currentPrice: '0.000000' }));
  });
});
