import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  strategies,
  portfolios,
  positions,
  paperTrades,
  agentReports,
  portfolioSnapshots,
  realTradeOrders,
  strategyRuns,
} from '@/lib/db/schema';
import { eq, and, desc, ne } from 'drizzle-orm';
import { kalshiOrderQuantity, normalizeKalshiOrderStatus } from '@/lib/official-trading';
import { enrichOpenOrdersWithMarkets } from '@/lib/agent-market-context';

// ---------------------------------------------------------------------------
// GET /api/agent/context?strategy_name=...
//
// Returns everything a stateless polling agent needs to resume a strategy:
//  - Strategy registration state (is_setup, mode, platform)
//  - Portfolio (balance, total value, PnL)
//  - Open positions
//  - Recent trade history
//  - Recent reports (for cross-session memory / retro strategies)
//  - System warnings
//
// This is the MCP Resource equivalent: the agent reads this first to decide
// whether to call register_strategy or skip to trading.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const strategyId = request.nextUrl.searchParams.get('strategy_id') || 
                      request.nextUrl.searchParams.get('strategy_name');
    if (!strategyId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: strategy_id or strategy_name' },
        { status: 400 },
      );
    }

    const db = getDb();

    // ── 1. Strategy registration state ─────────────────────────
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, strategyId),
      ),
    });

    const is_setup = !!strategy;

    if (strategy?.agentMode === 'real') {
      const competingRealStrategy = await db.query.strategies.findFirst({
        where: and(
          eq(strategies.platform, strategy.platform),
          eq(strategies.agentMode, 'real'),
          eq(strategies.status, 'active'),
          ne(strategies.id, strategy.id),
        ),
      });
      if (competingRealStrategy && competingRealStrategy.id !== strategy.id) {
        return NextResponse.json({
          error: 'This deployment uses one shared official venue account. Multiple active real strategies cannot be attributed safely.',
          code: 'SHARED_ACCOUNT_STRATEGY_AMBIGUITY',
        }, { status: 409 });
      }
    }

    // MCP agents opt into a server-audited run at bootstrap. The schedule on
    // the strategy row is metadata only; this run ledger is what lets us tell
    // a completed no-trade cycle from an agent that disappeared mid-run.
    let runId: string | null = null;
    if (strategy && request.nextUrl.searchParams.get('start_run') === 'true') {
      const triggerId = (request.nextUrl.searchParams.get('trigger_id') || 'mcp-context-bootstrap').slice(0, 255);
      const running = await db.query.strategyRuns.findFirst({
        where: and(
          eq(strategyRuns.strategyId, strategy.id),
          eq(strategyRuns.status, 'running'),
        ),
        orderBy: [desc(strategyRuns.startedAt)],
      });
      const staleBefore = Date.now() - 10 * 60 * 1000;
      if (running && running.startedAt.getTime() >= staleBefore) {
        runId = running.id;
      } else {
        if (running) {
          await db.update(strategyRuns).set({
            status: 'failed',
            finishedAt: new Date(),
            error: 'Agent run was superseded without a saved completion report.',
          }).where(eq(strategyRuns.id, running.id));
        }
        const [createdRun] = await db.insert(strategyRuns).values({
          strategyId: strategy.id,
          userId: session.user.id,
          triggerId,
          status: 'running',
          inputContext: {
            source: 'get_strategy_context',
            platform: strategy.platform,
            agent_mode: strategy.agentMode,
            schedule: strategy.schedule,
          },
        }).returning();
        runId = createdRun?.id ?? null;
      }
    }

    // ── 2. Portfolio ───────────────────────────────────────────
    const portfolio = await db.query.portfolios.findFirst({
      where: eq(portfolios.userId, session.user.id),
    });

    let portfolioState = portfolio
      ? {
          balance: Number(portfolio.balance),
          initial_balance: Number(portfolio.initialBalance),
        }
      : null;

    // ── 3. Open positions ──────────────────────────────────────
    const openPositions = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, session.user.id),
          eq(positions.isOpen, true),
        ),
      )
      .limit(50);

    let positionsSummary: any[] = openPositions.map((p) => ({
      market_id: p.marketId,
      risk_group_id: p.riskGroupId ?? p.marketId,
      market_question: p.marketQuestion,
      outcome: p.outcome,
      shares: Number(p.shares),
      avg_entry_price: Number(p.avgEntryPrice),
      current_price: Number(p.currentPrice),
      unrealized_pnl:
        Number(p.shares) * (Number(p.currentPrice) - Number(p.avgEntryPrice)),
    }));

    // ── 4. Recent trades ───────────────────────────────────────
    let recentTrades: any[] = [];
    try {
      recentTrades = await db
        .select({
          id: paperTrades.id,
          marketId: paperTrades.marketId,
          marketQuestion: paperTrades.marketQuestion,
          outcome: paperTrades.outcome,
          action: paperTrades.action,
          shares: paperTrades.shares,
          pricePerShare: paperTrades.pricePerShare,
          totalCost: paperTrades.totalCost,
          executedAt: paperTrades.executedAt,
        })
        .from(paperTrades)
        .where(strategy ? and(
          eq(paperTrades.userId, session.user.id),
          eq(paperTrades.strategyId, strategy.id),
        ) : eq(paperTrades.userId, session.user.id))
        .orderBy(desc(paperTrades.executedAt))
        .limit(10);
    } catch (err) {
      console.warn('Failed to fetch recent trades, likely schema mismatch:', err);
    }

    let tradeHistory: any[] = recentTrades.map((t) => ({
      market_id: t.marketId,
      market_question: t.marketQuestion,
      outcome: t.outcome,
      side: t.action,
      shares: Number(t.shares),
      price: Number(t.pricePerShare),
      total_cost: Number(t.totalCost),
      executed_at: t.executedAt,
    }));

    // ── 5. Recent reports ──────────────────────────────────────
    let recentReports: any[] = [];
    try {
      if (strategy) {
        recentReports = await db
          .select({
            filename: agentReports.filename,
            createdAt: agentReports.createdAt,
          })
          .from(agentReports)
          .where(and(
            eq(agentReports.userId, session.user.id),
            eq(agentReports.strategyId, strategy.id),
          ))
          .orderBy(desc(agentReports.createdAt))
          .limit(5);
      }
    } catch (err) {
      console.warn('Failed to fetch recent reports, likely schema mismatch:', err);
    }


    let openOrders: Record<string, unknown>[] = [];

    // ── 6. Compute summary values ──────────────────────────────
    let positionsValue = positionsSummary.reduce(
      (sum, p) => sum + p.shares * p.current_price,
      0,
    );
    let totalValue = (portfolioState?.balance ?? 0) + positionsValue;
    const registeredBaseline = Number(strategy?.startingBalance);
    const paperBaseline = Number.isFinite(registeredBaseline) && registeredBaseline > 0
      ? registeredBaseline
      : portfolioState?.initial_balance ?? 10000;
    let totalPnL = totalValue - paperBaseline;

    // ── 6.5. Real Trading Override ─────────────────────────────
    if (strategy?.agentMode === 'real') {
      const { getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
      const platform = strategy.platform === 'kalshi' ? 'kalshi' : 'polymarket_us';
      const realPortfolio = await getOfficialPortfolioSnapshot(platform);

      await db.insert(portfolioSnapshots).values({
        strategyId: strategy.id,
        userId: session.user.id,
        platform: strategy.platform,
        agentMode: strategy.agentMode,
        source: 'official',
        cash: realPortfolio.cash.toFixed(2),
        positionsValue: realPortfolio.positionsValue.toFixed(2),
        totalValue: realPortfolio.totalValue.toFixed(2),
        pnl: (realPortfolio.totalValue - Number(strategy.startingBalance || 0)).toFixed(6),
        positions: realPortfolio.positions,
        orders: realPortfolio.orders,
      });

      if (platform === 'kalshi') {
        const officialOrders = realPortfolio.orders.filter(
          (order): order is Record<string, unknown> =>
            Boolean(order && typeof order === 'object' && 'order_id' in order),
        );
        for (const order of officialOrders) {
          const quantity = kalshiOrderQuantity(order);
          await db.update(realTradeOrders)
            .set({
              status: normalizeKalshiOrderStatus(order),
              quantity: quantity == null ? undefined : quantity.toFixed(6),
              officialResponse: order,
              updatedAt: new Date(),
            })
            .where(and(
              eq(realTradeOrders.strategyId, strategy.id),
              eq(realTradeOrders.officialOrderId, String(order.order_id)),
            ));
        }

        openOrders = officialOrders
          .map((order) => {
            const initialQuantity = kalshiOrderQuantity(order);
            const filledQuantity = Number(order.fill_count_fp ?? order.fill_count ?? 0);
            const remainingQuantity = Number(order.remaining_count_fp ?? order.remaining_count ?? 0);
            return {
              order_id: String(order.order_id),
              client_order_id: order.client_order_id ?? null,
              ticker: order.ticker ?? null,
              status: normalizeKalshiOrderStatus(order),
              side: order.side ?? null,
              action: order.action ?? null,
              price: order.yes_price_dollars ?? order.price ?? null,
              initial_quantity: initialQuantity,
              filled_quantity: Number.isFinite(filledQuantity) ? filledQuantity : 0,
              remaining_quantity: Number.isFinite(remainingQuantity) ? remainingQuantity : 0,
              last_updated_at: order.last_update_time ?? order.last_updated_ts_ms ?? null,
            };
          })
          .filter((order) => Number(order.remaining_quantity) > 0);
      } else {
        openOrders = realPortfolio.orders
          .filter((order): order is Record<string, unknown> => Boolean(order && typeof order === 'object'))
          .map((order) => {
            const remainingQuantity = Number(order.leavesQuantity ?? order.remainingQuantity ?? 0);
            const filledQuantity = Number(order.cumQuantity ?? order.filledQuantity ?? 0);
            const initialQuantity = Number(order.quantity ?? (remainingQuantity + filledQuantity));
            const price = order.price && typeof order.price === 'object'
              ? (order.price as Record<string, unknown>).value
              : order.price;
            return {
              platform,
              order_id: String(order.id ?? order.orderId ?? ''),
              client_order_id: order.clientOrderId ?? null,
              market_slug: order.marketSlug ?? null,
              status: order.state ?? order.status ?? null,
              side: order.side ?? order.outcomeSide ?? null,
              action: order.intent ?? order.action ?? null,
              price: price ?? null,
              initial_quantity: Number.isFinite(initialQuantity) ? initialQuantity : null,
              filled_quantity: Number.isFinite(filledQuantity) ? filledQuantity : 0,
              remaining_quantity: Number.isFinite(remainingQuantity) ? remainingQuantity : 0,
              last_updated_at: order.updateTime ?? order.createTime ?? order.insertTime ?? null,
            };
          })
          .filter((order) => Number(order.remaining_quantity) > 0);
      }

      openOrders = await enrichOpenOrdersWithMarkets(strategy.platform, openOrders);
      
      portfolioState = {
        balance: realPortfolio.cash,
        initial_balance: strategy.startingBalance ? Number(strategy.startingBalance) : 10000,
      };
      
      positionsSummary = realPortfolio.positions;
      tradeHistory = realPortfolio.fills;
      
      positionsValue = realPortfolio.positionsValue;
      totalValue = realPortfolio.totalValue;
      totalPnL = realPortfolio.totalValue - Number(strategy.startingBalance || 0);
    }

    // ── 7. Warnings ────────────────────────────────────────────
    const warnings: string[] = [];
    if (!is_setup) {
      warnings.push(
        'Strategy is not registered. Call register_strategy before trading.',
      );
    }
    if (strategy?.status === 'paused') {
      warnings.push('Strategy is paused. Trading is suspended.');
    }
    if (strategy?.status === 'disabled') {
      warnings.push('Strategy is disabled. Contact admin to re-enable.');
    }
    if (
      strategy?.agentMode === 'paper'
      && portfolioState
      && Math.abs(Number(portfolioState.initial_balance) - Number(strategy.startingBalance)) > 0.005
    ) {
      warnings.push('Portfolio initial balance does not match strategy starting balance. Reset or repair before trading.');
    }

    return NextResponse.json({
      is_setup,
      strategy: strategy
        ? {
            strategy_id: strategy.strategyId,
            agent_mode: strategy.agentMode,
            platform: strategy.platform,
            status: strategy.status,
            starting_balance: Number(strategy.startingBalance),
            risk_config: strategy.riskConfig,
            schedule: strategy.schedule,
          }
        : null,
      portfolio: {
        cash: portfolioState?.balance ?? 0,
        positions_value: positionsValue,
        total_value: totalValue,
        pnl: totalPnL,
        pnl_percent:
          portfolioState?.initial_balance
            ? (totalPnL / Number(portfolioState.initial_balance)) * 100
            : 0,
      },
      positions: positionsSummary,
      recent_trades: tradeHistory,
      open_orders: openOrders,
      recent_reports: recentReports,
      run_id: runId,
      warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
