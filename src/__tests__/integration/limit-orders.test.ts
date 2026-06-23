// =============================================================================
// Integration Tests: Limit Orders ↔ Database
// =============================================================================

import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';
import { users, portfolios, limitOrders, positions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createLimitOrder,
  cancelLimitOrder,
  cancelAllOrders,
  getPendingOrders,
  getAllOrders,
  checkAndFillOrders,
} from '@/lib/limit-orders';
import { getPortfolio, executeTrade, TradingError } from '@/lib/trading-engine';
import * as polymarket from '@/lib/polymarket';

vi.mock('@/lib/polymarket', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/polymarket')>();
  return {
    ...original,
    getMidpoint: vi.fn(original.getMidpoint),
    getMarket: vi.fn(async (id: string) => ({
      id,
      question: 'Mock Question',
      conditionId: id,
      slug: `mock-${id}`,
      tokenIds: ['token-yes', 'token-no'],
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.5, 0.5],
      closed: false,
      startDate: null,
      endDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }) as any),
  };
});

const testUserIds: string[] = [];

const createTestUser = async (): Promise<string> => {
  const userId = randomUUID();
  const db = getDb();
  await db.insert(users).values({
    id: userId,
    email: `test-${userId}@example.com`,
    name: `Test User ${userId.slice(0, 8)}`,
  });
  testUserIds.push(userId);
  return userId;
};

afterAll(async () => {
  const db = getDb();
  for (const uid of testUserIds) {
    await db.delete(users).where(eq(users.id, uid));
  }
});

