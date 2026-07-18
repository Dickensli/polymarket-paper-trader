import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  portfolios,
  paperTrades,
  positions,
  ledgerEntries,
  marketCache,
  limitOrders,
  paperTradeOrders,
  portfolioSnapshots,
  strategyDecisions,
  agentReports,
  leaderboardSnapshots,
  reconciliationLogs,
  strategies,
  strategyCapitalFlows,
  strategyPerformanceSnapshots,
  strategyRuns,
} from '@/lib/db/schema';
import type {
  Portfolio,
  Position,
  Trade,
  TradeParams,
  OutcomeLabel,
} from '@/lib/types';
import { Redis } from '@upstash/redis';
import { getMidpoint, getMarket } from '@/lib/polymarket';
import { getKalshiOutcomePrice, parseKalshiTokenId, getKalshiMarket } from '@/lib/kalshi';
import { getPolymarketUsMarket } from '@/lib/polymarket-us';
export { runResolutionCheckForUser } from '@/worker/jobs/resolution-handler';

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

/** Wrap a promise with a timeout. Resolves to null if timeout is reached. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise.then((res) => {
      if (timeoutId) clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise,
  ]);
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
  // 0. Settle resolved positions on-the-fly to ensure cash balance & positions list are current
  // [Performance Fix] Do not run resolution checks synchronously on every portfolio fetch.
  // This causes extreme Vercel fluid CPU consumption. Resolution should be handled exclusively by the background cron.
  /*
  try {
    await runResolutionCheckForUser(userId);
  } catch (err) {
    console.error(`[getPortfolio] On-the-fly resolution check failed for user ${userId}:`, err);
  }
  */

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
    // [Performance Fix] Disable on-the-fly live price fetching to prevent Vercel Fluid CPU burn.
    // Instead of querying Polymarket CLOB API on every portfolio load (which causes timeouts without Redis),
    // we now rely on the `currentPrice` already stored in the `positions` table. 
    // This price is updated whenever a trade occurs or when the background cron job runs.
    /*
    const tokenIds = Array.from(new Set(rawPositions.map((p) => p.tokenId)));
    ...
    */
  }

  const activePositions: Position[] = rawPositions.map((pos) => {
    const shares = Number(pos.shares);
    const avgEntryPrice = Number(pos.avgEntryPrice);
    const currentPrice = Number(pos.currentPrice);
    
    const value = roundTo(shares * currentPrice, 2);
    const cost = roundTo(shares * avgEntryPrice, 2);
    const unrealizedPnL = roundTo(value - cost, 2);
    const unrealizedPnLPercent = cost > 0 ? roundTo((unrealizedPnL / cost) * 100, 2) : 0;
    const pricingUpdatedAt = pos.updatedAt.toISOString();
    const pricingStatus = Number.isFinite(currentPrice)
      && currentPrice > 0
      && Date.now() - pos.updatedAt.getTime() <= 10 * 60 * 1000
      ? 'priced' as const
      : 'unpriced' as const;

    return {
      id: pos.id,
      marketId: pos.marketId,
      riskGroupId: pos.riskGroupId ?? pos.marketId,
      marketQuestion: pos.marketQuestion ?? '',
      tokenId: pos.tokenId,
      outcome: pos.outcome as OutcomeLabel,
      shares,
      avgEntryPrice,
      currentPrice,
      unrealizedPnL,
      unrealizedPnLPercent,
      realizedPnL: Number(pos.realizedPnl) || 0,
      createdAt: pos.createdAt.toISOString(),
      pricingStatus,
      pricingUpdatedAt,
    };
  });

  // 3. Compute summaries
  const positionsValue = activePositions.reduce(
    (sum, p) => sum + p.shares * p.currentPrice,
    0,
  );
  const totalValue = roundTo(balance + positionsValue, 2);

  const parsedInitialBalance = Number(userPortfolio.initialBalance);
  const initialBalance = Number.isFinite(parsedInitialBalance) ? parsedInitialBalance : DEFAULT_BALANCE;
  const totalPnL = roundTo(totalValue - initialBalance, 2);
  const totalPnLPercent = initialBalance > 0 ? roundTo((totalPnL / initialBalance) * 100, 2) : 0;

  // 4. Fetch trade history
  const dbTrades = await db.query.paperTrades.findMany({
    where: eq(paperTrades.userId, userId),
    orderBy: [desc(paperTrades.executedAt)],
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
  const { marketId, riskGroupId, marketQuestion, tokenId, outcome, side, shares, price, idempotencyKey, slippageApplied, feeRateBps, platform = 'polymarket' } =
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

  // P0 FIX: Check if market is closed/resolved before executing any trade.
  // When a market resolves, positions should be settled via the resolution handler,
  // not through normal buy/sell at stale midpoint prices.
  // Skip this check for internal resolution calls (identified by idempotencyKey prefix).
  const isResolutionCall = idempotencyKey?.startsWith('resolve_');
  if (!isResolutionCall) {
    if (platform === 'polymarket') {
      try {
        const marketData = await getMarket(marketId);
        if (marketData && marketData.closed) {
          throw new TradingError(
            `Market is closed/resolved. Positions are settled automatically.`,
            'INVALID_TRADE',
          );
        }
      } catch (err) {
        if (err instanceof TradingError) throw err;
        console.warn(`[executeTrade] Could not verify market status for ${marketId}:`, err);
      }
    } else if (platform === 'polymarket_us') {
      try {
        const marketData = await getPolymarketUsMarket(marketId);
        if (marketData && marketData.closed) {
          throw new TradingError(
            `Market is closed/resolved. Positions are settled automatically.`,
            'INVALID_TRADE',
          );
        }
      } catch (err) {
        if (err instanceof TradingError) throw err;
        console.warn(`[executeTrade] Could not verify market status for ${marketId}:`, err);
      }
    } else if (platform === 'kalshi') {
      try {
        const marketData = await getKalshiMarket(marketId);
        if (marketData && (marketData.status === 'finalized' || marketData.status === 'settled' || marketData.status === 'closed')) {
          throw new TradingError(
            `Market is closed/resolved. Positions are settled automatically.`,
            'INVALID_TRADE',
          );
        }
      } catch (err) {
        if (err instanceof TradingError) throw err;
        console.warn(`[executeTrade] Could not verify market status for ${marketId}:`, err);
      }
    }
  }

  const subtotal = roundTo(shares * price, 2);
  const fee = calculateFee(price, shares, feeRateBps);
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
            platform,
            riskGroupId: riskGroupId ?? marketId,
            updatedAt: new Date(),
          })
          .where(eq(positions.id, existingPosition.id));
      } else {
        // P0 FIX: Check for a previously closed position with same key.
        // The DB has a unique index on (userId, marketId, outcome), so we
        // must reopen the existing closed row instead of inserting a new one.
        const [closedPosition] = await tx
          .select()
          .from(positions)
          .where(
            and(
              eq(positions.userId, userId),
              eq(positions.marketId, marketId),
              eq(positions.outcome, outcome),
              eq(positions.isOpen, false),
            ),
          )
          .for('update');

        if (closedPosition) {
          // Reopen the closed position with fresh values
          await tx
            .update(positions)
            .set({
              shares: shares.toFixed(6),
              avgEntryPrice: price.toFixed(6),
              currentPrice: price.toFixed(6),
              isOpen: true,
              platform,
              riskGroupId: riskGroupId ?? marketId,
              tokenId,
              marketQuestion,
              portfolioId: userPortfolio.id,
              realizedPnl: '0.000000',
              closedAt: null,
              closeReason: null,
              resolvedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(positions.id, closedPosition.id));
          positionId = closedPosition.id;
        } else {
          const [insertedPos] = await tx
            .insert(positions)
            .values({
              userId,
              portfolioId: userPortfolio.id,
              platform,
              marketId,
              riskGroupId: riskGroupId ?? marketId,
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
          platform,
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
        slippageApplied: slippageApplied ?? 0,
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

      // P1 FIX: Track realized PnL on sell
      const avgEntry = Number(existingPosition.avgEntryPrice);
      const sellPnl = roundTo((price - avgEntry) * sellShares, 6);
      const prevRealizedPnl = Number(existingPosition.realizedPnl) || 0;
      const newRealizedPnl = roundTo(prevRealizedPnl + sellPnl, 6);

      // Update or close position
      const remainingShares = roundTo(heldShares - sellShares, 6);
      if (remainingShares <= 0.001) {
        await tx
          .update(positions)
          .set({
            shares: '0.000000',
            isOpen: false,
            platform,
            currentPrice: price.toFixed(6),
            realizedPnl: newRealizedPnl.toFixed(6),
            closedAt: new Date(),
            closeReason: 'USER_CLOSED',
            updatedAt: new Date(),
          })
          .where(eq(positions.id, existingPosition.id));
      } else {
        await tx
          .update(positions)
          .set({
            shares: remainingShares.toFixed(6),
            currentPrice: price.toFixed(6),
            realizedPnl: newRealizedPnl.toFixed(6),
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
          platform,
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
        slippageApplied: slippageApplied ?? 0,
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

export async function resetPortfolio(userId: string, initialBalance?: number): Promise<Portfolio> {
  const db = getDb();
  const balanceVal = initialBalance ?? DEFAULT_BALANCE;
  if (!Number.isFinite(balanceVal) || balanceVal <= 0) {
    throw new TradingError('Reset balance must be a positive finite number.', 'INVALID_TRADE');
  }

  await db.transaction(async (tx) => {
    const userStrategies = await tx.query.strategies.findMany({
      where: eq(strategies.userId, userId),
    });
    const paperStrategies = userStrategies.filter((strategy) => strategy.agentMode === 'paper');
    if (userStrategies.length > 0 && paperStrategies.length === 0) {
      throw new TradingError('Official real-money portfolios cannot be reset locally.', 'INVALID_TRADE');
    }
    const strategyIds = paperStrategies.map((strategy) => strategy.id);
    const resetAt = new Date();

    // 1. Reset balance
    await tx
      .update(portfolios)
      .set({
        balance: balanceVal.toFixed(2),
        initialBalance: balanceVal.toFixed(2),
        updatedAt: resetAt,
      })
      .where(eq(portfolios.userId, userId));

    // 2. Delete every paper-strategy memory and performance artifact. A reset
    // is a true new inception, not a cash-only rewrite with stale reports/NAV.
    await tx.delete(limitOrders).where(eq(limitOrders.userId, userId));
    await tx.delete(paperTradeOrders).where(eq(paperTradeOrders.userId, userId));
    await tx.delete(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId));
    const decisionTable = await tx.execute(sql`select to_regclass('public.strategy_decisions') as name`);
    if ((decisionTable as unknown as Array<{ name: string | null }>)[0]?.name) {
      await tx.delete(strategyDecisions).where(eq(strategyDecisions.userId, userId));
    }
    if (strategyIds.length > 0) {
      await tx.delete(strategyPerformanceSnapshots).where(inArray(strategyPerformanceSnapshots.strategyId, strategyIds));
      await tx.delete(strategyCapitalFlows).where(inArray(strategyCapitalFlows.strategyId, strategyIds));
      await tx.delete(reconciliationLogs).where(inArray(reconciliationLogs.strategyId, strategyIds));
      await tx.delete(agentReports).where(inArray(agentReports.strategyId, strategyIds));
    } else {
      await tx.delete(agentReports).where(eq(agentReports.userId, userId));
    }

    // 3. Delete all positions
    await tx.delete(positions).where(eq(positions.userId, userId));

    // 4. Clear trade history
    await tx.delete(paperTrades).where(eq(paperTrades.userId, userId));
    await tx.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));
    if (strategyIds.length > 0) {
      await tx.delete(strategyRuns).where(inArray(strategyRuns.strategyId, strategyIds));
      await tx.delete(leaderboardSnapshots).where(eq(leaderboardSnapshots.userId, userId));
      for (const strategy of paperStrategies) {
        const metadata = {
          ...((strategy.metadata as Record<string, unknown> | null) ?? {}),
          performance_baseline_at: resetAt.toISOString(),
          last_destructive_reset_at: resetAt.toISOString(),
          reset_balance: balanceVal,
        };
        await tx.update(strategies).set({
          startingBalance: balanceVal.toFixed(2),
          metadata,
          updatedAt: resetAt,
        }).where(eq(strategies.id, strategy.id));

        const hourly = new Date(resetAt); hourly.setUTCMinutes(0, 0, 0);
        const daily = new Date(resetAt); daily.setUTCHours(0, 0, 0, 0);
        await tx.insert(strategyPerformanceSnapshots).values([
          {
            strategyId: strategy.id, userId, platform: strategy.platform, agentMode: strategy.agentMode,
            bucket: 'HOURLY', bucketAt: hourly, cash: balanceVal.toFixed(6), positionsValue: '0.000000',
            nav: balanceVal.toFixed(6), pnl: '0.000000', returnPct: '0.000000', periodReturnPct: '0.000000',
            twrPct: '0.000000', mwrPct: null, netExternalFlow: '0.000000', unpricedPositionsCount: 0,
            pricingUpdatedAt: resetAt, capturedAt: resetAt,
          },
          {
            strategyId: strategy.id, userId, platform: strategy.platform, agentMode: strategy.agentMode,
            bucket: 'DAILY', bucketAt: daily, cash: balanceVal.toFixed(6), positionsValue: '0.000000',
            nav: balanceVal.toFixed(6), pnl: '0.000000', returnPct: '0.000000', periodReturnPct: '0.000000',
            twrPct: '0.000000', mwrPct: null, netExternalFlow: '0.000000', unpricedPositionsCount: 0,
            pricingUpdatedAt: resetAt, capturedAt: resetAt,
          },
        ]);
      }
    }
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
