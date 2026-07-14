// =============================================================================
// Integration Tests: Trading Engine ↔ Database
// =============================================================================
//
// These tests exercise the full trading engine against the live Supabase
// PostgreSQL database. Each test uses a unique userId (UUID) to guarantee
// isolation without needing transaction rollbacks.
//
// Covers:
//  - Portfolio auto-provisioning
//  - Buy / sell lifecycle (positions, balance, ledger entries)
//  - Position averaging (multiple buys into same market)
//  - Partial sells
//  - Full position close
//  - Insufficient balance rejection
//  - Sell-without-position rejection
//  - Over-sell rejection
//  - Invalid price / shares boundary enforcement
//  - Portfolio reset
//  - Double-entry ledger accounting invariant
//  - Concurrent trade race conditions
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  getPortfolio,
  executeTrade,
  closePosition,
   resetPortfolio,
  getTradeHistory,
  TradingError,
  runResolutionCheckForUser,
} from '@/lib/trading-engine';
import { getDb } from '@/lib/db';
import { users, ledgerEntries, portfolios, paperTrades, positions, marketCache } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import * as polymarket from '@/lib/polymarket';
import * as polymarketUs from '@/lib/polymarket-us';
import * as kalshi from '@/lib/kalshi';

vi.mock('@/lib/kalshi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/kalshi')>();
  return {
    ...original,
    getKalshiMarket: vi.fn(async (ticker: string) => ({
      ticker,
      status: 'active',
    } as any)),
    getKalshiOutcomePrice: vi.fn(async () => 0.5),
  };
});

vi.mock('@/lib/polymarket-us', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/polymarket-us')>();
  return {
    ...original,
    getPolymarketUsMarket: vi.fn(async (slug: string) => ({
      slug,
      question: 'Mock Question US',
      closed: false,
      active: true,
    } as any)),
    getPolymarketUsOutcomePrice: vi.fn(async () => 0.5),
  };
});

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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Track all user IDs created during tests for cleanup */
const testUserIds: string[] = [];

/** Create a fresh test user in the database to satisfy foreign keys */
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

const validBuyParams = (overrides = {}) => ({
  marketId: `test-market-${randomUUID().slice(0, 8)}`,
  marketQuestion: 'Will test pass?',
  tokenId: `test-token-${randomUUID().slice(0, 8)}`,
  outcome: 'YES' as const,
  side: 'BUY' as const,
  shares: 100,
  price: 0.5,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

afterAll(async () => {
  // Clean up all test data. Cascading foreign keys will clean up referenced tables.
  const db = getDb();
  for (const uid of testUserIds) {
    await db.delete(users).where(eq(users.id, uid));
  }
});

// ---------------------------------------------------------------------------
// Portfolio Auto-Provisioning
// ---------------------------------------------------------------------------

describe('Portfolio auto-provisioning', () => {
  it('creates a new portfolio with $10,000 balance for unknown user', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);

    const portfolio = await getPortfolio(userId);

    expect(portfolio.balance).toBe(10000);
    expect(portfolio.positions).toEqual([]);
    expect(portfolio.tradeHistory).toEqual([]);
    expect(portfolio.totalValue).toBe(10000);
    expect(portfolio.totalPnL).toBe(0);
    expect(portfolio.totalPnLPercent).toBe(0);
  });

  it('returns the same portfolio on subsequent calls (idempotent)', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);

    const p1 = await getPortfolio(userId);
    const p2 = await getPortfolio(userId);

    expect(p1.balance).toBe(p2.balance);
    expect(p1.totalValue).toBe(p2.totalValue);
  });
});

// ---------------------------------------------------------------------------
// Buy Trade Execution
// ---------------------------------------------------------------------------

