import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  portfolios,
  paperTrades,
  positions,
  ledgerEntries,
} from '@/lib/db/schema';
import type {
  Portfolio,
  Position,
  Trade,
  TradeParams,
  OutcomeLabel,
} from '@/lib/types';
import { Redis } from '@upstash/redis';
import { getMidpoint } from '@/lib/polymarket';

// Constants
const DEFAULT_BALANCE = 10000;
const MIN_TRADE_AMOUNT = 1;
const MIN_SHARES = 0.01;
const MAX_PRICE = 1.0;
const MIN_PRICE = 0.0;

export class TradingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INSUFFICIENT_BALANCE'
      | 'INVALID_TRADE'
      | 'POSITION_NOT_FOUND'
      | 'INVALID_PRICE'
      | 'INVALID_SHARES',
  ) {
    super(message);
    this.name = 'TradingError';
  }
}

/** Round a number to a specific decimal precision. */
function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * Calculate the trading fee using the exact Polymarket formula.
 * Formula: (fee_rate_bps / 10_000) * min(price, 1 - price) * size
 */
function calculateFee(price: number, shares: number, feeRateBps = 0): number {
  if (feeRateBps === 0) return 0;
  let fee = (feeRateBps / 10000) * Math.min(price, 1.0 - price) * shares;
  if (fee > 0) {
    fee = Math.max(fee, 0.0001);
  }
  return roundTo(fee, 6);
}

/**
 * Get the current portfolio snapshot for a user.
 * Auto-creates a portfolio if it does not exist.
 */
export async function getPortfolio(userId: string): Promise<Portfolio> {
  const db = getDb();

  // 1. Get or create portfolio
  let userPortfolio = await db.query.portfolios.findFirst({
    where: eq(portfolios.userId, userId),
  });

  if (!userPortfolio) {
    const newPortfolios = await db
      .insert(portfolios)
      .values({
        userId,
        balance: DEFAULT_BALANCE.toFixed(2),
        initialBalance: DEFAULT_BALANCE.toFixed(2),
      })
      .returning();
    
    userPortfolio = newPortfolios[0];
    if (!userPortfolio) {
      throw new Error('Failed to auto-create portfolio');
    }
  }

  const balance = Number(userPortfolio.balance);

  // 2. Fetch open positions
  const rawPositions = await db.query.positions.findMany({
    where: and(eq(positions.userId, userId), eq(positions.isOpen, true)),
  });

  if (rawPositions.length > 0) {
    // 2.1 Refresh prices on the fly
    const tokenIds = Array.from(new Set(rawPositions.map((p) => p.tokenId)));
    
    let redis: Redis | null = null;
    try {
      redis = Redis.fromEnv();
    } catch {}

    const updatedPrices = await Promise.all(
      tokenIds.map(async (tokenId) => {
        let cachedPrice: number | null = null;
        if (redis) {
          const val = await redis.get(`price:${tokenId}`).catch(() => null);
          if (val !== null) {
            cachedPrice = Number(val);
          }
        }

        if (cachedPrice !== null) {
          return { tokenId, price: cachedPrice };
        }

        const livePrice = await getMidpoint(tokenId).catch(() => null);
        if (livePrice !== null && redis) {
          await redis.set(`price:${tokenId}`, livePrice, { ex: 15 }).catch(() => {});
        }
        return { tokenId, price: livePrice };
      })
    );

    // Apply updated prices to DB and local array
    for (const { tokenId, price } of updatedPrices) {
      if (price === null) continue;
      
      await db
        .update(positions)
        .set({ currentPrice: price.toFixed(6), updatedAt: new Date() })
        .where(eq(positions.tokenId, tokenId));
        
      for (const pos of rawPositions) {
        if (pos.tokenId === tokenId) {
          pos.currentPrice = price.toFixed(6);
        }
      }
    }
  }

  const activePositions: Position[] = rawPositions.map((pos) => {
    const shares = Number(pos.shares);
    const avgEntryPrice = Number(pos.avgEntryPrice);
    const currentPrice = Number(pos.currentPrice);
    
    const value = roundTo(shares * currentPrice, 2);
    const cost = roundTo(shares * avgEntryPrice, 2);
    const unrealizedPnL = roundTo(value - cost, 2);
    const unrealizedPnLPercent = cost > 0 ? roundTo((unrealizedPnL / cost) * 100, 2) : 0;

    return {
      id: pos.id,
      marketId: pos.marketId,
      marketQuestion: pos.marketQuestion ?? '',
      tokenId: pos.tokenId,
      outcome: pos.outcome as OutcomeLabel,
      shares,
      avgEntryPrice,
      currentPrice,
      unrealizedPnL,
      unrealizedPnLPercent,
      createdAt: pos.createdAt.toISOString(),
    };
  });

  // 3. Compute summaries
  const positionsValue = activePositions.reduce(
    (sum, p) => sum + p.shares * p.currentPrice,
    0,
  );
  const totalValue = roundTo(balance + positionsValue, 2);

  const totalPnL = roundTo(totalValue - DEFAULT_BALANCE, 2);
  const totalPnLPercent = roundTo((totalPnL / DEFAULT_BALANCE) * 100, 2);

  // 4. Fetch trade history
  const dbTrades = await db.query.paperTrades.findMany({
    where: eq(paperTrades.userId, userId),
    orderBy: [desc(paperTrades.executedAt)],
    limit: 50,
  });

  const tradeHistory: Trade[] = dbTrades.map((t) => ({
    id: t.id,
    marketId: t.marketId,
    marketQuestion: t.marketQuestion ?? '',
    tokenId: t.tokenId,
    outcome: t.outcome as OutcomeLabel,
    side: t.action as 'BUY' | 'SELL',
    shares: Number(t.shares),
    price: Number(t.pricePerShare),
    total: Number(t.totalCost),
    timestamp: t.executedAt.toISOString(),
  }));

  return {
    balance,
    positions: activePositions,
    tradeHistory,
    totalValue,
    totalPnL,
    totalPnLPercent,
  };
}