describe('Limit Orders Integration', () => {
  describe('createLimitOrder', () => {
    it('creates a pending limit BUY order', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId); // provision portfolio

      const order = await createLimitOrder(userId, {
        marketId: 'market-1',
        marketQuestion: 'Will it happen?',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 100,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      expect(order.status).toBe('PENDING');
      expect(Number(order.amount)).toBe(100);
      expect(Number(order.limitPrice)).toBe(0.5);

      const pending = await getPendingOrders(userId);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(order.id);
    });

    it('fails to create limit BUY order if amount exceeds balance', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      await expect(
        createLimitOrder(userId, {
          marketId: 'market-1',
          tokenId: 'token-yes',
          outcome: 'YES',
          side: 'BUY',
          amount: 20000, // exceeds $10,000 initial balance
          limitPrice: 0.5,
          orderType: 'GTC',
        })
      ).rejects.toThrowError(TradingError);
    });

    it('fails to create limit SELL order if position does not exist', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      await expect(
        createLimitOrder(userId, {
          marketId: 'market-1',
          tokenId: 'token-yes',
          outcome: 'YES',
          side: 'SELL',
          amount: 50,
          limitPrice: 0.5,
          orderType: 'GTC',
        })
      ).rejects.toThrowError(TradingError);
    });

    it('creates a pending limit SELL order if user holds the position', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      // Buy some shares first
      await executeTrade(userId, {
        marketId: 'market-1',
        marketQuestion: 'Will it happen?',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        shares: 100,
        price: 0.5,
      });

      const order = await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'SELL',
        amount: 50,
        limitPrice: 0.6,
        orderType: 'GTC',
      });

      expect(order.status).toBe('PENDING');
      expect(order.side).toBe('SELL');
      expect(Number(order.amount)).toBe(50);
    });

    it('fails to create limit SELL order if user does not hold enough shares', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      // Buy 50 shares
      await executeTrade(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        shares: 50,
        price: 0.5,
      });

      await expect(
        createLimitOrder(userId, {
          marketId: 'market-1',
          tokenId: 'token-yes',
          outcome: 'YES',
          side: 'SELL',
          amount: 100, // wants to sell 100 but only holds 50
          limitPrice: 0.6,
          orderType: 'GTC',
        })
      ).rejects.toThrowError(TradingError);
    });

    it('fails to create GTD order without expiresAt or with past expiresAt', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      await expect(
        createLimitOrder(userId, {
          marketId: 'market-1',
          tokenId: 'token-yes',
          outcome: 'YES',
          side: 'BUY',
          amount: 100,
          limitPrice: 0.5,
          orderType: 'GTD',
        })
      ).rejects.toThrow('GTD orders require an expiresAt timestamp');

      await expect(
        createLimitOrder(userId, {
          marketId: 'market-1',
          tokenId: 'token-yes',
          outcome: 'YES',
          side: 'BUY',
          amount: 100,
          limitPrice: 0.5,
          orderType: 'GTD',
          expiresAt: new Date(Date.now() - 10000).toISOString(), // in the past
        })
      ).rejects.toThrow('expiresAt must be in the future');
    });
  });

  describe('cancelLimitOrder', () => {
    it('cancels a pending limit order', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      const order = await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 100,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      await cancelLimitOrder(userId, order.id);

      const all = await getAllOrders(userId);
      expect(all[0].status).toBe('CANCELLED');
    });

    it('fails to cancel a non-existent or completed order', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      await expect(
        cancelLimitOrder(userId, randomUUID())
      ).rejects.toThrow('Order not found');
    });
  });

  describe('cancelAllOrders', () => {
    it('cancels all pending orders for user', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 100,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      await createLimitOrder(userId, {
        marketId: 'market-2',
        tokenId: 'token-no',
        outcome: 'NO',
        side: 'BUY',
        amount: 200,
        limitPrice: 0.4,
        orderType: 'GTC',
      });

      const count = await cancelAllOrders(userId);
      expect(count).toBe(2);

      const pending = await getPendingOrders(userId);
      expect(pending).toHaveLength(0);
    });

    it('cancels pending orders filtered by marketId', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 100,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      await createLimitOrder(userId, {
        marketId: 'market-2',
        tokenId: 'token-no',
        outcome: 'NO',
        side: 'BUY',
        amount: 200,
        limitPrice: 0.4,
        orderType: 'GTC',
      });

      const count = await cancelAllOrders(userId, 'market-1');
      expect(count).toBe(1);

      const pending = await getPendingOrders(userId);
      expect(pending).toHaveLength(1);
      expect(pending[0].marketId).toBe('market-2');
    });
  });

  describe('checkAndFillOrders (fill logic)', () => {
    it('expires GTD orders that are past their expiry', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      const db = getDb();
      const portfolio = await db.query.portfolios.findFirst({ where: eq(portfolios.userId, userId) });

      // Insert manually with past expiry to bypass creation validation
      const [order] = await db
        .insert(limitOrders)
        .values({
          id: randomUUID(),
          userId,
          portfolioId: portfolio!.id,
          marketId: 'market-1',
          tokenId: 'token-yes',
          outcome: 'YES',
          side: 'BUY',
          amount: '100.000000',
          limitPrice: '0.500000',
          orderType: 'GTD',
          expiresAt: new Date(Date.now() - 5000), // expired
          status: 'PENDING',
        })
        .returning();

      const counts = await checkAndFillOrders(userId);
      expect(counts.expired).toBe(1);

      const updated = await db.query.limitOrders.findFirst({ where: eq(limitOrders.id, order.id) });
      expect(updated?.status).toBe('EXPIRED');
    });

    it('fills a limit BUY order when midpoint drops to or below limitPrice', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      const order = await createLimitOrder(userId, {
        marketId: 'market-1',
        marketQuestion: 'Is it cheap?',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 100, // USD
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      // Mock live price below the limit price
      vi.mocked(polymarket.getMidpoint).mockResolvedValue(0.48);

      const counts = await checkAndFillOrders(userId);
      expect(counts.filled).toBe(1);

      const db = getDb();
      const updated = await db.query.limitOrders.findFirst({ where: eq(limitOrders.id, order.id) });
      expect(updated?.status).toBe('FILLED');
      expect(updated?.filledTradeId).toBeDefined();

      const portfolio = await getPortfolio(userId);
      expect(portfolio.balance).toBeLessThan(10000);
      expect(portfolio.positions).toHaveLength(1);
      // Fills at mock midpoint 0.48
      expect(portfolio.positions[0].shares).toBeCloseTo(100 / 0.48, 2);
    });

    it('does NOT fill a limit BUY order if midpoint is above limitPrice', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      const order = await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 100,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      // Mock live price above limit price
      vi.mocked(polymarket.getMidpoint).mockResolvedValue(0.52);

      const counts = await checkAndFillOrders(userId);
      expect(counts.filled).toBe(0);

      const db = getDb();
      const updated = await db.query.limitOrders.findFirst({ where: eq(limitOrders.id, order.id) });
      expect(updated?.status).toBe('PENDING');
    });

    it('fills a limit SELL order when midpoint rises to or above limitPrice', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      // Buy shares first
      await executeTrade(userId, {
        marketId: 'market-1',
        marketQuestion: 'Is it cheap?',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        shares: 100,
        price: 0.5,
      });

      const order = await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'SELL',
        amount: 100, // shares
        limitPrice: 0.6,
        orderType: 'GTC',
      });

      // Mock live price above limit price
      vi.mocked(polymarket.getMidpoint).mockResolvedValue(0.62);

      const counts = await checkAndFillOrders(userId);
      expect(counts.filled).toBe(1);

      const db = getDb();
      const updated = await db.query.limitOrders.findFirst({ where: eq(limitOrders.id, order.id) });
      expect(updated?.status).toBe('FILLED');

      const portfolio = await getPortfolio(userId);
      expect(portfolio.positions[0]?.shares || 0).toBe(0);
      expect(portfolio.balance).toBeCloseTo(10000 - 50 + 62, 0); // initial - buy + sell (100 * 0.62)
    });

    it('rejects a pending order if trade execution fails permanently', async () => {
      const userId = await createTestUser();
      await getPortfolio(userId);

      // Create a buy order for $5000 (valid based on $10,000 initial balance)
      const order1 = await createLimitOrder(userId, {
        marketId: 'market-1',
        tokenId: 'token-yes',
        outcome: 'YES',
        side: 'BUY',
        amount: 5000,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      // Create another buy order for $6000
      const order2 = await createLimitOrder(userId, {
        marketId: 'market-2',
        tokenId: 'token-no',
        outcome: 'NO',
        side: 'BUY',
        amount: 6000,
        limitPrice: 0.5,
        orderType: 'GTC',
      });

      // Mock live price trigger
      vi.mocked(polymarket.getMidpoint).mockResolvedValue(0.45);

      // Both orders are eligible to fill.
      // The worker processes them sequentially.
      // Order 1 executes first, spending ~$5000. Balance becomes ~$5000.
      // Order 2 tries to execute next, but now fails due to INSUFFICIENT_BALANCE.
      // Order 2 should be marked REJECTED (since insufficient balance is a permanent failure).
      const counts = await checkAndFillOrders(userId);
      expect(counts.filled).toBe(1);
      expect(counts.cancelled).toBe(1); // Rejected counts as cancelled in result

      const db = getDb();
      const u1 = await db.query.limitOrders.findFirst({ where: eq(limitOrders.id, order1.id) });
      const u2 = await db.query.limitOrders.findFirst({ where: eq(limitOrders.id, order2.id) });

      expect(u1?.status).toBe('FILLED');
      expect(u2?.status).toBe('REJECTED');
    });
  });
});
