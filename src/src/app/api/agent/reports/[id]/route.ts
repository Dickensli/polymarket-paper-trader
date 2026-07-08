import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { agentReports, getDb } from '@/lib/db';

const GLOBAL_AGENT_VIEWER_EMAILS = new Set(['dickenslihaocheng@gmail.com']);

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
    const canViewAll = GLOBAL_AGENT_VIEWER_EMAILS.has(session.user.email ?? '');

    const report = await db.query.agentReports.findFirst({
      where: canViewAll
        ? eq(agentReports.id, id)
        : and(
            eq(agentReports.id, id),
            eq(agentReports.userId, session.user.id),
          ),
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        filename: report.filename,
        account: report.strategyName,
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
