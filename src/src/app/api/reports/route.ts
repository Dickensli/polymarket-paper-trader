import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, agentReports, strategies } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';

/**
 * Agent Reports API — list and save reports.
 *
 * GET  /api/reports?strategy_id=...&limit=3  → list recent reports
 * POST /api/reports  { strategy_id, filename, content }  → save a report
 */

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = request.nextUrl;
    const strategyId = searchParams.get('strategy_id');
    if (!strategyId) {
      return NextResponse.json({ error: 'Missing strategy_id parameter' }, { status: 400 });
    }

    const rawLimit = parseInt(searchParams.get('limit') ?? '3', 10);
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 3), 50);

    const db = getDb();

    // Resolve strategy to get UUID
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, userId),
        eq(strategies.strategyId, strategyId),
      ),
    });

    if (!strategy) {
      return NextResponse.json({ error: `Strategy "${strategyId}" not registered.` }, { status: 404 });
    }

    const reports = await db
      .select({
        id: agentReports.id,
        filename: agentReports.filename,
        strategy_id: agentReports.strategyName,
        createdAt: agentReports.createdAt,
      })
      .from(agentReports)
      .where(and(eq(agentReports.userId, userId), eq(agentReports.strategyId, strategy.id)))
      .orderBy(desc(agentReports.createdAt))
      .limit(limit);

    return NextResponse.json({ data: reports, meta: { count: reports.length, limit } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await request.json();
    const { strategy_id, filename, content } = body;

    if (!strategy_id || !filename || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: strategy_id, filename, content' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Resolve strategy to get UUID
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, userId),
        eq(strategies.strategyId, strategy_id),
      ),
    });

    if (!strategy) {
      return NextResponse.json({ error: `Strategy "${strategy_id}" not registered.` }, { status: 404 });
    }

    // Upsert: if a report with the same (userId, strategyName, filename) exists, update it
    const existing = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, userId),
        eq(agentReports.strategyName, strategy.strategyId),
        eq(agentReports.filename, filename),
      ),
    });

    if (existing) {
      await db
        .update(agentReports)
        .set({ content })
        .where(eq(agentReports.id, existing.id));
      return NextResponse.json({ data: { id: existing.id, filename, status: 'updated' } });
    }

    const [inserted] = await db
      .insert(agentReports)
      .values({
        userId,
        strategyId: strategy.id,
        strategyName: strategy.strategyId,
        filename,
        content
      })
      .returning({ id: agentReports.id });

    return NextResponse.json({ data: { id: inserted.id, filename, status: 'created' } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
