import { eq, and, desc, lte, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { limitOrders, portfolios, positions } from '@/lib/db/schema';
import { executeTrade, TradingError } from '@/lib/trading-engine';
import { getMidpoint } from '@/lib/polymarket';
import { getKalshiOutcomePrice, parseKalshiTokenId } from '@/lib/kalshi';
import { getPolymarketUsOutcomePrice, parsePolymarketUsTokenId } from '@/lib/polymarket-us';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters required to create a new limit order. */
export interface CreateLimitOrderParams {
  marketId: string;
  marketQuestion?: string;
  tokenId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  /** USD amount for BUY, number of shares for SELL */
  amount: number;
  /** Target price — must be between 0 and 1 (exclusive) */
  limitPrice: number;
  /** 'GTC' (Good-Til-Cancelled) or 'GTD' (Good-Til-Date) */
  orderType: 'GTC' | 'GTD';
  /** Required when orderType is 'GTD'. ISO 8601 datetime string. */
  expiresAt?: string;
}

/** A limit order row as returned from the database. */
export type LimitOrder = typeof limitOrders.$inferSelect;

/** Error codes that indicate a permanent failure (order should be rejected). */
const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_BALANCE',
  'POSITION_NOT_FOUND',
  'INVALID_TRADE',
  'INVALID_PRICE',
  'INVALID_SHARES',
]);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a new limit order.
 *
 * Validates that:
 * - For BUY orders: user has a portfolio (auto-created by getPortfolio)
 * - For SELL orders: user holds enough shares in the specified position
 * - GTD orders must specify a future expiresAt timestamp
 */
export async function createLimitOrder(
  userId: string,
  params: CreateLimitOrderParams,
): Promise<LimitOrder> {
  const db = getDb();

  // 1. Validate GTD orders
  if (params.orderType === 'GTD') {
    if (!params.expiresAt) {
      throw new Error('GTD orders require an expiresAt timestamp');
    }
    const expiryDate = new Date(params.expiresAt);
    if (expiryDate <= new Date()) {
      throw new Error('expiresAt must be in the future');
    }
  }

  // 2. Get or validate portfolio
  const portfolio = await db.query.portfolios.findFirst({
    where: eq(portfolios.userId, userId),
  });

  if (!portfolio) {
    throw new Error('User portfolio not found. Execute a trade first to auto-create it.');
  }

  // 3. Side-specific validation
  if (params.side === 'BUY') {
    // Check if the user has enough balance for the order amount
    const balance = Number(portfolio.balance);
    if (params.amount > balance) {
      throw new TradingError(
        `Insufficient balance. Order requires $${params.amount}, have $${balance}`,
        'INSUFFICIENT_BALANCE',
      );
    }
  } else {
    // SELL: check that the user holds enough shares
    const position = await db.query.positions.findFirst({
      where: and(
        eq(positions.userId, userId),
        eq(positions.marketId, params.marketId),
        eq(positions.outcome, params.outcome),
        eq(positions.isOpen, true),
      ),
    });

    if (!position) {
      throw new TradingError(
        `No open position found for market ${params.marketId} / ${params.outcome}`,
        'POSITION_NOT_FOUND',
      );
    }

    const heldShares = Number(position.shares);
    if (params.amount > heldShares + 0.001) {
      throw new TradingError(
        `Cannot sell ${params.amount} shares — only ${heldShares} held.`,
        'INVALID_SHARES',
      );
    }
  }

  // 4. Insert the limit order
  const [order] = await db
    .insert(limitOrders)
    .values({
      userId,
      portfolioId: portfolio.id,
      marketId: params.marketId,
      marketQuestion: params.marketQuestion ?? null,
      tokenId: params.tokenId,
      outcome: params.outcome,
      side: params.side,
      amount: params.amount.toFixed(6),
      limitPrice: params.limitPrice.toFixed(6),
      orderType: params.orderType,
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
      status: 'PENDING',
    })
    .returning();

  return order;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancel a single pending limit order.
 * Only the owning user may cancel their own order.
 */
export async function cancelLimitOrder(
  userId: string,
  orderId: string,
): Promise<void> {
  const db = getDb();

  const order = await db.query.limitOrders.findFirst({
    where: and(eq(limitOrders.id, orderId), eq(limitOrders.userId, userId)),
  });

  if (!order) {
    throw new Error('Order not found');
  }

  if (order.status !== 'PENDING') {
    throw new Error(`Cannot cancel order with status ${order.status}`);
  }

  await db
    .update(limitOrders)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(eq(limitOrders.id, orderId));
}

/**
 * Cancel all pending orders for a user, optionally filtered by market.
 * Returns the count of orders cancelled.
 */
export async function cancelAllOrders(
  userId: string,
  marketId?: string,
): Promise<number> {
  const db = getDb();

  const conditions = [
    eq(limitOrders.userId, userId),
    eq(limitOrders.status, 'PENDING'),
  ];

  if (marketId) {
    conditions.push(eq(limitOrders.marketId, marketId));
  }

  const result = await db
    .update(limitOrders)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: limitOrders.id });

  return result.length;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Get all pending orders for a user.
 */
export async function getPendingOrders(
  userId: string,
): Promise<LimitOrder[]> {
  const db = getDb();

  return db.query.limitOrders.findMany({
    where: and(
      eq(limitOrders.userId, userId),
      eq(limitOrders.status, 'PENDING'),
    ),
    orderBy: [desc(limitOrders.createdAt)],
  });
}

