import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResolutionCheck } from '@/worker/jobs/resolution-handler';
import * as dbLib from '@/lib/db';
import * as polymarketLib from '@/lib/polymarket';
import * as polymarketUsLib from '@/lib/polymarket-us';

vi.mock('@/lib/db');
vi.mock('@/lib/polymarket');
vi.mock('@/lib/polymarket-us');

describe('Resolution Handler Job', () => {
  let mockDb: {
    query: { positions: { findMany: ReturnType<typeof vi.fn> } };
    transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockDb = {
      query: {
        positions: {
          findMany: vi.fn()
        }
      },
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
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

    vi.spyOn(dbLib, 'getDb').mockReturnValue(mockDb as unknown as ReturnType<typeof dbLib.getDb>);
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
    } as unknown as Awaited<ReturnType<typeof polymarketLib.getMarket>>);

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
    } as unknown as Awaited<ReturnType<typeof polymarketLib.getMarket>>);

    const count = await runResolutionCheck();
    
    // We expect 2 positions to be settled
    expect(count).toBe(2);
    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
  });

  it('uses the Polymarket US settlement price for US positions', async () => {
    mockDb.query.positions.findMany.mockResolvedValue([
      { id: 'pos-us', platform: 'polymarket_us', marketId: 'usa-market', outcome: 'YES', tokenId: 'polymarket_us:usa-market:YES', shares: '4', avgEntryPrice: '0.4', realizedPnl: '0', portfolioId: 'port1', userId: 'user1' },
    ]);
    vi.spyOn(polymarketUsLib, 'getPolymarketUsMarketSettlement').mockResolvedValue({
      marketSlug: 'usa-market', settlementPrice: { value: '1', currency: 'USD' }, settledAt: '2026-07-12T00:00:00Z',
    });

    await expect(runResolutionCheck()).resolves.toBe(1);
    expect(polymarketUsLib.getPolymarketUsMarketSettlement).toHaveBeenCalledWith('usa-market');
    expect(polymarketLib.getMarket).not.toHaveBeenCalled();
  });
});