/**
 * Execute a paper trade for a user.
 */
export async function executeTrade(
  userId: string,
  params: TradeParams,
): Promise<Trade> {
  const { marketId, marketQuestion, tokenId, outcome, side, shares, price, idempotencyKey, slippageApplied } =
    params;

  // Validation
  if (!marketId || !tokenId || !outcome || !side) {
    throw new TradingError(
      'Missing required trade parameters.',
      'INVALID_TRADE',
    );
  }

  if (price < MIN_PRICE || price > MAX_PRICE) {
    throw new TradingError(
      `Price must be between ${MIN_PRICE} and ${MAX_PRICE}.`,
      'INVALID_PRICE',
    );
  }

  if (!Number.isFinite(shares) || shares < MIN_SHARES) {
    throw new TradingError(
      `Shares must be at least ${MIN_SHARES}.`,
      'INVALID_SHARES',
    );
  }

  const subtotal = roundTo(shares * price, 2);
  const fee = calculateFee(price, shares);
  const total = roundTo(subtotal + fee, 2);

  if (total < MIN_TRADE_AMOUNT && side === 'BUY') {
    throw new TradingError(
      `Minimum trade amount is $${MIN_TRADE_AMOUNT}.`,
      'INVALID_TRADE',
    );
  }

  const db = getDb();

  return await db.transaction(async (tx) => {
    // 1. Lock and get portfolio
    const [userPortfolio] = await tx
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId))
      .for('update');

    if (!userPortfolio) {
      throw new Error('User portfolio not found');
    }

    const currentBalance = Number(userPortfolio.balance);

    if (side === 'BUY') {
      if (total > currentBalance) {
        throw new TradingError(
          `Insufficient balance. Need $${total} (includes $${fee} fee), have $${currentBalance}`,
          'INSUFFICIENT_BALANCE',
        );
      }

      // Update balance
      const newBalance = roundTo(currentBalance - total, 2);
      await tx
        .update(portfolios)
        .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
        .where(eq(portfolios.userId, userId));

      // Get or create position
      const [existingPosition] = await tx
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.marketId, marketId),
            eq(positions.outcome, outcome),
            eq(positions.isOpen, true),
          ),
        )
        .for('update');

      let positionId = '';

      if (existingPosition) {
        const existingShares = Number(existingPosition.shares);
        const existingAvgPrice = Number(existingPosition.avgEntryPrice);
        const newShares = roundTo(existingShares + shares, 6);
        const newAvgPrice = roundTo(
          (existingShares * existingAvgPrice + shares * price) / newShares,
          6,
        );

        positionId = existingPosition.id;
        await tx
          .update(positions)
          .set({
            shares: newShares.toFixed(6),
            avgEntryPrice: newAvgPrice.toFixed(6),
            currentPrice: price.toFixed(6),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, existingPosition.id));
      } else {
        const [insertedPos] = await tx
          .insert(positions)
          .values({
            userId,
            portfolioId: userPortfolio.id,
            marketId,
            marketQuestion,
            tokenId,
            outcome,
            shares: shares.toFixed(6),
            avgEntryPrice: price.toFixed(6),
            currentPrice: price.toFixed(6),
            isOpen: true,
          })
          .returning();
        
        positionId = insertedPos.id;
      }

      // Insert trade record
      const [tradeRecord] = await tx
        .insert(paperTrades)
        .values({
          userId,
          portfolioId: userPortfolio.id,
          marketId,
          marketQuestion,
          tokenId,
          outcome,
          action: 'BUY',
          shares: shares.toFixed(6),
          pricePerShare: price.toFixed(6),
          totalCost: total.toFixed(2),
          idempotencyKey: idempotencyKey ?? '',
          slippageApplied: (slippageApplied ?? 0).toFixed(6),
          status: 'FILLED',
        })
        .returning();

      // Ledger entries (Double-entry)
      await tx.insert(ledgerEntries).values([
        {
          userId,
          tradeId: tradeRecord.id,
          accountType: 'CASH',
          amount: (-total).toFixed(6),
          balanceAfter: newBalance.toFixed(6),
          description: `Buy trade: ${shares} shares of ${outcome} for ${marketQuestion}`,
        },
        {
          userId,
          tradeId: tradeRecord.id,
          accountType: 'POSITION',
          amount: total.toFixed(6),
          description: `Add position asset value for ${outcome} tokens`,
        },
      ]);

      return {
        id: tradeRecord.id,
        marketId,
        marketQuestion: marketQuestion ?? '',
        tokenId,
        outcome,
        side: 'BUY',
        shares,
        price,
        total,
        timestamp: tradeRecord.executedAt.toISOString(),
      };
    } else {
      // SELL trade
      const [existingPosition] = await tx
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, userId),
            eq(positions.marketId, marketId),
            eq(positions.outcome, outcome),
            eq(positions.isOpen, true),
          ),
        )
        .for('update');

      if (!existingPosition) {
        throw new TradingError(
          `No open position found for market ${marketId} / ${outcome}.`,
          'POSITION_NOT_FOUND',
        );
      }

      const heldShares = Number(existingPosition.shares);
      if (shares > heldShares + 0.001) {
        throw new TradingError(
          `Cannot sell ${shares} shares — only ${heldShares} held.`,
          'INVALID_SHARES',
        );
      }

      const sellShares = Math.min(shares, heldShares);
      const subtotal = roundTo(sellShares * price, 2);
      const fee = calculateFee(price, sellShares);
      const receiveAmount = roundTo(subtotal - fee, 2);
      const newBalance = roundTo(currentBalance + receiveAmount, 2);

      // Update balance
      await tx
        .update(portfolios)
        .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
        .where(eq(portfolios.userId, userId));

      // Update or close position
      const remainingShares = roundTo(heldShares - sellShares, 6);
      if (remainingShares <= 0.001) {
        await tx
          .update(positions)
          .set({
            shares: '0.000000',
            isOpen: false,
            updatedAt: new Date(),
          })
          .where(eq(positions.id, existingPosition.id));
      } else {
        await tx
          .update(positions)
          .set({
            shares: remainingShares.toFixed(6),
            currentPrice: price.toFixed(6),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, existingPosition.id));
      }

      // Insert trade record
      const [tradeRecord] = await tx
        .insert(paperTrades)
        .values({
          userId,
          portfolioId: userPortfolio.id,
          marketId,
          marketQuestion,
          tokenId,
          outcome,
          action: 'SELL',
          shares: sellShares.toFixed(6),
          pricePerShare: price.toFixed(6),
          totalCost: receiveAmount.toFixed(2),
          idempotencyKey: idempotencyKey ?? '',
          slippageApplied: (slippageApplied ?? 0).toFixed(6),
          status: 'FILLED',
        })
        .returning();

      // Ledger entries
      await tx.insert(ledgerEntries).values([
        {
          userId,
          tradeId: tradeRecord.id,
          accountType: 'CASH',
          amount: receiveAmount.toFixed(6),
          balanceAfter: newBalance.toFixed(6),
          description: `Sell trade: ${sellShares} shares of ${outcome} (minus $${fee} fee)`,
        },
        {
          userId,
          tradeId: tradeRecord.id,
          accountType: 'POSITION',
          amount: (-receiveAmount).toFixed(6),
          description: `Reduce position asset value for ${outcome} tokens`,
        },
      ]);

      return {
        id: tradeRecord.id,
        marketId,
        marketQuestion: marketQuestion ?? '',
        tokenId,
        outcome,
        side: 'SELL',
        shares: sellShares,
        price,
        total: receiveAmount,
        timestamp: tradeRecord.executedAt.toISOString(),
      };
    }
  });
}

