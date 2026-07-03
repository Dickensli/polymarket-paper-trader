import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { realTradeOrders, strategies } from '@/lib/db/schema';

const realTradeSchema = z.object({
  strategy_name: z.string().min(1).max(255),
  slug: z.string().min(1).max(500).describe('Market slug, ticker, or venue market id'),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  side: z.enum(['BUY', 'SELL']).default('BUY'),
  amount: z.number().positive().max(100000).optional(),
  shares: z.number().positive().optional(),
  price: z.number().min(0.001).max(0.999).optional(),
  client_order_id: z.string().min(1).max(255).optional(),
  run_id: z.string().uuid().optional(),
});

function realTradingEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const value = (metadata as Record<string, unknown>).real_trading_enabled;
  return value === true;
}

// POST /api/agent/real-trades
//
// Safe audit-first skeleton. This validates server-side strategy binding and
// persists the attempted official write, but refuses execution until a platform
// client is wired server-side and the strategy explicitly opts in.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = realTradeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const order = parsed.data;
    if (!order.amount && !order.shares) {
      return NextResponse.json(
        { error: 'Must provide either amount or shares' },
        { status: 400 },
      );
    }

    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.strategyName, order.strategy_name),
        eq(strategies.agentMode, 'real'),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Real strategy "${order.strategy_name}" is not registered.` },
        { status: 404 },
      );
    }

    if (strategy.status !== 'active') {
      return NextResponse.json(
        { error: `Strategy is ${strategy.status}. Trading is suspended.` },
        { status: 403 },
      );
    }

    if (strategy.platform === 'polymarket') {
      const [audit] = await db
        .insert(realTradeOrders)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: order.run_id ?? null,
          platform: strategy.platform,
          clientOrderId: order.client_order_id ?? null,
          marketSlugOrTicker: order.slug,
          side: order.side,
          quantity: order.shares?.toFixed(6) ?? null,
          price: order.price?.toFixed(6) ?? null,
          status: 'REJECTED',
          request: order,
          error: { code: 'UNSUPPORTED_PLATFORM', message: 'Polymarket International real trading is out of scope.' },
        })
        .returning();

      return NextResponse.json(
        { error: 'Polymarket International real trading is not supported.', audit },
        { status: 400 },
      );
    }

    const enabled = realTradingEnabled(strategy.metadata);
    const [audit] = await db
      .insert(realTradeOrders)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId: order.run_id ?? null,
        platform: strategy.platform,
        clientOrderId: order.client_order_id ?? null,
        marketSlugOrTicker: order.slug,
        side: order.side,
        quantity: order.shares?.toFixed(6) ?? null,
        price: order.price?.toFixed(6) ?? null,
        status: enabled ? 'PENDING_CLIENT_IMPLEMENTATION' : 'REJECTED',
        request: order,
        error: enabled
          ? { code: 'CLIENT_NOT_IMPLEMENTED', message: 'Official real-trading client is not wired server-side yet.' }
          : { code: 'REAL_TRADING_DISABLED', message: 'Strategy metadata.real_trading_enabled must be true.' },
      })
      .returning();

    return NextResponse.json(
      {
        error: enabled
          ? 'Official real-trading client is not implemented yet.'
          : 'Real trading is disabled for this strategy.',
        audit,
      },
      { status: enabled ? 501 : 403 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