describe('Buy trade execution', () => {
  it('deducts balance and creates a position', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId); // auto-provision

    const params = validBuyParams({ shares: 100, price: 0.5 });
    const trade = await executeTrade(userId, params);

    expect(trade.side).toBe('BUY');
    expect(trade.shares).toBe(100);
    expect(trade.price).toBe(0.5);
    expect(trade.total).toBe(50); // 100 * 0.5

    const portfolio = await getPortfolio(userId);
    expect(portfolio.balance).toBe(9950); // 10000 - 50
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.positions[0].shares).toBe(100);
    expect(portfolio.positions[0].outcome).toBe('YES');
  });

  it('creates correct double-entry ledger records', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ shares: 50, price: 0.8 });
    const trade = await executeTrade(userId, params);

    const db = getDb();
    const entries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.tradeId, trade.id),
    });

    expect(entries).toHaveLength(2);

    const cashEntry = entries.find((e) => e.accountType === 'CASH');
    const posEntry = entries.find((e) => e.accountType === 'POSITION');

    expect(cashEntry).toBeDefined();
    expect(posEntry).toBeDefined();

    // Cash goes down, position goes up — equal and opposite
    const cashAmount = Number(cashEntry!.amount);
    const posAmount = Number(posEntry!.amount);
    expect(cashAmount).toBe(-40); // -(50 * 0.8)
    expect(posAmount).toBe(40);
    expect(cashAmount + posAmount).toBe(0); // double-entry invariant
  });

  it('averages position price when buying into same market/outcome', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const marketId = `avg-market-${randomUUID().slice(0, 8)}`;
    const tokenId = `avg-token-${randomUUID().slice(0, 8)}`;

    // First buy: 100 @ 0.40
    await executeTrade(
      userId,
      validBuyParams({ marketId, tokenId, shares: 100, price: 0.4 }),
    );
    // Second buy: 100 @ 0.60
    await executeTrade(
      userId,
      validBuyParams({ marketId, tokenId, shares: 100, price: 0.6 }),
    );

    const portfolio = await getPortfolio(userId);
    const pos = portfolio.positions.find((p) => p.marketId === marketId);

    expect(pos).toBeDefined();
    expect(pos!.shares).toBe(200);
    // Weighted avg: (100*0.4 + 100*0.6) / 200 = 0.5
    expect(pos!.avgEntryPrice).toBeCloseTo(0.5, 4);
  });

  it('creates separate positions for YES and NO in same market', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const marketId = `dual-market-${randomUUID().slice(0, 8)}`;

    await executeTrade(
      userId,
      validBuyParams({
        marketId,
        tokenId: 'yes-token',
        outcome: 'YES',
        shares: 50,
        price: 0.6,
      }),
    );
    await executeTrade(
      userId,
      validBuyParams({
        marketId,
        tokenId: 'no-token',
        outcome: 'NO',
        shares: 50,
        price: 0.4,
      }),
    );

    const portfolio = await getPortfolio(userId);
    const yesPos = portfolio.positions.find(
      (p) => p.marketId === marketId && p.outcome === 'YES',
    );
    const noPos = portfolio.positions.find(
      (p) => p.marketId === marketId && p.outcome === 'NO',
    );

    expect(yesPos).toBeDefined();
    expect(noPos).toBeDefined();
    expect(yesPos!.shares).toBe(50);
    expect(noPos!.shares).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Sell Trade Execution
// ---------------------------------------------------------------------------

describe('Sell trade execution', () => {
  it('credits balance and reduces position on partial sell', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ shares: 100, price: 0.5 });
    await executeTrade(userId, params);

    // Sell half at a higher price
    const sellTrade = await executeTrade(userId, {
      ...params,
      side: 'SELL',
      shares: 50,
      price: 0.7,
    });

    expect(sellTrade.side).toBe('SELL');
    expect(sellTrade.shares).toBe(50);
    expect(sellTrade.total).toBe(35); // 50 * 0.7

    const portfolio = await getPortfolio(userId);
    expect(portfolio.balance).toBe(9985); // 10000 - 50 + 35
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.positions[0].shares).toBe(50); // 100 - 50
  });

  it('closes position when selling all shares', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ shares: 100, price: 0.5 });
    await executeTrade(userId, params);

    // Sell all
    await executeTrade(userId, { ...params, side: 'SELL', shares: 100 });

    const portfolio = await getPortfolio(userId);
    expect(portfolio.positions).toHaveLength(0); // closed positions excluded
    expect(portfolio.balance).toBe(10000); // 10000 - 50 + 50
    const db = getDb();
    const closed = await db.query.positions.findFirst({
      where: and(eq(positions.userId, userId), eq(positions.marketId, params.marketId)),
    });
    expect(closed).toMatchObject({ isOpen: false, closeReason: 'USER_CLOSED', platform: 'polymarket' });
    expect(closed?.closedAt).toBeInstanceOf(Date);
    expect(closed?.resolvedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Close Position
// ---------------------------------------------------------------------------

describe('closePosition', () => {
  it('sells entire position at given price', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ shares: 200, price: 0.3 });
    const buyTrade = await executeTrade(userId, params);

    // Get the position
    const portfolio = await getPortfolio(userId);
    const pos = portfolio.positions[0];

    const closeTrade = await closePosition(userId, pos.id, 0.6);
    expect(closeTrade.side).toBe('SELL');
    expect(closeTrade.shares).toBe(200);
    expect(closeTrade.total).toBe(120); // 200 * 0.6

    const final = await getPortfolio(userId);
    expect(final.positions).toHaveLength(0);
    expect(final.balance).toBe(10060); // 10000 - 60 + 120
  });

  it('throws POSITION_NOT_FOUND for non-existent position', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      closePosition(userId, randomUUID(), 0.5),
    ).rejects.toThrow(TradingError);

    try {
      await closePosition(userId, randomUUID(), 0.5);
    } catch (err) {
      expect((err as TradingError).code).toBe('POSITION_NOT_FOUND');
    }
  });

  it('throws POSITION_NOT_FOUND when position belongs to different user', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    testUserIds.push(user1, user2);
    await getPortfolio(user1);
    await getPortfolio(user2);

    const params = validBuyParams({ shares: 50, price: 0.5 });
    await executeTrade(user1, params);

    const p1 = await getPortfolio(user1);
    const posId = p1.positions[0].id;

    // user2 should NOT be able to close user1's position
    await expect(closePosition(user2, posId, 0.5)).rejects.toThrow(
      TradingError,
    );
  });
});