/**
 * Close an entire position at the given price.
 */
export async function closePosition(
  userId: string,
  positionId: string,
  currentPrice: number,
): Promise<Trade> {
  const db = getDb();

  const pos = await db.query.positions.findFirst({
    where: and(eq(positions.id, positionId), eq(positions.userId, userId)),
  });

  if (!pos) {
    throw new TradingError(
      `Position not found: ${positionId}`,
      'POSITION_NOT_FOUND',
    );
  }

  return await executeTrade(userId, {
    marketId: pos.marketId,
    marketQuestion: pos.marketQuestion ?? '',
    tokenId: pos.tokenId,
    outcome: pos.outcome as OutcomeLabel,
    side: 'SELL',
    shares: Number(pos.shares),
    price: currentPrice,
  });
}

/**
 * Update current prices for open positions.
 */
export async function updatePositionPrices(
  updates: { tokenId: string; price: number }[],
): Promise<void> {
  const db = getDb();
  
  // Perform updates in parallel
  await Promise.all(
    updates.map((u) =>
      db
        .update(positions)
        .set({ currentPrice: u.price.toFixed(6), updatedAt: new Date() })
        .where(eq(positions.tokenId, u.tokenId)),
    ),
  );
}

/**
 * Reset the portfolio to its initial state for a user.
 */
