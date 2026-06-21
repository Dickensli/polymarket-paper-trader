import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPriceRefresh } from '@/worker/jobs/price-refresh';
import * as dbLib from '@/lib/db';
import * as polymarketLib from '@/lib/polymarket';
import { Redis } from '@upstash/redis';

vi.mock('@/lib/db');
vi.mock('@/lib/polymarket');
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

  it('fetches prices and updates db for open positions uniquely', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: '1', tokenId: 'tokenA' },
      { id: '2', tokenId: 'tokenB' },
      { id: '3', tokenId: 'tokenA' }, // Duplicate token
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
});
