import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResolutionCheck } from '@/worker/jobs/resolution-handler';
import * as dbLib from '@/lib/db';
import * as polymarketLib from '@/lib/polymarket';

vi.mock('@/lib/db');
vi.mock('@/lib/polymarket');

describe('Resolution Handler Job', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDb = {
      query: {
        positions: {
          findMany: vi.fn()
        }
      },
      transaction: vi.fn(async (cb) => {
        const tx = {
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          for: vi.fn().mockResolvedValue([{ balance: '100.00' }])
        };
        await cb(tx);
      })
    };

    vi.spyOn(dbLib, 'getDb').mockReturnValue(mockDb as any);
  });

  it('skips if no open positions', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([]);
    const count = await runResolutionCheck();
    expect(count).toBe(0);
    expect(polymarketLib.getMarket).not.toHaveBeenCalled();
  });

  it('skips if market is not closed', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: 'pos1', marketId: 'marketA', tokenId: 'tokenYES', shares: '10' }
    ]);
    vi.spyOn(polymarketLib, 'getMarket').mockResolvedValue({
      closed: false
    } as any);

    const count = await runResolutionCheck();
    expect(count).toBe(0);
  });

  it('settles positions correctly for a resolved market', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: 'pos1', marketId: 'marketA', tokenId: 'tokenYES', shares: '10', portfolioId: 'port1' },
      { id: 'pos2', marketId: 'marketA', tokenId: 'tokenNO', shares: '5', portfolioId: 'port2' }
    ]);

    vi.spyOn(polymarketLib, 'getMarket').mockResolvedValue({
      id: 'marketA',
      closed: true,
      tokenIds: ['tokenYES', 'tokenNO'],
      outcomePrices: [1, 0] // YES won
    } as any);

    const count = await runResolutionCheck();
    
    // We expect 2 positions to be settled
    expect(count).toBe(2);
    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
  });
});
