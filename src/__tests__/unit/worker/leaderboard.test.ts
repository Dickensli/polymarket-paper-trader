import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLeaderboardCalculation } from '@/worker/jobs/leaderboard';
import * as dbLib from '@/lib/db';

vi.mock('@/lib/db');

describe('Leaderboard Job', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDb = {
      query: {
        portfolios: {
          findMany: vi.fn()
        },
        users: {
          findFirst: vi.fn()
        },
        positions: {
          findMany: vi.fn()
        },
        strategies: {
          findMany: vi.fn()
        }
      },
      transaction: vi.fn(async (cb) => {
        const tx = {
          delete: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis()
        };
        await cb(tx);
      })
    };

    vi.spyOn(dbLib, 'getDb').mockReturnValue(mockDb as any);
  });

  it('skips if no portfolios', async () => {
    mockDb.query.portfolios.findMany.mockResolvedValue([]);
    const count = await runLeaderboardCalculation();
    expect(count).toBe(0);
  });

  it('calculates portfolio value and ranks correctly', async () => {
    mockDb.query.portfolios.findMany.mockResolvedValue([
      { id: 'port1', userId: 'user1', balance: '5000', initialBalance: '10000' },
      { id: 'port2', userId: 'user2', balance: '12000', initialBalance: '10000' },
    ]);

    mockDb.query.users.findFirst.mockImplementation(async ({ where }: any) => {
      return { id: 'dummy', name: 'User' };
    });

    mockDb.query.positions.findMany.mockResolvedValue([
       { isOpen: true, shares: '100', currentPrice: '0.5' }
    ]);

    mockDb.query.strategies.findMany.mockResolvedValue([
       { id: 'strat1', userId: 'dummy', agentMode: 'paper', status: 'active', platform: 'kalshi' }
    ]);

    const count = await runLeaderboardCalculation();
    expect(count).toBe(2);
    
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('uses local positions for real trading users (same as paper)', async () => {
    // Real trading positions are mirrored locally by /api/agent/real-trades
    // and currentPrice is updated by runPriceRefresh via public API.
    // The leaderboard should use the same balance + positions formula.
    mockDb.query.portfolios.findMany.mockResolvedValue([
      { id: 'port1', userId: 'user1', balance: '4000', initialBalance: '5000' },
    ]);

    mockDb.query.users.findFirst.mockResolvedValue({ id: 'user1', name: 'Real Trader' });

    mockDb.query.positions.findMany.mockResolvedValue([
       { isOpen: true, shares: '50', currentPrice: '0.60' }
    ]);

    mockDb.query.strategies.findMany.mockResolvedValue([
       { id: 'strat-real', userId: 'user1', agentMode: 'real', status: 'active', platform: 'kalshi' }
    ]);

    const count = await runLeaderboardCalculation();
    expect(count).toBe(1);
    expect(mockDb.transaction).toHaveBeenCalled();

    // Verify the transaction was called with correct snapshot values:
    // portfolioValue = balance(4000) + shares(50) * currentPrice(0.60) = 4030
    // totalPnl = 4030 - 5000 = -970
    const txFn = mockDb.transaction.mock.calls[0][0];
    const tx = {
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis()
    };
    await txFn(tx);

    // The ALL_TIME insert should have portfolioValue = 4030
    const allTimeInsertCall = tx.values.mock.calls[0][0];
    expect(Number(allTimeInsertCall[0].portfolioValue)).toBeCloseTo(4030, 2);
    expect(Number(allTimeInsertCall[0].totalPnl)).toBeCloseTo(-970, 2);
  });
});
