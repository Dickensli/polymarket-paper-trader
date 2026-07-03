import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { agentReports, getDb } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = getDb();
    const report = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.id, id),
        eq(agentReports.userId, session.user.id),
      ),
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        id: report.id,
        strategy_id: report.strategyId,
        run_id: report.runId,
        filename: report.filename,
        account: report.account,
        title: report.title,
        content: report.content,
        lessons_learned: report.lessonsLearned,
        next_steps: report.nextSteps,
        portfolio_summary: report.portfolioSummary,
        trade_summary: report.tradeSummary,
        created_at: report.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