// ---------------------------------------------------------------------------
// Error Cases — Insufficient Balance
// ---------------------------------------------------------------------------

describe('Insufficient balance', () => {
  it('rejects buy when total exceeds balance', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Try to buy $10,001 worth
    const params = validBuyParams({ shares: 10001, price: 1.0 });
    await expect(executeTrade(userId, params)).rejects.toThrow(TradingError);

    try {
      await executeTrade(userId, params);
    } catch (err) {
      expect((err as TradingError).code).toBe('INSUFFICIENT_BALANCE');
    }
  });

  it('rejects buy at exact balance boundary + 1 cent', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Spend almost everything
    await executeTrade(
      userId,
      validBuyParams({ shares: 9999, price: 1.0 }),
    );

    const portfolio = await getPortfolio(userId);
    expect(portfolio.balance).toBe(1); // $1 remaining

    // Try to buy $1.01 worth
    await expect(
      executeTrade(
        userId,
        validBuyParams({ shares: 1.01, price: 1.0 }),
      ),
    ).rejects.toThrow(TradingError);
  });

  it('allows buy at exactly remaining balance', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Spend down to $100
    await executeTrade(
      userId,
      validBuyParams({ shares: 9900, price: 1.0 }),
    );

    // Buy exactly $100
    const trade = await executeTrade(
      userId,
      validBuyParams({ shares: 100, price: 1.0 }),
    );
    expect(trade.total).toBe(100);

    const portfolio = await getPortfolio(userId);
    expect(portfolio.balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Error Cases — Invalid Sell
// ---------------------------------------------------------------------------

describe('Invalid sell operations', () => {
  it('rejects sell when no position exists', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ side: 'SELL', shares: 50, price: 0.5 });
    await expect(executeTrade(userId, params)).rejects.toThrow(TradingError);

    try {
      await executeTrade(userId, params);
    } catch (err) {
      expect((err as TradingError).code).toBe('POSITION_NOT_FOUND');
    }
  });

  it('rejects sell exceeding held shares', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ shares: 100, price: 0.5 });
    await executeTrade(userId, params);

    // Try to sell 200 when only 100 held
    await expect(
      executeTrade(userId, { ...params, side: 'SELL', shares: 200 }),
    ).rejects.toThrow(TradingError);

    try {
      await executeTrade(userId, { ...params, side: 'SELL', shares: 200 });
    } catch (err) {
      expect((err as TradingError).code).toBe('INVALID_SHARES');
    }
  });
});

