import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buyTradeSchema, idempotencyKeySchema } from '@/lib/validations';
import { executeTrade, TradingError } from '@/lib/trading-engine';
import { getMarket, getOrderBook, getFeeRate, getMidpoint } from '@/lib/polymarket';
import { simulateBuyFill } from '@/lib/orderbook-simulator';
import { getDb } from '@/lib/db';
import { paperTrades, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // Idempotency Check
    const idempotencyKey = request.headers.get('x-idempotency-key');
    const idempParse = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!idempParse.success) {
      return NextResponse.json({ error: 'Missing or invalid X-Idempotency-Key header' }, { status: 400 });
    }
    
    const db = getDb();
    const existing = await db.query.paperTrades.findFirst({
      where: eq(paperTrades.idempotencyKey, idempParse.data)
    });
    if (existing) {
      return NextResponse.json({ data: existing, message: 'Returned existing trade' }, { status: 200 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = buyTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }

    const order = parsed.data;

    // Fetch market data
    const market = await getMarket(order.marketConditionId).catch(() => null);
    if (!market || market.closed) {
      return NextResponse.json({ error: 'Market not found or closed' }, { status: 400 });
    }

    const outcomeIndex = order.side === 'YES' ? 0 : 1;
    const tokenId = market.tokenIds[outcomeIndex];
    if (!tokenId) {
       return NextResponse.json({ error: 'Token ID not found' }, { status: 400 });
    }

    // Check user settings for slippage mode
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const settings = (user?.settings as Record<string, any>) || {};
    const useOrderBookSim = settings.slippageEnabled !== false; // Default to order book sim

    let executionPrice: number;
    let shares: number;
    let slippageApplied: number;

    if (useOrderBookSim) {
      // Order book simulation: walk the real ask side level-by-level
      try {
        const [orderBook, feeRateBps] = await Promise.all([
          getOrderBook(tokenId),
          getFeeRate(tokenId),
        ]);

        const fillResult = simulateBuyFill(orderBook, order.amount, feeRateBps, 'FAK');

        if (!fillResult.success) {
          return NextResponse.json({
            error: 'Insufficient liquidity to fill order. Try a smaller amount.',
            details: { amountRequested: order.amount }
          }, { status: 400 });
        }

        executionPrice = fillResult.avgPrice;
        shares = fillResult.totalShares;
        slippageApplied = fillResult.slippageBps / 10_000; // Convert BPS to decimal

        if (executionPrice >= 1.0) {
          return NextResponse.json({ error: 'Price too high after order book fill' }, { status: 400 });
        }
      } catch (err) {
        // If order book fetch fails, fall back to midpoint + flat slippage
        console.warn('[Buy] Order book simulation failed, falling back to midpoint:', err);
        const currentPrice = await getMidpoint(tokenId);
        if (currentPrice <= 0 || currentPrice >= 1) {
          return NextResponse.json({ error: 'Invalid market price' }, { status: 400 });
        }
        const slippageBps = settings.slippageBps || 50;
        executionPrice = currentPrice * (1 + slippageBps / 10000);
        shares = order.amount / executionPrice;
        slippageApplied = executionPrice - currentPrice;
      }
    } else {
      // Legacy flat slippage mode (when user disables order book sim)
      const currentPrice = await getMidpoint(tokenId);
      if (currentPrice <= 0 || currentPrice >= 1) {
        return NextResponse.json({ error: 'Invalid market price' }, { status: 400 });
      }
      executionPrice = currentPrice;
      shares = order.amount / executionPrice;
      slippageApplied = 0;
    }

    const trade = await executeTrade(userId, {
      marketId: market.id,
      marketQuestion: market.question,
      tokenId: tokenId,
      outcome: order.side,
      side: 'BUY',
      shares,
      price: executionPrice,
      idempotencyKey: idempParse.data,
      slippageApplied,
    });

    return NextResponse.json({ data: trade }, { status: 201 });
  } catch (err) {
    if (err instanceof TradingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
