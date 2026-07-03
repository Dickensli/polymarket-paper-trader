import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { agentReports, getDb, strategies } from '@/lib/db';

const reportSchema = z.object({
  strategy_name: z.string().min(1).max(255),
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

    const strategyName = request.nextUrl.searchParams.get('strategy_name');
    if (!strategyName) {
      return NextResponse.json(
        { error: 'Missing required query parameter: strategy_name' },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Number(request.nextUrl.searchParams.get('limit') ?? 5) || 5,
      25,
    );
    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: eq(strategies.strategyName, strategyName),
    });

    const reports = await db
      .select({
        id: agentReports.id,
        filename: agentReports.filename,
        title: agentReports.title,
        createdAt: agentReports.createdAt,
      })
      .from(agentReports)
      .where(
        and(
          eq(agentReports.userId, session.user.id),
          strategy
            ? eq(agentReports.strategyId, strategy.id)
            : eq(agentReports.account, strategyName),
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
      where: eq(strategies.strategyName, report.strategy_name),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Strategy "${report.strategy_name}" is not registered.` },
        { status: 404 },
      );
    }

    const existing = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, session.user.id),
        eq(agentReports.account, report.strategy_name),
        eq(agentReports.filename, report.filename),
      ),
    });

    const values = {
      strategyId: strategy.id,
      runId: report.run_id ?? null,
      userId: session.user.id,
      account: report.strategy_name,
      filename: report.filename,
      content: report.content,
      title: report.title ?? null,
      lessonsLearned: report.lessons_learned ?? null,
      nextSteps: report.next_steps ?? null,
      portfolioSummary: report.portfolio_summary ?? {},
      tradeSummary: report.trade_summary ?? {},
      createdAt: new Date(),
    };

    if (existing) {
      const [updated] = await db
        .update(agentReports)
        .set(values)
        .where(eq(agentReports.id, existing.id))
        .returning();
      return NextResponse.json({ data: updated, updated: true });
    }

    const [created] = await db.insert(agentReports).values(values).returning();
    return NextResponse.json({ data: created, updated: false }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
