import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  portfolioSnapshots,
  reconciliationLogs,
  strategies,
} from '@/lib/db/schema';
import { getPortfolio } from '@/lib/trading-engine';

const reconcileSchema = z.object({
  strategy_name: z.string().min(1).max(255),
  run_id: z.string().uuid().optional(),
});

// POST /api/agent/reconcile
//
// Captures the local portfolio and writes a reconciliation log. Official venue
// snapshot fetchers are intentionally explicit future work.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = reconcileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { strategy_name, run_id } = parsed.data;
    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: eq(strategies.strategyName, strategy_name),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Strategy "${strategy_name}" is not registered.` },
        { status: 404 },
      );
    }

    const portfolio = await getPortfolio(session.user.id);
    const localSnapshot = {
      cash: portfolio.balance,
      positions_value: portfolio.totalValue - portfolio.balance,
      total_value: portfolio.totalValue,
      pnl: portfolio.totalPnL,
      positions: portfolio.positions,
    };

    const [snapshot] = await db
      .insert(portfolioSnapshots)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId: run_id ?? null,
        platform: strategy.platform,
        agentMode: strategy.agentMode,
        source: 'local',
        cash: portfolio.balance.toFixed(2),
        positionsValue: (portfolio.totalValue - portfolio.balance).toFixed(2),
        totalValue: portfolio.totalValue.toFixed(2),
        pnl: portfolio.totalPnL.toFixed(6),
        positions: portfolio.positions,
        orders: [],
      })
      .returning();

    const [log] = await db
      .insert(reconciliationLogs)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId: run_id ?? null,
        platform: strategy.platform,
        severity: strategy.agentMode === 'real' ? 'warning' : 'info',
        differenceType: 'unknown',
        officialSnapshot: {},
        localSnapshot,
        diff: {},
        threshold: {},
        message:
          strategy.agentMode === 'real'
            ? 'Official venue snapshot fetch is not implemented yet; local snapshot captured only.'
            : 'Paper strategy local snapshot captured; official reconciliation is not required.',
      })
      .returning();

    return NextResponse.json({
      reconciled: strategy.agentMode !== 'real',
      strategy_name,
      platform: strategy.platform,
      agent_mode: strategy.agentMode,
      local_snapshot: snapshot,
      reconciliation_log: log,
      warnings:
        strategy.agentMode === 'real'
          ? ['Official venue snapshot fetch is not implemented yet.']
          : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
