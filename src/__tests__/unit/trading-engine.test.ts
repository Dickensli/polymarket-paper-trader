import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTrade, closePosition, TradingError } from '@/lib/trading-engine';
import * as dbLib from '@/lib/db';

vi.mock('@/lib/db');

describe('Trading Engine Core', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDb = {
      query: {
        users: { findFirst: vi.fn() },
        portfolios: { findFirst: vi.fn() },
        positions: { findFirst: vi.fn() }
      },
      transaction: vi.fn(async (cb) => {
        const tx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockResolvedValue([{ id: 'port1', balance: '1000' }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: 'trade1', executedAt: new Date() }]),
        };
        return await cb(tx);
      })
    };

    vi.spyOn(dbLib, 'getDb').mockReturnValue(mockDb as any);
  });

  describe('executeTrade', () => {
    it('executes a buy trade successfully', async () => {
      mockDb.query.portfolios.findFirst.mockResolvedValue({ id: 'port1', balance: '1000' });
      
      await executeTrade('user1', {
        marketId: 'market1',
        marketQuestion: 'Will something happen?',
        tokenId: 'tokenYES',
        outcome: 'YES',
        side: 'BUY',
        shares: 200,
        price: 0.5,
        idempotencyKey: 'idemp-123',
        slippageApplied: 0.01
      });

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('throws TradingError if price is invalid', async () => {
      await expect(executeTrade('user1', {
        marketId: 'market1',
        marketQuestion: '?',
        tokenId: 't1',
        outcome: 'YES',
        side: 'BUY',
        shares: 100,
        price: 1.5, // Invalid
        idempotencyKey: 'idemp-123',
      })).rejects.toThrow(TradingError);
    });

    it('throws TradingError if shares are invalid', async () => {
      await expect(executeTrade('user1', {
        marketId: 'market1',
        marketQuestion: '?',
        tokenId: 't1',
        outcome: 'YES',
        side: 'BUY',
        shares: -5, // Invalid
        price: 0.5,
      })).rejects.toThrow(TradingError);
    });
  });

  describe('closePosition', () => {
    it('closes the position successfully', async () => {
      mockDb.query.positions.findFirst.mockResolvedValue({
        id: 'pos1',
        portfolioId: 'port1',
        marketId: 'market1',
        marketQuestion: 'Question?',
        tokenId: 'tokenYES',
        outcome: 'YES',
        shares: '200',
        isOpen: true,
      });
      await closePosition('user1', 'pos1', 0.5);
      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });
});