export async function resetPortfolio(userId: string): Promise<Portfolio> {
  const db = getDb();

  await db.transaction(async (tx) => {
    // 1. Reset balance
    await tx
      .update(portfolios)
      .set({
        balance: DEFAULT_BALANCE.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(portfolios.userId, userId));

    // 2. Close all positions
    await tx
      .update(positions)
      .set({
        shares: '0.000000',
        isOpen: false,
        updatedAt: new Date(),
      })
      .where(eq(positions.userId, userId));

    // 3. Clear trade history
    await tx.delete(paperTrades).where(eq(paperTrades.userId, userId));
    await tx.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));
  });

  return getPortfolio(userId);
}

/**
 * Get trade history for a user.
 */
export async function getTradeHistory(
  userId: string,
  limit = 50,
): Promise<Trade[]> {
  const db = getDb();
  
  const dbTrades = await db.query.paperTrades.findMany({
    where: eq(paperTrades.userId, userId),
    orderBy: [desc(paperTrades.executedAt)],
    limit,
  });

  return dbTrades.map((t) => ({
    id: t.id,
    marketId: t.marketId,
    marketQuestion: t.marketQuestion ?? '',
    tokenId: t.tokenId,
    outcome: t.outcome as OutcomeLabel,
    side: t.action as 'BUY' | 'SELL',
    shares: Number(t.shares),
    price: Number(t.pricePerShare),
    total: Number(t.totalCost),
    timestamp: t.executedAt.toISOString(),
  }));
}
