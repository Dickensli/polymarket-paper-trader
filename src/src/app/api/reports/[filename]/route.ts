import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, agentReports } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

/**
 * Read a single agent report by filename.
 *
 * GET /api/reports/[filename]?account=...
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
    const account = searchParams.get('account');

    if (!account) {
      return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 });
    }

    const db = getDb();
    const report = await db.query.agentReports.findFirst({
      where: and(
        eq(agentReports.userId, userId),
        eq(agentReports.account, account),
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
        account: report.account,
        content: report.content,
        createdAt: report.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
