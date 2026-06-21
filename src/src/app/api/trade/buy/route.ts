import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buyTradeSchema, idempotencyKeySchema } from '@/lib/validations';
import { executeTrade, TradingError } from '@/lib/trading-engine';
import { getMarket, getMidpoint } from '@/lib/polymarket';
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

    const currentPrice = await getMidpoint(tokenId);
    if (currentPrice <= 0 || currentPrice >= 1) {
      return NextResponse.json({ error: 'Invalid market price' }, { status: 400 });
    }

    // Slippage calculation
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const settings = (user?.settings as Record<string, any>) || {};
    const slippageBps = settings.slippageEnabled ? (settings.slippageBps || 50) : 0;
    const slippageMultiplier = 1 + (slippageBps / 10000);
    
    // For buys, the execution price is higher
    const executionPrice = currentPrice * slippageMultiplier;
    if (executionPrice >= 1.0) {
      return NextResponse.json({ error: 'Price too high with slippage' }, { status: 400 });
    }

    const shares = order.amount / executionPrice;

    const trade = await executeTrade(userId, {
      marketId: market.id,
      marketQuestion: market.question,
      tokenId: tokenId,
      outcome: order.side,
      side: 'BUY',
      shares,
      price: executionPrice,
      idempotencyKey: idempParse.data,
      slippageApplied: executionPrice - currentPrice,
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
