import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/official-trading', () => ({
  getOfficialPortfolioSnapshot: vi.fn(),
  getOfficialKalshiHistoricalFills: vi.fn().mockResolvedValue([]),
  kalshiOrderQuantity: vi.fn(() => 10),
  normalizeKalshiOrderStatus: vi.fn(() => 'PARTIALLY_FILLED'),
}));

import { getDb } from '@/lib/db';
import { getOfficialPortfolioSnapshot } from '@/lib/official-trading';
import { runRealAccountSync } from '@/worker/jobs/real-account-sync';

describe('real account sync job', () => {
  const insertValues = vi.fn(async () => undefined);
  const onConflictDoNothing = vi.fn(async () => undefined);
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const ledgerInsertValues = vi.fn(() => ({ onConflictDoNothing }));
  const syncInsertValues = vi.fn(() => ({ onConflictDoUpdate }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    query: {
      strategies: {
        findMany: vi.fn(),
      },
      realTradeOrders: {
        findMany: vi.fn(),
      },
      officialSyncState: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: table && typeof table === 'object' && 'cash' in table
        ? insertValues
        : table && typeof table === 'object' && 'resource' in table
          ? syncInsertValues
        : ledgerInsertValues,
    })),
    update: vi.fn(() => ({ set: updateSet })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(db as never);
    db.query.realTradeOrders.findMany.mockResolvedValue([]);
    db.query.officialSyncState.findFirst.mockResolvedValue({ lastSuccessAt: new Date() });
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
      orders: [{
        order_id: 'official-1', status: 'resting', initial_count_fp: '10.00',
        fill_count_fp: '4.00', remaining_count_fp: '6.00', last_update_time: '2026-07-13T01:00:00Z',
      }],
      fills: [],
      settlements: [],
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
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(3);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PARTIALLY_FILLED',
      quantity: '10.000000',
    }));
  });
});
