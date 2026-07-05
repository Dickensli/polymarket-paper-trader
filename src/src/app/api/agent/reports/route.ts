import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { agentReports, getDb, strategies } from '@/lib/db';

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

    const existing = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, session.user.id),
        eq(agentReports.strategyId, strategy.id),
        eq(agentReports.filename, report.filename),
      ),
    });

    const values = {
      strategyId: strategy.id,
      runId: report.run_id ?? null,
      userId: session.user.id,
      strategyName: report.strategy_id,
      filename: report.filename,
      content: report.content,
      title: report.title ?? null,
      lessonsLearned: report.lessons_learned ?? null,
      nextSteps: report.next_steps ?? null,
      portfolioSummary: report.portfolio_summary ?? {},
      tradeSummary: report.trade_summary ?? {},
      createdAt: new Date(),
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

    if (existing) {
      const [updated] = await db
        .update(agentReports)
        .set(values)
        .where(eq(agentReports.id, existing.id))
        .returning();
      return NextResponse.json({ data: sanitizeAgentReport(updated), updated: true });
    }

    const [created] = await db.insert(agentReports).values(values).returning();
    return NextResponse.json({ data: sanitizeAgentReport(created), updated: false }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
