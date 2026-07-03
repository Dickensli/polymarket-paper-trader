import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies, paperTrades, strategyRuns } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { executeTrade, TradingError } from '@/lib/trading-engine';

// Polymarket helpers
import { getMarket, getMidpoint } from '@/lib/polymarket';
// Kalshi helpers
import { getKalshiOutcomePrice } from '@/lib/kalshi';
// Polymarket US helpers
import { getPolymarketUsOutcomePrice, getPolymarketUsMarket, polymarketUsTokenId } from '@/lib/polymarket-us';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const paperTradeSchema = z.object({
  strategy_name: z.string().min(1).max(255),
  slug: z.string().min(1).max(500).describe('Market slug, ticker, or conditionId'),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  side: z.enum(['BUY', 'SELL']).default('BUY'),
  amount: z.number().positive().max(100000).optional(),
  shares: z.number().positive().optional(),
  price: z.number().min(0.001).max(0.999).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/agent/paper-trades
//
// Unified cross-platform paper trade endpoint.
// The server resolves platform from the strategy's server-side binding.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Idempotency check
    const idempotencyKey = request.headers.get('x-idempotency-key');
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Missing X-Idempotency-Key header' },
        { status: 400 },
      );
    }

    const db = getDb();
    const existing = await db.query.paperTrades.findFirst({
      where: eq(paperTrades.idempotencyKey, idempotencyKey),
    });
    if (existing) {
      return NextResponse.json(
        { data: existing, message: 'Returned existing trade (idempotent)' },
        { status: 200 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = paperTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const order = parsed.data;

    // ── Resolve strategy ──────────────────────────────────────
    const strategy = await db.query.strategies.findFirst({
      where: eq(strategies.strategyName, order.strategy_name),
    });

    if (!strategy) {
      return NextResponse.json(
        {
          error: `Strategy "${order.strategy_name}" not registered. Call register_strategy first.`,
        },
        { status: 404 },
      );
    }

    if (strategy.status !== 'active') {
      return NextResponse.json(
        { error: `Strategy is ${strategy.status}. Trading is suspended.` },
        { status: 403 },
      );
    }

    if (strategy.agentMode !== 'paper') {
      return NextResponse.json(
        {
          error:
            'This endpoint is for paper trading only. Use /api/agent/real-trades for real trading.',
        },
        { status: 400 },
      );
    }

    const platform = strategy.platform;

    // ── Resolve market data & price per platform ──────────────
    let marketId: string;
    let marketQuestion: string;
    let tokenId: string;
    let price: number;

    if (platform === 'polymarket') {
      // Polymarket International
      const market = await getMarket(order.slug).catch(() => null);
      if (!market || market.closed) {
        return NextResponse.json(
          { error: 'Market not found or closed' },
          { status: 400 },
        );
      }
      const outcomeIndex = order.outcome === 'YES' ? 0 : 1;
      tokenId = market.tokenIds[outcomeIndex];
      marketId = order.slug;
      marketQuestion = market.question || order.slug;

      if (order.price) {
        price = order.price;
      } else {
        const mid = await getMidpoint(order.slug).catch(() => null);
        price = mid ?? 0.5;
      }
    } else if (platform === 'kalshi') {
      // Kalshi
      marketId = order.slug;
      tokenId = `${order.slug}:${order.outcome}`;
      marketQuestion = order.slug;

      if (order.price) {
        price = order.price;
      } else {
        const kalshiPrice = await getKalshiOutcomePrice(
          order.slug,
          order.outcome,
          order.side,
        ).catch(() => null);
        price = kalshiPrice ?? 0.5;
      }
    } else if (platform === 'polymarket_us') {
      // Polymarket US
      const market = await getPolymarketUsMarket(order.slug).catch(
        () => null,
      );
      if (!market) {
        return NextResponse.json(
          { error: 'Polymarket US market not found' },
          { status: 400 },
        );
      }
      marketId = order.slug;
      tokenId = polymarketUsTokenId(order.slug, order.outcome);
      marketQuestion =
        (market as unknown as Record<string, unknown>).question as string ||
        market.title ||
        market.description ||
        order.slug;

      if (order.price) {
        price = order.price;
      } else {
        const usPrice = await getPolymarketUsOutcomePrice(
          order.slug,
          order.outcome,
          order.side,
        ).catch(() => null);
        price = usPrice ?? 0.5;
      }
    } else {
      return NextResponse.json(
        { error: `Unsupported platform: ${platform}` },
        { status: 400 },
      );
    }

    // ── Calculate shares ──────────────────────────────────────
    let shares: number;
    if (order.shares) {
      shares = order.shares;
    } else if (order.amount) {
      shares = order.amount / price;
    } else {
      return NextResponse.json(
        { error: 'Must provide either amount or shares' },
        { status: 400 },
      );
    }

    // ── Execute trade ─────────────────────────────────────────
    const trade = await executeTrade(session.user.id, {
      marketId,
      marketQuestion,
      tokenId,
      outcome: order.outcome,
      side: order.side,
      shares,
      price,
      idempotencyKey,
      platform,
    });

    return NextResponse.json({
      data: trade,
      platform,
      strategy_name: order.strategy_name,
    });
  } catch (err) {
    if (err instanceof TradingError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
