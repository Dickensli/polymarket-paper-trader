import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { portfolioSnapshots, portfolios, positions, strategies, strategyCapitalFlows } from '@/lib/db/schema';

const ADMIN_EMAIL = 'dickenslihaocheng@gmail.com';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const strategy = await db.query.strategies.findFirst({ where: eq(strategies.id, id) });
  if (!strategy || (strategy.userId !== session.user.id && session.user.email !== ADMIN_EMAIL)) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  }
  const flows = await db.query.strategyCapitalFlows.findMany({
    where: eq(strategyCapitalFlows.strategyId, strategy.id),
    orderBy: [desc(strategyCapitalFlows.occurredAt)],
  });
  return NextResponse.json({ success: true, flows });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const amount = Number(body?.amount);
  const occurredAt = body?.occurred_at ? new Date(String(body.occurred_at)) : new Date();
  if (!Number.isFinite(amount) || amount === 0 || Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: 'amount must be non-zero and occurred_at must be valid' }, { status: 400 });
  }

  const db = getDb();
  const strategy = await db.query.strategies.findFirst({ where: eq(strategies.id, id) });
  if (!strategy || (strategy.userId !== session.user.id && session.user.email !== ADMIN_EMAIL)) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  }
  const portfolio = await db.query.portfolios.findFirst({ where: eq(portfolios.userId, strategy.userId) });
  if (!portfolio) return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  const openPositions = await db.query.positions.findMany({
    where: and(eq(positions.userId, strategy.userId), eq(positions.platform, strategy.platform), eq(positions.isOpen, true)),
  });
  const positionsValue = openPositions.reduce((sum, position) => sum + Number(position.shares) * Number(position.currentPrice), 0);
  const currentNav = Number(portfolio.balance) + positionsValue;
  const navBeforeFlow = body?.nav_before_flow === undefined ? currentNav : Number(body.nav_before_flow);
  if (!Number.isFinite(navBeforeFlow) || navBeforeFlow < 0) {
    return NextResponse.json({ error: 'nav_before_flow must be a non-negative number' }, { status: 400 });
  }
  const applyToPaperBalance = body?.apply_to_paper_balance !== false && strategy.agentMode === 'paper';
  const idempotencyKey = String(body?.idempotency_key ?? `manual:${occurredAt.toISOString()}:${amount.toFixed(6)}`);

  const result = await db.transaction(async (tx) => {
    const inserted = await tx.insert(strategyCapitalFlows).values({
      strategyId: strategy.id,
      userId: strategy.userId,
      amount: amount.toFixed(6),
      navBeforeFlow: navBeforeFlow.toFixed(6),
      occurredAt,
      source: 'manual',
      idempotencyKey,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) return { duplicate: true };

    if (applyToPaperBalance) {
      const newCash = Number(portfolio.balance) + amount;
      await tx.update(portfolios).set({ balance: newCash.toFixed(2), updatedAt: occurredAt }).where(eq(portfolios.id, portfolio.id));
      await tx.insert(portfolioSnapshots).values({
        strategyId: strategy.id,
        userId: strategy.userId,
        platform: strategy.platform,
        agentMode: strategy.agentMode,
        source: 'capital_flow',
        cash: newCash.toFixed(2),
        positionsValue: positionsValue.toFixed(2),
        totalValue: (currentNav + amount).toFixed(2),
        pnl: (currentNav + amount - Number(strategy.startingBalance) - amount).toFixed(6),
        positions: [],
        orders: [],
        capturedAt: occurredAt,
      });
    }
    return { duplicate: false };
  });

  return NextResponse.json({
    success: true,
    duplicate: result.duplicate,
    capitalFlow: { amount, navBeforeFlow, occurredAt: occurredAt.toISOString(), applyToPaperBalance, idempotencyKey },
  });
}