// ---------------------------------------------------------------------------
// Error Cases — Validation Boundaries
// ---------------------------------------------------------------------------

describe('Trading engine validation boundaries', () => {
  it('rejects price > 1.0', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ price: 1.01 })),
    ).rejects.toThrow(TradingError);

    try {
      await executeTrade(userId, validBuyParams({ price: 1.01 }));
    } catch (err) {
      expect((err as TradingError).code).toBe('INVALID_PRICE');
    }
  });

  it('rejects negative price', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ price: -0.01 })),
    ).rejects.toThrow(TradingError);
  });

  it('rejects shares below MIN_SHARES (0.01)', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ shares: 0.005 })),
    ).rejects.toThrow(TradingError);
  });

  it('rejects NaN shares', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ shares: NaN })),
    ).rejects.toThrow(TradingError);
  });

  it('rejects Infinity shares', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ shares: Infinity })),
    ).rejects.toThrow(TradingError);
  });

  it('rejects missing marketId', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ marketId: '' })),
    ).rejects.toThrow(TradingError);
  });

  it('rejects missing tokenId', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await expect(
      executeTrade(userId, validBuyParams({ tokenId: '' })),
    ).rejects.toThrow(TradingError);
  });

  it('rejects buy with total below MIN_TRADE_AMOUNT ($1)', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // 0.5 shares * 0.5 price = $0.25 — below $1 minimum
    await expect(
      executeTrade(userId, validBuyParams({ shares: 0.5, price: 0.5 })),
    ).rejects.toThrow(TradingError);
  });
});

// ---------------------------------------------------------------------------
// Portfolio Reset
// ---------------------------------------------------------------------------

