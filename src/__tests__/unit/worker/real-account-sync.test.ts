import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/official-trading', () => ({
  getOfficialPortfolioSnapshot: vi.fn(),
  kalshiOrderQuantity: vi.fn(() => 10),
  normalizeKalshiOrderStatus: vi.fn(() => 'PARTIALLY_FILLED'),
}));

import { getDb } from '@/lib/db';
import { getOfficialPortfolioSnapshot } from '@/lib/official-trading';
import { runRealAccountSync } from '@/worker/jobs/real-account-sync';

describe('real account sync job', () => {
  const insertValues = vi.fn(async () => undefined);
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    query: {
      strategies: {
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(db as never);
  });

  it('fetches one private snapshot for two strategies sharing a Kalshi key', async () => {
    db.query.strategies.findMany.mockResolvedValue([
      { id: 'strategy-1', userId: 'user-1', platform: 'kalshi', agentMode: 'real' },
      { id: 'strategy-2', userId: 'user-2', platform: 'kalshi', agentMode: 'real' },
    ]);
    vi.mocked(getOfficialPortfolioSnapshot).mockResolvedValue({
      cash: 1000,
      positionsValue: 50,
      totalValue: 1050,
      pnl: 10,
      positions: [],
      orders: [{ order_id: 'official-1', initial_count_fp: '10.00' }],
      fills: [],
      activity: [],
      raw: {},
    });

    await expect(runRealAccountSync()).resolves.toMatchObject({
      accounts_synced: 1,
      strategies_synced: 2,
      errors: [],
    });
    expect(getOfficialPortfolioSnapshot).toHaveBeenCalledTimes(1);
    expect(getOfficialPortfolioSnapshot).toHaveBeenCalledWith('kalshi');
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PARTIALLY_FILLED',
      quantity: '10.000000',
    }));
  });
});
