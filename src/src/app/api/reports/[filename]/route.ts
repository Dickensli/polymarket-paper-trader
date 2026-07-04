import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, agentReports, strategies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

/**
 * Read a single agent report by filename.
 *
 * GET /api/reports/[filename]?strategy_id=...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { filename } = await params;
    const { searchParams } = request.nextUrl;
    const strategyId = searchParams.get('strategy_id');

    if (!strategyId) {
      return NextResponse.json({ error: 'Missing strategy_id parameter' }, { status: 400 });
    }

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

    const report = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, userId),
        eq(agentReports.strategyId, strategy.id),
        eq(agentReports.filename, decodeURIComponent(filename)),
      ),
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        id: report.id,
        filename: report.filename,
        strategy_id: report.strategyName,
        content: report.content,
        createdAt: report.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
