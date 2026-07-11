import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPriceRefresh } from '@/worker/jobs/price-refresh';
import * as dbLib from '@/lib/db';
import * as polymarketLib from '@/lib/polymarket';
import * as kalshiLib from '@/lib/kalshi';
import { Redis } from '@upstash/redis';

vi.mock('@/lib/db');
vi.mock('@/lib/polymarket');
vi.mock('@/lib/kalshi');
vi.mock('@upstash/redis');

describe('Price Refresh Job', () => {
  let mockDb: any;

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

    vi.spyOn(dbLib, 'getDb').mockReturnValue(mockDb as any);
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
      { id: '1', tokenId: 'KXBTC15M-26JUL091115-15:NO', outcome: 'NO' },
      { id: '2', tokenId: 'kalshi:KXBTCD-26JUL0914-T62999.99:YES', outcome: 'YES' },
      { id: '3', tokenId: 'polyTokenA', outcome: 'YES' }, // Polymarket position
    ]);

    vi.spyOn(polymarketLib, 'getMidpoint').mockResolvedValue(0.50);
    vi.spyOn(kalshiLib, 'getKalshiOutcomePrice').mockImplementation(
      async (ticker, outcome) => {
        if (ticker === 'KXBTC15M-26JUL091115-15' && outcome === 'NO') return 0.25;
        if (ticker === 'KXBTCD-26JUL0914-T62999.99' && outcome === 'YES') return 0.60;
        return null;
      }
    );

    const count = await runPriceRefresh();
    
    // 1 Polymarket token + 2 Kalshi tickers
    expect(count).toBe(3);

    // Polymarket called once
    expect(polymarketLib.getMidpoint).toHaveBeenCalledTimes(1);
    expect(polymarketLib.getMidpoint).toHaveBeenCalledWith('polyTokenA');

    // Kalshi called twice (one per unique ticker:outcome)
    expect(kalshiLib.getKalshiOutcomePrice).toHaveBeenCalledTimes(2);
    expect(kalshiLib.getKalshiOutcomePrice).toHaveBeenCalledWith('KXBTC15M-26JUL091115-15', 'NO');
    expect(kalshiLib.getKalshiOutcomePrice).toHaveBeenCalledWith('KXBTCD-26JUL0914-T62999.99', 'YES');

    // 3 DB updates total (1 Polymarket + 2 Kalshi)
    expect(mockDb.update).toHaveBeenCalledTimes(3);
  });
});
