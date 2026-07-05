import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { portfolioSnapshots, realTradeOrders, strategies } from '@/lib/db/schema';
import {
  getOfficialPortfolioSnapshot,
  submitOfficialRealTrade,
} from '@/lib/official-trading';

const realTradeSchema = z.object({
  strategy_id: z.string().min(1).max(255),
  slug: z.string().min(1).max(500).describe('Market slug, ticker, or venue market id'),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  side: z.enum(['BUY', 'SELL']).default('BUY'),
  amount: z.number().positive().max(100000).optional(),
  shares: z.number().positive().optional(),
  price: z.number().min(0.001).max(0.999).optional(),
  client_order_id: z.string().min(1).max(255).optional(),
  time_in_force: z.enum(['GTC', 'IOC', 'FOK']).optional(),
  run_id: z.string().uuid().optional(),
});

function realTradingEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const value = (metadata as Record<string, unknown>).real_trading_enabled;
  return value === true;
}

// POST /api/agent/real-trades
//
// Audit-first real trading route. This validates server-side strategy binding,
// persists the official write request, submits through the platform client, and
// captures an official snapshot when the write succeeds.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sanitizeRealOrder = (o: any) => ({
      platform: o.platform,
      officialOrderId: o.officialOrderId,
      clientOrderId: o.clientOrderId,
      marketId: o.marketId,
      marketSlugOrTicker: o.marketSlugOrTicker,
      side: o.side,
      quantity: o.quantity ? Number(o.quantity) : null,
      price: o.price ? Number(o.price) : null,
      status: o.status,
      request: o.request,
      officialResponse: o.officialResponse,
      error: o.error,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });

    const sanitizePortfolioSnapshot = (s: any) => ({
      platform: s.platform,
      agentMode: s.agentMode,
      source: s.source,
      cash: Number(s.cash),
      positionsValue: Number(s.positionsValue),
      totalValue: Number(s.totalValue),
      pnl: Number(s.pnl),
      positions: s.positions,
      orders: s.orders,
      capturedAt: s.capturedAt,
    });

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
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, order.strategy_id),
        eq(strategies.agentMode, 'real'),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Real strategy "${order.strategy_id}" is not registered.` },
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
        { error: 'Polymarket International real trading is not supported.', audit: sanitizeRealOrder(audit) },
        { status: 400 },
      );
    }

    if (!order.price) {
      return NextResponse.json(
        { error: 'Real trading requires an explicit limit price.' },
        { status: 400 },
      );
    }

    const enabled = realTradingEnabled(strategy.metadata);
    if (!enabled) {
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
          price: order.price.toFixed(6),
          status: 'REJECTED',
          request: order,
          error: { code: 'REAL_TRADING_DISABLED', message: 'Strategy metadata.real_trading_enabled must be true.' },
        })
        .returning();

      return NextResponse.json(
        {
          error: 'Real trading is disabled for this strategy.',
          audit: sanitizeRealOrder(audit),
        },
        { status: 403 },
      );
    }

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
        price: order.price.toFixed(6),
        status: 'SUBMITTING',
        request: order,
      })
      .returning();

    try {
      const official = await submitOfficialRealTrade({
        platform: strategy.platform as 'kalshi' | 'polymarket_us',
        slug: order.slug,
        outcome: order.outcome,
        side: order.side,
        amount: order.amount,
        shares: order.shares,
        price: order.price,
        clientOrderId: order.client_order_id,
        timeInForce: order.time_in_force,
      });

      const [updatedAudit] = await db
        .update(realTradeOrders)
        .set({
          officialOrderId: official.officialOrderId,
          clientOrderId: official.clientOrderId,
          status: official.status,
          request: official.request,
          officialResponse: official.response,
          error: {},
          updatedAt: new Date(),
        })
        .where(eq(realTradeOrders.id, audit.id))
        .returning();

      const officialSnapshot = await getOfficialPortfolioSnapshot(
        strategy.platform as 'kalshi' | 'polymarket_us',
      );
      const [snapshot] = await db
        .insert(portfolioSnapshots)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: order.run_id ?? null,
          platform: strategy.platform,
          agentMode: strategy.agentMode,
          source: 'official',
          cash: officialSnapshot.cash.toFixed(2),
          positionsValue: officialSnapshot.positionsValue.toFixed(2),
          totalValue: officialSnapshot.totalValue.toFixed(2),
          pnl: officialSnapshot.pnl.toFixed(6),
          positions: officialSnapshot.positions,
          orders: officialSnapshot.orders,
        })
        .returning();

      return NextResponse.json({
        data: sanitizeRealOrder(updatedAudit),
        official_order: official,
        official_snapshot: sanitizePortfolioSnapshot(snapshot),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [updatedAudit] = await db
        .update(realTradeOrders)
        .set({
          status: 'ERROR',
          error: { code: 'OFFICIAL_TRADE_FAILED', message },
          updatedAt: new Date(),
        })
        .where(eq(realTradeOrders.id, audit.id))
        .returning();

      return NextResponse.json(
        {
          error: 'Official real trade failed.',
          details: message,
          audit: sanitizeRealOrder(updatedAudit),
        },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