describe('Portfolio reset', () => {
  it('restores balance to $10,000 and clears all positions/history', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Execute a few trades
    const params = validBuyParams({ shares: 100, price: 0.5 });
    await executeTrade(userId, params);

    await executeTrade(userId, { ...params, side: 'SELL', shares: 50 });

    // Reset
    const fresh = await resetPortfolio(userId);

    expect(fresh.balance).toBe(10000);
    expect(fresh.positions).toHaveLength(0);
    expect(fresh.tradeHistory).toHaveLength(0);
    expect(fresh.totalPnL).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Trade History
// ---------------------------------------------------------------------------

describe('Trade history', () => {
  it('returns trades in descending chronological order', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    await executeTrade(
      userId,
      validBuyParams({ shares: 10, price: 0.3 }),
    );
    await executeTrade(
      userId,
      validBuyParams({ shares: 20, price: 0.4 }),
    );
    await executeTrade(
      userId,
      validBuyParams({ shares: 30, price: 0.5 }),
    );

    const trades = await getTradeHistory(userId, 10);
    expect(trades).toHaveLength(3);

    // Most recent first
    expect(trades[0].shares).toBe(30);
    expect(trades[1].shares).toBe(20);
    expect(trades[2].shares).toBe(10);
  });

  it('respects the limit parameter', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    for (let i = 0; i < 5; i++) {
      await executeTrade(
        userId,
        validBuyParams({ shares: 10, price: 0.1 }),
      );
    }

    const trades = await getTradeHistory(userId, 3);
    expect(trades).toHaveLength(3);
  });

  it('returns empty array for user with no trades', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const trades = await getTradeHistory(userId);
    expect(trades).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Double-Entry Ledger Accounting Invariant
// ---------------------------------------------------------------------------

describe('Ledger accounting invariant', () => {
  it('ensures sum of all ledger entries equals zero after buy + sell cycle', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const params = validBuyParams({ shares: 100, price: 0.5 });
    await executeTrade(userId, params);
    await executeTrade(userId, { ...params, side: 'SELL', shares: 100, price: 0.7 });

    const db = getDb();
    const result = await db
      .select({ total: sql<string>`SUM(CAST(amount AS DECIMAL))` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId));

    const totalLedger = Number(result[0]?.total ?? 0);
    expect(totalLedger).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------
// Concurrent Trade Safety
// ---------------------------------------------------------------------------

describe('Concurrent trade safety', () => {
  it('handles simultaneous buys without corruption', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Fire 5 concurrent buys of $100 each
    const promises = Array.from({ length: 5 }, (_, i) =>
      executeTrade(
        userId,
        validBuyParams({
          marketId: `concurrent-market-${i}`,
          tokenId: `concurrent-token-${i}`,
          shares: 100,
          price: 1.0,
        }),
      ),
    );

    const results = await Promise.allSettled(promises);

    // All should succeed since total = 5 * $100 = $500 < $10,000
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(5);

    const portfolio = await getPortfolio(userId);
    expect(portfolio.balance).toBe(9500); // 10000 - 500
    expect(portfolio.positions).toHaveLength(5);
  });

  it('correctly rejects when concurrent buys exceed balance', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Fire 3 concurrent buys of $5,000 each — only 2 can succeed
    const promises = Array.from({ length: 3 }, async (_, i) => {
      try {
        const trade = await executeTrade(
          userId,
          validBuyParams({
            marketId: `race-market-${i}`,
            tokenId: `race-token-${i}`,
            shares: 5000,
            price: 1.0,
          }),
        );
        return trade;
      } catch (err) {
        throw err;
      }
    });

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(1);

    // The rejected one should be INSUFFICIENT_BALANCE
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(TradingError);
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
  });
});

describe('Portfolio price refresh timeout', () => {
  it('does not block getPortfolio and falls back to cached prices if live price fetch hangs', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    // Buy a token to create an active position
    await executeTrade(
      userId,
      validBuyParams({
        shares: 100,
        price: 0.5,
        tokenId: 'hang-token-id',
      }),
    );

    // Mock getMidpoint to hang indefinitely (resolve after 3 seconds)
    const spy = vi.spyOn(polymarket, 'getMidpoint').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(0.9), 3000))
    );

    const startTime = Date.now();
    const portfolio = await getPortfolio(userId);
    const duration = Date.now() - startTime;

    // It should resolve fast (under 2.5 seconds) due to 1s timeout
    expect(duration).toBeLessThan(2500);

    // And it should return the cached price of the position (which is 0.5, not the hung 0.9)
    const pos = portfolio.positions.find((p) => p.tokenId === 'hang-token-id');
    expect(pos).toBeDefined();
    expect(pos?.currentPrice).toBe(0.5);

    spy.mockImplementation(async () => 50);
  });
});

describe('Portfolio price refresh database cache fallback', () => {
  it.skip('falls back to database marketCache prices if live price fetch fails or returns null', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const testMarketId = `fallback-market-${randomUUID().slice(0, 8)}`;
    const testTokenId = `fallback-token-${randomUUID().slice(0, 8)}`;

    // Populate marketCache table with the outcome price of the token
    const db = getDb();
    await db.insert(marketCache).values({
      id: testMarketId,
      question: 'Will fallback work?',
      tokenIds: [testTokenId, 'other-token'],
      outcomePrices: ['0.75', '0.25'],
    });

    // Buy the token to create an active position with entry price 0.5
    await executeTrade(
      userId,
      validBuyParams({
        marketId: testMarketId,
        tokenId: testTokenId,
        shares: 100,
        price: 0.5,
      }),
    );

    // Mock getMidpoint to fail (throw error/return null)
    const spy = vi.spyOn(polymarket, 'getMidpoint').mockImplementation(
      () => Promise.reject(new Error('CLOB 404'))
    );

    const portfolio = await getPortfolio(userId);

    // It should fallback to database cache price (0.75) instead of remaining at buy price (0.5)
    const pos = portfolio.positions.find((p) => p.tokenId === testTokenId);
    expect(pos).toBeDefined();
    expect(pos?.currentPrice).toBe(0.75);

    // P&L should be calculated using the fallback price: 100 * (0.75 - 0.5) = $25.00
    expect(pos?.unrealizedPnL).toBe(25.00);

    spy.mockImplementation(async () => 50);

    // Clean up test market from cache
    await db.delete(marketCache).where(eq(marketCache.id, testMarketId));
  });

  it.skip('falls back to direct getMarket Gamma API query if live price fetch fails AND database marketCache is missing', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const testMarketId = `api-market-${randomUUID().slice(0, 8)}`;
    const testTokenId = `api-token-${randomUUID().slice(0, 8)}`;

    // Buy the token to create an active position with entry price 0.4
    await executeTrade(
      userId,
      validBuyParams({
        marketId: testMarketId,
        tokenId: testTokenId,
        shares: 100,
        price: 0.4,
      }),
    );

    // Verify database marketCache does not have this market
    const db = getDb();
    await db.delete(marketCache).where(eq(marketCache.id, testMarketId));

    // Mock getMidpoint to fail (throw error/return null)
    const midpointSpy = vi.spyOn(polymarket, 'getMidpoint').mockImplementation(
      () => Promise.reject(new Error('CLOB 404'))
    );

    // Mock getMarket to return mock data from the Gamma API
    const marketSpy = vi.spyOn(polymarket, 'getMarket').mockImplementation(
      (id) => Promise.resolve({
        id,
        question: 'Will Gamma fallback work?',
        conditionId: 'mock-condition-id',
        tokenIds: [testTokenId, 'other-token'],
        outcomePrices: [0.85, 0.15],
        closed: false,
        active: true,
        endDate: new Date().toISOString(),
        slug: 'mock-slug',
        outcomes: ['Yes', 'No'],
        lastTradePrice: 0.85,
        bestBid: 0.84,
        bestAsk: 0.86,
        spread: 0.02,
        volume24hr: 1000,
        liquidity: 5000,
        image: null,
        icon: null,
        description: null,
        category: 'Test',
        startDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const portfolio = await getPortfolio(userId);

    // It should query Gamma API, cache it, and use the 0.85 price
    const pos = portfolio.positions.find((p) => p.tokenId === testTokenId);
    expect(pos).toBeDefined();
    expect(pos?.currentPrice).toBe(0.85);

    // P&L should be calculated using the fallback price: 100 * (0.85 - 0.40) = $45.00
    expect(pos?.unrealizedPnL).toBe(45.00);

    // It should have cached the market in the database marketCache
    const cached = await db.query.marketCache.findFirst({
      where: eq(marketCache.id, testMarketId),
    });
    expect(cached).toBeDefined();
    expect(cached?.question).toBe('Will Gamma fallback work?');

    midpointSpy.mockImplementation(async () => 50);
    marketSpy.mockImplementation(async (id: string) => ({
      id,
      question: 'Mock Question',
      conditionId: id,
      slug: `mock-${id}`,
      tokenIds: ['token-yes', 'token-no'],
      outcomes: ['YES', 'NO'],
      active: true,
      closed: false,
    } as any));

    // Clean up test market from cache
    await db.delete(marketCache).where(eq(marketCache.id, testMarketId));
  });
});

describe('On-the-fly position resolution and auto-settlement', () => {
  it('automatically settles positions and credits cash balance when getPortfolio is called for resolved markets', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);

    // Initial balance is $10,000
    const initialPortfolio = await getPortfolio(userId);
    expect(initialPortfolio.balance).toBe(10000);

    const testMarketId = `resolve-market-${randomUUID().slice(0, 8)}`;
    const testTokenId = `resolve-token-${randomUUID().slice(0, 8)}`;

    // Buy 100 shares of outcome YES at 0.60 price (cost = 100 * 0.60 = $60 + fees)
    const tradeResult = await executeTrade(
      userId,
      validBuyParams({
        marketId: testMarketId,
        tokenId: testTokenId,
        shares: 100,
        price: 0.6,
      }),
    );

    const portfolioAfterBuy = await getPortfolio(userId);
    const balanceAfterBuy = portfolioAfterBuy.balance;
    expect(portfolioAfterBuy.positions.length).toBe(1);

    // Mock getMarket Gamma API call to return the market as closed/resolved to YES (YES token price is 1.0)
    const marketSpy = vi.spyOn(polymarket, 'getMarket').mockImplementation(
      (id) => Promise.resolve({
        id,
        question: 'Will Japan win?',
        conditionId: 'mock-condition-id',
        tokenIds: [testTokenId, 'other-token'],
        outcomePrices: [1.0, 0.0], // YES token won!
        closed: true, // Market is resolved
        active: false,
        endDate: new Date().toISOString(),
        slug: 'mock-slug',
        outcomes: ['Yes', 'No'],
        lastTradePrice: 1.0,
        bestBid: 1.0,
        bestAsk: 1.0,
        spread: 0.0,
        volume24hr: 1000,
        liquidity: 5000,
        image: null,
        icon: null,
        description: null,
        category: 'Test',
        startDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Query portfolio - this should trigger the on-the-fly resolution check!
    await runResolutionCheckForUser(userId);
    const portfolioAfterResolve = await getPortfolio(userId);

    // Position should be closed and no longer in active positions
    expect(portfolioAfterResolve.positions.length).toBe(0);

    // Cash balance should be credited with proceeds from win: 100 shares * $1.00 = $100.00
    // New balance = balanceAfterBuy + $100.00
    expect(portfolioAfterResolve.balance).toBe(balanceAfterBuy + 100.00);

    // Verify database position isOpen is now false
    const db = getDb();
    const dbPos = await db.query.positions.findFirst({
      where: and(
        eq(positions.userId, userId),
        eq(positions.tokenId, testTokenId)
      ),
    });
    expect(dbPos?.isOpen).toBe(false);
    expect(Number(dbPos?.currentPrice)).toBe(1.0);

    // Verify trade history has the SELL settlement trade logged
    const history = await getTradeHistory(userId);
    const settleTrade = history.find((t) => t.marketId === testMarketId && t.side === 'SELL');
    expect(settleTrade).toBeDefined();
    expect(settleTrade?.shares).toBe(100);
    expect(settleTrade?.price).toBe(1.0);
    expect(settleTrade?.total).toBe(100.00);

    marketSpy.mockImplementation(async (id: string) => ({
      id,
      question: 'Mock Question',
      conditionId: id,
      slug: `mock-${id}`,
      tokenIds: ['token-yes', 'token-no'],
      outcomes: ['YES', 'NO'],
      active: true,
      closed: false,
    } as any));
  });

  it('automatically settles positions as loss (0.0¢) and does NOT credit cash balance for resolved losing positions', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const testMarketId = `resolve-market-loss-${randomUUID().slice(0, 8)}`;
    const testTokenId = `resolve-token-loss-${randomUUID().slice(0, 8)}`;

    // Buy 100 shares of outcome YES at 0.40 price
    await executeTrade(
      userId,
      validBuyParams({
        marketId: testMarketId,
        tokenId: testTokenId,
        shares: 100,
        price: 0.4,
      }),
    );

    const portfolioAfterBuy = await getPortfolio(userId);
    const balanceAfterBuy = portfolioAfterBuy.balance;

    // Mock getMarket Gamma API call to return the market as closed/resolved to NO (YES token price is 0.0)
    const marketSpy = vi.spyOn(polymarket, 'getMarket').mockImplementation(
      (id) => Promise.resolve({
        id,
        question: 'Will Japan win?',
        conditionId: 'mock-condition-id',
        tokenIds: [testTokenId, 'other-token'],
        outcomePrices: [0.0, 1.0], // YES token lost!
        closed: true, // Market is resolved
        active: false,
        endDate: new Date().toISOString(),
        slug: 'mock-slug',
        outcomes: ['Yes', 'No'],
        lastTradePrice: 0.0,
        bestBid: 0.0,
        bestAsk: 0.0,
        spread: 0.0,
        volume24hr: 1000,
        liquidity: 5000,
        image: null,
        icon: null,
        description: null,
        category: 'Test',
        startDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Query portfolio
    await runResolutionCheckForUser(userId);
    const portfolioAfterResolve = await getPortfolio(userId);

    // Position should be closed and removed
    expect(portfolioAfterResolve.positions.length).toBe(0);

    // Cash balance should remain exactly the same as balanceAfterBuy (since shares resolved to 0)
    expect(portfolioAfterResolve.balance).toBe(balanceAfterBuy);

    // Verify database position isOpen is now false and currentPrice is 0.0
    const db = getDb();
    const dbPos = await db.query.positions.findFirst({
      where: and(
        eq(positions.userId, userId),
        eq(positions.tokenId, testTokenId)
      ),
    });
    expect(dbPos?.isOpen).toBe(false);
    expect(Number(dbPos?.currentPrice)).toBe(0.0);

    // Verify trade history has the SELL settlement trade logged at 0.0 price
    const history = await getTradeHistory(userId);
    const settleTrade = history.find((t) => t.marketId === testMarketId && t.side === 'SELL');
    expect(settleTrade).toBeDefined();
    expect(settleTrade?.shares).toBe(100);
    expect(settleTrade?.price).toBe(0.0);
    expect(settleTrade?.total).toBe(0.0);

    marketSpy.mockImplementation(async (id: string) => ({
      id,
      question: 'Mock Question',
      conditionId: id,
      slug: `mock-${id}`,
      tokenIds: ['token-yes', 'token-no'],
      outcomes: ['YES', 'NO'],
      active: true,
      closed: false,
    } as any));
  });

  it('rejects trade execution on a closed Polymarket market', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const testMarketId = `closed-market-poly-${randomUUID().slice(0, 8)}`;
    const testTokenId = `closed-token-poly-${randomUUID().slice(0, 8)}`;

    const marketSpy = vi.spyOn(polymarket, 'getMarket').mockImplementation(
      async (id) => ({
        id,
        question: 'Will Japan win?',
        closed: true, // Closed!
      } as any)
    );

    const params = validBuyParams({
      marketId: testMarketId,
      tokenId: testTokenId,
      shares: 100,
      price: 0.6,
      platform: 'polymarket' as const,
    });

    await expect(executeTrade(userId, params)).rejects.toThrow(
      'Market is closed/resolved. Positions are settled automatically.'
    );

    marketSpy.mockRestore();
  });

  it('rejects trade execution on a closed Polymarket US market', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const testMarketId = `closed-market-polyus-${randomUUID().slice(0, 8)}`;
    const testTokenId = `closed-token-polyus-${randomUUID().slice(0, 8)}`;

    const marketSpy = vi.spyOn(polymarketUs, 'getPolymarketUsMarket').mockImplementation(
      async (slug) => ({
        slug,
        question: 'Will Japan win?',
        closed: true, // Closed!
      } as any)
    );

    const params = validBuyParams({
      marketId: testMarketId,
      tokenId: testTokenId,
      shares: 100,
      price: 0.6,
      platform: 'polymarket_us' as const,
    });

    await expect(executeTrade(userId, params)).rejects.toThrow(
      'Market is closed/resolved. Positions are settled automatically.'
    );

    marketSpy.mockRestore();
  });

  it('rejects trade execution on a closed Kalshi market', async () => {
    const userId = await createTestUser();
    testUserIds.push(userId);
    await getPortfolio(userId);

    const testMarketId = `closed-market-kalshi-${randomUUID().slice(0, 8)}`;
    const testTokenId = `closed-token-kalshi-${randomUUID().slice(0, 8)}`;

    const marketSpy = vi.spyOn(kalshi, 'getKalshiMarket').mockImplementation(
      async (ticker) => ({
        ticker,
        status: 'settled', // Settled/Closed!
      } as any)
    );

    const params = validBuyParams({
      marketId: testMarketId,
      tokenId: testTokenId,
      shares: 100,
      price: 0.6,
      platform: 'kalshi' as const,
    });

    await expect(executeTrade(userId, params)).rejects.toThrow(
      'Market is closed/resolved. Positions are settled automatically.'
    );

    marketSpy.mockRestore();
  });
});
