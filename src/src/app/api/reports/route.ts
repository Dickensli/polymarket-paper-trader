import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, agentReports } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';

/**
 * Agent Reports API — list and save reports.
 *
 * GET  /api/reports?account=...&limit=3  → list recent reports
 * POST /api/reports  { account, filename, content }  → save a report
 */

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = request.nextUrl;
    const account = searchParams.get('account');
    if (!account) {
      return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 });
    }

    const rawLimit = parseInt(searchParams.get('limit') ?? '3', 10);
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 3), 50);

    const db = getDb();
    const reports = await db
      .select({
        id: agentReports.id,
        filename: agentReports.filename,
        account: agentReports.account,
        createdAt: agentReports.createdAt,
      })
      .from(agentReports)
      .where(and(eq(agentReports.userId, userId), eq(agentReports.account, account)))
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
    const { account, filename, content } = body;

    if (!account || !filename || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: account, filename, content' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Upsert: if a report with the same (userId, account, filename) exists, update it
    const existing = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, userId),
        eq(agentReports.account, account),
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
      .values({ userId, account, filename, content })
      .returning({ id: agentReports.id });

    return NextResponse.json({ data: { id: inserted.id, filename, status: 'created' } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
