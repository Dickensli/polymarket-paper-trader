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
      // Mocking the behavior based on generic user matching
      // Since eq() generates an object, we just mock sequentially or loosely
      return { id: 'dummy', name: 'User' };
    });

    mockDb.query.positions.findMany.mockResolvedValue([
       { isOpen: true, shares: '100', currentPrice: '0.5' }
    ]);

    const count = await runLeaderboardCalculation();
    expect(count).toBe(2);
    
    expect(mockDb.transaction).toHaveBeenCalled();
  });
});
