import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  strategies,
  portfolios,
  positions,
  paperTrades,
  agentReports,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

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

    // ── 2. Portfolio ───────────────────────────────────────────
    const portfolio = await db.query.portfolios.findFirst({
      where: eq(portfolios.userId, session.user.id),
    });

    const portfolioState = portfolio
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

    const positionsSummary = openPositions.map((p) => ({
      id: p.id,
      market_id: p.marketId,
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
        .where(eq(paperTrades.userId, session.user.id))
        .orderBy(desc(paperTrades.executedAt))
        .limit(10);
    } catch (err) {
      console.warn('Failed to fetch recent trades, likely schema mismatch:', err);
    }

    const tradeHistory = recentTrades.map((t) => ({
      id: t.id,
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
          .where(eq(agentReports.userId, session.user.id))
          .orderBy(desc(agentReports.createdAt))
          .limit(5);
      }
    } catch (err) {
      console.warn('Failed to fetch recent reports, likely schema mismatch:', err);
    }


    // ── 6. Compute summary values ──────────────────────────────
    const positionsValue = positionsSummary.reduce(
      (sum, p) => sum + p.shares * p.current_price,
      0,
    );
    const totalValue = (portfolioState?.balance ?? 0) + positionsValue;
    const totalPnL = totalValue - (portfolioState?.initial_balance ?? 10000);

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

    return NextResponse.json({
      is_setup,
      strategy: strategy
        ? {
            id: strategy.id,
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
      recent_reports: recentReports,
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
