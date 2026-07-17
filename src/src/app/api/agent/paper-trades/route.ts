import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  strategies,
  agentReports,
  paperTrades,
  paperTradeOrders,
  portfolioSnapshots,
  strategyRuns,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { executeTrade, getPortfolio, TradingError } from '@/lib/trading-engine';
import { validatePaperBuyRisk } from '@/lib/paper-risk';

// Polymarket helpers
import { getMarket, getMidpoint } from '@/lib/polymarket';
// Kalshi helpers
import { getKalshiMarket, getKalshiOutcomePrice, kalshiTokenId } from '@/lib/kalshi';
// Polymarket US helpers
import { getPolymarketUsOutcomePrice, getPolymarketUsMarket, polymarketUsTokenId } from '@/lib/polymarket-us';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const paperTradeSchema = z.object({
  strategy_id: z.string().min(1).max(255),
  slug: z.string().min(1).max(500).describe('Market slug, ticker, or conditionId'),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  side: z.enum(['BUY', 'SELL']).default('BUY'),
  amount: z.number().positive().max(100000).optional(),
  shares: z.number().positive().optional(),
  run_id: z.string().uuid().optional(),
}).strict().refine((order) => Boolean(order.amount) !== Boolean(order.shares), {
  message: 'Provide exactly one of amount or shares',
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
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
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
    const sanitizePaperOrder = (o: any) => ({
      platform: o.platform,
      marketId: o.marketId,
      marketSlug: o.marketSlug,
      outcome: o.outcome,
      side: o.side,
      quantity: o.quantity,
      price: o.price,
      notional: o.notional,
      fillModel: o.fillModel,
      status: o.status,
      idempotencyKey: o.idempotencyKey,
      createdAt: o.createdAt,
    });

    const sanitizeTrade = (t: any) => ({
      marketId: t.marketId,
      marketQuestion: t.marketQuestion,
      tokenId: t.tokenId,
      outcome: t.outcome,
      side: t.side,
      shares: t.shares,
      price: t.price,
      total: t.total,
      timestamp: t.timestamp,
      slippageApplied: t.slippageApplied,
    });

    const existingOrder = await db.query.paperTradeOrders.findFirst({
      where: eq(paperTradeOrders.idempotencyKey, idempotencyKey),
    });
    if (existingOrder) {
      return NextResponse.json(
        { data: sanitizePaperOrder(existingOrder), message: 'Returned existing paper order (idempotent)' },
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
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, order.strategy_id),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        {
          error: `Strategy "${order.strategy_id}" not registered. Call register_strategy first.`,
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

    let runId = order.run_id ?? null;
    let currentRun: typeof strategyRuns.$inferSelect | null = null;
    if (runId) {
      const run = await db.query.strategyRuns.findFirst({
        where: and(
          eq(strategyRuns.id, runId),
          eq(strategyRuns.strategyId, strategy.id),
        ),
      });
      if (!run) {
        return NextResponse.json(
          { error: 'run_id does not belong to this strategy' },
          { status: 400 },
        );
      }
      currentRun = run;
    } else {
      const latestRun = await db.query.strategyRuns.findFirst({
        where: and(
          eq(strategyRuns.strategyId, strategy.id),
          eq(strategyRuns.status, 'running'),
        ),
        orderBy: [desc(strategyRuns.startedAt)],
      });
      runId = latestRun?.id ?? null;
      currentRun = latestRun ?? null;
    }

    const currentReport = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.strategyId, strategy.id),
        eq(agentReports.userId, session.user.id),
      ),
      orderBy: [desc(agentReports.createdAt)],
    });

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

      const executablePrice = await getMidpoint(tokenId).catch(() => null);
      if (executablePrice === null || executablePrice <= 0 || executablePrice >= 1) {
        return NextResponse.json(
          { error: 'No executable Polymarket market price is available' },
          { status: 400 },
        );
      }
      price = executablePrice;
    } else if (platform === 'kalshi') {
      // Kalshi
      const market = await getKalshiMarket(order.slug).catch(() => null);
      const marketStatus = String(market?.status ?? '').toLowerCase();
      if (!market || (marketStatus !== 'open' && marketStatus !== 'active')) {
        return NextResponse.json(
          { error: 'Kalshi market not found or not tradable' },
          { status: 400 },
        );
      }
      marketId = order.slug;
      tokenId = kalshiTokenId(order.slug, order.outcome);
      marketQuestion = String(market.title ?? market.subtitle ?? order.slug);

      const kalshiPrice = await getKalshiOutcomePrice(
        order.slug,
        order.outcome,
        order.side,
      ).catch(() => null);
      if (kalshiPrice === null || kalshiPrice <= 0 || kalshiPrice >= 1) {
        return NextResponse.json(
          { error: 'No executable Kalshi market price is available' },
          { status: 400 },
        );
      }
      price = kalshiPrice;
    } else if (platform === 'polymarket_us') {
      // Polymarket US
      const market = await getPolymarketUsMarket(order.slug).catch(
        () => null,
      );
      if (!market || market.closed || market.active === false) {
        return NextResponse.json(
          { error: 'Polymarket US market not found or not tradable' },
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

      const usPrice = await getPolymarketUsOutcomePrice(
        order.slug,
        order.outcome,
        order.side,
      ).catch(() => null);
      if (usPrice === null || usPrice <= 0 || usPrice >= 1) {
        return NextResponse.json(
          { error: 'No executable Polymarket US market price is available' },
          { status: 400 },
        );
      }
      price = usPrice;
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

    // ── Enforce server-side risk ──────────────────────────────
    // Prompt rules are advisory; this guard prevents a confused agent from
    // bypassing per-trade, cumulative-market, and cash-reserve limits.
    if (order.side === 'BUY') {
      const portfolioBeforeTrade = await getPortfolio(session.user.id);
      const riskError = validatePaperBuyRisk({
        portfolio: portfolioBeforeTrade,
        marketId,
        notional: shares * price,
        riskConfig: strategy.riskConfig,
      });
      if (riskError) {
        return NextResponse.json({ error: riskError }, { status: 403 });
      }
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

    await db
      .update(paperTrades)
      .set({
        strategyId: strategy.id,
        runId,
        reportId: currentReport?.id ?? null,
        platform,
        metadata: {
          strategy_id: order.strategy_id,
          source: 'agent_paper_trades',
          report_id: currentReport?.id ?? null,
          run_id: runId,
        },
      })
      .where(eq(paperTrades.id, trade.id));

    const [paperOrder] = await db
      .insert(paperTradeOrders)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId,
        reportId: currentReport?.id ?? null,
        paperTradeId: trade.id,
        platform,
        marketId,
        marketSlug: order.slug,
        outcome: order.outcome,
        side: order.side,
        quantity: shares.toFixed(6),
        price: price.toFixed(6),
        notional: trade.total.toFixed(2),
        fillModel: 'top_of_book_no_depth',
        status: 'FILLED',
        idempotencyKey,
        request: order,
        result: trade,
      })
      .returning();

    const portfolio = await getPortfolio(session.user.id);
    await db.insert(portfolioSnapshots).values({
      strategyId: strategy.id,
      userId: session.user.id,
      runId,
      platform,
      agentMode: strategy.agentMode,
      source: 'local',
      cash: portfolio.balance.toFixed(2),
      positionsValue: (portfolio.totalValue - portfolio.balance).toFixed(2),
      totalValue: portfolio.totalValue.toFixed(2),
      pnl: portfolio.totalPnL.toFixed(6),
      positions: portfolio.positions,
      orders: [paperOrder],
    });

    if (currentRun) {
      const previousCount = Number(currentRun.tradesExecuted ?? 0);
      await db
        .update(strategyRuns)
        .set({
          tradesExecuted: previousCount + 1,
          summary: `Latest paper trade: ${order.side} ${shares.toFixed(6)} ${order.outcome} @ ${price.toFixed(4)} on ${platform}:${order.slug}`,
        })
        .where(eq(strategyRuns.id, currentRun.id));
    }

    return NextResponse.json({
      data: sanitizeTrade(trade),
      paper_order: sanitizePaperOrder(paperOrder),
      report: currentReport
        ? {
            filename: currentReport.filename,
          }
        : null,
      portfolio: {
        cash: portfolio.balance,
        total_value: portfolio.totalValue,
        pnl: portfolio.totalPnL,
      },
      platform,
      strategy_id: order.strategy_id,
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