/**
 * Get all orders for a user (any status), with an optional limit.
 */
export async function getAllOrders(
  userId: string,
  limit = 100,
): Promise<LimitOrder[]> {
  const db = getDb();

  return db.query.limitOrders.findMany({
    where: eq(limitOrders.userId, userId),
    orderBy: [desc(limitOrders.createdAt)],
    limit,
  });
}

// ---------------------------------------------------------------------------
// Check & Fill
// ---------------------------------------------------------------------------

/**
 * Scan pending limit orders and:
 *  1. Expire any GTD orders whose expiresAt has passed
 *  2. For each remaining pending order, fetch the live midpoint price
 *  3. Fill if price condition is met (BUY: midpoint <= limitPrice, SELL: midpoint >= limitPrice)
 *  4. Reject orders that fail with permanent errors
 *
 * @param userId - Optional. If provided, only check orders for this user.
 * @returns Counts of filled, expired, and cancelled orders.
 */
export async function checkAndFillOrders(
  userId?: string,
): Promise<{ filled: number; expired: number; cancelled: number }> {
  const db = getDb();
  const now = new Date();

  let result = { filled: 0, expired: 0, cancelled: 0 };

  // ── Step 1: Expire stale GTD orders ─────────────────────────
  const expireConditions = [
    eq(limitOrders.status, 'PENDING'),
    eq(limitOrders.orderType, 'GTD'),
    lte(limitOrders.expiresAt, now),
  ];

  if (userId) {
    expireConditions.push(eq(limitOrders.userId, userId));
  }

  const expiredRows = await db
    .update(limitOrders)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(and(...expireConditions))
    .returning({ id: limitOrders.id });

  result.expired = expiredRows.length;

  // ── Step 2: Fetch remaining pending orders ──────────────────
  const pendingConditions = [eq(limitOrders.status, 'PENDING')];
  if (userId) {
    pendingConditions.push(eq(limitOrders.userId, userId));
  }

  const pendingOrders = await db.query.limitOrders.findMany({
    where: and(...pendingConditions),
    orderBy: [limitOrders.createdAt], // FIFO sorting (defaults to asc)
  });

  if (pendingOrders.length === 0) return result;

  // ── Step 3: Fetch live midpoints (deduplicated by tokenId) ──
  // Routes price fetches through the correct platform API based on tokenId format:
  //  - polymarket_us:<slug>:<YES|NO> → getPolymarketUsOutcomePrice
  //  - kalshi:<ticker>:<YES|NO>      → getKalshiOutcomePrice
  //  - anything else                 → getMidpoint (Polymarket International CLOB)
  const tokenIds = Array.from(new Set(pendingOrders.map((o) => o.tokenId)));
  const midpoints: Record<string, number | null> = {};

  await Promise.all(
    tokenIds.map(async (tokenId) => {
      try {
        const polyUsMatch = parsePolymarketUsTokenId(tokenId);
        if (polyUsMatch) {
          midpoints[tokenId] = await getPolymarketUsOutcomePrice(polyUsMatch.slug, polyUsMatch.outcome);
          return;
        }
        const kalshiMatch = parseKalshiTokenId(tokenId);
        if (kalshiMatch) {
          midpoints[tokenId] = await getKalshiOutcomePrice(kalshiMatch.ticker, kalshiMatch.outcome);
          return;
        }
        midpoints[tokenId] = await getMidpoint(tokenId);
      } catch {
        midpoints[tokenId] = null;
      }
    }),
  );

  // ── Step 4: Attempt to fill each order ──────────────────────
  for (const order of pendingOrders) {
    const mid = midpoints[order.tokenId];
    if (mid === null || mid === undefined) continue;

    const limitPrice = Number(order.limitPrice);
    const amount = Number(order.amount);
    const side = order.side; // 'BUY' | 'SELL'

    // Check fill condition
    const shouldFill =
      side === 'BUY' ? mid <= limitPrice : mid >= limitPrice;

    if (!shouldFill) continue;

    // Calculate shares for the trade
    let shares: number;
    if (side === 'BUY') {
      // amount is in USD; shares = amount / price
      shares = amount / mid;
    } else {
      // amount is number of shares to sell
      shares = amount;
    }

    try {
      const trade = await executeTrade(order.userId, {
        marketId: order.marketId,
        marketQuestion: order.marketQuestion ?? '',
        tokenId: order.tokenId,
        outcome: order.outcome as 'YES' | 'NO',
        side: side as 'BUY' | 'SELL',
        shares,
        price: mid,
        idempotencyKey: `limit_${order.id}_${Date.now()}`,
      });

      // Mark as filled
      await db
        .update(limitOrders)
        .set({
          status: 'FILLED',
          filledAt: new Date(),
          filledTradeId: trade.id,
          updatedAt: new Date(),
        })
        .where(eq(limitOrders.id, order.id));

      result.filled++;
    } catch (err) {
      // If it's a permanent error, reject the order
      if (err instanceof TradingError && PERMANENT_ERROR_CODES.has(err.code)) {
        await db
          .update(limitOrders)
          .set({ status: 'REJECTED', updatedAt: new Date() })
          .where(eq(limitOrders.id, order.id));

        result.cancelled++;
        console.warn(
          `[LimitOrders] Rejected order ${order.id}: ${err.message}`,
        );
      } else {
        // Transient error (network, timeout) — leave as PENDING for retry
        console.error(
          `[LimitOrders] Transient error filling order ${order.id}:`,
          err,
        );
      }
    }
  }

  return result;
}
