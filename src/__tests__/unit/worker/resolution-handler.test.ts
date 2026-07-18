import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResolutionCheck } from '@/worker/jobs/resolution-handler';
import * as dbLib from '@/lib/db';
import * as polymarketLib from '@/lib/polymarket';
import * as polymarketUsLib from '@/lib/polymarket-us';
import { ledgerEntries, paperTrades } from '@/lib/db/schema';

vi.mock('@/lib/db');
vi.mock('@/lib/polymarket');
vi.mock('@/lib/polymarket-us');

describe('Resolution Handler Job', () => {
  let mockDb: {
    query: {
      positions: { findMany: ReturnType<typeof vi.fn> };
      paperTrades: { findFirst: ReturnType<typeof vi.fn> };
    };
    transaction: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockDb = {
      query: {
        positions: {
          findMany: vi.fn()
        },
        paperTrades: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const updateChain = {
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{
            id: 'settled-position', userId: 'user-1', portfolioId: 'portfolio-1',
            marketId: 'market-1', tokenId: 'token-1', outcome: 'YES',
            shares: '10', avgEntryPrice: '0.5', realizedPnl: '0',
          }]),
        };
        const tx = {
          update: vi.fn(() => updateChain),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockResolvedValue([{ balance: '100.00' }])
        };
        return cb(tx);
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

  it('does not credit or record a position already settled by another worker', async () => {
    const inserts: unknown[] = [];
    mockDb.query.positions.findMany.mockResolvedValue([
      {
        id: 'pos-race', userId: 'user-1', portfolioId: 'portfolio-1',
        marketId: 'market-race', tokenId: 'token-yes', outcome: 'YES',
        shares: '10', avgEntryPrice: '0.4', realizedPnl: '0',
      },
    ]);
    vi.spyOn(polymarketLib, 'getMarket').mockResolvedValue({
      id: 'market-race', closed: true, tokenIds: ['token-yes', 'token-no'], outcomePrices: [1, 0],
    } as unknown as Awaited<ReturnType<typeof polymarketLib.getMarket>>);
    mockDb.transaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      const tx = {
        update: vi.fn(() => updateChain),
        insert: vi.fn((table: unknown) => ({
          values: vi.fn((values: unknown) => {
            inserts.push({ table, values });
            return Promise.resolve();
          }),
        })),
      };
      return cb(tx);
    });

    await expect(runResolutionCheck()).resolves.toBe(0);
    expect(inserts).toEqual([]);
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

  it('attributes settlement trades and writes balanced cash ledger entries', async () => {
    const inserts: Array<{ table: unknown; values: unknown }> = [];
    mockDb.query.positions.findMany.mockResolvedValue([
      {
        id: 'pos-ledger', userId: 'user-1', portfolioId: 'portfolio-1',
        platform: 'polymarket', marketId: 'market-ledger', marketQuestion: 'Resolved?',
        tokenId: 'token-yes', outcome: 'YES', shares: '10', avgEntryPrice: '0.4', realizedPnl: '0',
      },
    ]);
    mockDb.query.paperTrades.findFirst.mockResolvedValue({ strategyId: 'strategy-1' });
    vi.spyOn(polymarketLib, 'getMarket').mockResolvedValue({
      id: 'market-ledger', closed: true, tokenIds: ['token-yes', 'token-no'], outcomePrices: [1, 0],
    } as unknown as Awaited<ReturnType<typeof polymarketLib.getMarket>>);
    mockDb.transaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{
          id: 'pos-ledger', userId: 'user-1', portfolioId: 'portfolio-1',
          platform: 'polymarket', marketId: 'market-ledger', marketQuestion: 'Resolved?',
          tokenId: 'token-yes', outcome: 'YES', shares: '10', avgEntryPrice: '0.4', realizedPnl: '0',
        }]),
      };
      const tx = {
        update: vi.fn(() => updateChain),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({ for: vi.fn().mockResolvedValue([{ balance: '100.00' }]) })),
          })),
        })),
        insert: vi.fn((table: unknown) => ({
          values: vi.fn((values: unknown) => {
            inserts.push({ table, values });
            return Promise.resolve();
          }),
        })),
      };
      return cb(tx);
    });

    await expect(runResolutionCheck()).resolves.toBe(1);

    const settlementTrade = inserts.find((entry) => entry.table === paperTrades)?.values as Record<string, unknown>;
    expect(settlementTrade).toMatchObject({ strategyId: 'strategy-1', totalCost: '10.00' });
    const settlementLedger = inserts.find((entry) => entry.table === ledgerEntries)?.values as Array<Record<string, unknown>>;
    expect(settlementLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountType: 'CASH', amount: '10.000000', balanceAfter: '110.000000' }),
      expect.objectContaining({ accountType: 'POSITION', amount: '-10.000000' }),
    ]));
  });
});
