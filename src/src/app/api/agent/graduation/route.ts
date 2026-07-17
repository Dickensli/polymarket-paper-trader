import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { getStrategyGraduation } from '@/lib/strategy-graduation';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const currentStrategyId = request.nextUrl.searchParams.get('strategy_id');
  const sourceStrategyId = request.nextUrl.searchParams.get('source_strategy_id') || currentStrategyId;
  if (!currentStrategyId || !sourceStrategyId) {
    return NextResponse.json({ error: 'strategy_id is required' }, { status: 400 });
  }

  const db = getDb();
  let sourceUserId = session.user.id;
  if (sourceStrategyId !== currentStrategyId) {
    const accountId = request.headers.get('x-agent-account-id');
    if (!accountId) return NextResponse.json({ error: 'Missing agent account identity' }, { status: 403 });
    sourceUserId = resolveTargetUserId(accountId, sourceStrategyId, 'kalshi');
  }
  const strategy = await db.query.strategies.findFirst({
    where: and(
      eq(strategies.userId, sourceUserId),
      eq(strategies.strategyId, sourceStrategyId),
      eq(strategies.platform, 'kalshi'),
      eq(strategies.agentMode, 'paper'),
    ),
  });
  if (!strategy) return NextResponse.json({ error: 'Shadow strategy not found' }, { status: 404 });

  const scorecard = await getStrategyGraduation(strategy);
  return NextResponse.json({
    strategy_id: currentStrategyId,
    source_strategy_id: sourceStrategyId,
    ...scorecard,
    message: scorecard.graduated
      ? 'GRADUATION_READY: server criteria passed. Human approval is still required before real-money activation.'
      : 'Shadow validation is still in progress.',
  });
}
