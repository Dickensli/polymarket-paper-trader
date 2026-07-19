import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq, ne } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { agentReports, getDb, strategies } from '@/lib/db';
import { paperTradeOrders, paperTrades, realTradeOrders, strategyRuns } from '@/lib/db/schema';
import { getPortfolio } from '@/lib/trading-engine';
import { getOfficialPortfolioSnapshot } from '@/lib/official-trading';
import { runPriceRefresh } from '@/worker/jobs/price-refresh';

const reportSchema = z.object({
  strategy_id: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  content: z.string().min(1),
  title: z.string().max(255).optional(),
  lessons_learned: z.string().optional(),
  next_steps: z.string().optional(),
  portfolio_summary: z.record(z.string(), z.unknown()).optional(),
  trade_summary: z.record(z.string(), z.unknown()).optional(),
  run_id: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const strategyId = request.nextUrl.searchParams.get('strategy_id');
    if (!strategyId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: strategy_id' },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Number(request.nextUrl.searchParams.get('limit') ?? 5) || 5,
      25,
    );
    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, strategyId),
      ),
    });

    if (!strategy) {
      return NextResponse.json({ error: `Strategy "${strategyId}" not registered.` }, { status: 404 });
    }

    const sanitizeAgentReport = (r: any) => ({
      filename: r.filename,
      account: r.strategyName,
      title: r.title,
      content: r.content,
      lessons_learned: r.lessonsLearned,
      next_steps: r.nextSteps,
      portfolio_summary: r.portfolioSummary,
      trade_summary: r.tradeSummary,
      created_at: r.createdAt,
    });

    const filename = request.nextUrl.searchParams.get('filename');
    if (filename) {
      const report = await db.query.agentReports.findFirst({
        where: and(
          eq(agentReports.userId, session.user.id),
          eq(agentReports.strategyId, strategy.id),
          eq(agentReports.filename, filename),
        ),
      });

      if (!report) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }

      return NextResponse.json({ data: sanitizeAgentReport(report) });
    }

    const reports = await db
      .select({
        filename: agentReports.filename,
        title: agentReports.title,
        createdAt: agentReports.createdAt,
      })
      .from(agentReports)
      .where(
        and(
          eq(agentReports.userId, session.user.id),
          eq(agentReports.strategyId, strategy.id),
        ),
      )
      .orderBy(desc(agentReports.createdAt))
      .limit(limit);

    return NextResponse.json({ data: reports, meta: { count: reports.length, limit } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = reportSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const report = parsed.data;
    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, report.strategy_id),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Strategy "${report.strategy_id}" is not registered.` },
        { status: 404 },
      );
    }

    const activeRun = report.run_id
      ? await db.query.strategyRuns.findFirst({
          where: and(
            eq(strategyRuns.id, report.run_id),
            eq(strategyRuns.strategyId, strategy.id),
          ),
        })
      : await db.query.strategyRuns.findFirst({
          where: and(
            eq(strategyRuns.strategyId, strategy.id),
            eq(strategyRuns.status, 'running'),
          ),
          orderBy: [desc(strategyRuns.startedAt)],
        });
    if (report.run_id && !activeRun) {
      return NextResponse.json(
        { error: 'run_id does not belong to this strategy' },
        { status: 400 },
      );
    }
    const effectiveRunId = activeRun?.id ?? null;

    const existing = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, session.user.id),
        eq(agentReports.strategyId, strategy.id),
        eq(agentReports.filename, report.filename),
      ),
    });

    const verifiedAt = new Date();
    let verifiedPortfolio: Record<string, unknown> = { source: 'unavailable', verified_at: verifiedAt.toISOString() };
    let verifiedTrades: Record<string, unknown> = { source: 'unavailable', verified_at: verifiedAt.toISOString() };
    if (strategy.agentMode === 'paper') {
      await runPriceRefresh();
      const portfolio = await getPortfolio(session.user.id);
      const verifiedOrderRows = await db.query.paperTradeOrders.findMany({
        where: effectiveRunId
          ? and(
              eq(paperTradeOrders.strategyId, strategy.id),
              eq(paperTradeOrders.runId, effectiveRunId),
            )
          : eq(paperTradeOrders.strategyId, strategy.id),
        orderBy: [desc(paperTradeOrders.createdAt)],
        limit: 25,
      });
      const unpricedPositions = portfolio.positions.filter((position) => position.pricingStatus !== 'priced');
      const pricingTimes = portfolio.positions
        .map((position) => position.pricingUpdatedAt)
        .filter((value): value is string => Boolean(value));
      verifiedPortfolio = {
        source: 'server_paper_ledger',
        verified_at: verifiedAt.toISOString(),
        cash: portfolio.balance,
        positions_value: portfolio.totalValue - portfolio.balance,
        total_value: portfolio.totalValue,
        pnl: portfolio.totalPnL,
        pnl_percent: portfolio.totalPnLPercent,
        unpriced_positions_count: unpricedPositions.length,
        pricing_updated_at: pricingTimes.length > 0
          ? pricingTimes.reduce((oldest, value) => value < oldest ? value : oldest)
          : null,
      };
      verifiedTrades = {
        source: 'server_paper_ledger',
        verified_at: verifiedAt.toISOString(),
        scope: effectiveRunId ? 'run' : 'strategy_recent_orders',
        run_id: effectiveRunId,
        recent_trades: verifiedOrderRows,
      };
    } else if (strategy.platform === 'kalshi' || strategy.platform === 'polymarket_us') {
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
      try {
        const official = await getOfficialPortfolioSnapshot(strategy.platform);
        const verifiedOrderRows = await db.query.realTradeOrders.findMany({
          where: effectiveRunId
            ? and(
                eq(realTradeOrders.strategyId, strategy.id),
                eq(realTradeOrders.runId, effectiveRunId),
              )
            : eq(realTradeOrders.strategyId, strategy.id),
          orderBy: [desc(realTradeOrders.createdAt)],
          limit: 25,
        });
        const pnl = official.totalValue - Number(strategy.startingBalance || 0);
        verifiedPortfolio = {
          source: 'official_venue',
          verified_at: verifiedAt.toISOString(),
          cash: official.cash,
          positions_value: official.positionsValue,
          total_value: official.totalValue,
          pnl,
          pnl_percent: Number(strategy.startingBalance) > 0
            ? (pnl / Number(strategy.startingBalance)) * 100
            : 0,
          unpriced_positions_count: official.unpricedPositionsCount ?? 0,
        };
        verifiedTrades = {
          source: 'official_order_ledger',
          verified_at: verifiedAt.toISOString(),
          scope: effectiveRunId ? 'run' : 'strategy_recent_orders',
          run_id: effectiveRunId,
          recent_trades: verifiedOrderRows,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        verifiedPortfolio = { ...verifiedPortfolio, error: message };
        verifiedTrades = { ...verifiedTrades, error: message };
      }
    }

    const values = {
      strategyId: strategy.id,
      runId: effectiveRunId,
      userId: session.user.id,
      strategyName: report.strategy_id,
      filename: report.filename,
      content: report.content,
      title: report.title ?? null,
      lessonsLearned: report.lessons_learned ?? null,
      nextSteps: report.next_steps ?? null,
      portfolioSummary: {
        verified: verifiedPortfolio,
        agent_supplied: report.portfolio_summary ?? {},
      },
      tradeSummary: {
        verified: verifiedTrades,
        agent_supplied: report.trade_summary ?? {},
      },
      createdAt: verifiedAt,
    };

    const sanitizeAgentReport = (r: any) => ({
      filename: r.filename,
      account: r.strategyName,
      title: r.title,
      content: r.content,
      lessons_learned: r.lessonsLearned,
      next_steps: r.nextSteps,
      portfolio_summary: r.portfolioSummary,
      trade_summary: r.tradeSummary,
      created_at: r.createdAt,
    });

    const completeRun = async () => {
      if (!effectiveRunId) return;
      await db.update(strategyRuns).set({
        status: 'completed',
        finishedAt: verifiedAt,
        summary: `Saved report ${report.filename}`,
      }).where(and(
        eq(strategyRuns.id, effectiveRunId),
        eq(strategyRuns.strategyId, strategy.id),
      ));
    };

    const linkRunEvidence = async (reportId: string) => {
      if (!effectiveRunId) return;
      await Promise.all([
        db.update(paperTradeOrders).set({ reportId }).where(and(
          eq(paperTradeOrders.strategyId, strategy.id),
          eq(paperTradeOrders.runId, effectiveRunId),
        )),
        db.update(paperTrades).set({ reportId }).where(and(
          eq(paperTrades.strategyId, strategy.id),
          eq(paperTrades.runId, effectiveRunId),
        )),
      ]);
    };

    if (existing) {
      const [updated] = await db
        .update(agentReports)
        .set(values)
        .where(eq(agentReports.id, existing.id))
        .returning();
      await completeRun();
      await linkRunEvidence(updated.id);
      return NextResponse.json({ data: sanitizeAgentReport(updated), updated: true });
    }

    const [created] = await db.insert(agentReports).values(values).returning();
    await completeRun();
    await linkRunEvidence(created.id);
    return NextResponse.json({ data: sanitizeAgentReport(created), updated: false }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
